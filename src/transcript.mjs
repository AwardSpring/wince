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

export function currentTurn(records) {
  let start = 0;
  records.forEach((r, i) => {
    if (isHumanPrompt(r)) start = i;
  });
  return records.slice(start);
}

export function toolCalls(records) {
  const calls = [];
  for (const r of records) {
    if (r.type !== 'assistant' || r.isSidechain) continue;
    for (const block of r.message?.content ?? []) {
      if (block?.type === 'tool_use') calls.push({ name: block.name, input: block.input ?? {} });
    }
  }
  return calls;
}

export function unverifiedEdits(calls) {
  const lastEdit = calls.findLastIndex((c) => EDIT_TOOLS.has(c.name));
  if (lastEdit === -1) return false;
  return !calls.slice(lastEdit + 1).some(isVerification);
}

export function isVerification(call) {
  return call.name === 'Bash' && VERIFY.test(String(call.input.command ?? ''));
}

function isHumanPrompt(r) {
  if (r.type !== 'user' || r.isSidechain || r.isMeta || r.isCompactSummary) return false;
  const content = r.message?.content;
  if (typeof content === 'string') return true;
  return Array.isArray(content) && content.length > 0 && content.every((b) => b?.type === 'text');
}
