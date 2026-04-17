#!/usr/bin/env bash
# Synthius-Mem for Claude Code — Install Script (macOS / Linux)
# Usage: curl -fsSL https://raw.githubusercontent.com/YOUR_USERNAME/synthius-mem-claude/main/install.sh | bash
#   or:  bash install.sh

set -e

echo "=== Synthius-Mem for Claude Code — Installer ==="
echo ""

# Detect Claude Code config directory
CLAUDE_DIR="$HOME/.claude"
MEMORY_DIR=""
SETTINGS_FILE="$CLAUDE_DIR/settings.json"

if [ ! -d "$CLAUDE_DIR" ]; then
  echo "ERROR: Claude Code not found at $CLAUDE_DIR"
  echo "Please make sure Claude Code is installed and has been run at least once."
  exit 1
fi

echo "✓ Found Claude Code directory at $CLAUDE_DIR"

# Find or create memory directory
# Look for existing project memory directories
EXISTING_MEM=$(find "$CLAUDE_DIR/projects" -maxdepth 1 -type d -name "memory" 2>/dev/null | head -1)

if [ -n "$EXISTING_MEM" ]; then
  MEMORY_DIR="$EXISTING_MEM"
  echo "✓ Found existing memory directory: $MEMORY_DIR"
else
  # Create in first project directory found, or create a dedicated one
  FIRST_PROJECT=$(find "$CLAUDE_DIR/projects" -maxdepth 1 -type d -not -name "C--Users-Administrator" 2>/dev/null | head -1)
  if [ -n "$FIRST_PROJECT" ]; then
    MEMORY_DIR="$FIRST_PROJECT/memory"
  else
    # Create a dedicated project for memory
    MEMORY_DIR="$CLAUDE_DIR/projects/synthius-mem/memory"
    mkdir -p "$MEMORY_DIR"
  fi
  mkdir -p "$MEMORY_DIR"
  echo "✓ Created memory directory: $MEMORY_DIR"
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Copy domain templates
echo ""
echo "Installing memory domains..."
DOMAINS=("01-biography" "02-experiences" "03-preferences" "04-social-circle" "05-work" "06-psychometrics")
for d in "${DOMAINS[@]}"; do
  mkdir -p "$MEMORY_DIR/domains/$d"
  if [ -f "$SCRIPT_DIR/memory/domains/$d/_index.md" ]; then
    # Replace placeholder date
    TODAY=$(date +%Y-%m-%d)
    sed "s/PLACEHOLDER_DATE/$TODAY/g" "$SCRIPT_DIR/memory/domains/$d/_index.md" > "$MEMORY_DIR/domains/$d/_index.md"
    echo "  ✓ domains/$d/_index.md"
  fi
done

# Copy support files
mkdir -p "$MEMORY_DIR/.pending" "$MEMORY_DIR/archive"

for f in consolidation-log.md; do
  if [ ! -f "$MEMORY_DIR/$f" ]; then
    cp "$SCRIPT_DIR/memory/$f" "$MEMORY_DIR/$f"
    echo "  ✓ $f"
  else
    echo "  ⊘ $f (already exists, skipping)"
  fi
done

# Create MEMORY.md from template if it doesn't exist
if [ ! -f "$MEMORY_DIR/MEMORY.md" ]; then
  cp "$SCRIPT_DIR/memory/MEMORY.md.template" "$MEMORY_DIR/MEMORY.md"
  echo "  ✓ MEMORY.md (created from template)"
else
  echo "  ⊘ MEMORY.md (already exists, preserving)"
fi

# Install skill
SKILL_DEST="$CLAUDE_DIR/skills/memory-ops.md"
if [ -f "$SKILL_DEST" ]; then
  echo "  ⊘ memory-ops.md skill (already exists, skipping)"
else
  mkdir -p "$CLAUDE_DIR/skills"
  cp "$SCRIPT_DIR/.claude/skills/memory-ops.md" "$SKILL_DEST"
  echo "  ✓ memory-ops.md skill"
fi

# Merge hooks into settings.json
echo ""
echo "Installing hooks..."
if [ -f "$SETTINGS_FILE" ]; then
  # Use node to merge hooks safely
  node -e "
    const fs = require('fs');
    const settingsPath = '$SETTINGS_FILE';
    const hooksPath = '$SCRIPT_DIR/hooks/settings-hooks.json';
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));

    // Replace placeholder with actual memory dir
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
echo "To verify everything works:"
echo "  node $SCRIPT_DIR/test/test-memory.js"
echo ""
echo "Next time you start Claude Code, the SessionStart hook will automatically"
echo "load your memory index. Memories captured during sessions will be"
echo "consolidated at session end."
echo ""
