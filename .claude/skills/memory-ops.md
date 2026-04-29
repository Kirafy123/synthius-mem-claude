# Memory Ops Skill

Synthius-Mem: Brain-Inspired Structured Persona Memory for Claude Code.
Based on: Gadzhiev & Kislov, "Synthius-Mem: Brain-Inspired Hallucination-Resistant Persona Memory" (arXiv:2604.11563)

## Memory Paths

- Global memory: `~/.claude/projects/<project-id>/memory/`
- Domain indexes: `memory/domains/01-biography/` through `06-psychometrics/`
- Pending buffer: `memory/.pending/`
- Consolidation script: `memory/scripts/session-end.js`
- Audit trail: `memory/consolidation-log.md`

## Two-Tier Consolidation

**Tier 1 — Automatic (SessionEnd hook)**
Runs `session-end.js` at every session end. Mechanically appends each pending capture to its domain `_index.md` and deletes the pending file. No LLM needed, no semantic judgment. Every capture is preserved — nothing is lost.

**Tier 2 — Manual (consolidate action)**
Semantic cleanup: merge near-duplicate entries, remove contradictions, refine titles, archive stale entries. Run this when domain files grow noisy (roughly weekly, or after a heavy session).

## Actions

### capture — Write a New Memory

**When to call capture (MUST trigger without being asked):**
- User expresses a preference or aversion: "I like X", "don't do Y", "I prefer Z"
- User gives feedback on Claude's behavior — positive or negative
- User shares identity or background: role, location, skills, years of experience
- User mentions a project, tool, or workflow they use regularly
- User reveals a thinking pattern or decision framework
- User mentions team members, collaborators, or stakeholders by name/role
- User shares an important milestone or experience
- Any information that would change how you'd respond in a future session

**Do not wait for the user to say "remember this."** If the information fits a domain, capture it.

**How**: Write to `memory/.pending/` with naming `pending-YYYYMMDD-HHMM.md`.

**Format**:
```markdown
---
action: capture
domain: preferences|biography|experiences|social-circle|work|psychometrics
strength: high|medium|low
date: 2026-04-29
---

**Content**: Concise description of the memory (one sentence, specific)
**Original Quote**: "exact words from the conversation"
**Source Session**: 2026-04-29 / topic
**Category**: Suggested sub-category (e.g. "communication style", "project context")
```

**Strength guidelines:**
- `high`: Core identity, strong stated preferences, repeated patterns
- `medium`: Useful context, single-mention preferences
- `low`: Incidental mentions, unconfirmed assumptions

### consolidate — Semantic Cleanup (Manual)

Run this after the domain files have accumulated entries, or when you notice duplicates.

**Step 1 — Run the deterministic script first:**
```
node memory/scripts/consolidate.js <memory-path>
```

The script handles automatically (no LLM needed):
- **Auto-merge**: same domain + same Category + word overlap ≥ 75% → merged, loser's quote added to winner's Change History
- **Archive**: `Strength: low` + not updated in 30+ days → moved to `memory/archive/`
- **Flag**: relative time references ("最近", "yesterday", etc.) in content/title

**Step 2 — Review the script's output:**

The script prints only the cases it couldn't resolve deterministically:
- Same-category pairs with 30%-75% overlap → make a call: same fact or complementary?
  - Same: merge manually with Edit tool (keep higher-strength entry, append other's quote to Change History)
  - Complementary: add distinct Category suffixes, e.g. `"communication style / brevity"` vs `"communication style / depth"`
- Entries missing Category field with any overlap → add the Category field, then re-run

**Step 3 — Fix flagged relative time entries:**
Replace with absolute dates (`2026-04-29`) or delete if date is unknown.

**Step 4 — Handle contradictions:**
If two entries directly contradict each other (old preference vs new) → newer Updated wins; add to losing entry's Change History: `YYYY-MM-DD: Superseded by <ID>: "<new value>"`

### compact — Deep Refinement (Weekly)

More aggressive than consolidate. Run roughly once a week or after a long project phase.

1. Scan all domain indexes
2. Merge same-category entries that have drifted apart over multiple sessions
3. Move `low` strength entries untouched for 30+ days into `archive/`
4. Rewrite poorly titled entries (slug should summarize content in ≤52 chars)
5. Write compaction report to `consolidation-log.md`

To automate: use the `/schedule` skill to create a weekly recurring task.

### retrieve — Load Relevant Domain

Based on current task context, decide which domains to load.

**Retrieval rules:**
- Communication style / interaction → `03-preferences/_index.md`
- Code / projects / tools → `05-work/_index.md`
- Background / identity → `01-biography/_index.md` + `02-experiences/_index.md`
- Team / collaboration → `04-social-circle/_index.md`
- Decisions / judgment / frameworks → `06-psychometrics/_index.md`
- Unsure → read only `MEMORY.md`, load domains as needed

**Never load all domain content at once.** Index (~200 tokens) first, domain content on demand.

### load-session — Session Startup

Called at session start (handled by SessionStart hook automatically).

1. Read `MEMORY.md` to get the index
2. Determine task context from working directory and first user message
3. Load relevant domain indexes (not full content)
4. If `.pending/` has files older than 24h, warn the user — the SessionEnd hook may not have run

## Domain Quick Reference

| Domain | What it stores | Entry ID prefix |
|---|---|---|
| 01-biography | Identity, roles, background | `B-` |
| 02-experiences | Important events, milestones | `E-` |
| 03-preferences | Interaction style, habits, decision rules | `P-` |
| 04-social-circle | Team members, collaborators | `SC-` |
| 05-work | Projects, skills, tools | `W-` |
| 06-psychometrics | Thinking patterns, cognitive frameworks | `PS-` |

## Entry Format

```markdown
### P-001 Entry title slug here [Strength: high | Updated: 2026-04-29 | Source: 2026-04-29]
- Concise summary of the memory entry
- **Category**: communication style
- **Original Quote**: "exact words"
- **Change History**:
  - 2026-04-29: Initial capture (pending-20260429-1430.md)
  - 2026-04-29: Merged with P-003 (same category, more complete)
```

## Consolidation Principles

1. **Never delete without archiving**: Move to `archive/`, don't just remove
2. **Merge over append**: New information updates old entries, doesn't add alongside
3. **Preserve traceability**: Merged entries keep original quotes and change history
4. **Absolute dates only**: No "today", "recently", "last week" — always `YYYY-MM-DD`
5. **One entry, one fact**: Don't pack multiple unrelated facts into one entry

## neat-freak Bridge

If the neat-freak skill is also installed:

| | Synthius-Mem | neat-freak |
|---|---|---|
| Manages | Who the user is (persona, cross-project) | What's in the project (docs, CLAUDE.md) |
| Scope | Global, all projects | Per-project |
| Trigger | Automatic (hooks) | Manual ("收尾", "整理一下") |

**When neat-freak runs Step 1** (memory scan): read `memory/MEMORY.md` index first; load individual domain `_index.md` files only as needed — not all at once.

**When neat-freak identifies `type: user` or `type: feedback` memories**: write them to Synthius-Mem's `.pending/` buffer instead of flat `.md` files, so they get properly classified and consolidated:

```markdown
---
action: capture
domain: preferences
strength: high
date: 2026-04-29
---

**Content**: <description>
**Original Quote**: "<user's words>"
**Source Session**: 2026-04-29 / neat-freak sync
**Category**: <sub-category>
```

**neat-freak Step 4 checklist should include**: Check `memory/.pending/` — if files exist, trigger `consolidate` before closing the session.
