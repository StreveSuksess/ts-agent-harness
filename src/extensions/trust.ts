import { lstatSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

/** Resolve future files against their nearest existing ancestor, including a symlinked parent. */
function canonical(path: string): string {
  if (lstatSync(path, { throwIfNoEntry: false })) return realpathSync(path);
  const parent = dirname(path);
  return join(canonical(parent), relative(parent, path));
}

function contains(parent: string, child: string): boolean {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path));
}

export function separateWorkspace(workspace: string, trustedPaths: string[]): void {
  const roots = [resolve(workspace), canonical(resolve(workspace))];
  for (const path of trustedPaths) {
    const trusted = [resolve(path), canonical(resolve(path))];
    if (roots.some((w) => trusted.some((p) => contains(w, p) || contains(p, w)))) {
      throw new Error(
        'Extension configuration, packages and state must be outside the editable workspace',
      );
    }
  }
}
