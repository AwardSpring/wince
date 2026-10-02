import { findRisk } from '../risky.mjs';

export const SHELL_TOOLS = new Set(['Bash', 'PowerShell']);

// Only flagged commands are logged: this runs before every shell command,
// and a line per quiet command would mostly record that nothing happened.
export function checkRisky({ input, projectDir }) {
  if (!SHELL_TOOLS.has(input.tool_name)) return null;
  const risk = findRisk(input.tool_input?.command, { projectDir });
  if (!risk) return null;
  return {
    trace: { check: 'risky', outcome: 'flagged', tool: input.tool_name },
    finding: {
      check: 'risky',
      id: risk.id,
      message: `Flinch: this command ${risk.label}: ${risk.command.slice(0, 200)}`,
    },
  };
}
