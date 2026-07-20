FROM golang:1.26.4-bookworm AS golang_toolchain

FROM mcr.microsoft.com/playwright:v1.61.1-noble

COPY --from=golang_toolchain /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"
ENV GOTOOLCHAIN=local

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install Chrome during image build so Playwright's `channel: 'chrome'`
# works in containers without per-run downloads.
RUN npx -y playwright@1.61.1 install chrome

# Cache JS dependencies in an image layer. This only rebuilds when package
# manifests change, so local test runs don't need npm install every time.
WORKDIR /opt/moo2v2-deps
COPY package.json package-lock.json ./
RUN npm ci --include=dev \
  && sha256sum package-lock.json > package-lock.sha256 \
  && npm cache clean --force

# Cache Go server dependencies in an image layer so e2e startup does not fetch
# modules/toolchains every run.
WORKDIR /opt/moo2v2-go
COPY server/go.mod server/go.sum ./server/
RUN cd server && go mod download

WORKDIR /work

COPY scripts/docker/run-tests.sh /usr/local/bin/run-tests.sh
RUN chmod +x /usr/local/bin/run-tests.sh

ENTRYPOINT ["/usr/local/bin/run-tests.sh"]
