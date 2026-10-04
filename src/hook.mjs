#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { loadConfig, loadProjectRules } from './config.mjs';
import { selectBackend, timeoutFor, guarded } from './backends/index.mjs';
import { readTranscript } from './transcript.mjs';
import { checkRules } from './checks/rules.mjs';
import { checkDone } from './checks/done.mjs';
import { checkRisky } from './checks/risky.mjs';
import { checkSweep, shellChangedFiles } from './checks/sweep.mjs';
import { appendEntry, logDir } from './log.mjs';

const HARD_DEADLINE_MS = 25_000;

// Every path out of this file exits 0. A Wince failure must never block
// or slow the agent beyond the deadline, so errors are logged and dropped.
// Returns { output, trace }: output goes to Claude Code, trace to the log.
// Null means the check didn't apply here at all (no rules file, no edits
// this turn, a safe command) and nothing is logged.
export async function run(event, input, env = process.env) {
  if (env.WINCE_INNER) return null;
  const projectDir = env.CLAUDE_PROJECT_DIR || input.cwd || process.cwd();
  const config = await loadConfig(projectDir);

  if (event === 'session-start') return { output: null, trace: { check: 'session', outcome: 'started' } };

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
  } else if (event === 'stop' || event === 'subagent-stop') {
    return endOfTurn({ event, input, projectDir, config, backend, ctx });
  }
  if (!result) return null;

  return {
    output: result.finding ? toOutput(result.finding, config.mode) : null,
    trace: { ...(result.trace.outcome === 'skipped' ? {} : { backend: backend.name }), mode: config.mode, ...result.trace, id: result.finding?.id },
  };
}

// When a turn ends: rules-check files changed outside the edit tools (by
// shell scripts, for example), then check for an unverified done claim.
async function endOfTurn({ event, input, projectDir, config, backend, ctx }) {
  if (input.stop_hook_active || (!config.checks.done && !config.checks.rules)) return null;
  const subagent = event === 'subagent-stop';
  const records = await readTranscript(subagent ? input.agent_transcript_path : input.transcript_path);
  const shellChanged = await shellChangedFiles({ input, projectDir, records, subagent });
  const rules = config.checks.rules && shellChanged.length ? await loadProjectRules(projectDir, config) : [];
  const sweep = rules.length ? await checkSweep({ ...ctx, files: shellChanged, rules, subagent }) : null;
  const done = config.checks.done ? await checkDone({ ...ctx, records, subagent, shellChanged }) : null;
  const results = [sweep, done].filter(Boolean);
  if (results.length === 0) return null;

  const findings = results.map((r) => r.finding).filter(Boolean);
  const merged = findings.length ? { message: findings.map((f) => f.message).join('\n\n'), notice: findings.map((f) => f.notice ?? f.message).join(' | ') } : null;
  const output = !merged ? null : subagent ? subagentStopOutput(merged, config.subagents) : stopOutput(merged, config.mode);
  const traces = results.map((r) => ({ ...(r.trace.outcome === 'skipped' ? {} : { backend: backend.name }), mode: config.mode, ...r.trace, id: r.finding?.id }));
  return { output, traces };
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

// The agent gets the full message; the user gets a one-line notice so a
// nudge is never invisible to them.
export function postToolUseOutput(finding, mode) {
  const notice = finding.notice ? { systemMessage: finding.notice } : {};
  if (mode === 'block') return { decision: 'block', reason: finding.message, ...notice };
  return { hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: finding.message }, ...notice };
}

// Claude Code drops a SubagentStop hook's systemMessage and
// additionalContext, so the only way to act on a subagent is to send it
// back. That happens in nudge mode too: it is agent to agent and never
// interrupts the user. "subagents": "log" turns it into a log line only.
export function subagentStopOutput(finding, subagents = 'send-back') {
  if (subagents === 'log') return null;
  return { decision: 'block', reason: finding.message };
}

export function stopOutput(finding, mode) {
  if (mode === 'block') return { decision: 'block', reason: finding.message };
  return { systemMessage: finding.message };
}

export function shortSession(id) {
  return typeof id === 'string' && id ? id.slice(0, 8) : undefined;
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
      for (const trace of result.traces ?? [result.trace]) await log({ event, session: shortSession(input.session_id), ...trace, ms: Date.now() - started });
      if (result.output) process.stdout.write(JSON.stringify(result.output));
    }
  } catch (e) {
    await log({ event, outcome: 'error', error: String(e?.message ?? e).slice(0, 120), ms: Date.now() - started });
    if (process.env.WINCE_DEBUG) process.stderr.write(`wince: ${e?.stack ?? e}\n`);
  }
  // Let Node exit on its own. process.exit() while a fetch socket is still
  // closing aborts Node on Windows (libuv assertion in win/async.c).
  process.exitCode = 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
