import { join, dirname, basename } from 'node:path';
import { currentTurn } from './transcript.mjs';
import { SHELL_TOOLS } from './checks/risky.mjs';

// Only a refusal by the user counts. Retrying after an auto mode block or a
// permission rule is usually legitimate: auto mode often allows the same
// command later, and a rule may have been satisfied in between.
const REFUSED_BY = {
  'user-rejected': 'by the user',
};

export function normalizeCommand(command) {
  return String(command ?? '').replace(/\s+/g, ' ').trim();
}

// Commands refused earlier in the current turn, keyed by their normalized
// text. A subagent's records are all sidechain records in its own file.
export function refusedCommands(records, { sidechain = false } = {}) {
  const turn = currentTurn(records, { sidechain });
  const commands = new Map();
  for (const r of turn) {
    if (r.type !== 'assistant' || Boolean(r.isSidechain) !== sidechain) continue;
    for (const b of r.message?.content ?? []) {
      if (b?.type === 'tool_use' && SHELL_TOOLS.has(b.name)) commands.set(b.id, normalizeCommand(b.input?.command));
    }
  }
  const refused = new Map();
  for (const r of turn) {
    const by = REFUSED_BY[r.toolDenialKind];
    if (r.type !== 'user' || !by) continue;
    for (const b of r.message?.content ?? []) {
      const command = b?.type === 'tool_result' ? commands.get(b.tool_use_id) : null;
      if (command) refused.set(command, by);
    }
  }
  return refused;
}

// Claude Code passes a subagent's commands with the main transcript and an
// agent_id; the subagent's own transcript sits beside it.
export function transcriptFor(input) {
  if (!input.agent_id || !input.transcript_path) return { path: input.transcript_path, sidechain: false };
  const sessionDir = join(dirname(input.transcript_path), basename(input.transcript_path, '.jsonl'));
  return { path: join(sessionDir, 'subagents', `agent-${input.agent_id}.jsonl`), sidechain: true };
}
