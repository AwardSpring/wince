import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { loadRules, rulesFor } from '../src/rules.mjs';
import { ruleCheck, NONE } from '../src/prompt.mjs';
import { decide, score, percentile } from '../src/score.mjs';

const { values: opts } = parseArgs({
  options: {
    backend: { type: 'string', default: 'claude-cli' },
    model: { type: 'string' },
    rules: { type: 'string', default: 'private/rules/awardspring.json' },
    cases: { type: 'string', default: 'private/testset/cases.jsonl' },
    adjudication: { type: 'string', default: 'private/testset/adjudication.json' },
    threshold: { type: 'string', default: '0.8' },
    concurrency: { type: 'string', default: '4' },
    limit: { type: 'string' },
  },
});

if (!process.env.TYPESAFE_API_KEY) {
  const key = (await readFile('private/jev.key', 'utf8').catch(() => '')).trim();
  if (key) process.env.TYPESAFE_API_KEY = key;
}
const backend = await import(`../src/backends/${opts.backend}.mjs`);
const rules = await loadRules(opts.rules);
const adjudication = JSON.parse(await readFile(opts.adjudication, 'utf8').catch(() => '{}'));
const threshold = Number(opts.threshold);

let cases = (await readFile(opts.cases, 'utf8'))
  .split('\n')
  .filter((l) => l.trim())
  .map((l) => JSON.parse(l))
  .filter((c) => !(adjudication.drop ?? []).includes(c.id));
if (opts.limit) cases = cases.slice(0, Number(opts.limit));

const results = [];
let next = 0;
async function worker() {
  while (next < cases.length) {
    const c = cases[next++];
    results.push(await runCase(c));
    process.stderr.write('.');
  }
}

async function runCase(c) {
  const applicable = rulesFor(c.file_path, rules);
  const accepted = adjudication.accept?.[c.id] ?? [c.expected];
  if (applicable.length === 0) {
    return { id: c.id, expected: c.expected, accepted, said: NONE, raw: null, confidence: null, ms: 0, skipped: 'no applicable rules' };
  }
  const { question, choices, descriptions } = ruleCheck({ rules: applicable, filePath: c.file_path, diff: c.diff });
  const started = performance.now();
  try {
    const verdict = await backend.classify(question, choices, { model: opts.model, descriptions });
    const ms = Math.round(performance.now() - started);
    const said = decide(verdict, threshold);
    return { id: c.id, expected: c.expected, accepted, said, raw: verdict.choice, confidence: verdict.confidence, ms, apiMs: verdict.apiMs };
  } catch (e) {
    return { id: c.id, expected: c.expected, accepted, said: NONE, raw: null, confidence: null, ms: Math.round(performance.now() - started), error: e.message };
  }
}

await Promise.all(Array.from({ length: Number(opts.concurrency) }, worker));
process.stderr.write('\n');
results.sort((a, b) => a.id.localeCompare(b.id));

const { caught, wrongRule, missed, falseAlarms, violations, clean } = score(results);
const errors = results.filter((r) => r.error);
const times = results.filter((r) => !r.skipped && !r.error).map((r) => r.ms).sort((a, b) => a - b);
const pct = (p) => percentile(times, p);

const summary = {
  backend: opts.backend,
  model: opts.model ?? 'default',
  threshold,
  cases: results.length,
  violations: { total: violations.length, caught: caught.length, wrongRule: wrongRule.length, missed: missed.length },
  clean: { total: clean.length, falseAlarms: falseAlarms.length },
  errors: errors.length,
  latencyMs: { p50: pct(0.5), p95: pct(0.95), max: times.at(-1) ?? 0 },
};

await mkdir('private/results', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = `private/results/${opts.backend}-${stamp}.json`;
await writeFile(out, JSON.stringify({ summary, results }, null, 2));

console.log(JSON.stringify(summary, null, 2));
const show = (label, rows) => rows.length && console.log(`\n${label}:\n` + rows.map((r) => `  ${r.id} expected=${r.expected} said=${r.said} raw=${r.raw} conf=${r.confidence}${r.error ? ' error=' + r.error : ''}`).join('\n'));
show('Wrong rule', wrongRule);
show('Missed', missed);
show('False alarms', falseAlarms);
show('Errors', errors);
console.log(`\nFull results: ${out}`);
