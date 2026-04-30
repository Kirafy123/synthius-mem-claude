#!/usr/bin/env node
/**
 * Synthius-Mem — Deterministic Consolidation Script
 *
 * Deterministic actions (no LLM needed):
 *   - Archive: entries past their `Expires: YYYY-MM` date
 *   - Archive: Strength=low + not updated in ARCHIVE_DAYS days
 *   - Auto-merge: same domain + same Category + similarity >= threshold
 *     (threshold: 0.75 normally, 0.50 when either entry has < 10 words/chars)
 *   - Trim Change History: cap at MAX_HISTORY entries, summarize older ones
 *   - Flag: relative time references in content/title
 *
 * Outputs for LLM review:
 *   - Same-category pairs with similarity 30%-threshold (ambiguous)
 *   - Entries missing Category field that have overlap > 0.3
 *
 * Fixes vs original:
 *   - CJK bigram tokenization (Chinese text no longer treated as one token)
 *   - Dynamic merge threshold for short content
 *   - Expiry enforcement from `Expires:` field in entry header
 *   - Change History trimmed to MAX_HISTORY
 *
 * Usage: node consolidate.js <memory-path>
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const MEMORY_PATH = process.argv[2];
if (!MEMORY_PATH || !fs.existsSync(MEMORY_PATH)) {
  console.error('Usage: consolidate.js <memory-path>');
  process.exit(1);
}

const MERGE_THRESHOLD = 0.75;
const SHORT_THRESHOLD = 0.50; // used when either entry has < SHORT_WORD_COUNT tokens
const SHORT_WORD_COUNT = 10;
const REVIEW_LOW      = 0.30;
const ARCHIVE_DAYS    = 30;
const MAX_HISTORY     = 5;
const RELATIVE_TIME   = /\b(今天|昨天|最近|刚刚|上周|上个月|recently|yesterday|today|last\s+week|last\s+month|a\s+few\s+days\s+ago)\b/i;

const DOMAINS = {
  '01-biography':     'biography',
  '02-experiences':   'experiences',
  '03-preferences':   'preferences',
  '04-social-circle': 'social-circle',
  '05-work':          'work',
  '06-psychometrics': 'psychometrics',
};

const today    = new Date();
const todayStr = today.toISOString().slice(0, 10);
const nowYYYYMM = todayStr.slice(0, 7);

// ─── Utilities ────────────────────────────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr);
  return isNaN(d) ? 9999 : Math.floor((today - d) / 86400000);
}

// CJK bigrams so Chinese text is tokenized properly
function tokenize(text) {
  const tokens = new Set();
  for (const w of text.toLowerCase().replace(/[^\w\s]/g, ' ').split(/\s+/)) {
    if (w.length > 1) tokens.add(w);
  }
  for (const seg of (text.match(/[一-鿿]+/g) || [])) {
    for (let i = 0; i < seg.length - 1; i++) tokens.add(seg[i] + seg[i + 1]);
  }
  return tokens;
}

function tokenCount(text) {
  const ascii = text.toLowerCase().split(/\s+/).filter(w => w.length > 1).length;
  const cjk   = (text.match(/[一-鿿]/g) || []).length;
  return ascii + cjk;
}

function jaccardSimilarity(a, b) {
  const sa = tokenize(a), sb = tokenize(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

// Lower threshold for short entries to catch paraphrased duplicates
function getMergeThreshold(a, b) {
  return Math.min(tokenCount(a), tokenCount(b)) < SHORT_WORD_COUNT
    ? SHORT_THRESHOLD
    : MERGE_THRESHOLD;
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseFrontmatter(content) {
  const m = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/);
  if (!m) return { front: '', preamble: '', body: content };
  const afterFront = m[2];
  const firstEntry = afterFront.search(/^### /m);
  const preamble   = firstEntry > 0 ? afterFront.slice(0, firstEntry) : '';
  const body       = firstEntry >= 0 ? afterFront.slice(firstEntry) : afterFront;
  return { front: m[1], preamble, body };
}

function parseEntries(body) {
  const entries = [];
  const chunks  = body.split(/\n(?=### )/);

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('###')) continue;

    const lines  = trimmed.split('\n');
    const header = lines[0];
    const m      = header.match(/^### ([A-Z]+-\d+)\s+(.+?)\s+\[[^:]+:\s*([^\s|]+)\s*\|[^:]+:\s*([\d-]+)\s*\|[^:]+:\s*([^\]|]+)(?:\|[^:]+:\s*([^\]]+))?\]/);

    const exm = header.match(/Expires:\s*(\d{4}-\d{2})/i);
    const entry = {
      id:       m?.[1]  || '?',
      title:    m?.[2]  || header.replace(/^###\s*/, '').trim(),
      strength: m?.[3]  || 'medium',
      updated:  m?.[4]  || '',
      source:   m?.[5]?.trim() || '',
      expires:  exm?.[1] || '',
      content:  '',
      category: '',
      quote:    '',
      raw:      trimmed,
    };

    for (const line of lines.slice(1)) {
      if (!entry.category) {
        const cm = line.match(/^\s*-\s*\*\*Category\*\*:\s*(.+)/);
        if (cm) { entry.category = cm[1].trim(); continue; }
      }
      if (!entry.quote) {
        const qm = line.match(/^\s*-\s*\*\*Original Quote\*\*:\s*"?(.+?)"?\s*$/);
        if (qm) { entry.quote = qm[1].trim(); continue; }
      }
      if (!entry.content) {
        const bulletM = line.match(/^\s*-\s+([^*\s].+)/);
        if (bulletM) { entry.content = bulletM[1].trim(); continue; }
        if (line.trim() && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('*')) {
          entry.content = line.trim();
        }
      }
    }

    entries.push(entry);
  }

  return entries;
}

