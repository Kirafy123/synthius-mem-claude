#!/usr/bin/env node
/**
 * Synthius-Mem for Claude Code — SessionEnd Consolidation
 *
 * Mechanically appends pending captures to domain _index.md files.
 * No LLM required — deterministic append only.
 * Semantic dedup/merge is a separate manual step via the 'consolidate' action.
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

function parseFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)([\s\S]*)$/);
  if (!m) return { meta: {}, body: content };
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const colon = line.indexOf(':');
    if (colon > 0) meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
  }
  return { meta, body: m[2] };
}

function extractField(body, field) {
  const m = body.match(new RegExp(`\\*\\*${field}\\*\\*:\\s*(.+)`));
  return m ? m[1].replace(/^["']|["']$/g, '').trim() : '';
}

function nextEntryId(domain, indexContent) {
  const prefix  = ID_PREFIX[domain] || 'X';
  const existing = (indexContent.match(/^### [A-Z]+-\d+/gm) || []).length;
  return `${prefix}-${String(existing + 1).padStart(3, '0')}`;
}

const today = new Date().toISOString().slice(0, 10);

if (!fs.existsSync(PENDING_DIR)) process.exit(0);

const pendingFiles = fs.readdirSync(PENDING_DIR)
  .filter(f => f.startsWith('pending-') && f.endsWith('.md'))
  .sort();

if (pendingFiles.length === 0) process.exit(0);

const logLines   = [`\n## SessionEnd ${today}\n`];
let consolidated = 0;
let skipped      = 0;

for (const file of pendingFiles) {
  const filePath = path.join(PENDING_DIR, file);
  let content;
  try { content = fs.readFileSync(filePath, 'utf8'); }
  catch (e) { logLines.push(`- SKIP ${file}: read error — ${e.message}`); skipped++; continue; }

  const { meta, body } = parseFrontmatter(content);
  const rawDomain  = (meta.domain || '').toLowerCase().trim().replace(/\s+/g, '-');
  const domainDir  = DOMAIN_MAP[rawDomain];

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

  const entryId     = nextEntryId(rawDomain, indexContent);
  const strength    = meta.strength || 'medium';
  const source      = extractField(body, 'Source Session') || (meta.date || today);
  const contentText = extractField(body, 'Content')        || body.trim().split('\n')[0].slice(0, 120);
  const quote       = extractField(body, 'Original Quote');
  const category    = extractField(body, 'Category');
  const titleSlug   = contentText.slice(0, 52).replace(/[\r\n].*/s, '').trimEnd();

  const entryLines = [
    `\n### ${entryId} ${titleSlug} [Strength: ${strength} | Updated: ${today} | Source: ${source}]`,
    `- ${contentText}`,
  ];
  if (category) entryLines.push(`- **Category**: ${category}`);
  if (quote)    entryLines.push(`- **Original Quote**: "${quote}"`);
  entryLines.push(`- **Change History**:`);
  entryLines.push(`  - ${today}: Initial capture (${file})`);
  entryLines.push('');

  // Remove "no entries yet" placeholder
  indexContent = indexContent.replace(/\n_No entries yet[^\n]*\n?/g, '\n');
  // Update frontmatter updated date
  indexContent = indexContent.replace(/^(updated:\s*).+$/m, `$1${today}`);
  // Append entry
  indexContent = indexContent.trimEnd() + '\n' + entryLines.join('\n');

  try {
    fs.writeFileSync(indexPath, indexContent, 'utf8');
    fs.unlinkSync(filePath);
    logLines.push(`- OK   ${file} → ${domainDir}/${entryId}`);
    consolidated++;
  } catch (e) {
    logLines.push(`- FAIL ${file}: write error — ${e.message}`);
    skipped++;
  }
}

logLines.push(`\nConsolidated: ${consolidated} | Skipped: ${skipped}\n`);
try { fs.appendFileSync(CONSOLIDATION_LOG, logLines.join('\n'), 'utf8'); } catch (_) {}

if (consolidated > 0) {
  process.stdout.write(JSON.stringify({
    systemMessage: `Memory consolidated: ${consolidated} entries written to domains${skipped > 0 ? `, ${skipped} skipped` : ''}.`
  }) + '\n');
}
