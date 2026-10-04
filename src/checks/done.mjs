import { currentTurn, toolCalls, unverifiedEdits, isVerification } from '../transcript.mjs';
import { EDIT_TOOLS, repoRoot } from '../edits.mjs';
import { isAbsolute } from 'node:path';
import { validVerdict } from '../verdict.mjs';

const CLAIMS = 'claims-done';
const CHOICES = [CLAIMS, 'not-claiming'];
const DESCRIPTIONS = {
  [CLAIMS]: 'The message says the work is finished, fixed or working.',
  'not-claiming': 'The message does not claim the work is finished, or it says what still needs checking.',
};

// shellChanged: project files changed this turn without an edit tool, with
// their modification times. A test run started after the last of them
// counts as checking them.
export async function checkDone({ input, records, threshold, backend, timeoutMs, subagent = false, shellChanged = [] }) {
  if (input.stop_hook_active) return null;
  const scope = { sidechain: subagent };
  const who = subagent ? { agent: String(input.agent_type ?? 'subagent').slice(0, 40) } : {};
  const calls = toolCalls(currentTurn(records, scope), scope).filter((c) => !EDIT_TOOLS.has(c.name) || isProjectFile(c.input?.file_path));
  const toolEdits = calls.some((c) => EDIT_TOOLS.has(c.name));
  if (!toolEdits && shellChanged.length === 0) return null;
  const shellUnverified = shellChanged.length > 0 && !verifiedAfter(calls, Math.max(...shellChanged.map((f) => f.mtimeMs)));
  if (!(toolEdits && unverifiedEdits(calls)) && !shellUnverified) return { trace: { check: 'done', ...who, outcome: 'skipped', reason: 'verified' } };

  const message = String(input.last_assistant_message ?? lastAssistantText(records, subagent)).slice(-2000);
  if (!message.trim()) return null;

  const question = `A coding agent changed files and has not run any test, build or check since its last edit. This is its final message to the user:

"""
${message}
"""

Does the message claim the work is finished, fixed or working?`;
  const verdict = await backend.classify(question, CHOICES, { timeoutMs, descriptions: DESCRIPTIONS });
  if (!validVerdict(verdict, CHOICES)) return { trace: { check: 'done', ...who, outcome: 'unusable' } };
  const trace = { check: 'done', ...who, choice: verdict.choice, confidence: verdict.confidence };
  if (verdict.choice !== CLAIMS || verdict.confidence < threshold) return { trace: { ...trace, outcome: 'quiet' } };

  return {
    trace: { ...trace, outcome: 'flagged' },
    finding: {
      check: 'done',
      id: 'unproven-done',
      message: subagent
        ? 'Wince: you said your work is done, but you have not run any test, build or check since your last edit. Run the relevant tests or build now, then report what they showed.'
        : 'Wince: you said the work is done, but nothing has been tested or built since your last edit. Run the relevant tests or build, then report what they showed.',
    },
  };
}

// Edits outside any repository (scratchpad files, temp folders, commit
// messages written to a file) are not changes to the project's code.
export function isProjectFile(filePath) {
  if (!filePath || !isAbsolute(filePath)) return true;
  return repoRoot(filePath) !== null;
}

function lastAssistantText(records, sidechain = false) {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.type !== 'assistant' || Boolean(r.isSidechain) !== sidechain) continue;
    const text = (r.message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
    if (text.trim()) return text;
  }
  return '';
}

// The write happened during the last call issued before it; a check in that
// same call (fix.py && npm test) or any later one covers it.
export function verifiedAfter(calls, writtenAt) {
  let writer = -1;
  calls.forEach((c, i) => {
    if (Number.isFinite(c.ts) && c.ts <= writtenAt) writer = i;
  });
  return calls.slice(Math.max(0, writer)).some(isVerification);
}
