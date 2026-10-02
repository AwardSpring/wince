import { readFile } from 'node:fs/promises';

export async function loadRules(path) {
  const parsed = JSON.parse(await readFile(path, 'utf8'));
  return parsed.rules;
}

export function rulesFor(filePath, rules) {
  const normalized = filePath.replaceAll('\\', '/').replace(/^\.\//, '');
  return rules.filter((r) => (r.applies ?? ['**/*']).some((g) => globToRegExp(g).test(normalized)));
}

// Gitignore-style: a pattern without a slash matches the file name at any
// depth; a pattern with a slash is anchored to the project root.
export function globToRegExp(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      const slash = glob[i + 2] === '/';
      out += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') {
      out += '[^/]*';
    } else if (c === '?') {
      out += '[^/]';
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  const anchored = glob.includes('/');
  return new RegExp(anchored ? `^${out}$` : `^(?:.*/)?${out}$`);
}
