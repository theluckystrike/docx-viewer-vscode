#!/bin/bash
# Runs test/vscode-smoke/index.js inside a real, isolated VS Code instance (own user-data and extensions dirs).
# Usage: scripts/smoke-vscode.sh [path-to-VS-Code-binary]   Run `npm run build` first.
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODE_BIN="${1:-/Applications/Visual Studio Code.app/Contents/MacOS/Code}"
W="$HOME/docx-viewer-vscode-work/smoke-$$"
mkdir -p "$W/ud" "$W/ext"
DV_SMOKE_OUT="$W/result.txt" DV_FIXTURES="$ROOT/test/fixtures" timeout 150 "$CODE_BIN" \
  --user-data-dir="$W/ud" --extensions-dir="$W/ext" --disable-extensions --skip-welcome --skip-release-notes \
  --disable-workspace-trust --new-window --extensionDevelopmentPath="$ROOT" --extensionTestsPath="$ROOT/test/vscode-smoke/index.js" >/dev/null 2>&1 || true
cat "$W/result.txt"
FAILS=$(grep -c '^FAIL' "$W/result.txt" || true)
rm -rf "$W"
[ "$FAILS" = 0 ]
