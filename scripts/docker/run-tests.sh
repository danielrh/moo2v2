#!/usr/bin/env bash
set -euo pipefail

SOURCE_DIR="${SOURCE_DIR:-/src}"
WORK_DIR="${WORK_DIR:-/work}"
OUTPUT_DIR="${OUTPUT_DIR:-/output}"
RUN_SUITE="${RUN_SUITE:-all}"
SOURCE_STDIN_TAR="${SOURCE_STDIN_TAR:-0}"

TOTAL_STEPS=0
PASSED_STEPS=0
FAILED_STEPS=0

declare -a STEP_NAMES=()
declare -a STEP_STATUS=()
declare -a STEP_DURATION=()
declare -a STEP_DETAILS=()

SCRIPT_START_TS="$(date +%s)"
PHASE_START_TS=0
PHASE_NAME=""

timestamp() {
  date '+%Y-%m-%d %H:%M:%S'
}

format_duration() {
  local seconds="$1"
  printf '%02dm:%02ds' "$((seconds / 60))" "$((seconds % 60))"
}

print_summary() {
  local total_elapsed
  total_elapsed="$(( $(date +%s) - SCRIPT_START_TS ))"
  echo
  echo "========== Docker CI Summary =========="
  echo "Suite: $RUN_SUITE"
  echo "Steps: $TOTAL_STEPS total | $PASSED_STEPS passed | $FAILED_STEPS failed"
  echo "Elapsed: $(format_duration "$total_elapsed")"
  if [ "${#STEP_NAMES[@]}" -gt 0 ]; then
    echo "Step Results:"
    local i
    for i in "${!STEP_NAMES[@]}"; do
      if [ -n "${STEP_DETAILS[$i]}" ]; then
        echo "  - ${STEP_NAMES[$i]}: ${STEP_STATUS[$i]} (${STEP_DURATION[$i]}) | ${STEP_DETAILS[$i]}"
      else
        echo "  - ${STEP_NAMES[$i]}: ${STEP_STATUS[$i]} (${STEP_DURATION[$i]})"
      fi
    done
  fi
  echo "Logs:  $OUTPUT_DIR/logs"
  echo "Artifacts: $OUTPUT_DIR/artifacts"
  echo "======================================="
}

extract_step_details() {
  local name="$1"
  local log_file="$2"

  case "$name" in
    e2e)
      grep -Eo '[0-9]+ passed \([^)]+\)' "$log_file" | tail -n 1 || true
      ;;
    test|test-game|test-balance)
      local files_line tests_line
      files_line="$(grep -E '^ Test Files' "$log_file" | tail -n 1 | sed 's/^ *//' || true)"
      tests_line="$(grep -E '^ +Tests' "$log_file" | tail -n 1 | sed 's/^ *//' || true)"
      if [ -n "$files_line" ] && [ -n "$tests_line" ]; then
        echo "$files_line | $tests_line"
      elif [ -n "$files_line" ]; then
        echo "$files_line"
      elif [ -n "$tests_line" ]; then
        echo "$tests_line"
      fi
      ;;
    go-test)
      local ok_count
      ok_count="$(grep -Ec '^ok[[:space:]]' "$log_file" || true)"
      echo "go packages ok: $ok_count"
      ;;
    build)
      grep -E 'built in [0-9]+(\.[0-9]+)?s' "$log_file" | tail -n 1 || true
      ;;
  esac
}

record_step_result() {
  local name="$1"
  local status="$2"
  local duration="$3"
  local log_file="$4"
  local detail
  detail="$(extract_step_details "$name" "$log_file")"
  STEP_NAMES+=("$name")
  STEP_STATUS+=("$status")
  STEP_DURATION+=("$duration")
  STEP_DETAILS+=("$detail")
}

phase_begin() {
  PHASE_NAME="$1"
  PHASE_START_TS="$(date +%s)"
  echo
  echo "[$(timestamp)] [PHASE] BEGIN $PHASE_NAME"
}

phase_end() {
  local end_ts elapsed
  end_ts="$(date +%s)"
  elapsed="$((end_ts - PHASE_START_TS))"
  echo "[$(timestamp)] [PHASE] END   $PHASE_NAME ($(format_duration "$elapsed"))"
}

phase_begin "prepare-output"
mkdir -p "$OUTPUT_DIR/logs" "$OUTPUT_DIR/artifacts"
phase_end

copy_source_tree() {
  echo "[$(timestamp)] [INFO] copy mode: git-tracked+nonignored"
  git -C "$SOURCE_DIR" ls-files -z --cached --others --exclude-standard \
    | tar --null -T - -cf - -C "$SOURCE_DIR" \
    | tar -xf - -C "$WORK_DIR"
}

