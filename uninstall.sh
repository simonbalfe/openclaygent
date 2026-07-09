#!/usr/bin/env bash
set -euo pipefail

DIR="${OPENCLAYGENT_DIR:-$HOME/openclaygent}"

echo "This will remove openclaygent from your system:"
echo "  - stop and delete its Docker containers, network, and volumes"
echo "  - remove its Docker images (api, patchright, searxng base)"
echo "  - remove the global 'openclaygent' CLI link"
echo "  - delete the install directory ${DIR}"
echo "Your API keys in ~/.zshrc are NOT touched."
echo

if [ "${OPENCLAYGENT_YES:-}" != "1" ] && [ "${1:-}" != "-y" ]; then
  if [ -e /dev/tty ]; then
    printf "Proceed? [y/N] "
    read -r reply < /dev/tty
    case "${reply}" in y | Y | yes | YES) ;; *) echo "Aborted."; exit 0 ;; esac
  else
    echo "Non-interactive shell. Re-run with -y (or OPENCLAYGENT_YES=1) to confirm."
    exit 1
  fi
fi

if command -v docker >/dev/null 2>&1; then
  if [ -f "${DIR}/docker-compose.yml" ]; then
    echo "Stopping stack..."
    (cd "${DIR}" && docker compose down -v --remove-orphans) || true
  fi
  echo "Removing images..."
  docker rmi -f openclaygent-api openclaygent-patchright >/dev/null 2>&1 || true
  docker rmi -f ghcr.io/simonbalfe/openclaygent-patchright:latest >/dev/null 2>&1 || true
  docker rmi -f searxng/searxng:latest >/dev/null 2>&1 || true
fi

if command -v bun >/dev/null 2>&1 && [ -d "${DIR}" ]; then
  (cd "${DIR}" && bun unlink >/dev/null 2>&1) || true
fi
rm -f "$HOME/.bun/bin/openclaygent" >/dev/null 2>&1 || true

if [ -d "${DIR}" ]; then
  echo "Removing ${DIR}..."
  rm -rf "${DIR}"
fi

echo "openclaygent removed. Your API keys in ~/.zshrc were left untouched."
