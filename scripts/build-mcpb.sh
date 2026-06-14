#!/usr/bin/env bash
# Build a Claude Desktop extension (.mcpb) from the compiled server.
# Stages dist/ plus production dependencies, then validates and packs.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
stage="$root/build/mcpb"
out="$root/proxmox-mcp-server.mcpb"

npm --prefix "$root" run build

rm -rf "$stage"
mkdir -p "$stage"
cp "$root/manifest.json" "$stage/manifest.json"
cp "$root/package.json" "$stage/package.json"
cp "$root/README.md" "$stage/README.md"
cp "$root/LICENSE" "$stage/LICENSE"
cp -R "$root/dist" "$stage/dist"

# Production dependencies only — the bundle must run without a build step.
(cd "$stage" && npm install --omit=dev --no-audit --no-fund --ignore-scripts --silent)

npx -y @anthropic-ai/mcpb@latest validate "$stage/manifest.json"
npx -y @anthropic-ai/mcpb@latest pack "$stage" "$out"
echo "built $out"