phase_begin "copy-source"
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
if [ "$SOURCE_STDIN_TAR" = "1" ]; then
  echo "[$(timestamp)] [INFO] copy mode: git-archive-stream"
  tar -xf - -C "$WORK_DIR"
else
  copy_source_tree
fi
cd "$WORK_DIR"
phase_end

# Repos mounted from Windows may carry CRLF shell scripts, which breaks strict
# mode options (for example: "set: pipefail\r: invalid option name").
phase_begin "normalize-shell-scripts"
find scripts -type f -name '*.sh' -exec sed -i 's/\r$//' {} +
phase_end

run_step() {
  local name="$1"
  shift
  TOTAL_STEPS=$((TOTAL_STEPS + 1))
  local log_file="$OUTPUT_DIR/logs/${name}.log"
  local start_ts
  local end_ts
  local elapsed
  local exit_code

  echo
  echo "[$(timestamp)] [RUN ] $name"
  echo "       log: $log_file"

  start_ts="$(date +%s)"
  set +e
  "$@" 2>&1 | tee "$log_file"
  exit_code=${PIPESTATUS[0]}
  set -e
  end_ts="$(date +%s)"
  elapsed=$((end_ts - start_ts))

  if [ "$exit_code" -eq 0 ]; then
    PASSED_STEPS=$((PASSED_STEPS + 1))
    echo "[$(timestamp)] [PASS] $name ($(format_duration "$elapsed"))"
    record_step_result "$name" "PASS" "$(format_duration "$elapsed")" "$log_file"
  else
    FAILED_STEPS=$((FAILED_STEPS + 1))
    echo "[$(timestamp)] [FAIL] $name ($(format_duration "$elapsed"))"
    record_step_result "$name" "FAIL" "$(format_duration "$elapsed")" "$log_file"
    print_summary
    exit "$exit_code"
  fi
}

prepare_node_modules() {
  local cache_dir="/opt/moo2v2-deps"
  local cache_lock="$cache_dir/package-lock.sha256"
  local cache_node_modules="$cache_dir/node_modules"

  if [ -f package-lock.json ] && [ -f "$cache_lock" ] && [ -d "$cache_node_modules" ]; then
    local expected actual
    expected="$(cut -d' ' -f1 "$cache_lock")"
    actual="$(sha256sum package-lock.json | cut -d' ' -f1)"
    if [ "$expected" = "$actual" ]; then
      echo "[$(timestamp)] [INFO] Using cached npm dependencies from Docker image layer"
      rm -rf node_modules
      # Keep deps physically under /work so Vite's serve allow-list is happy.
      # Hardlink copy is fast and space-efficient on the same filesystem.
      if ! cp -al "$cache_node_modules" node_modules 2>/dev/null; then
        cp -a "$cache_node_modules" node_modules
      fi
      return 0
    fi
    echo "[$(timestamp)] [INFO] package-lock.json changed; refreshing dependencies with npm ci"
  else
    echo "[$(timestamp)] [INFO] No dependency cache found in image; running npm ci"
  fi

  run_step npm-ci npm ci --include=dev
}

echo "[$(timestamp)] Starting Docker CI runner (suite: $RUN_SUITE)"

case "$RUN_SUITE" in
  all|node|build-test|check-build-test|e2e|playwright)
    prepare_node_modules
    ;;
esac

case "$RUN_SUITE" in
  all|node|build-test|check-build-test)
    run_step check npm run check
    run_step build npm run build
    run_step test npm test
    run_step test-game npm run test:game
    run_step test-balance npm run test:balance
    ;;
esac

case "$RUN_SUITE" in
  all|go|server)
    run_step go-test bash -lc "cd server && go test ./..."
    ;;
esac

case "$RUN_SUITE" in
  all|e2e|playwright)
    run_step e2e npm run test:e2e
    ;;
esac

if [ -d playwright-report ]; then
  rm -rf "$OUTPUT_DIR/artifacts/playwright-report"
  cp -a playwright-report "$OUTPUT_DIR/artifacts/"
fi

if [ -d test-results ]; then
  rm -rf "$OUTPUT_DIR/artifacts/test-results"
  cp -a test-results "$OUTPUT_DIR/artifacts/"
fi

if [ -d dist ]; then
  rm -rf "$OUTPUT_DIR/artifacts/dist"
  cp -a dist "$OUTPUT_DIR/artifacts/"
fi

print_summary
echo "Docker CI run finished successfully."
