#!/usr/bin/env node
'use strict';
const fs   = require('fs');
const path = require('path');

const MEMORY_PATH = process.argv[2];
if (!MEMORY_PATH || !fs.existsSync(MEMORY_PATH)) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Memory index not found.' } }));
  process.exit(0);
}

let memoryIndex = '';
try {
  memoryIndex = fs.readFileSync(path.join(MEMORY_PATH, 'MEMORY.md'), 'utf8').trim();
} catch (e) {
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: 'Memory index not found.' } }));
  process.exit(0);
}

// Ensure .pending exists
const pendingDir = path.join(MEMORY_PATH, '.pending');
if (!fs.existsSync(pendingDir)) fs.mkdirSync(pendingDir, { recursive: true });

// Warn if stale pending files exist (session-end hook may not have run)
const staleFiles = fs.existsSync(pendingDir)
  ? fs.readdirSync(pendingDir).filter(f => f.startsWith('pending-') && f.endsWith('.md'))
  : [];
const staleWarning = staleFiles.length > 0
  ? `\n\n> WARNING: ${staleFiles.length} unprocessed pending file(s) in .pending/ — run 'consolidate' to flush them.`
  : '';

const pendingPath = pendingDir.replace(/\\/g, '/');

const captureRules = `## Synthius-Mem: Auto-Capture Rules

Pending path: \`${pendingPath}/pending-YYYYMMDDHHMMSS.md\`

**TIER 1 — Explicit commands (always capture, no exceptions):**
中文: 记住/记一下/记下来/下次注意/别忘了/这是个教训/以后都要
English: remember this / note that / don't forget / lesson learned / always do
→ strength: high | update existing if relevant | add \`expires: YYYY-MM\` if "暂时/for now"

**TIER 2 — Clear signals (capture without being asked):**
- Preference / aversion / habit → preferences
- Hard constraint (不能/必须/只能/can't/must) → preferences, category: hard-constraint
- Style or process feedback on Claude → preferences, category: feedback
- Role / background / expertise depth → biography
- Ongoing project / tool / workflow → work
- Thinking pattern / decision framework → psychometrics
- Team member / collaborator named → social-circle
- Milestone / anti-pattern (试过不行/被坑过/we tried X and it failed) → experiences, category: anti-pattern

**DO NOT capture:** content corrections | current-task-only state | already in index with nothing new | one-off in-session requests

**TIER 3 — Implicit signals:** permanence × impact — low permanence + low impact = always skip

**Strength:** high = user commanded OR confirmed 2+ times this session | medium = single clear mention | low = inferred

File format:
\`\`\`
---
action: capture
domain: <domain>
strength: high|medium|low
date: YYYY-MM-DD
expires: YYYY-MM
---
**Content**: one sentence
**Original Quote**: "exact user words"
**Source Session**: YYYY-MM-DD / topic
**Category**: sub-category
\`\`\``;

const domainsPath = path.join(MEMORY_PATH, 'domains').replace(/\\/g, '/');

const retrievalRules = `## Synthius-Mem: Retrieval Triggers

Domain index paths:
- preferences: \`${domainsPath}/03-preferences/_index.md\`
- work:        \`${domainsPath}/05-work/_index.md\`
- biography:   \`${domainsPath}/01-biography/_index.md\`
- experiences: \`${domainsPath}/02-experiences/_index.md\`
- social-circle: \`${domainsPath}/04-social-circle/_index.md\`
- psychometrics: \`${domainsPath}/06-psychometrics/_index.md\`

**Load domain(s) before responding when:**

| Situation | Domains to load |
|---|---|
| Before ANY recommendation (always) | preferences — scan for hard-constraint entries |
| "How should I / what approach / what framework" | preferences + psychometrics |
| Code or architecture question | work + preferences |
| Tool / library / approach choice | work + experiences (check anti-patterns) |
| User mentions a person by name | social-circle |
| User background or history unclear | biography + experiences |
| About to assume user preference or context | check memory first — never guess |

**Loading discipline:** index (_index.md) first, full entry only if index summary suggests relevance. Never load all domains at once. If a domain was already loaded this session, don't reload.`;

const additionalContext = `## Memory Index\n\n${memoryIndex}${staleWarning}\n\n---\n\n${retrievalRules}\n\n---\n\n${captureRules}`;

console.log(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: 'SessionStart',
    additionalContext,
  },
}));
