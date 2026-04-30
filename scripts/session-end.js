#!/usr/bin/env node
/**
 * Synthius-Mem for Claude Code — SessionEnd Consolidation
 *
 * For each pending capture:
 *   - Same category + Jaccard similarity >= DEDUP_THRESHOLD → update existing entry
 *   - Otherwise → append as new entry
 *
 * Fixes vs original:
 *   - ID generation: max-based (not count-based, avoids collision after archive)
 *   - Title slug: word-boundary truncation
 *   - CJK bigram tokenization for similarity check
 *   - Pre-append dedup: update instead of blindly append when near-duplicate exists
 *   - `expires` field from pending meta written into entry header
 *
 * Usage: node session-end.js <memory-path>
 */

'use strict';
const fs   = require('fs');
const path = require('path');

const MEMORY_PATH = process.argv[2];
if (!MEMORY_PATH || !fs.existsSync(MEMORY_PATH)) process.exit(0);

const PENDING_DIR       = path.join(MEMORY_PATH, '.pending');
const CONSOLIDATION_LOG = path.join(MEMORY_PATH, 'consolidation-log.md');
const ARCHIVE_DIR       = path.join(MEMORY_PATH, 'archive');
const DEDUP_THRESHOLD   = 0.80;

const DOMAIN_MAP = {
  'biography':     '01-biography',
  'experiences':   '02-experiences',
  'preferences':   '03-preferences',
  'social-circle': '04-social-circle',
  'socialcircle':  '04-social-circle',
  'work':          '05-work',
  'psychometrics': '06-psychometrics',
};

const ID_PREFIX = {
  'biography':     'B',
  'experiences':   'E',
  'preferences':   'P',
  'social-circle': 'SC',
  'socialcircle':  'SC',
  'work':          'W',
  'psychometrics': 'PS',
};

// ── Utilities ──────────────────────────────────────────────────────────────────

function parseFrontmatter(content) {
  const m = content.match(/^(---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$))([\s\S]*)$/);
  if (!m) return { front: '', meta: {}, body: content };
  const meta = {};
  for (const line of m[2].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { front: m[1], meta, body: m[3] };
}

