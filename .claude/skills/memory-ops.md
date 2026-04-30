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
Runs `session-end.js` at every session end. For each pending file: checks same-category entries in the domain for near-duplicates (Jaccard ≥ 80%) and updates the existing entry instead of appending; otherwise appends as a new entry. No LLM needed.

**Tier 2 — Manual (consolidate action)**
Semantic cleanup: merge near-duplicate entries, remove contradictions, refine titles, archive stale/expired entries. Run this when domain files grow noisy (roughly weekly, or after a heavy session).

## Actions

### capture — Write a New Memory

**Three-tier trigger structure — evaluate in order, stop at first match:**

#### Tier 1: Explicit Commands (highest priority — always capture, no judgment)

中文信号：记住、记一下、记下来、下次注意、别忘了、这是个教训、以后都要
English signals: "remember this", "note that", "don't forget", "lesson learned", "always do"

Rules:
- **Never skip** — user intent overrides all other filters
- Always `strength: high`
- If a relevant entry already exists in the memory index: **update** it, don't create a duplicate
- If the user qualifies with 暂时 / 这次 / for now / temporarily: add `expires: YYYY-MM` field
- Domain: infer from content if the user doesn't state it (see table in Tier 2)

#### Tier 2: Clear Signals (capture without being asked)

| Signal type | Domain | Category hint |
|---|---|---|
| Preference / aversion / working habit | preferences | communication style / workflow |
| Hard constraint: 不能 / 必须 / 只能 / can't / must | preferences | hard-constraint |
| Style or process feedback on Claude's behavior | preferences | feedback |
| Role / background / expertise depth in a specific area | biography | role / expertise |
| Ongoing project, tool, or workflow | work | project / tool |
| Thinking pattern or decision framework | psychometrics | framework |
| Team member or collaborator named | social-circle | — |
| Milestone or important experience | experiences | milestone |
| Negative experience / anti-pattern: 试过不行 / 被坑过 / we tried X and it failed | experiences | anti-pattern |

**Do NOT capture:**
- Content corrections: "this answer is wrong", "that function doesn't exist"
- Current-task-only state: "we're now on step 3", "use tabs just for this file"
- Info already in the memory index with nothing new to add
- Incidental one-off mentions with no signal of recurrence

#### Tier 3: Implicit Signals (use judgment)

Apply permanence × impact:
- High permanence + High impact → capture
- High permanence + Low impact → capture only if confirmed (appears 2+ times this session)
- Low permanence + High impact → capture with `expires: YYYY-MM`
- Low permanence + Low impact → skip

**How**: Write to `memory/.pending/` with naming `pending-YYYYMMDDHHMMSS.md` (seconds precision avoids overwrite when multiple captures happen in the same minute).

After writing the pending file: if `strength: high`, also update the domain's summary line in `MEMORY.md` to reflect the new key fact (one-line edit, keep it under ~60 chars).

**Format**:
```markdown
---
action: capture
domain: preferences|biography|experiences|social-circle|work|psychometrics
strength: high|medium|low
date: YYYY-MM-DD
expires: YYYY-MM
---

**Content**: Concise description of the memory (one to two sentences; preserve key qualifiers and conditions)
**Original Quote**: "exact words from the conversation"
**Source Session**: YYYY-MM-DD / topic
**Category**: sub-category (e.g. "hard-constraint", "anti-pattern", "communication style")
```

**Strength rules (objective):**
- `high`: User explicitly commanded capture OR core identity OR preference confirmed 2+ times this session
- `medium`: Single clear explicit mention
- `low`: Inferred from behavior / indirect signal

### consolidate — Semantic Cleanup (Manual)

Run this after the domain files have accumulated entries, or when you notice duplicates.

**Step 1 — Run the deterministic script first:**
```
node memory/scripts/consolidate.js <memory-path>
```

The script handles automatically (no LLM needed):
- **Archive (expired)**: entries with `Expires: YYYY-MM` past current month → `memory/archive/`
- **Archive (stale)**: `Strength: low` + not updated in 30+ days → `memory/archive/`
- **Auto-merge**: same domain + same Category + similarity ≥ threshold → merged (threshold: 75% normally, 50% for entries with < 10 tokens)
- **Trim**: Change History capped at 5 entries, older ones summarized
- **Flag**: relative time references ("最近", "yesterday", etc.) in content/title

**Step 2 — Review the script's output:**

The script prints only the cases it couldn't resolve deterministically:
- Same-category pairs with 30%–threshold overlap → make a call: same fact or complementary?
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

**When to trigger retrieve (mid-session):**

| Situation | Domains to load |
|---|---|
| Before ANY recommendation (always) | preferences — scan for `category: hard-constraint` entries |
| "How should I / what approach / what framework" | preferences + psychometrics |
| Code or architecture question | work + preferences |
| Tool / library / approach choice | work + experiences (check anti-patterns) |
| User mentions a person by name | social-circle |
| User background or history unclear | biography + experiences |
| About to assume user preference or context | check memory first — never guess |
| Topic shifts significantly | re-evaluate: which domains does the new topic touch? |

**Constraint check — before every recommendation:**
Scan preferences for `category: hard-constraint` entries. Verify your suggestion doesn't violate them before responding.

**Uncertainty signal:**
If you're about to make an assumption about the user's preference, background, or project context → load the relevant domain first instead of guessing.

**Loading discipline:**
1. `_index.md` first (50–100 tokens per domain) — full entry only if index summary suggests direct relevance
2. Never load all domains at once
3. If a domain was already loaded earlier in this session, don't reload — use what's in context
4. Most queries need 2 domains; single-domain retrieval is usually incomplete

### load-session — Session Startup

The SessionStart hook handles initialization automatically: MEMORY.md index, retrieval triggers, and capture rules are all injected into context before the first message.

**Claude's role at session start:**
1. Scan the injected index to understand what memory exists
2. From the working directory and first user message, identify 1–2 most relevant domains
3. Proactively load those domain `_index.md` files (not full content)
4. Do not preload all domains — load others on demand as topics emerge

**Mid-session:** as conversation topics shift, apply the retrieval triggers above and load additional domain indexes as needed.

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
  - 2026-04-29: Initial capture (pending-20260429143000.md)
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
