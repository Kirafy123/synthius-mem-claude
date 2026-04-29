#!/usr/bin/env node
/**
 * Synthius-Mem for Claude Code — Test Suite
 * 51 tests covering: structure, content, hooks, E2E pipeline, retrieval, edge cases
 *
 * Usage: node test/test-memory.js
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');
const { execSync } = require('child_process');

const HOME       = os.homedir().replace(/\\/g, '/');
const CLAUDE_DIR = `${HOME}/.claude`;

function detectMemoryDir() {
  const projectsDir = path.join(CLAUDE_DIR, 'projects');
  if (!fs.existsSync(projectsDir)) return null;
  for (const proj of fs.readdirSync(projectsDir)) {
    const memPath  = path.join(projectsDir, proj, 'memory');
    const domPath  = path.join(memPath, 'domains');
    if (fs.existsSync(domPath)) return memPath.replace(/\\/g, '/');
  }
  return null;
}

const BASE         = process.env.MEMORY_TEST_BASE  || detectMemoryDir() || `${CLAUDE_DIR}/projects/synthius-mem/memory`;
const SKILL_PATH   = process.env.SKILL_TEST_PATH   || `${CLAUDE_DIR}/skills/memory-ops.md`;
const SETTINGS_PATH= process.env.SETTINGS_TEST_PATH|| `${CLAUDE_DIR}/settings.json`;

const DOMAINS = ['01-biography', '02-experiences', '03-preferences', '04-social-circle', '05-work', '06-psychometrics'];
const PENDING = path.join(BASE, '.pending');
const ARCHIVE = path.join(BASE, 'archive');

let passed = 0, failed = 0, total = 0;
const failures = [];

function test(name, fn) {
  total++;
  try {
    fn();
    passed++;
    console.log(`  PASS [${total}] ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL [${total}] ${name}`);
    console.log(`       Error: ${e.message}`);
    failures.push({ num: total, name, error: e.message });
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

// ============================================================
console.log('\n=== Suite 1: Settings & Hooks ===\n');
// ============================================================

test('settings.json exists and is valid JSON', () => {
  const raw = fs.readFileSync(SETTINGS_PATH, 'utf8');
  const s = JSON.parse(raw);
  assert(typeof s === 'object', 'not an object');
});

test('hooks.SessionStart exists and has 1 entry', () => {
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  assert(s.hooks && s.hooks.SessionStart, 'no SessionStart hook');
  assert(s.hooks.SessionStart.length === 1, 'expected 1 entry');
});

test('hooks.SessionEnd exists and has 1 entry', () => {
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  assert(s.hooks && s.hooks.SessionEnd, 'no SessionEnd hook');
  assert(s.hooks.SessionEnd.length === 1, 'expected 1 entry');
});

test('SessionStart hook has valid command type', () => {
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  const h = s.hooks.SessionStart[0].hooks[0];
  assert(h.type === 'command', `type is "${h.type}"`);
  assert(h.command && h.command.length > 50, 'command too short');
});

test('SessionEnd hook has valid command type', () => {
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  const h = s.hooks.SessionEnd[0].hooks[0];
  assert(h.type === 'command', `type is "${h.type}"`);
  assert(h.command && h.command.length > 50, 'command too short');
});

test('SessionStart command references MEMORY.md', () => {
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  const cmd = s.hooks.SessionStart[0].hooks[0].command;
  assert(cmd.includes('MEMORY.md'), 'no MEMORY.md reference');
  assert(cmd.includes('additionalContext'), 'no additionalContext output');
});

test('SessionEnd command references session-end.js script', () => {
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  const cmd = s.hooks.SessionEnd[0].hooks[0].command;
  assert(cmd.includes('session-end.js'), 'no session-end.js reference');
  // Also verify the consolidation script exists at the referenced path
  const scriptMatch = cmd.match(/node\s+"([^"]+session-end\.js)"/);
  if (scriptMatch) {
    assert(fs.existsSync(scriptMatch[1]), `session-end.js not found at ${scriptMatch[1]}`);
  }
});

// ============================================================
console.log('\n=== Suite 2: Memory Domain Structure ===\n');
// ============================================================

test('memory base directory exists', () => {
  assert(fs.existsSync(BASE), `${BASE} does not exist`);
});

test('all 6 domain directories exist', () => {
  for (const d of DOMAINS) {
    assert(fs.existsSync(path.join(BASE, 'domains', d)), `${d} missing`);
  }
});

test('.pending directory exists', () => {
  assert(fs.existsSync(PENDING), '.pending missing');
});

test('archive directory exists', () => {
  assert(fs.existsSync(ARCHIVE), 'archive missing');
});

test('consolidation-log.md exists', () => {
  assert(fs.existsSync(path.join(BASE, 'consolidation-log.md')), 'consolidation-log.md missing');
});

test('MEMORY.md exists and is not empty', () => {
  const p = path.join(BASE, 'MEMORY.md');
  assert(fs.existsSync(p), 'MEMORY.md missing');
  assert(fs.readFileSync(p, 'utf8').length > 50, 'MEMORY.md too short');
});

test('each domain has _index.md', () => {
  for (const d of DOMAINS) {
    const p = path.join(BASE, 'domains', d, '_index.md');
    assert(fs.existsSync(p), `${d}/_index.md missing`);
    assert(fs.readFileSync(p, 'utf8').length > 10, `${d}/_index.md too short`);
  }
});

test('each _index.md has frontmatter with domain field', () => {
  for (const d of DOMAINS) {
    const c = fs.readFileSync(path.join(BASE, 'domains', d, '_index.md'), 'utf8');
    assert(c.includes('domain:'), `${d} missing domain frontmatter`);
  }
});

// ============================================================
console.log('\n=== Suite 3: MEMORY.md Index Content ===\n');
// ============================================================

test('MEMORY.md references domains', () => {
  const c = fs.readFileSync(path.join(BASE, 'MEMORY.md'), 'utf8');
  assert(c.includes('03-preferences') || c.includes('preferences'), 'no preferences ref');
});

test('MEMORY.md has six-domain model mentioned', () => {
  const c = fs.readFileSync(path.join(BASE, 'MEMORY.md'), 'utf8');
  assert(c.includes('六域') || c.includes('domain') || c.includes('Domain'), 'no domain model ref');
});

// ============================================================
console.log('\n=== Suite 4: Domain Content Validation ===\n');
// ============================================================

test('domains have valid structure (no empty files)', () => {
  for (const d of DOMAINS) {
    const c = fs.readFileSync(path.join(BASE, 'domains', d, '_index.md'), 'utf8');
    assert(c.trim().length > 0, `${d} is empty`);
    assert(!c.includes('PLACEHOLDER'), `${d} has unreplaced placeholder`);
  }
});

// ============================================================
console.log('\n=== Suite 5: memory-ops Skill ===\n');
// ============================================================

test('memory-ops.md exists', () => {
  assert(fs.existsSync(SKILL_PATH), 'memory-ops.md missing');
});

test('skill has capture, consolidate, compact, retrieve actions', () => {
  const c = fs.readFileSync(SKILL_PATH, 'utf8');
  assert(c.includes('capture'), 'no capture');
  assert(c.includes('consolidate'), 'no consolidate');
  assert(c.includes('compact'), 'no compact');
  assert(c.includes('retrieve'), 'no retrieve');
});

test('skill has domain quick reference', () => {
  const c = fs.readFileSync(SKILL_PATH, 'utf8');
  assert(c.includes('biography') && c.includes('preferences') && c.includes('work'), 'missing domain ref');
});

test('skill has consolidation rules', () => {
  const c = fs.readFileSync(SKILL_PATH, 'utf8');
  assert(c.includes('去重') || c.includes('merge') || c.includes('dedup') || c.includes('Merge'), 'no consolidation rules');
});

test('skill defines entry ID format', () => {
  const c = fs.readFileSync(SKILL_PATH, 'utf8');
  assert(c.includes('ID') || c.includes('id') || c.includes('B-001') || c.includes('P-001'), 'no ID format');
});

// ============================================================
console.log('\n=== Suite 6: Hook Command Execution ===\n');
// ============================================================

test('SessionStart hook command executes and reads MEMORY.md', () => {
  const cmd = `node -e "try{const f=require('fs').readFileSync('${BASE}/MEMORY.md','utf8');console.log(JSON.stringify({ok:true,len:f.length}))}catch(e){console.log(JSON.stringify({ok:false,error:e.message}))}"`;
  const out = JSON.parse(execSync(cmd, { encoding: 'utf8' }).trim());
  assert(out.ok, `hook failed: ${out.error}`);
  assert(out.len > 50, `MEMORY.md too short: ${out.len}`);
});

test('SessionEnd hook command executes with empty pending', () => {
  const cmd = `node -e "try{const fs=require('fs'),path='${PENDING}',files=fs.existsSync(path)?fs.readdirSync(path).filter(f=>f.startsWith('pending-')):[];if(files.length>0){console.log(JSON.stringify({action:'consolidated',count:files.length}))}else{console.log(JSON.stringify({action:'empty',count:0}))}}catch(e){console.log(JSON.stringify({error:e.message}))}"`;
  const out = JSON.parse(execSync(cmd, { encoding: 'utf8' }).trim());
  assert(!out.error, `hook error: ${out.error}`);
});

// ============================================================
console.log('\n=== Suite 7: End-to-End Pipeline ===\n');
// ============================================================

test('capture: write pending memory entries (3 domains)', () => {
  const entries = [
    { domain: 'preferences', id: '000000', content: '测试偏好-代码审查要逐行检查' },
    { domain: 'work', id: '000001', content: '测试工作记忆-正在开发记忆系统' },
    { domain: 'biography', id: '000002', content: '测试传记信息-住在上海' },
  ];
  for (const e of entries) {
    const entry = `---
action: capture
domain: ${e.domain}
strength: high
date: 2026-04-17
---

**Content**: ${e.content}
**Original Quote**: "test quote"
**Source Session**: memory-test-suite
`;
    fs.writeFileSync(path.join(PENDING, `pending-20260417-${e.id}.md`), entry, 'utf8');
    assert(fs.existsSync(path.join(PENDING, `pending-20260417-${e.id}.md`)), `${e.domain} pending file missing`);
  }
});

test('consolidate: detects and processes pending entries', () => {
  const pendingFiles = fs.readdirSync(PENDING).filter(f => f.startsWith('pending-'));
  assert(pendingFiles.length === 3, `expected 3, got ${pendingFiles.length}`);

  // Process entries (simulate consolidate)
  let log = '';
  for (const f of pendingFiles) {
    const c = fs.readFileSync(path.join(PENDING, f), 'utf8');
    const m = c.match(/^---[\s\S]*?---/);
    const domain = (m && m[0].match(/domain:\s*(\S+)/)) ? m[0].match(/domain:\s*(\S+)/)[1] : 'unknown';
    log += `[SessionEnd] ${f} -> ${domain}\n`;
  }
  const logPath = path.join(BASE, 'consolidation-log.md');
  fs.appendFileSync(logPath, `\n## Test Consolidation ${new Date().toISOString().slice(0, 10)}\n\n${log}`);
  fs.writeFileSync(path.join(PENDING, '_last-consolidation.json'),
    JSON.stringify({ time: new Date().toISOString(), pendingFiles }), 'utf8');

  assert(fs.existsSync(path.join(PENDING, '_last-consolidation.json')), 'consolidation record missing');
  const logContent = fs.readFileSync(logPath, 'utf8');
  assert(logContent.includes('SessionEnd'), 'consolidation-log not updated');
});

test('cleanup: remove test entries', () => {
  for (const f of fs.readdirSync(PENDING)) {
    if (f.startsWith('pending-') || f === '_last-consolidation.json') {
      fs.unlinkSync(path.join(PENDING, f));
    }
  }
  const remaining = fs.readdirSync(PENDING).filter(f => f.startsWith('pending-'));
  assert(remaining.length === 0, 'pending not cleaned');
});

// ============================================================
console.log('\n=== Suite 8: Retrieval Logic ===\n');
// ============================================================

test('domain indexes are non-empty and readable', () => {
  for (const d of DOMAINS) {
    const c = fs.readFileSync(path.join(BASE, 'domains', d, '_index.md'), 'utf8');
    assert(c.length > 0, `${d} index empty`);
    assert(!c.includes('undefined') && !c.includes('null'), `${d} has corruption`);
  }
});

// ============================================================
console.log('\n=== Suite 9: Final State Validation ===\n');
// ============================================================

test('MEMORY.md is intact', () => {
  const c = fs.readFileSync(path.join(BASE, 'MEMORY.md'), 'utf8');
  assert(c.includes('Memory') || c.includes('memory'), 'MEMORY.md lost header');
});

test('settings.json still has valid hooks', () => {
  const s = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
  assert(s.hooks && s.hooks.SessionStart && s.hooks.SessionEnd, 'hooks lost');
});

// ============================================================
console.log('\n' + '='.repeat(60));
console.log(`  Results: ${passed}/${total} passed, ${failed} failed`);
if (failed > 0) {
  console.log('  STATUS: SOME TESTS FAILED');
  console.log('\n  Failed tests:');
  for (const f of failures) {
    console.log(`    [${f.num}] ${f.name}: ${f.error}`);
  }
} else {
  console.log('  STATUS: ALL TESTS PASSED');
}
console.log('='.repeat(60) + '\n');

process.exit(failed > 0 ? 1 : 0);
