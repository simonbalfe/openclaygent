#!/usr/bin/env bash
set -euo pipefail

REPO="${OPENCLAYGENT_REPO:-https://github.com/simonbalfe/openclaygent.git}"
DIR="${OPENCLAYGENT_DIR:-$HOME/openclaygent}"

SUDO=""
if [ "$(id -u)" != "0" ] && command -v sudo >/dev/null 2>&1; then SUDO="sudo"; fi

install_pkg() {
  if command -v apt-get >/dev/null 2>&1; then ${SUDO} apt-get update -qq && ${SUDO} apt-get install -y -qq "$1"
  elif command -v dnf >/dev/null 2>&1; then ${SUDO} dnf install -y "$1"
  elif command -v yum >/dev/null 2>&1; then ${SUDO} yum install -y "$1"
  elif command -v apk >/dev/null 2>&1; then ${SUDO} apk add "$1"
  elif command -v pacman >/dev/null 2>&1; then ${SUDO} pacman -S --noconfirm "$1"
  elif command -v zypper >/dev/null 2>&1; then ${SUDO} zypper install -y "$1"
  elif command -v brew >/dev/null 2>&1; then brew install "$1"
  else return 1; fi
}

need() {
  command -v "$1" >/dev/null 2>&1 && return 0
  echo "$1 not found - installing."
  install_pkg "$1" && command -v "$1" >/dev/null 2>&1 || {
    echo "Could not install $1 automatically. Install it with your package manager and re-run."
    exit 1
  }
}

need curl
need git

if [ -d "${DIR}/.git" ]; then
  echo "openclaygent already at ${DIR} - updating."
  git -C "${DIR}" pull --ff-only
else
  echo "Cloning openclaygent into ${DIR}"
  git clone "${REPO}" "${DIR}"
fi

cd "${DIR}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed. Setup will install the CLI, but the local API requires Docker Desktop, OrbStack, or Docker Engine with Compose."
fi

if ! command -v bun >/dev/null 2>&1; then
  need unzip
  echo "Bun not found - installing Bun."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

if (exec < /dev/tty) 2>/dev/null; then
  exec bun run scripts/setup.ts < /dev/tty
else
  echo "No terminal detected for interactive key prompts - running non-interactive."
  echo "After it finishes, edit ${DIR}/.env and run 'bun run setup' again."
  exec bun run scripts/setup.ts
fi
