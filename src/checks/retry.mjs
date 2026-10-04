import { readTranscript } from '../transcript.mjs';
import { refusedCommands, normalizeCommand, transcriptFor } from '../refusals.mjs';
import { SHELL_TOOLS } from './risky.mjs';

export const TAIL_BYTES = 2 * 1024 * 1024;

// The same shell command, refused earlier in this turn, is being run again.
// Rewording a refused command is not caught: sometimes that is the right fix.
export async function checkRetry({ input }) {
  if (!SHELL_TOOLS.has(input.tool_name)) return null;
  const command = normalizeCommand(input.tool_input?.command);
  if (!command) return null;
  const { path, sidechain } = transcriptFor(input);
  if (!path) return null;
  const records = await readTranscript(path, { tailBytes: TAIL_BYTES });
  const by = refusedCommands(records, { sidechain }).get(command);
  if (!by) return null;
  return {
    trace: { check: 'retry', outcome: 'flagged', tool: input.tool_name, ...(sidechain ? { agent: String(input.agent_type ?? 'subagent').slice(0, 40) } : {}) },
    finding: {
      check: 'retry',
      id: 'retry-after-refusal',
      message: `Wince: this exact command was already refused ${by} in this task. Don't retry it or work around it. Tell the user what you need and why, and let them decide.`,
    },
  };
}
