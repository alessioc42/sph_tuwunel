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
HS="${PUB#https://}"
HS="${HS#http://}"
HS="${HS%%/*}"

mkdir -p deploy/generated

sed -e "s|__HOMESERVER_HOST__|${HS}|g" \
    -e "s|__SERVER_NAME__|${SERVER_NAME}|g" \
    deploy/cinny-config.json.template > deploy/generated/cinny-config.json

sed -e "s|__SERVER_NAME__|${SERVER_NAME}|g" \
    -e "s|__JWT_SECRET__|${JWT_SECRET}|g" \
    deploy/tuwunel.toml.template > deploy/generated/tuwunel.toml

echo "Rendered for local/non-Portainer use:"
echo "  Cinny homeserverList host: ${HS}"
echo "  Cinny Web:                 ${CHAT}"
echo "  SPH tile URL:              ${PUB}/"
echo "  Folder name:               ${FOLDER_NAME:-matrix}"
