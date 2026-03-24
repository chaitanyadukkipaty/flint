#!/bin/bash
# Wrapper to ensure @playwright/mcp runs under Node 18+.
# Claude Code's MCP subprocess may inherit system Node (could be old).
# This script tries nvm first, then falls back to whatever node is in PATH.

# Load nvm if available (macOS Homebrew path first, then standard)
export NVM_DIR="$HOME/.nvm"
[ -s "/opt/homebrew/opt/nvm/nvm.sh" ] && . "/opt/homebrew/opt/nvm/nvm.sh" --no-use
[ -s "$NVM_DIR/nvm.sh" ]              && . "$NVM_DIR/nvm.sh" --no-use

# If current node is too old, switch to a newer version via nvm
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -e "process.stdout.write(String(parseInt(process.version.slice(1))))" 2>/dev/null)
  if [ -n "$NODE_MAJOR" ] && [ "$NODE_MAJOR" -lt 18 ] 2>/dev/null; then
    # Try nvm default → lts → 20 → 18 in order
    nvm use default --silent 2>/dev/null ||
    nvm use --lts   --silent 2>/dev/null ||
    nvm use 20      --silent 2>/dev/null ||
    nvm use 18      --silent 2>/dev/null
  fi
fi

exec npx -y @playwright/mcp@latest "$@"
