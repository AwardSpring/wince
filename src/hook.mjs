#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { loadConfig, loadProjectRules } from './config.mjs';
import { selectBackend, timeoutFor, guarded } from './backends/index.mjs';
import { readTranscript } from './transcript.mjs';
import { checkRules } from './checks/rules.mjs';
import { checkDone } from './checks/done.mjs';
import { checkRisky } from './checks/risky.mjs';
import { appendEntry, logDir } from './log.mjs';

const HARD_DEADLINE_MS = 25_000;

// Every path out of this file exits 0. A Flinch failure must never block
// or slow the agent beyond the deadline, so errors are logged and dropped.
// Returns { output, trace }: output goes to Claude Code, trace to the log.
// A check that never reached a backend returns null and is not logged.
export async function run(event, input, env = process.env) {
  if (env.FLINCH_INNER) return null;
  const projectDir = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = await loadConfig(projectDir);

  if (event === 'pre-tool-use') {
    if (!config.checks.risky) return null;
    const result = checkRisky({ input, projectDir });
    if (!result) return null;
    return { output: preToolUseOutput(result.finding, config.mode), trace: { backend: 'patterns', mode: config.mode, ...result.trace, id: result.finding.id } };
  }

  const backend = await selectBackend(env);
  if (!backend) return null;
  const ctx = { input, projectDir, threshold: config.threshold, backend: guarded(backend), timeoutMs: timeoutFor(backend) };

  let result = null;
  let toOutput = null;
  if (event === 'post-tool-use' && config.checks.rules) {
    const rules = await loadProjectRules(projectDir, config);
    if (rules.length === 0) return null;
    result = await checkRules({ ...ctx, rules });
    toOutput = postToolUseOutput;
  } else if (event === 'stop' && config.checks.done) {
    const records = await readTranscript(input.transcript_path);
    result = await checkDone({ ...ctx, records });
    toOutput = stopOutput;
  }
  if (!result) return null;

  return {
    output: result.finding ? toOutput(result.finding, config.mode) : null,
    trace: { backend: backend.name, mode: config.mode, ...result.trace, id: result.finding?.id },
  };
}

// Nudge mode asks the user before the command runs; block mode refuses it
// and tells the agent why.
export function preToolUseOutput(finding, mode) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: mode === 'block' ? 'deny' : 'ask',
      permissionDecisionReason: finding.message,
    },
  };
}

export function postToolUseOutput(finding, mode) {
  if (mode === 'block') return { decision: 'block', reason: finding.message };
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: finding.message } };
}

export function stopOutput(finding, mode) {
  if (mode === 'block') return { decision: 'block', reason: finding.message };
  return { systemMessage: finding.message };
}

async function log(entry) {
  try {
    await appendEntry(logDir(process.env), entry);
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
    const result = await Promise.race([
      run(event, input),
      new Promise((resolve) => setTimeout(() => resolve({ timedOut: true }), HARD_DEADLINE_MS).unref()),
    ]);
    if (result?.timedOut) {
      await log({ event, outcome: 'timeout', ms: Date.now() - started });
    } else if (result) {
      await log({ event, ...result.trace, ms: Date.now() - started });
      if (result.output) process.stdout.write(JSON.stringify(result.output));
    }
  } catch (e) {
    await log({ event, outcome: 'error', error: String(e?.message ?? e).slice(0, 120), ms: Date.now() - started });
    if (process.env.FLINCH_DEBUG) process.stderr.write(`flinch: ${e?.stack ?? e}\n`);
  }
  // Let Node exit on its own. process.exit() while a fetch socket is still
  // closing aborts Node on Windows (libuv assertion in win/async.c).
  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
