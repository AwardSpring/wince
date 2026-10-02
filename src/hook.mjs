#!/usr/bin/env node
import { appendFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { loadConfig, loadProjectRules } from './config.mjs';
import { selectBackend, timeoutFor, guarded } from './backends/index.mjs';
import { readTranscript } from './transcript.mjs';
import { checkRules } from './checks/rules.mjs';
import { checkDone } from './checks/done.mjs';

const HARD_DEADLINE_MS = 25_000;

// Every path out of this file exits 0. A Flinch failure must never block
// or slow the agent beyond the deadline, so errors are logged and dropped.
export async function run(event, input, env = process.env) {
  if (env.FLINCH_INNER) return null;
  const projectDir = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = await loadConfig(projectDir);
  const backend = await selectBackend(env);
  if (!backend) return null;
  const ctx = { input, threshold: config.threshold, backend: guarded(backend), timeoutMs: timeoutFor(backend) };

  if (event === 'post-tool-use' && config.checks.rules) {
    const rules = await loadProjectRules(projectDir, config);
    if (rules.length === 0) return null;
    const finding = await checkRules({ ...ctx, rules });
    return finding && postToolUseOutput(finding, config.mode);
  }

  if (event === 'stop' && config.checks.done) {
    const records = await readTranscript(input.transcript_path);
    const finding = await checkDone({ ...ctx, records });
    return finding && stopOutput(finding, config.mode);
  }

  return null;
}

export function postToolUseOutput(finding, mode) {
  if (mode === 'block') return { decision: 'block', reason: finding.message };
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: finding.message } };
}

export function stopOutput(finding, mode) {
  if (mode === 'block') return { decision: 'block', reason: finding.message };
  return { systemMessage: finding.message };
}

async function log(env, entry) {
  try {
    const dir = env.CLAUDE_PLUGIN_DATA || join(tmpdir(), 'flinch');
    await mkdir(dir, { recursive: true });
    await appendFile(join(dir, 'log.jsonl'), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n');
  } catch {}
}

async function readStdin() {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  return JSON.parse(data);
}

async function main() {
  const event = process.argv[2];
  const started = Date.now();
  try {
    const input = await readStdin();
    const output = await Promise.race([
      run(event, input),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), HARD_DEADLINE_MS).unref()),
    ]);
    if (output?.timedOut) {
      await log(process.env, { event, outcome: 'timeout', ms: Date.now() - started });
    } else if (output) {
      await log(process.env, { event, outcome: 'flagged', output, ms: Date.now() - started });
      process.stdout.write(JSON.stringify(output));
    }
  } catch (e) {
    await log(process.env, { event, outcome: 'error', error: String(e?.message ?? e), ms: Date.now() - started });
    if (process.env.FLINCH_DEBUG) process.stderr.write(`flinch: ${e?.stack ?? e}\n`);
  }
  process.exit(0);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replaceAll('\\', '/').split('/').pop())) {
  main();
}
