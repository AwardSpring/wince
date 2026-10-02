import { relative, isAbsolute } from 'node:path';

export const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export function editToDiff(toolName, toolInput) {
  if (toolName === 'Edit') return hunk(toolInput.old_string, toolInput.new_string);
  if (toolName === 'MultiEdit') return (toolInput.edits ?? []).map((e) => hunk(e.old_string, e.new_string)).join('\n');
  if (toolName === 'Write') return hunk('', toolInput.content);
  return '';
}

export function projectPath(filePath, projectDir) {
  if (!filePath) return '';
  const rel = projectDir && isAbsolute(filePath) ? relative(projectDir, filePath) : filePath;
  return rel.replaceAll('\\', '/');
}

export function capDiff(diff, maxChangedLines = 80) {
  const lines = diff.split('\n');
  let changed = 0;
  const kept = [];
  for (const line of lines) {
    if (line.startsWith('+') || line.startsWith('-')) changed++;
    if (changed > maxChangedLines) break;
    kept.push(line);
  }
  return kept.join('\n');
}

function hunk(oldText = '', newText = '') {
  const removed = oldText ? oldText.split('\n').map((l) => `-${l}`) : [];
  const added = newText ? newText.split('\n').map((l) => `+${l}`) : [];
  return ['@@', ...removed, ...added].join('\n');
}
