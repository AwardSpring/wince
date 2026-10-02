#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { readEntries, findLogDirs, logDir } from './log.mjs';
import { percentile } from './score.mjs';

const isCheck = (e) => e && e.check !== 'session';

export function summarize(entries, { days = 7, now = Date.now() } = {}) {
  const since = now - days * 86_400_000;
  const inWindow = entries.filter((e) => e && Date.parse(e.ts) >= since);
  const recent = inWindow.filter(isCheck);
  const count = (pred) => recent.filter(pred).length;
  const byBackend = {};
  for (const e of recent) {
    if (e.backend && Number.isFinite(e.ms)) (byBackend[e.backend] ??= []).push(e.ms);
  }
  const flaggedRules = {};
  for (const e of recent) if (e.outcome === 'flagged' && e.check === 'rules') flaggedRules[e.id] = (flaggedRules[e.id] ?? 0) + 1;
  return {
    days,
    total: recent.length,
    sessions: new Set(inWindow.filter((e) => e.check === 'session').map((e) => e.session)).size,
    lastTs: recent.at(-1)?.ts ?? null,
    byCheck: { rules: count((e) => e.check === 'rules'), done: count((e) => e.check === 'done'), risky: count((e) => e.check === 'risky') },
    outcomes: {
      flagged: count((e) => e.outcome === 'flagged'),
      quiet: count((e) => e.outcome === 'quiet'),
      skipped: count((e) => e.outcome === 'skipped'),
      unusable: count((e) => e.outcome === 'unusable'),
      error: count((e) => e.outcome === 'error'),
      timeout: count((e) => e.outcome === 'timeout'),
    },
    skipped: {
      noMatchingRules: count((e) => e.reason === 'no-matching-rules'),
      alreadyTested: count((e) => e.reason === 'verified'),
    },
    backends: Object.fromEntries(
      Object.entries(byBackend).map(([name, ms]) => [name, { checks: ms.length, p50: percentile([...ms].sort((a, b) => a - b), 0.5) }]),
    ),
    topRules: Object.entries(flaggedRules).sort((a, b) => b[1] - a[1]).slice(0, 10),
    recentFlags: recent.filter((e) => e.outcome === 'flagged').slice(-10),
  };
}

export function localTime(ts, now = Date.now()) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).replace(/\s/g, '').toLowerCase();
  const sameDay = new Date(now).toDateString() === d.toDateString();
  return sameDay ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${time}`;
}

export function render(s, now = Date.now()) {
  const lines = [`Flinch, last ${s.days} day${s.days === 1 ? '' : 's'}`, ''];
  if (s.total === 0) return [...lines, s.sessions ? `Loaded in ${s.sessions} session${s.sessions === 1 ? '' : 's'}, no checks yet.` : 'No checks logged yet.'].join('\n');
  const o = s.outcomes;
  const judged = s.total - o.skipped;
  lines.push(`Last check   ${localTime(s.lastTs, now)}`);
  lines.push(`Checks       ${s.total}  (rules ${s.byCheck.rules}, done ${s.byCheck.done}, risky ${s.byCheck.risky})`);
  lines.push(`Flagged      ${o.flagged}${judged ? `  (${Math.round((100 * o.flagged) / judged)}% of checks that ran)` : ''}`);
  lines.push(`Quiet        ${o.quiet}`);
  if (o.skipped) lines.push(`Stood down   ${o.skipped}  (no rule covers the file ${s.skipped.noMatchingRules}, tests already ran ${s.skipped.alreadyTested})`);
  if (o.unusable + o.error + o.timeout > 0) lines.push(`No answer    ${o.unusable + o.error + o.timeout}  (unusable ${o.unusable}, errors ${o.error}, timeouts ${o.timeout})`);
  if (Object.keys(s.backends).length) {
    lines.push('', 'Backends');
    for (const [name, b] of Object.entries(s.backends)) lines.push(`  ${name.padEnd(12)} ${String(b.checks).padStart(5)} checks   median ${b.p50}ms`);
  }
  if (s.topRules.length) {
    lines.push('', 'Rules flagged most');
    for (const [id, n] of s.topRules) lines.push(`  ${String(n).padStart(4)}  ${id}`);
  }
  if (s.recentFlags.length) {
    lines.push('', 'Recent flags');
    for (const e of s.recentFlags) {
      const conf = e.confidence == null ? '' : ` ${Math.round(e.confidence * 100)}%`;
      lines.push(`  ${localTime(e.ts, now).padEnd(14)} ${String(e.check ?? e.event ?? '').padEnd(6)} ${String(e.id ?? '').padEnd(24)} ${e.kind ?? ''}${conf}  ${e.backend ?? ''}`);
    }
  }
  return lines.join('\n');
}

// One short segment for Claude Code's status line, for the session whose
// id Claude Code passes in. Empty when Flinch isn't loaded in that session,
// so the status line of a session without Flinch is unchanged.
export function statusline(entries, sessionId, now = Date.now()) {
  const short = typeof sessionId === 'string' ? sessionId.slice(0, 8) : '';
  if (!short) return '';
  const mine = entries.filter((e) => e && e.session === short);
  if (!mine.length) return '';
  const checks = mine.filter(isCheck);
  if (!checks.length) return 'flinch on';
  const flags = checks.filter((e) => e.outcome === 'flagged').length;
  const parts = [`flinch ${checks.length} check${checks.length === 1 ? '' : 's'}`];
  if (flags) parts.push(`${flags} flag${flags === 1 ? '' : 's'}`);
  parts.push(`last ${localTime(checks.at(-1).ts, now)}`);
  return parts.join(' · ');
}

async function readStdinJson() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

async function allEntries() {
  const dirs = process.env.FLINCH_LOG_DIR || process.env.CLAUDE_PLUGIN_DATA ? [logDir(process.env)] : await findLogDirs();
  return (await Promise.all(dirs.map(readEntries))).flat().sort((a, b) => String(a.ts).localeCompare(String(b.ts)));
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { days: { type: 'string', default: '7' }, json: { type: 'boolean', default: false } },
  });
  const [command] = positionals;
  if (command === 'statusline') {
    const input = await readStdinJson();
    try {
      process.stdout.write(statusline(await allEntries(), input.session_id));
    } catch {}
    return;
  }
  if (command !== 'log') {
    process.stdout.write('Usage: flinch log [--days N] [--json]\n       flinch statusline   (reads Claude Code status line JSON on stdin)\n');
    process.exitCode = command ? 1 : 0;
    return;
  }
  const summary = summarize(await allEntries(), { days: Number(values.days) });
  process.stdout.write((values.json ? JSON.stringify(summary, null, 2) : render(summary)) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
