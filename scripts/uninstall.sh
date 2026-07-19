#!/usr/bin/env bash
set -euo pipefail

DIR="${OPENCLAYGENT_DIR:-$HOME/openclaygent}"

is_ours() {
  [ -f "${1}/package.json" ] && grep -q '"name"[[:space:]]*:[[:space:]]*"openclaygent"' "${1}/package.json" 2>/dev/null
}

if [ "${OPENCLAYGENT_YES:-}" != "1" ] && [ "${1:-}" != "-y" ]; then
  if [ -e /dev/tty ]; then
    printf "Remove openclaygent (containers, images, CLI link, %s)? ~/.zshrc keys are kept. [y/N] " "${DIR}"
    read -r reply < /dev/tty
    case "${reply}" in y | Y | yes | YES) ;; *) exit 0 ;; esac
  else
    echo "Non-interactive: re-run with -y (or OPENCLAYGENT_YES=1) to confirm." >&2
    exit 1
  fi
fi

if command -v docker >/dev/null 2>&1; then
  [ -f "${DIR}/docker-compose.yml" ] && (cd "${DIR}" && docker compose down -v --remove-orphans >/dev/null 2>&1) || true
  imgs="$(docker images -q \
    ghcr.io/simonbalfe/openclaygent \
    ghcr.io/simonbalfe/openclaygent-patchright \
    ghcr.io/simonbalfe/openclaygent-search 2>/dev/null | sort -u)"
  [ -n "${imgs}" ] && docker rmi -f ${imgs} >/dev/null 2>&1 || true
fi

if command -v bun >/dev/null 2>&1 && is_ours "${DIR}"; then
  (cd "${DIR}" && bun unlink >/dev/null 2>&1) || true
fi
LINK="$HOME/.bun/bin/openclaygent"
if [ -L "${LINK}" ]; then
  case "$(readlink "${LINK}")" in *openclaygent*) rm -f "${LINK}" ;; esac
fi

if [ -d "${DIR}" ]; then
  resolved="$(cd "${DIR}" && pwd -P)"
  if [ -z "${resolved}" ] || [ "${resolved}" = "/" ] || [ "${resolved}" = "${HOME}" ]; then
    echo "Skipped ${DIR}: unsafe path, remove manually." >&2
  elif ! is_ours "${DIR}"; then
    echo "Skipped ${DIR}: not an openclaygent checkout." >&2
  else
    rm -rf "${DIR}"
  fi
fi

echo "openclaygent removed."
