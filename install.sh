#!/usr/bin/env bash
# install.sh — set up getframe so it works in EVERY project/directory.
#
# Run once after cloning:
#     bash install.sh
#
# It resolves its own location (no hardcoded paths), installs deps, and registers
# the getframe MCP server with Claude Code at *user* scope so the tools and the
# /getframe prompt are available no matter which directory you launch Claude from.

set -e

# ── Resolve the directory this script lives in (works from any cwd) ─────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Sanity checks ───────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "❌  node is not installed. Install Node.js >=18 first: https://nodejs.org"
  exit 1
fi

if ! command -v claude >/dev/null 2>&1; then
  echo "❌  the 'claude' CLI was not found on your PATH."
  echo "    Install Claude Code first: https://docs.claude.com/claude-code"
  exit 1
fi

# ── Install dependencies ────────────────────────────────────────────────────────
echo "📦  Installing dependencies in $SCRIPT_DIR ..."
npm install

# ── Register the MCP server (user scope = available in all directories) ─────────
echo "🔌  Registering the getframe MCP server (user scope) ..."
claude mcp remove getframe -s user >/dev/null 2>&1 || true
claude mcp add getframe node "$SCRIPT_DIR/server.mjs" -s user

echo ""
echo "✅  getframe is installed and available in every project."
echo ""
echo "    Verify:   claude mcp list      # should show: getframe"
echo ""
echo "    Use it in any Claude Code session:"
echo "      /mcp__getframe__getframe <framer-component-url>"
echo ""
echo "    …or just ask Claude:"
echo "      \"use getframe on https://framer.com/m/Component-XXXX.js@hash\""
