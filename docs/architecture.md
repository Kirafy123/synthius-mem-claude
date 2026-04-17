# Synthius-Mem Architecture

## Overview

Synthius-Mem for Claude Code implements the core principles from the paper
[Synthius-Mem: Brain-Inspired Hallucination-Resistant Persona Memory](https://arxiv.org/abs/2604.11563)
in a lightweight, file-based architecture that runs entirely within Claude Code's native systems.

## The Problem

Claude Code has no intrinsic long-term memory between sessions. Each session starts fresh.
The user's CLAUDE.md and memory files provide basic persistence, but they are flat,
unstructured, and grow without consolidation — leading to token bloat and degraded relevance.

## The Solution

A six-domain structured memory system with three-stage pipeline:

```
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│  EXTRACT    │ →  │ CONSOLIDATE │ →  │  RETRIEVE   │
│  (capture)  │    │  (merge)    │    │  (load)     │
└─────────────┘    └─────────────┘    └─────────────┘
    Session             Session-End        Session-Start
    Real-time           Post-Processing    On-Demand
```

### Stage 1: Extract (capture)

During conversation, when new persona information is detected:
- Written to `.pending/` as a temporary file
- Tagged with domain, strength, date, original quote
- Not written directly to domain files (avoids uncommitted changes)

### Stage 2: Consolidate (merge)

At session end, via SessionEnd hook:
- Scans `.pending/` for entries
- Groups by domain
- Per-domain: deduplicates, merges same-category entries, resolves conflicts by timestamp
- Writes to `consolidation-log.md`
- Clears pending buffer

### Stage 3: Retrieve (load)

At session start, via SessionStart hook:
- Loads `MEMORY.md` index into context (~200 tokens)
- Domain content loaded on-demand based on task type
- Uses CategoryRAG pattern: planner determines which domain to query

## Six Cognitive Domains

| Domain | Neuroscience Analog | What It Stores |
|---|---|---|
| **Biography** | Semantic self-knowledge | Identity, roles, education, health, location |
| **Experiences** | Episodic memory (hippocampus) | Events with temporal anchors, emotional valence |
| **Preferences** | Evaluative memory (OFC/VTA) | Likes, dislikes, interaction styles, decision rules |
| **Social Circle** | Social cognition (mPFC/TPJ) | Relationships, closeness, trust, interaction dynamics |
| **Work** | Professional memory | Projects, skills, tools, outcomes |
| **Psychometrics** | Metacognition / self-model | Thinking patterns, cognitive frameworks, 9 validated scales |

## Why Domain Structure Matters

Unlike flat memory stores where all facts share the same representation,
domain-structured memory provides:

1. **Targeted retrieval**: Query only the relevant domain, not everything
2. **Optimized schemas**: Each domain has fields suited to its content type
3. **Conflict resolution**: Same-domain merges are semantically coherent
4. **Scalable token budget**: ~200 token index vs. full replay at 25K+ tokens
5. **Hallucination resistance**: Structured facts (not raw text) are retrieved,
   making absence-of-evidence a reliable refusal signal

## Comparison: Paper vs. This Implementation

| Feature | Paper (Synthius-Mem) | This Implementation |
|---|---|---|
| Storage | Structured JSON + CategoryRAG | Markdown files + file reads |
| Extraction | LLM parallel extraction pipeline | Claude Code agent capture action |
| Consolidation | Deterministic per-category merge | Agent-based merge with dedup rules |
| Retrieval | 21.79ms CategoryRAG tool | Domain-index lookup + Read tool |
| Token Cost | ~5,040 tok/msg at N=500 | ~200-500 tok index load + on-demand |
| Adversarial Robustness | 99.55% (benchmarked) | N/A (no benchmark) |

## File Structure

```
.claude/
├── skills/memory-ops.md          # Skill definition
├── settings.json                 # Hooks configuration (merged with existing)
└── projects/<id>/memory/
    ├── MEMORY.md                 # Index file (always loaded)
    ├── consolidation-log.md      # Audit trail
    ├── domains/
    │   ├── 01-biography/_index.md
    │   ├── 02-experiences/_index.md
    │   ├── 03-preferences/_index.md
    │   ├── 04-social-circle/_index.md
    │   ├── 05-work/_index.md
    │   └── 06-psychometrics/_index.md
    ├── .pending/                 # Temp buffer (cleared each consolidation)
    └── archive/                  # 30+ day inactive entries
```

## Hooks Detail

### SessionStart
```
Command: node -e "read MEMORY.md, output as additionalContext"
Effect: Injects the memory index into the system prompt
Token cost: ~200 tokens for index content
```

### SessionEnd
```
Command: node -e "scan .pending/, log domains to consolidation-log"
Effect: Records pending entries and their domain classification
Token cost: negligible (runs after session)
```

## Design Decisions

1. **Markdown over JSON**: Humans can read and edit it directly. JSON requires parsing.
2. **Single index per domain**: Simple enough to scan visually, structured enough for programmatic access.
3. **File-based over MCP**: No external service to maintain. Works out of the box.
4. **Hooks over memory**: Memory stores knowledge; hooks trigger automated actions. Both are needed.
