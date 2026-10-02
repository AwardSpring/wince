// Each call is { name, input, failed }. The list is the current turn in order.
const SHELL = new Set(['Bash', 'PowerShell']);
const EDIT = new Set(['Edit', 'Write', 'MultiEdit']);
const LOOKS = new Set(['Read', 'Grep', 'Glob', 'LS', 'TodoWrite', 'NotebookRead']);

export const REPEATS = 3;

export function findStuck(calls) {
  return repeatedFailure(calls) ?? failingEdits(calls) ?? editLoop(calls);
}

// The same shell command failed REPEATS times with no edit between tries.
// Read-only tools in between don't count as changing anything.
function repeatedFailure(calls) {
  const last = calls.at(-1);
  if (!last || !SHELL.has(last.name) || !last.failed) return null;
  const key = normalize(last.input?.command);
  if (!key) return null;
  let failures = 0;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (LOOKS.has(c.name)) continue;
    if (EDIT.has(c.name)) break;
    if (!SHELL.has(c.name)) break;
    if (normalize(c.input?.command) !== key) continue;
    if (!c.failed) break;
    failures++;
  }
  if (failures < REPEATS) return null;
  return {
    id: 'repeated-failure',
    key: `cmd:${key}`,
    message: `Flinch: this command has failed ${failures} times in a row with nothing changed between tries. Stop retrying it: read the error, then change the code or the approach.`,
  };
}

// REPEATS edits in a row to the same file failed.
function failingEdits(calls) {
  const last = calls.at(-1);
  if (!last || !EDIT.has(last.name) || !last.failed) return null;
  const file = last.input?.file_path;
  let failures = 0;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i];
    if (LOOKS.has(c.name)) continue;
    if (!EDIT.has(c.name) || c.input?.file_path !== file || !c.failed) break;
    failures++;
  }
  if (failures < REPEATS) return null;
  return {
    id: 'failing-edits',
    key: `edit:${file}`,
    message: `Flinch: ${failures} edits in a row to this file have failed. Read the file again to see its current contents before the next edit.`,
  };
}

// The same change to the same file succeeded twice this turn: the file
// went from A to B, back to A, and to B again.
function editLoop(calls) {
  const last = calls.at(-1);
  if (!last || last.name !== 'Edit' || last.failed) return null;
  const sig = editSignature(last);
  if (!sig) return null;
  const earlier = calls.slice(0, -1).some((c) => c.name === 'Edit' && !c.failed && editSignature(c) === sig);
  if (!earlier) return null;
  return {
    id: 'edit-loop',
    key: `loop:${sig}`,
    message: 'Flinch: you just made the same change to this file a second time, so the file has gone back and forth. Step back and decide which version is right before editing again.',
  };
}

function editSignature(call) {
  const { file_path, old_string, new_string } = call.input ?? {};
  if (!file_path || old_string == null || new_string == null || old_string === new_string) return null;
  return `${file_path}\u0000${old_string}\u0000${new_string}`;
}

function normalize(command) {
  return String(command ?? '').replace(/\s+/g, ' ').trim();
}
