#!/usr/bin/env node
/**
 * Synthius-Mem — Deterministic Consolidation Script
 *
 * Deterministic actions (no LLM needed):
 *   - Auto-merge: same domain + same Category + word overlap >= MERGE_THRESHOLD
 *   - Archive: Strength: low + not updated in ARCHIVE_DAYS days
 *   - Flag: relative time references in content/title
 *
 * Outputs for LLM review:
 *   - Same-category pairs with overlap 30%-MERGE_THRESHOLD (ambiguous — maybe same, maybe complementary)
 *   - Entries missing Category field that have overlap > 0.3 with another entry
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
const REVIEW_LOW      = 0.30;
const ARCHIVE_DAYS    = 30;
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

// ─── Utilities ────────────────────────────────────────────────────────────────

function daysSince(dateStr) {
  if (!dateStr) return 9999;
  const d = new Date(dateStr);
  return isNaN(d) ? 9999 : Math.floor((today - d) / 86400000);
}

function jaccardSimilarity(a, b) {
  const tok  = t => new Set(t.toLowerCase().replace(/[^\w\s一-鿿]/g, ' ').split(/\s+/).filter(w => w.length > 1));
  const setA = tok(a), setB = tok(b);
  // Both empty = unknown, not identical — treat as 0 to avoid false positives
  if (!setA.size || !setB.size) return 0;
  let inter = 0;
  for (const w of setA) if (setB.has(w)) inter++;
  return inter / (setA.size + setB.size - inter);
}

// ─── Parser ───────────────────────────────────────────────────────────────────

function parseFrontmatter(content) {
  const m = content.match(/^(---\r?\n[\s\S]*?\r?\n---\r?\n?)([\s\S]*)$/);
  return m ? { front: m[1], body: m[2] } : { front: '', body: content };
}

function parseEntries(body) {
  const entries = [];
  // Split on lines starting with "### "
  const chunks  = body.split(/\n(?=### )/);

  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('###')) continue;

    const lines  = trimmed.split('\n');
    const header = lines[0];
    // Support both English [Strength|Updated|Source] and Chinese [强度|更新|来源] label formats
    // Use [^\s|]+ for strength value to match Chinese (高/中/低) and English (high/medium/low)
    const m      = header.match(/^### ([A-Z]+-\d+)\s+(.+?)\s+\[[^:]+:\s*([^\s|]+)\s*\|[^:]+:\s*([\d-]+)\s*\|[^:]+:\s*([^\]]+)\]/);

    const entry = {
      id:       m?.[1]  || '?',
      title:    m?.[2]  || header.replace(/^###\s*/, '').trim(),
      strength: m?.[3]  || 'medium',
      updated:  m?.[4]  || '',
      source:   m?.[5]?.trim() || '',
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
        // Bullet-point format: "- content text"
        const bulletM = line.match(/^\s*-\s+([^*\s].+)/);
        if (bulletM) { entry.content = bulletM[1].trim(); continue; }
        // Plain text format (no leading dash, not a heading/hr/blank)
        if (line.trim() && !line.startsWith('#') && !line.startsWith('-') && !line.startsWith('*')) {
          entry.content = line.trim();
        }
      }
    }

    entries.push(entry);
  }

  return entries;
}

// ─── Merge ────────────────────────────────────────────────────────────────────

const STRENGTH_RANK = { high: 3, medium: 2, low: 1, '高': 3, '中': 2, '低': 1 };

function pickWinner(a, b) {
  const sa = (STRENGTH_RANK[a.strength] || 2) * 1000 - daysSince(a.updated);
  const sb = (STRENGTH_RANK[b.strength] || 2) * 1000 - daysSince(b.updated);
  return sa >= sb ? { winner: a, loser: b } : { winner: b, loser: a };
}

function mergeIntoWinner(winner, loser, sim) {
  const pct      = Math.round(sim * 100);
  const quoteNote = loser.quote ? ` Original Quote: "${loser.quote}"` : '';
  const note      = `  - ${todayStr}: Auto-merged with ${loser.id} (${pct}% word overlap).${quoteNote}`;

  let raw = winner.raw;
  raw = raw.replace(/\| Updated: [\d-]+/, `| Updated: ${todayStr}`);

  if (raw.includes('**Change History**')) {
    // Append after the last history line
    raw = raw.replace(/(- \*\*Change History\*\*:[\s\S]*?)(\n(?=###)|\s*$)/, `$1\n${note}$2`);
  } else {
    raw = raw.trimEnd() + `\n- **Change History**:\n${note}\n`;
  }

  return { ...winner, updated: todayStr, raw };
}

// ─── Write entries back ───────────────────────────────────────────────────────

function serializeEntries(front, entries) {
  const updatedFront = front.replace(/^(updated:\s*).+$/m, `$1${todayStr}`);
  return updatedFront.trimEnd() + '\n\n' + entries.map(e => e.raw.trim()).join('\n\n') + '\n';
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const archiveDir = path.join(MEMORY_PATH, 'archive');
fs.mkdirSync(archiveDir, { recursive: true });

const report = { autoMerged: [], archived: [], relTime: [], review: [] };

for (const [dirName, domainName] of Object.entries(DOMAINS)) {
  const indexPath = path.join(MEMORY_PATH, 'domains', dirName, '_index.md');
  if (!fs.existsSync(indexPath)) continue;

  const raw             = fs.readFileSync(indexPath, 'utf8');
  const { front, body } = parseFrontmatter(raw);
  let entries           = parseEntries(body);
  let modified          = false;

  // ── 1. Archive low-strength stale entries ────────────────────────────────
  const stale = entries.filter(e => e.strength === 'low' && daysSince(e.updated) > ARCHIVE_DAYS);
  for (const e of stale) {
    const dest = path.join(archiveDir, `${e.id}-${todayStr}.md`);
    fs.writeFileSync(dest, `# Archived: ${e.id}\n\nArchived: ${todayStr}\nReason: strength=low, last updated ${e.updated} (${daysSince(e.updated)}d ago)\n\n---\n\n${e.raw}\n`, 'utf8');
    report.archived.push(`${e.id} (${domainName}) — low strength, ${daysSince(e.updated)}d since ${e.updated}`);
    modified = true;
  }
  entries = entries.filter(e => !stale.includes(e));

  // ── 2. Flag relative time ────────────────────────────────────────────────
  for (const e of entries) {
    if (RELATIVE_TIME.test(e.content) || RELATIVE_TIME.test(e.title)) {
      report.relTime.push(`${e.id} (${domainName}): "${(e.content || e.title).slice(0, 70)}"`);
    }
  }

  // ── 3. Find merge candidates by category ─────────────────────────────────
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

        const sim = jaccardSimilarity(group[i].content, group[j].content);

        if (sim >= MERGE_THRESHOLD) {
          // Deterministic: auto-merge
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
          // Edge case: flag for human review
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
  if (modified) fs.writeFileSync(indexPath, serializeEntries(front, entries), 'utf8');
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
  // Print to stdout so Claude can read it as tool output
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
