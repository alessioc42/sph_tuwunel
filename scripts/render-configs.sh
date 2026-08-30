#!/usr/bin/env bash
# Optional local helper (Portainer uses config-init instead).
# Renders deploy/generated/* from PUBLIC_BASE_URL / ELEMENT_WEB_URL / JWT_SECRET.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

: "${PUBLIC_BASE_URL:?Set PUBLIC_BASE_URL in .env}"
: "${ELEMENT_WEB_URL:?Set ELEMENT_WEB_URL in .env}"
: "${JWT_SECRET:?Set JWT_SECRET in .env}"
: "${MATRIX_SERVER_NAME:?Set MATRIX_SERVER_NAME in .env}"

PUB="${PUBLIC_BASE_URL%/}"
CHAT="${ELEMENT_WEB_URL%/}"
SERVER_NAME="${MATRIX_SERVER_NAME}"

mkdir -p deploy/generated

sed -e "s|__PUBLIC_BASE_URL__|${PUB}|g" \
    -e "s|__SERVER_NAME__|${SERVER_NAME}|g" \
    deploy/element-config.json.template > deploy/generated/element-config.json

sed -e "s|__SERVER_NAME__|${SERVER_NAME}|g" \
    -e "s|__JWT_SECRET__|${JWT_SECRET}|g" \
    deploy/tuwunel.toml.template > deploy/generated/tuwunel.toml

echo "Rendered for local/non-Portainer use:"
echo "  Element homeserver base_url: ${PUB}"
echo "  Element Web:                 ${CHAT}"
echo "  SPH tile URL:                ${PUB}/"
echo "  Folder name:                 ${FOLDER_NAME:-matrix}"
