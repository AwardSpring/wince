import { readFile, open } from 'node:fs/promises';
import { EDIT_TOOLS } from './edits.mjs';

const VERIFY = /\b(test|tests|spec|vitest|jest|pytest|mocha|rspec|phpunit|go test|cargo (test|build|check)|dotnet (test|build)|mvn|gradle|tsc|build|lint|typecheck|check|make)\b/i;

// tailBytes reads only the end of the file, for checks that run on every
// command and only need the current turn. The first, partial line is dropped.
export async function readTranscript(path, { tailBytes } = {}) {
  try {
    const text = tailBytes ? await readTail(path, tailBytes) : await readFile(path, 'utf8');
    return text
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

async function readTail(path, bytes) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    await handle.read(buffer, 0, buffer.length, start);
    const text = buffer.toString('utf8');
    return start === 0 ? text : text.slice(text.indexOf('\n') + 1);
  } finally {
    await handle.close();
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
