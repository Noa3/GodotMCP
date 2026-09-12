#!/usr/bin/env bash
set -euo pipefail
if [[ $# -lt 1 ]]; then
  echo 'Usage: scripts/install.sh /path/to/godot-project [--enable] [--autoload]' >&2
  exit 2
fi
PROJECT="$(cd "$1" && pwd)"
shift
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"
npm ci
npm run build
node dist/cli/index.js install "$PROJECT" "$@"
