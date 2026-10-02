import { currentTurn, toolCalls, unverifiedEdits } from '../transcript.mjs';
import { validVerdict } from '../verdict.mjs';

const CLAIMS = 'claims-done';
const CHOICES = [CLAIMS, 'not-claiming'];

export async function checkDone({ input, records, threshold, backend, timeoutMs }) {
  if (input.stop_hook_active) return null;
  if (!unverifiedEdits(toolCalls(currentTurn(records)))) return null;

  const message = String(input.last_assistant_message ?? lastAssistantText(records)).slice(-2000);
  if (!message.trim()) return null;

  const question = `A coding agent changed files and has not run any test, build or check since its last edit. This is its final message to the user:

"""
${message}
"""

Does the message claim the work is finished, fixed or working?`;
  const verdict = await backend.classify(question, CHOICES, { timeoutMs });
  if (!validVerdict(verdict, CHOICES)) return null;
  if (verdict.choice !== CLAIMS || verdict.confidence < threshold) return null;

  return {
    check: 'done',
    id: 'unproven-done',
    message: 'Flinch: you said the work is done, but nothing has been tested or built since your last edit. Run the relevant tests or build, then report what they showed.',
  };
}

function lastAssistantText(records) {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (r.type !== 'assistant' || r.isSidechain) continue;
    const text = (r.message?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('\n');
    if (text.trim()) return text;
  }
  return '';
}
