# Memory Ops Skill

Synthius-Mem: Brain-Inspired Structured Persona Memory for Claude Code.
Based on: Gadzhiev & Kislov, "Synthius-Mem: Brain-Inspired Hallucination-Resistant Persona Memory" (arXiv:2604.11563)

## Memory Paths

- Global memory: `.claude/projects/<project-id>/memory/`
- Domain directories: `memory/domains/01-biography/` through `06-psychometrics/`
- Pending buffer: `memory/.pending/`
- Index: `memory/domains/XX-domain/_index.md`
- Consolidation log: `memory/consolidation-log.md`

## Actions

### capture — Capture a New Memory

When new user preferences, decisions, or important information appear in conversation, call this action.

**How**: Write a markdown file to `memory/.pending/` with naming `pending-YYYYMMDD-HHMM.md`.

**Format**:
```markdown
---
action: capture
domain: preferences|biography|experiences|social-circle|work|psychometrics
strength: high|medium|low
date: 2026-04-17
---

**Content**: Brief description of the memory
**Original Quote**: "exact words from conversation"
**Source Session**: Date and topic
**Category**: Suggested sub-category within the domain
```

### consolidate — Merge and Deduplicate

Triggered automatically at session end via SessionEnd hook.

1. Read all files in `memory/.pending/` matching `pending-*.md`
2. Group by domain
3. For each domain:
   a. Read `_index.md`
   b. Compare new entries with existing ones
   c. **Dedup**: Merge semantically identical entries, keep the most complete version
   d. **Conflict**: Newer timestamps overwrite older; old value kept in changelog
   e. **Merge**: Combine same-category entries (e.g., multiple "don't do X/Y/Z" → "avoid X, Y, Z")
4. Update domain `_index.md`
5. Append summary to `consolidation-log.md`
6. Clear `.pending/` files

### compact — Refine (Weekly)

Triggered weekly via cron or manually.

1. Scan all domain `_index.md` files
2. Identify mergeable entries (same sub-category, semantically similar, not updated in 7+ days)
3. Merge entries, preserving original quotes as sub-items
4. Move `low` strength entries untouched for 30+ days into `archive/`
5. Update `_index.md` files
6. Write compaction report to `consolidation-log.md`

### retrieve — Retrieve Memory

Based on current task context, decide which domains to load.

**Retrieval rules**:
- Task about interaction style / communication → read `03-preferences/_index.md`
- Task about projects / code → read `05-work/_index.md`
- Task about personal background → read `01-biography/_index.md` + `02-experiences/_index.md`
- Task about team / collaboration → read `04-social-circle/_index.md`
- Task about decisions / judgment → read `06-psychometrics/_index.md`
- Unsure → only read `MEMORY.md` index, load domains as prompted

**Never load all domain content at once.** Only load domains relevant to the current task.

### load-session — Session Startup

Called at session start.

1. Read `MEMORY.md` to get the memory index
2. Determine project context from current working directory
3. Load relevant domain indexes (not full content)
4. If `.pending/` has unconsolidated entries, run consolidate first

## Domain Quick Reference

| Domain | What it stores | Example |
|---|---|---|
| 01-biography | Identity, roles, background | "I'm a game designer turned producer" |
| 02-experiences | Important events, milestones | "Started this game project in 2024" |
| 03-preferences | Interaction style, habits, likes | "Conclusion first, no preamble" |
| 04-social-circle | Team members, collaborators | "I have a development team" |
| 05-work | Projects, skills, tools | "gamedev1 project" |
| 06-psychometrics | Thinking patterns, cognition | "First principles thinking" |

## Consolidation Principles

1. **Keep core, filter noise**: Identity, relationships, major experiences, values are never deleted. Restaurant names, casually mentioned adjectives can be filtered.
2. **Merge same-category**: Multiple "don't do X/Y/Z" → "avoid doing X, Y, Z"
3. **Preserve traceability**: Merged entries must keep original quotes and change history
4. **Time-based updates**: New information overwrites old; old values kept as history
5. **Reversibility**: All deletions are logged in consolidation-log.md

## Entry Format

Each entry in a domain index follows this format:

```markdown
### ID-NNN Entry Title [Strength: high|medium|low | Updated: YYYY-MM-DD | Source: source]
- Concise summary of the memory entry
- **Original Quote**: "exact words"
- **Change History**:
  - YYYY-MM-DD: Initial extraction
  - YYYY-MM-DD: Merged with related entry (description)
```

Entry IDs are domain-prefixed:
- Biography: `B-001`, `B-002`, ...
- Experiences: `E-001`, `E-002`, ...
- Preferences: `P-001`, `P-002`, ...
- Social Circle: `SC-001`, `SC-002`, ...
- Work: `W-001`, `W-002`, ...
- Psychometrics: `PS-001`, `PS-002`, ...
