#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readEntries, findLogDirs, logDir } from './log.mjs';
import { percentile } from './score.mjs';

export function summarize(entries, { days = 7, now = Date.now() } = {}) {
  const since = now - days * 86_400_000;
  const recent = entries.filter((e) => e && Date.parse(e.ts) >= since);
  const count = (pred) => recent.filter(pred).length;
  const byBackend = {};
  for (const e of recent) {
    if (!e.backend) continue;
    if (Number.isFinite(e.ms)) (byBackend[e.backend] ??= []).push(e.ms);
  }
  const flaggedRules = {};
  for (const e of recent) if (e.outcome === 'flagged' && e.check === 'rules') flaggedRules[e.id] = (flaggedRules[e.id] ?? 0) + 1;
  return {
    days,
    total: recent.length,
    byCheck: { rules: count((e) => e.check === 'rules'), done: count((e) => e.check === 'done') },
    outcomes: {
      flagged: count((e) => e.outcome === 'flagged'),
      quiet: count((e) => e.outcome === 'quiet'),
      unusable: count((e) => e.outcome === 'unusable'),
      error: count((e) => e.outcome === 'error'),
      timeout: count((e) => e.outcome === 'timeout'),
    },
    backends: Object.fromEntries(
      Object.entries(byBackend).map(([name, ms]) => [name, { checks: ms.length, p50: percentile([...ms].sort((a, b) => a - b), 0.5) }]),
    ),
    topRules: Object.entries(flaggedRules).sort((a, b) => b[1] - a[1]).slice(0, 10),
    recentFlags: recent.filter((e) => e.outcome === 'flagged').slice(-10),
  };
}

export function render(s) {
  const lines = [`Flinch, last ${s.days} day${s.days === 1 ? '' : 's'}`, ''];
  if (s.total === 0) return [...lines, 'No checks logged yet.'].join('\n');
  const pct = (n) => `${Math.round((100 * n) / s.total)}%`;
  const o = s.outcomes;
  lines.push(`Checks run   ${s.total}  (rules ${s.byCheck.rules}, done ${s.byCheck.done})`);
  lines.push(`Flagged      ${o.flagged}  (${pct(o.flagged)})`);
  lines.push(`Quiet        ${o.quiet}`);
  if (o.unusable + o.error + o.timeout > 0) lines.push(`No answer    ${o.unusable + o.error + o.timeout}  (unusable ${o.unusable}, errors ${o.error}, timeouts ${o.timeout})`);
  lines.push('', 'Backends');
  for (const [name, b] of Object.entries(s.backends)) lines.push(`  ${name.padEnd(12)} ${String(b.checks).padStart(5)} checks   median ${b.p50}ms`);
  if (s.topRules.length) {
    lines.push('', 'Rules flagged most');
    for (const [id, n] of s.topRules) lines.push(`  ${String(n).padStart(4)}  ${id}`);
  }
  if (s.recentFlags.length) {
    lines.push('', 'Recent flags');
    for (const e of s.recentFlags) {
      const conf = e.confidence == null ? '' : ` ${Math.round(e.confidence * 100)}%`;
      lines.push(`  ${String(e.ts ?? '').slice(0, 16).replace('T', ' ')}  ${String(e.check ?? e.event ?? '').padEnd(5)} ${String(e.id ?? '').padEnd(24)} ${e.kind ?? ''}${conf}  ${e.backend ?? ''}`);
    }
  }
  return lines.join('\n');
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { days: { type: 'string', default: '7' }, json: { type: 'boolean', default: false } },
  });
  const [command] = positionals;
  if (command !== 'log') {
    process.stdout.write('Usage: flinch log [--days N] [--json]\n');
    process.exit(command ? 1 : 0);
  }
  const dirs = process.env.FLINCH_LOG_DIR || process.env.CLAUDE_PLUGIN_DATA ? [logDir(process.env)] : await findLogDirs();
  const entries = (await Promise.all(dirs.map(readEntries))).flat().sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
  const summary = summarize(entries, { days: Number(values.days) });
  process.stdout.write((values.json ? JSON.stringify(summary, null, 2) : render(summary)) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
