#!/usr/bin/env bash
set -euo pipefail

REPO="${OPENCLAYGENT_REPO:-https://github.com/simonbalfe/openclaygent.git}"
DIR="${OPENCLAYGENT_DIR:-$HOME/openclaygent}"

command -v git >/dev/null 2>&1 || { echo "git is required. Install it first: https://git-scm.com"; exit 1; }

if [ -d "${DIR}/.git" ]; then
  echo "openclaygent already at ${DIR} - updating."
  git -C "${DIR}" pull --ff-only
else
  echo "Cloning openclaygent into ${DIR}"
  git clone "${REPO}" "${DIR}"
fi

cd "${DIR}"

if [ -e /dev/tty ]; then
  exec ./setup.sh < /dev/tty
else
  echo "No terminal detected for interactive key prompts - running non-interactive."
  echo "After it finishes, edit ${DIR}/.env and run ./setup.sh again."
  exec ./setup.sh
fi