// ─── Change History trimming ──────────────────────────────────────────────────

function trimChangeHistory(raw) {
  const m = raw.match(/(- \*\*Change History\*\*:\n)((?:  - .+\n?)+)/);
  if (!m) return raw;
  const lines = (m[2].match(/  - .+/g) || []);
  if (lines.length <= MAX_HISTORY) return raw;
  const dropped = lines.length - MAX_HISTORY;
  const kept    = lines.slice(-MAX_HISTORY);
  return raw.replace(m[0], `${m[1]}  - (${dropped} earlier entries consolidated)\n${kept.join('\n')}\n`);
}

// ─── Merge ────────────────────────────────────────────────────────────────────

const STRENGTH_RANK = { high: 3, medium: 2, low: 1, '高': 3, '中': 2, '低': 1 };

function pickWinner(a, b) {
  const sa = (STRENGTH_RANK[a.strength] || 2) * 1000 - daysSince(a.updated);
  const sb = (STRENGTH_RANK[b.strength] || 2) * 1000 - daysSince(b.updated);
  return sa >= sb ? { winner: a, loser: b } : { winner: b, loser: a };
}

function mergeIntoWinner(winner, loser, sim) {
  const pct       = Math.round(sim * 100);
  const quoteNote = loser.quote ? ` Original Quote: "${loser.quote}"` : '';
  const note      = `  - ${todayStr}: Auto-merged with ${loser.id} (${pct}% overlap).${quoteNote}`;

  let raw = winner.raw.replace(/\| Updated: [\d-]+/, () => `| Updated: ${todayStr}`);

  if (raw.includes('**Change History**')) {
    raw = raw.replace(/(- \*\*Change History\*\*:[\s\S]*?)(\n(?=###)|\s*$)/, (_, g1, g2) => `${g1}\n${note}${g2}`);
  } else {
    raw = raw.trimEnd() + `\n- **Change History**:\n${note}\n`;
  }

  return { ...winner, updated: todayStr, raw: trimChangeHistory(raw) };
}

// ─── Write entries back ───────────────────────────────────────────────────────

function serializeEntries(front, preamble, entries) {
  const updatedFront = front.replace(/^(updated:\s*).+$/m, `$1${todayStr}`);
  const entriesStr   = entries.map(e => e.raw.trim()).join('\n\n');
  return updatedFront.trimEnd() + '\n' + (preamble || '\n') + entriesStr + (entriesStr ? '\n' : '');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const archiveDir = path.join(MEMORY_PATH, 'archive');
fs.mkdirSync(archiveDir, { recursive: true });

const report = { autoMerged: [], archived: [], relTime: [], review: [] };

for (const [dirName, domainName] of Object.entries(DOMAINS)) {
  const indexPath = path.join(MEMORY_PATH, 'domains', dirName, '_index.md');
  if (!fs.existsSync(indexPath)) continue;

  const raw                      = fs.readFileSync(indexPath, 'utf8');
  const { front, preamble, body } = parseFrontmatter(raw);
  let entries           = parseEntries(body);
  let modified          = false;

  // ── 1. Archive expired entries (Expires: YYYY-MM past current month) ─────
  const expired = entries.filter(e => e.expires && e.expires < nowYYYYMM);
  for (const e of expired) {
    const dest = path.join(archiveDir, `${e.id}-expired-${todayStr}.md`);
    fs.writeFileSync(dest, `# Archived (expired): ${e.id}\nArchived: ${todayStr}\nExpires: ${e.expires}\n\n---\n\n${e.raw}\n`, 'utf8');
    report.archived.push(`${e.id} (${domainName}) — expired ${e.expires}`);
    modified = true;
  }
  entries = entries.filter(e => !expired.includes(e));

  // ── 2. Archive low-strength stale entries ────────────────────────────────
  const stale = entries.filter(e => e.strength === 'low' && daysSince(e.updated) > ARCHIVE_DAYS);
  for (const e of stale) {
    const dest = path.join(archiveDir, `${e.id}-${todayStr}.md`);
    fs.writeFileSync(dest, `# Archived: ${e.id}\nArchived: ${todayStr}\nReason: strength=low, last updated ${e.updated} (${daysSince(e.updated)}d ago)\n\n---\n\n${e.raw}\n`, 'utf8');
    report.archived.push(`${e.id} (${domainName}) — low strength, ${daysSince(e.updated)}d since ${e.updated}`);
    modified = true;
  }
  entries = entries.filter(e => !stale.includes(e));

  // ── 3. Flag relative time ────────────────────────────────────────────────
  for (const e of entries) {
    if (RELATIVE_TIME.test(e.content) || RELATIVE_TIME.test(e.title)) {
      report.relTime.push(`${e.id} (${domainName}): "${(e.content || e.title).slice(0, 70)}"`);
    }
  }

  // ── 4. Find merge candidates by category ─────────────────────────────────
  const byCategory = {};
  for (const e of entries) {
    const key = e.category.toLowerCase() || '__none__';
    (byCategory[key] = byCategory[key] || []).push(e);
  }

  const absorbed = new Set();

  for (const [cat, group] of Object.entries(byCategory)) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      if (absorbed.has(group[i].id)) continue;

      for (let j = i + 1; j < group.length; j++) {
        if (absorbed.has(group[j].id)) continue;

        const sim       = jaccardSimilarity(group[i].content, group[j].content);
        const threshold = getMergeThreshold(group[i].content, group[j].content);

        if (sim >= threshold) {
          const { winner, loser } = pickWinner(group[i], group[j]);
          const merged = mergeIntoWinner(winner, loser, sim);
          const idx = entries.findIndex(e => e.id === winner.id);
          if (idx >= 0) entries[idx] = merged;
          absorbed.add(loser.id);
          report.autoMerged.push(
            `${winner.id} ← ${loser.id}  (${domainName} / "${cat}")  ${Math.round(sim * 100)}% overlap  kept: ${winner.id} [${winner.strength}]`
          );
          modified = true;

        } else if (sim >= REVIEW_LOW) {
          const label = cat === '__none__' ? 'no Category' : `"${cat}"`;
          report.review.push(
            `${group[i].id} vs ${group[j].id}  (${domainName} / ${label})  ${Math.round(sim * 100)}% overlap\n` +
            `  A: "${group[i].content.slice(0, 90)}"\n` +
            `  B: "${group[j].content.slice(0, 90)}"\n` +
            `  → Same fact or complementary? If same: merge manually. If complementary: add distinct Category suffixes.`
          );
        }
      }
    }
  }

  entries = entries.filter(e => !absorbed.has(e.id));

  // ── 5. Trim oversized Change History on all remaining entries ─────────────
  for (const e of entries) {
    const trimmed = trimChangeHistory(e.raw);
    if (trimmed !== e.raw) { e.raw = trimmed; modified = true; }
  }

  if (modified) fs.writeFileSync(indexPath, serializeEntries(front, preamble, entries), 'utf8');
}

// ─── Consolidation log ────────────────────────────────────────────────────────

const logLines = [`\n## Consolidation ${todayStr}\n`];

if (report.autoMerged.length) {
  logLines.push('### Auto-merged\n');
  report.autoMerged.forEach(l => logLines.push(`- ${l}`));
  logLines.push('');
}
if (report.archived.length) {
  logLines.push('### Archived\n');
  report.archived.forEach(l => logLines.push(`- ${l}`));
  logLines.push('');
}
if (report.relTime.length) {
  logLines.push('### Flagged: relative time\n');
  report.relTime.forEach(l => logLines.push(`- ${l}`));
  logLines.push('');
}
if (report.review.length) {
  logLines.push('### Review needed\n');
  report.review.forEach((l, i) => logLines.push(`[${i + 1}] ${l}\n`));
}
if (!Object.values(report).some(a => a.length)) {
  logLines.push('No issues found.\n');
}

try { fs.appendFileSync(path.join(MEMORY_PATH, 'consolidation-log.md'), logLines.join('\n'), 'utf8'); } catch (_) {}

// ─── Output ───────────────────────────────────────────────────────────────────

const hasReview = report.review.length > 0 || report.relTime.length > 0;

if (hasReview) {
  const out = ['=== Consolidation Complete ===\n'];
  if (report.autoMerged.length) out.push(`Auto-merged: ${report.autoMerged.length} pairs`);
  if (report.archived.length)   out.push(`Archived:    ${report.archived.length} entries`);

  if (report.relTime.length) {
    out.push('\n--- Fix these (replace relative time with absolute date) ---');
    report.relTime.forEach(l => out.push('  • ' + l));
  }
  if (report.review.length) {
    out.push('\n--- Review needed (make a call on each) ---');
    report.review.forEach((l, i) => out.push(`\n[${i + 1}] ${l}`));
    out.push('\nFor each: merge manually OR add distinct Category suffixes to keep both.');
  }
  console.log(out.join('\n'));
} else {
  process.stdout.write(JSON.stringify({
    systemMessage: `Consolidation done: ${report.autoMerged.length} auto-merged, ${report.archived.length} archived. No review needed.`
  }) + '\n');
}
