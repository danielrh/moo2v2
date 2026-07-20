#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
IMAGE_NAME="${IMAGE_NAME:-moo2v2-ci-runner:local}"
OUTPUT_DIR="${OUTPUT_DIR:-$ROOT_DIR/docker-output}"
RUN_SUITE="${RUN_SUITE:-all}"
SOURCE_MODE="${SOURCE_MODE:-docker-cp}"
SKIP_BUILD=0

usage() {
  cat <<EOF
Usage: ./run-docker.sh [--suite <all|node|go|e2e>] [--output-dir <path>] [--image <name>] [--source-mode <mount|docker-cp|git>] [--no-build]

Builds a local CI runner image with all prerequisites and runs tests in Docker.
Default source mode is docker-cp (no host bind mounts).
Outputs (logs and artifacts) are written to docker-output/ by default.
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --suite)
      RUN_SUITE="$2"
      shift 2
      ;;
    --output-dir)
      OUTPUT_DIR="$2"
      shift 2
      ;;
    --image)
      IMAGE_NAME="$2"
      shift 2
      ;;
    --source-mode)
      SOURCE_MODE="$2"
      shift 2
      ;;
    --no-build)
      SKIP_BUILD=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 2
      ;;
  esac
done

mkdir -p "$OUTPUT_DIR"

case "$SOURCE_MODE" in
  mount|docker-cp|git)
    ;;
  *)
    echo "Invalid --source-mode: $SOURCE_MODE (expected mount, docker-cp, or git)" >&2
    exit 2
    ;;
esac

copy_source_to_container() {
  local container_id="$1"
  local source_mode="$2"

  if [ "$source_mode" = "git" ]; then
    source_mode="docker-cp"
  fi

  case "$source_mode" in
    docker-cp)
      echo "Transferring source via git-tracked + non-ignored archive using docker cp"
      local staging_dir
      staging_dir="$(mktemp -d)"
      mkdir -p "$staging_dir/src"
      git -C "$ROOT_DIR" ls-files -z --cached --others --exclude-standard \
        | tar -C "$ROOT_DIR" --null -T - -cf - \
        | tar -xf - -C "$staging_dir/src"
      docker cp "$staging_dir/src" "$container_id:/"
      rm -rf "$staging_dir"
      ;;
    mount)
      # No-op: source is bind mounted in mount mode.
      ;;
  esac
}

run_with_docker_cp() {
  local container_id
  local run_status=0

  container_id="$(docker create \
    -e RUN_SUITE="$RUN_SUITE" \
    -e SOURCE_DIR=/src \
    -e WORK_DIR=/work \
    -e OUTPUT_DIR=/output \
    -e CI=1 \
    "$IMAGE_NAME")"

  trap "docker rm -f '$container_id' >/dev/null 2>&1 || true" EXIT

  copy_source_to_container "$container_id" "$SOURCE_MODE"

  set +e
  docker start -a "$container_id"
  run_status=$?
  set -e

  # Copy logs/artifacts out even on failures.
  docker cp "$container_id:/output/." "$OUTPUT_DIR/" >/dev/null 2>&1 || true

  exit "$run_status"
}

if [ "$SKIP_BUILD" -eq 0 ]; then
  echo "Building Docker image: $IMAGE_NAME"
  docker build \
    -f "$ROOT_DIR/scripts/docker/ci-runner.Dockerfile" \
    -t "$IMAGE_NAME" \
    "$ROOT_DIR"
fi

echo "Running suite '$RUN_SUITE' with output dir: $OUTPUT_DIR"

if [ "$SOURCE_MODE" = "mount" ]; then
  docker run --rm \
    -e RUN_SUITE="$RUN_SUITE" \
    -e SOURCE_DIR=/src \
    -e WORK_DIR=/work \
    -e OUTPUT_DIR=/output \
    -e CI=1 \
    -v "$ROOT_DIR:/src:ro" \
    -v "$OUTPUT_DIR:/output" \
    "$IMAGE_NAME"
else
  run_with_docker_cp
fi
