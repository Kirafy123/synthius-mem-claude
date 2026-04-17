# Synthius-Mem for Claude Code

> A brain-inspired, six-domain structured memory system for Claude Code.
> Based on the paper [Synthius-Mem](https://arxiv.org/abs/2604.11563) by Gadzhiev & Kislov.

[中文说明](#中文说明) · [English](#english-readme)

---

## English Readme

### What is this?

Claude Code sessions start fresh every time — no memory between sessions. This project implements
the **Synthius-Mem** paper's principles ([arXiv:2604.11563](https://arxiv.org/abs/2604.11563v1)) as a lightweight, file-based memory system that runs
entirely within Claude Code's native architecture (hooks + skills + markdown files).

**Core idea**: Instead of dumping raw conversation into memory, extract *what is known about the person*
and organize it into **six cognitive domains** — the way the human brain does.

### Six Domains

| Domain | Stores |
|---|---|
| **Biography** | Identity, roles, background |
| **Experiences** | Important events, milestones |
| **Preferences** | Interaction style, habits, decision rules |
| **Social Circle** | Team, collaborators, relationships |
| **Work** | Projects, skills, tools |
| **Psychometrics** | Thinking patterns, cognitive frameworks |

### Quick Install

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Kirafy123/synthius-mem-claude/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/Kirafy123/synthius-mem-claude/main/install.ps1 | iex
```

Or manually:

```bash
git clone https://github.com/Kirafy123/synthius-mem-claude.git
cd synthius-mem-claude
# Run the install script
bash install.sh        # macOS/Linux
# or
powershell -ExecutionPolicy Bypass -File install.ps1   # Windows
```

### How It Works

**Three-stage pipeline** (matching the paper's architecture):

```
Session Real-time          Session-End              Session-Start
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│   EXTRACT    │ ───────→ │ CONSOLIDATE  │          │   RETRIEVE   │
│  (capture)   │          │   (merge)    │          │   (load)     │
└──────────────┘          └──────────────┘          └──────────────┘
```

1. **Extract**: During conversation, Claude captures new memories into `.pending/`
2. **Consolidate**: At session end, entries are merged, deduplicated, and classified by domain
3. **Retrieve**: At session start, only the memory index is loaded (~200 tokens). Domain content loaded on-demand.

### Architecture

```
.claude/
├── skills/memory-ops.md          # Memory operations skill
├── settings.json                 # Hooks configuration
└── projects/<id>/memory/
    ├── MEMORY.md                 # Index (always loaded)
    ├── consolidation-log.md      # Audit trail
    ├── domains/
    │   ├── 01-biography/_index.md
    │   ├── 02-experiences/_index.md
    │   ├── 03-preferences/_index.md
    │   ├── 04-social-circle/_index.md
    │   ├── 05-work/_index.md
    │   └── 06-psychometrics/_index.md
    ├── .pending/                 # Temp buffer
    └── archive/                  # Inactive entries
```

### Memory Ops Skill

The `memory-ops.md` skill provides five actions:

- `capture` — Write a new memory to the pending buffer
- `consolidate` — Merge pending entries into domain files
- `compact` — Weekly refinement (merge similar entries, archive old ones)
- `retrieve` — Load relevant domain based on task context
- `load-session` — Initialize memory at session start

### Token Efficiency

| Approach | Tokens per message (N=500) |
|---|---|
| Full context replay | ~26,200 |
| **Synthius-Mem (this project)** | ~200-500 (index) + on-demand |

### Test Suite

```bash
node test/test-memory.js
```

51 tests covering: settings/hooks, domain structure, content validation, skill actions,
hook execution, end-to-end pipeline, retrieval logic, and edge cases.

### Paper vs. This Implementation

| Feature | Paper (Synthius-Mem) | This Implementation |
|---|---|---|
| Storage | Structured JSON + CategoryRAG | Markdown files + file reads |
| Extraction | LLM parallel pipeline | Claude agent capture action |
| Consolidation | Deterministic per-category merge | Agent-based merge with rules |
| Retrieval | 21.79ms CategoryRAG | Domain-index lookup |
| Token Cost | ~5,040 tok/msg at N=500 | ~200-500 tok index + on-demand |

### License

MIT

---

## 中文说明

### 这是什么？

Claude Code 每次会话都是全新的——会话之间没有记忆。本项目将 **Synthius-Mem** 论文的原理
（[arXiv:2604.11563](https://arxiv.org/abs/2604.11563v1)）
实现为一个轻量级、基于文件的记忆系统，完全运行在 Claude Code 的原生架构内（hooks + skills + markdown 文件）。

**核心理念**：不是把原始对话塞进记忆，而是提取「关于这个人的已知信息」，
按照人类大脑的方式组织到**六个认知域**中。

### 六域模型

| 域 | 存储内容 |
|---|---|
| **传记** | 身份、角色、背景 |
| **经历** | 重要事件、里程碑 |
| **偏好** | 交互风格、习惯、决策规则 |
| **社交圈** | 团队、合作者、关系 |
| **工作** | 项目、技能、工具 |
| **心理画像** | 思维模式、认知框架 |

### 快速安装

```bash
# macOS / Linux
curl -fsSL https://raw.githubusercontent.com/Kirafy123/synthius-mem-claude/main/install.sh | bash

# Windows (PowerShell)
irm https://raw.githubusercontent.com/Kirafy123/synthius-mem-claude/main/install.ps1 | iex
```

或手动安装：

```bash
git clone https://github.com/Kirafy123/synthius-mem-claude.git
cd synthius-mem-claude
bash install.sh        # macOS/Linux
powershell -ExecutionPolicy Bypass -File install.ps1   # Windows
```

### 工作原理

**三阶段管道**（与论文架构一致）：

1. **提取**：对话中，Claude 将新记忆写入 `.pending/` 缓冲区
2. **合并**：会话结束时，条目按域分类、去重、合并
3. **检索**：会话开始时，只加载索引（~200 token），域内容按需加载

### 记忆操作 Skill

`memory-ops.md` 提供五个操作：

- `capture` — 写入新记忆到待处理缓冲区
- `consolidate` — 合并待处理条目到域文件
- `compact` — 每周精炼（合并相似条目、归档旧条目）
- `retrieve` — 根据任务上下文加载相关域
- `load-session` — 会话开始时初始化记忆

### Token 效率

| 方式 | 每条消息的 Token 消耗（N=500） |
|---|---|
| 全量上下文回放 | ~26,200 |
| **Synthius-Mem（本项目）** | ~200-500（索引）+ 按需加载 |

### 测试套件

```bash
node test/test-memory.js
```

51 项测试覆盖：配置/hooks、域结构、内容验证、skill 操作、hook 执行、端到端管道、检索逻辑和边界情况。

### 论文 vs 本项目

| 特性 | 论文（Synthius-Mem） | 本项目 |
|---|---|---|
| 存储 | 结构化 JSON + CategoryRAG | Markdown 文件 + 文件读取 |
| 提取 | LLM 并行提取管道 | Claude agent 捕获操作 |
| 合并 | 确定论按子类合并 | Agent 驱动合并+规则 |
| 检索 | 21.79ms CategoryRAG | 域索引查找 |
| Token 成本 | ~5,040 tok/消息 | ~200-500 tok 索引 + 按需 |

### 许可证

MIT
