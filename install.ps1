# Synthius-Mem for Claude Code — Install Script (Windows PowerShell)
# Usage: irm https://raw.githubusercontent.com/YOUR_USERNAME/synthius-mem-claude/main/install.ps1 | iex
#   or:  powershell -ExecutionPolicy Bypass -File install.ps1

$ErrorActionPreference = "Stop"

Write-Host ""
Write-Host "=== Synthius-Mem for Claude Code — Installer ===" -ForegroundColor Cyan
Write-Host ""

# Detect Claude Code config directory
$ClaudeDir = Join-Path $env:USERPROFILE ".claude"

if (-not (Test-Path $ClaudeDir)) {
  Write-Host "ERROR: Claude Code not found at $ClaudeDir" -ForegroundColor Red
  Write-Host "Please make sure Claude Code is installed and has been run at least once." -ForegroundColor Red
  exit 1
}

Write-Host "Found Claude Code directory at $ClaudeDir" -ForegroundColor Green

$SettingsFile = Join-Path $ClaudeDir "settings.json"

# Find or create memory directory
$MemoryDir = $null
$ProjectsDir = Join-Path $ClaudeDir "projects"

if (Test-Path $ProjectsDir) {
  # Look for existing memory directories
  $ExistingMem = Get-ChildItem -Path $ProjectsDir -Recurse -Directory -Filter "memory" -Depth 1 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($ExistingMem) {
    $MemoryDir = $ExistingMem.FullName
    Write-Host "Found existing memory directory: $MemoryDir" -ForegroundColor Green
  }
}

if (-not $MemoryDir) {
  # Create in a new dedicated project
  $MemoryDir = Join-Path $ClaudeDir "projects\synthius-mem\memory"
  New-Item -ItemType Directory -Path $MemoryDir -Force | Out-Null
  Write-Host "Created memory directory: $MemoryDir" -ForegroundColor Green
}

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path

# Copy domain templates
Write-Host ""
Write-Host "Installing memory domains..." -ForegroundColor Cyan

$Domains = @("01-biography", "02-experiences", "03-preferences", "04-social-circle", "05-work", "06-psychometrics")
$Today = Get-Date -Format "yyyy-MM-dd"

foreach ($d in $Domains) {
  $DomainDir = Join-Path $MemoryDir "domains\$d"
  if (-not (Test-Path $DomainDir)) {
    New-Item -ItemType Directory -Path $DomainDir -Force | Out-Null
  }

  $TemplateFile = Join-Path $ScriptDir "memory\domains\$d\_index.md"
  $DestFile = Join-Path $DomainDir "_index.md"

  if (-not (Test-Path $DestFile)) {
    $Content = Get-Content $TemplateFile -Raw
    $Content = $Content -replace "PLACEHOLDER_DATE", $Today
    Set-Content -Path $DestFile -Value $Content -NoNewline
    Write-Host "  domains\$d\_index.md" -ForegroundColor Green
  } else {
    Write-Host "  domains\$d\_index.md (already exists, skipping)" -ForegroundColor Yellow
  }
}

# Copy support files
$PendingDir = Join-Path $MemoryDir ".pending"
$ArchiveDir = Join-Path $MemoryDir "archive"
if (-not (Test-Path $PendingDir)) { New-Item -ItemType Directory -Path $PendingDir -Force | Out-Null }
if (-not (Test-Path $ArchiveDir)) { New-Item -ItemType Directory -Path $ArchiveDir -Force | Out-Null }

$ConsolidationLog = Join-Path $MemoryDir "consolidation-log.md"
if (-not (Test-Path $ConsolidationLog)) {
  Copy-Item (Join-Path $ScriptDir "memory\consolidation-log.md") $ConsolidationLog
  Write-Host "  consolidation-log.md" -ForegroundColor Green
} else {
  Write-Host "  consolidation-log.md (already exists, skipping)" -ForegroundColor Yellow
}

# Create MEMORY.md from template
$MemoryIndexFile = Join-Path $MemoryDir "MEMORY.md"
if (-not (Test-Path $MemoryIndexFile)) {
  Copy-Item (Join-Path $ScriptDir "memory\MEMORY.md.template") $MemoryIndexFile
  Write-Host "  MEMORY.md (created from template)" -ForegroundColor Green
} else {
  Write-Host "  MEMORY.md (already exists, preserving)" -ForegroundColor Yellow
}

# Install skill
$SkillDest = Join-Path $ClaudeDir "skills\memory-ops.md"
if (-not (Test-Path $SkillDest)) {
  $SkillsDir = Join-Path $ClaudeDir "skills"
  if (-not (Test-Path $SkillsDir)) { New-Item -ItemType Directory -Path $SkillsDir -Force | Out-Null }
  Copy-Item (Join-Path $ScriptDir ".claude\skills\memory-ops.md") $SkillDest
  Write-Host "  memory-ops.md skill" -ForegroundColor Green
} else {
  Write-Host "  memory-ops.md skill (already exists, skipping)" -ForegroundColor Yellow
}

# Merge hooks into settings.json
Write-Host ""
Write-Host "Installing hooks..." -ForegroundColor Cyan

if (Test-Path $SettingsFile) {
  node -e "
    const fs = require('fs');
    const settingsPath = '$($SettingsFile -replace '\\\\', '/')';
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hooksPath = '$((Join-Path $ScriptDir 'hooks\settings-hooks.json') -replace '\\\\', '/')';
    const hooks = JSON.parse(fs.readFileSync(hooksPath, 'utf8'));
    const memDir = '$($MemoryDir -replace '\\\\', '/')';

    for (const [event, entries] of Object.entries(hooks.hooks)) {
      if (!settings.hooks) settings.hooks = {};
      settings.hooks[event] = entries.map(entry => {
        const cmd = entry.hooks[0].command.replace(/MEMORY_PATH_PLACEHOLDER/g, memDir);
        return { hooks: [{ type: entry.hooks[0].type, command: cmd, statusMessage: entry.hooks[0].statusMessage }] };
      });
    }

    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf8');
    console.log('  Hooks merged into settings.json');
  "
  Write-Host "  Hooks installed" -ForegroundColor Green
} else {
  Write-Host "settings.json not found at $SettingsFile" -ForegroundColor Red
  Write-Host "Please run Claude Code at least once, then re-run this script." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "=== Installation Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Memory directory: $MemoryDir"
Write-Host ""
Write-Host "To verify everything works:"
Write-Host "  node $(Join-Path $ScriptDir 'test\test-memory.js')"
Write-Host ""
Write-Host "Next time you start Claude Code, the SessionStart hook will automatically"
Write-Host "load your memory index. Memories captured during sessions will be"
Write-Host "consolidated at session end."
Write-Host ""
