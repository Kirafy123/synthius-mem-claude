#!/usr/bin/env bash
# Synthius-Mem for Claude Code — Install Script (macOS / Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/Kirafy123/synthius-mem-claude/main/install.sh | bash
#   or:  bash install.sh

set -e

echo "=== Synthius-Mem for Claude Code — Installer ==="
echo ""

CLAUDE_DIR="$HOME/.claude"
MEMORY_DIR=""
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

if [ ! -d "$CLAUDE_DIR" ]; then
  echo "ERROR: Claude Code not found at $CLAUDE_DIR"
  echo "Please make sure Claude Code is installed and has been run at least once."
  exit 1
fi

echo "✓ Found Claude Code directory at $CLAUDE_DIR"

# Find existing memory dir: look for any projects/<id>/memory/ that has a domains/ subdir
EXISTING_MEM=$(find "$CLAUDE_DIR/projects" -mindepth 2 -maxdepth 2 -type d -name "memory" 2>/dev/null | while read d; do
  [ -d "$d/domains" ] && echo "$d" && break
done | head -1)

if [ -n "$EXISTING_MEM" ]; then
  MEMORY_DIR="$EXISTING_MEM"
  echo "✓ Found existing memory directory: $MEMORY_DIR"
else
  MEMORY_DIR="$CLAUDE_DIR/projects/synthius-mem/memory"
  mkdir -p "$MEMORY_DIR"
  echo "✓ Created memory directory: $MEMORY_DIR"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Copy domain templates
echo ""
echo "Installing memory domains..."
DOMAINS=("01-biography" "02-experiences" "03-preferences" "04-social-circle" "05-work" "06-psychometrics")
TODAY=$(date +%Y-%m-%d)

for d in "${DOMAINS[@]}"; do
  mkdir -p "$MEMORY_DIR/domains/$d"
  DEST="$MEMORY_DIR/domains/$d/_index.md"
  if [ ! -f "$DEST" ]; then
    sed "s/PLACEHOLDER_DATE/$TODAY/g" "$SCRIPT_DIR/memory/domains/$d/_index.md" > "$DEST"
    echo "  ✓ domains/$d/_index.md"
  else
    echo "  ⊘ domains/$d/_index.md (already exists, skipping)"
  fi
done

# Copy support files
mkdir -p "$MEMORY_DIR/.pending" "$MEMORY_DIR/archive"

if [ ! -f "$MEMORY_DIR/consolidation-log.md" ]; then
  cp "$SCRIPT_DIR/memory/consolidation-log.md" "$MEMORY_DIR/consolidation-log.md"
  echo "  ✓ consolidation-log.md"
else
  echo "  ⊘ consolidation-log.md (already exists, skipping)"
fi

if [ ! -f "$MEMORY_DIR/MEMORY.md" ]; then
  cp "$SCRIPT_DIR/memory/MEMORY.md.template" "$MEMORY_DIR/MEMORY.md"
  echo "  ✓ MEMORY.md (created from template)"
else
  echo "  ⊘ MEMORY.md (already exists, preserving)"
fi

# Copy consolidation script
mkdir -p "$MEMORY_DIR/scripts"
cp "$SCRIPT_DIR/scripts/session-end.js" "$MEMORY_DIR/scripts/session-end.js"
echo "  ✓ scripts/session-end.js"
cp "$SCRIPT_DIR/scripts/session-start.js" "$MEMORY_DIR/scripts/session-start.js"
echo "  ✓ scripts/session-start.js"

# Install skill
mkdir -p "$CLAUDE_DIR/skills"
cp "$SCRIPT_DIR/.claude/skills/memory-ops.md" "$CLAUDE_DIR/skills/memory-ops.md"
echo "  ✓ memory-ops.md skill (installed/updated)"

# Merge hooks into settings.json
echo ""
echo "Installing hooks..."
if [ -f "$SETTINGS_FILE" ]; then
  node -e "
    const fs = require('fs');
    const settingsPath = '$SETTINGS_FILE';
    const hooksPath = '$SCRIPT_DIR/hooks/settings-hooks.json';
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    const memDir = '$MEMORY_DIR';

    for (const [event, entries] of Object.entries(hooks.hooks)) {
      if (!settings.hooks) settings.hooks = {};
      settings.hooks[event] = entries.map(entry => {
        const cmd = entry.hooks[0].command.replace(/MEMORY_PATH_PLACEHOLDER/g, memDir);
        return { hooks: [{ type: entry.hooks[0].type, command: cmd, statusMessage: entry.hooks[0].statusMessage }] };
      });
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    console.log('  ✓ Hooks merged into settings.json');
  "
else
  echo "  ✗ settings.json not found at $SETTINGS_FILE"
  echo "    Please run Claude Code at least once, then re-run this script."
  exit 1
fi

echo ""
echo "=== Installation Complete ==="
echo ""
echo "Memory directory: $MEMORY_DIR"
echo ""
echo "To verify:"
echo "  node $SCRIPT_DIR/test/test-memory.js"
echo ""
echo "SessionStart loads your memory index automatically."
echo "SessionEnd writes pending captures to domain files automatically."
echo "Run 'consolidate' in a session to do semantic dedup/merge."
echo ""
