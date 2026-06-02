#!/usr/bin/env bash
# push-to-github.sh
# Run this once on your machine to create the GitHub repo and push.
# Requires: git, curl
# Usage: GITHUB_TOKEN=ghp_xxx GITHUB_USER=yourhandle bash push-to-github.sh

set -e

REPO_NAME="getframe-mcp"
DESCRIPTION="MCP server: fetch Framer components for Claude Code to convert to React"
VISIBILITY="public"   # change to "private" if you want

# ── Validate ──────────────────────────────────────────────────────────────────

if [ -z "$GITHUB_TOKEN" ]; then
  echo "❌  GITHUB_TOKEN is not set."
  echo "    Generate one at: https://github.com/settings/tokens"
  echo "    Needs: repo scope"
  echo ""
  echo "    Then run:"
  echo "    GITHUB_TOKEN=ghp_... GITHUB_USER=yourhandle bash push-to-github.sh"
  exit 1
fi

if [ -z "$GITHUB_USER" ]; then
  # Try to detect from git config
  GITHUB_USER=$(git config --global user.name 2>/dev/null | tr '[:upper:]' '[:lower:]' | tr ' ' '-')
  if [ -z "$GITHUB_USER" ]; then
    echo "❌  GITHUB_USER is not set and could not be detected."
    echo "    Run: GITHUB_USER=yourGitHubHandle bash push-to-github.sh"
    exit 1
  fi
  echo "ℹ️   Detected GitHub user: $GITHUB_USER (override with GITHUB_USER=... if wrong)"
fi

# ── Create the repo via GitHub API ────────────────────────────────────────────

echo "🐙  Creating GitHub repo: $GITHUB_USER/$REPO_NAME ..."

HTTP_STATUS=$(curl -s -o /tmp/gh_create_response.json -w "%{http_code}" \
  -X POST "https://api.github.com/user/repos" \
  -H "Authorization: token $GITHUB_TOKEN" \
  -H "Accept: application/vnd.github+json" \
  -H "X-GitHub-Api-Version: 2022-11-28" \
  -d "{
    \"name\": \"$REPO_NAME\",
    \"description\": \"$DESCRIPTION\",
    \"private\": $([ \"$VISIBILITY\" = \"private\" ] && echo true || echo false),
    \"auto_init\": false
  }")

if [ "$HTTP_STATUS" = "422" ]; then
  echo "⚠️   Repo already exists — will push to existing repo."
elif [ "$HTTP_STATUS" != "201" ]; then
  echo "❌  GitHub API error (HTTP $HTTP_STATUS):"
  cat /tmp/gh_create_response.json
  exit 1
else
  echo "✅  Repo created: https://github.com/$GITHUB_USER/$REPO_NAME"
fi

# ── Push ──────────────────────────────────────────────────────────────────────

REMOTE_URL="https://$GITHUB_USER:$GITHUB_TOKEN@github.com/$GITHUB_USER/$REPO_NAME.git"

if git remote get-url origin &>/dev/null; then
  git remote set-url origin "$REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
fi

echo "🚀  Pushing to GitHub..."
git push -u origin main

# Clean the token from remote URL after push
git remote set-url origin "https://github.com/$GITHUB_USER/$REPO_NAME.git"

echo ""
echo "✅  Done!"
echo ""
echo "    Repo:    https://github.com/$GITHUB_USER/$REPO_NAME"
echo "    Clone:   git clone https://github.com/$GITHUB_USER/$REPO_NAME ~/scripts/getframe-mcp"
echo ""
echo "    Install (registers the MCP at user scope, any directory):"
echo "    cd ~/scripts/getframe-mcp && bash install.sh"
