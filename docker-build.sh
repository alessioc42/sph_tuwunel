#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

IMAGE_NAME="${IMAGE_NAME:-sph-jwt-bridge}"
TAG="${TAG:-dev}"
FULL="${IMAGE_NAME}:${TAG}"

echo "==> Host tests"
SPH_SECRET="${SPH_SECRET:-test-secret-aaaaaaaaaaaaaaaa}" \
JWT_SECRET="${JWT_SECRET:-matrix-plug-e2e-local-hmac-secret-do-not-use-in-prod}" \
MATRIX_HOMESERVER="${MATRIX_HOMESERVER:-http://127.0.0.1:8008}" \
FOLDER_NAME=matrix \
  bun test

echo "==> Docker build ${FULL}"
docker build --target runtime -t "${FULL}" -f Dockerfile .
docker build --target test -t "${IMAGE_NAME}:test" -f Dockerfile .

echo "==> Smoke container (expects tuwunel on host :8008)"
# Host tuwunel is often published as 127.0.0.1:8008 only — use host network.
cid="$(docker run -d --network host \
  -e PORT=13000 \
  -e SPH_SECRET=test-secret-aaaaaaaaaaaaaaaa \
  -e JWT_SECRET=matrix-plug-e2e-local-hmac-secret-do-not-use-in-prod \
  -e PUBLIC_BASE_URL=http://127.0.0.1:13000 \
  -e MATRIX_HOMESERVER=http://127.0.0.1:8008 \
  -e MATRIX_SERVER_NAME=localhost \
  -e ELEMENT_WEB_URL=http://127.0.0.1:8080 \
  -e ENABLE_MATRIX_PROXY=true \
  -e ALLOW_ALL_IPS=true \
  -e FOLDER_NAME=matrix \
  "${FULL}")"

cleanup() { docker rm -f "$cid" >/dev/null 2>&1 || true; }
trap cleanup EXIT

ok=0
for _ in $(seq 1 40); do
  if curl -fsS "http://127.0.0.1:13000/health" >/dev/null 2>&1; then
    ok=1
    break
  fi
  sleep 0.25
done
if [[ "$ok" -ne 1 ]]; then
  echo "health check failed" >&2
  docker logs "$cid" >&2 || true
  exit 1
fi

SPH_SECRET=test-secret-aaaaaaaaaaaaaaaa FOLDER_NAME=matrix \
  bun run ./scripts/smoke-sph.ts "http://127.0.0.1:13000"

echo "==> OK  image=${FULL}"