function extractField(body, field) {
  const m = body.match(new RegExp(`\\*\\*${field}\\*\\*:\\s*(.+)`));
  return m ? m[1].replace(/^["']|["']$/g, '').trim() : '';
}

// Max-based ID: survives archive/deletion without collision
function nextEntryId(domain, indexContent) {
  const prefix = ID_PREFIX[domain] || 'X';
  const regex  = new RegExp(`^### ${prefix}-(\\d+)`, 'gm');
  let maxNum = 0, match;
  while ((match = regex.exec(indexContent)) !== null) {
    const n = parseInt(match[1], 10);
    if (n > maxNum) maxNum = n;
  }
  return `${prefix}-${String(maxNum + 1).padStart(3, '0')}`;
}

// Word-boundary truncation — avoids mid-word or mid-CJK cuts
function makeSlug(text, maxLen = 52) {
  const line = text.replace(/[\r\n].*/s, '').trim();
  if (line.length <= maxLen) return line;
  const cut = line.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > maxLen * 0.55 ? cut.slice(0, lastSpace) : cut;
}

// CJK bigram tokenization so Chinese text isn't treated as a single token
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

function jaccardSimilarity(a, b) {
  const sa = tokenize(a), sb = tokenize(b);
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function parseEntries(body) {
  const entries = [];
  for (const chunk of body.split(/\n(?=### )/)) {
    const trimmed = chunk.trim();
    if (!trimmed.startsWith('###')) continue;
    const lines = trimmed.split('\n');
    const m = lines[0].match(/^### ([A-Z]+-\d+)\s+/);
    const entry = { id: m?.[1] || '?', content: '', category: '', raw: trimmed };
    for (const line of lines.slice(1)) {
      if (!entry.category) {
        const cm = line.match(/^\s*-\s*\*\*Category\*\*:\s*(.+)/);
        if (cm) { entry.category = cm[1].trim(); continue; }
      }
      if (!entry.content) {
        const bm = line.match(/^\s*-\s+([^*\s].+)/);
        if (bm) entry.content = bm[1].trim();
      }
    }
    entries.push(entry);
  }
  return entries;
}

// ── Main ───────────────────────────────────────────────────────────────────────

const today = new Date().toISOString().slice(0, 10);

fs.mkdirSync(ARCHIVE_DIR, { recursive: true });

if (!fs.existsSync(PENDING_DIR)) process.exit(0);

const pendingFiles = fs.readdirSync(PENDING_DIR)
  .filter(f => f.startsWith('pending-') && f.endsWith('.md'))
  .sort();

if (pendingFiles.length === 0) process.exit(0);

const logLines   = [`\n## SessionEnd ${today}\n`];
let newCount     = 0;
let updatedCount = 0;
let skipped      = 0;

for (const file of pendingFiles) {
  const filePath = path.join(PENDING_DIR, file);
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { logLines.push(`- SKIP ${file}: read error — ${e.message}`); skipped++; continue; }

  const { meta, body } = parseFrontmatter(content);
  const rawDomain = (meta.domain || '').toLowerCase().trim().replace(/\s+/g, '-');
  const domainDir = DOMAIN_MAP[rawDomain];

  if (!domainDir) {
    logLines.push(`- SKIP ${file}: unknown domain "${rawDomain}"`);
    skipped++; continue;
  }

  const indexPath = path.join(MEMORY_PATH, 'domains', domainDir, '_index.md');
  if (!fs.existsSync(indexPath)) {
    logLines.push(`- SKIP ${file}: index missing at ${indexPath}`);
    skipped++; continue;
  }

  let indexContent = fs.readFileSync(indexPath, 'utf8');
  const { body: indexBody } = parseFrontmatter(indexContent);
  const existingEntries = parseEntries(indexBody);

  const strength    = meta.strength || 'medium';
  const expires     = meta.expires  || '';
  const source      = extractField(body, 'Source Session') || (meta.date || today);
  const contentText = extractField(body, 'Content')        || body.trim().split('\n')[0].slice(0, 120);
  const quote       = extractField(body, 'Original Quote');
  const category    = extractField(body, 'Category');
  const titleSlug   = makeSlug(contentText);

  // Find nearest existing entry in same category (or uncategorized pool if no category)
  const sameCat = category
    ? existingEntries.filter(e => e.category.toLowerCase() === category.toLowerCase())
    : existingEntries.filter(e => !e.category);

  let matched = null, matchSim = 0;
  for (const e of sameCat) {
    const sim = jaccardSimilarity(contentText, e.content);
    if (sim > matchSim) { matchSim = sim; matched = e; }
  }

  try {
    if (matched && matchSim >= DEDUP_THRESHOLD) {
      // Near-duplicate: update existing entry instead of appending
      const note = `  - ${today}: Updated via ${file} (${Math.round(matchSim * 100)}% overlap)${quote ? ` — "${quote}"` : ''}`;
      let updatedRaw = matched.raw.replace(/\| Updated: [\d-]+/, () => `| Updated: ${today}`);
      if (updatedRaw.includes('**Change History**')) {
        updatedRaw = updatedRaw.replace(/(- \*\*Change History\*\*:[\s\S]*?)(\n(?=###)|\s*$)/, (_, g1, g2) => `${g1}\n${note}${g2}`);
      } else {
        updatedRaw = updatedRaw.trimEnd() + `\n- **Change History**:\n${note}\n`;
      }
      indexContent = indexContent.replace(matched.raw, () => updatedRaw);
      indexContent = indexContent.replace(/^(updated:\s*).+$/m, `$1${today}`);
      logLines.push(`- UPDATE ${file} → ${domainDir}/${matched.id} (${Math.round(matchSim * 100)}%)`);
      updatedCount++;
    } else {
      // New entry
      const entryId    = nextEntryId(rawDomain, indexContent);
      const expiresTag = expires ? ` | Expires: ${expires}` : '';
      const entryLines = [
        `\n### ${entryId} ${titleSlug} [Strength: ${strength} | Updated: ${today} | Source: ${source}${expiresTag}]`,
        `- ${contentText}`,
      ];
      if (category) entryLines.push(`- **Category**: ${category}`);
      if (quote)    entryLines.push(`- **Original Quote**: "${quote}"`);
      entryLines.push(`- **Change History**:`);
      entryLines.push(`  - ${today}: Initial capture (${file})`);
      entryLines.push('');

      indexContent = indexContent.replace(/\n_No entries yet[^\n]*\n?/g, '\n');
      indexContent = indexContent.replace(/^(updated:\s*).+$/m, `$1${today}`);
      indexContent = indexContent.trimEnd() + '\n' + entryLines.join('\n');
      logLines.push(`- OK   ${file} → ${domainDir}/${entryId}`);
      newCount++;
    }

    fs.writeFileSync(indexPath, indexContent, 'utf8');
    fs.unlinkSync(filePath);
  } catch (e) {
    logLines.push(`- FAIL ${file}: write error — ${e.message}`);
    skipped++;
  }
}

const summary = `New: ${newCount} | Updated: ${updatedCount} | Skipped: ${skipped}`;
logLines.push(`\n${summary}\n`);
try { fs.appendFileSync(CONSOLIDATION_LOG, logLines.join('\n'), 'utf8'); } catch (_) {}

if (newCount + updatedCount > 0) {
  process.stdout.write(JSON.stringify({
    systemMessage: `Memory: ${summary.toLowerCase()}.`
  }) + '\n');
}
