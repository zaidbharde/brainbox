export function normalizePath(path: string): string {
  if (!path || path.includes('\0')) throw new Error('path must be a non-empty string');
  const segments: string[] = [];
  for (const segment of path.replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return `/${segments.join('/')}` || '/';
}

export function joinPath(...parts: string[]): string {
  return normalizePath(parts.join('/'));
}
