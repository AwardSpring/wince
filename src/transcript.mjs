import { readFile } from 'node:fs/promises';
import { EDIT_TOOLS } from './edits.mjs';

const VERIFY = /\b(test|tests|spec|vitest|jest|pytest|mocha|rspec|phpunit|go test|cargo (test|build|check)|dotnet (test|build)|mvn|gradle|tsc|build|lint|typecheck|check|make)\b/i;

export async function readTranscript(path) {
  try {
    return (await readFile(path, 'utf8'))
      .split('\n')
      .filter((l) => l.trim())
      .flatMap((l) => {
        try {
          return [JSON.parse(l)];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

// A subagent's own transcript marks every record as a sidechain, so its
// checks read sidechain records and the main agent's checks skip them.
export function currentTurn(records, { sidechain = false } = {}) {
  let start = 0;
  records.forEach((r, i) => {
    if (isHumanPrompt(r, sidechain)) start = i;
  });
  return records.slice(start);
}

export function toolCalls(records, { sidechain = false } = {}) {
  const calls = [];
  for (const r of records) {
    if (r.type !== 'assistant' || Boolean(r.isSidechain) !== sidechain) continue;
    for (const block of r.message?.content ?? []) {
      if (block?.type === 'tool_use') calls.push({ name: block.name, input: block.input ?? {}, ts: Date.parse(r.timestamp) });
    }
  }
  return calls;
}

export function unverifiedEdits(calls) {
  const lastEdit = calls.findLastIndex((c) => EDIT_TOOLS.has(c.name));
  if (lastEdit === -1) return false;
  return !calls.slice(lastEdit + 1).some(isVerification);
}

const SHELLS = new Set(['Bash', 'PowerShell']);

export function isVerification(call) {
  return SHELLS.has(call.name) && VERIFY.test(String(call.input.command ?? ''));
}

function isHumanPrompt(r, sidechain = false) {
  if (r.type !== 'user' || Boolean(r.isSidechain) !== sidechain || r.isMeta || r.isCompactSummary) return false;
  const content = r.message?.content;
  if (typeof content === 'string') return true;
  return Array.isArray(content) && content.length > 0 && content.every((b) => b?.type === 'text');
}
