import { lstatSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { validateArguments, validatePolicy } from './schema.js';
import type { Args, PolicyConfig, ToolCall } from './types.js';

export function inside(root: string, path: string): boolean {
  const relativePath = relative(root, path);

  return (
    relativePath === '' ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== '..' && !isAbsolute(relativePath))
  );
}

export class Policy {
  private constructor(
    public readonly file: string,
    public readonly workspace: string,
    public readonly config: PolicyConfig,
  ) {}

  static load(file: string, workspace: string): Policy {
    const root = realpathSync(workspace);
    const policyFile = realpathSync(file);

    if (inside(root, policyFile)) {
      throw new Error('Policy must be outside workspace');
    }

    if (!statSync(root).isDirectory()) {
      throw new Error('Workspace must be a directory');
    }

    const policy = new Policy(
      policyFile,
      root,
      validatePolicy(JSON.parse(readFileSync(policyFile, 'utf8'))),
    );

    for (const configuredPath of [
      ...policy.config.directories.allow,
      ...policy.config.directories.deny,
      ...policy.config.readOnlyFiles,
    ]) {
      policy.canonical(configuredPath);
    }

    return policy;
  }

  canonical(path: string): string {
    if (
      !path ||
      isAbsolute(path) ||
      path.includes('\0') ||
      path.includes('\\') ||
      path.split('/').includes('..')
    ) {
      throw new Error('Absolute paths, traversal and backslashes are forbidden');
    }

    const resolved = resolve(this.workspace, path);

    if (!inside(this.workspace, resolved)) {
      throw new Error('Path escapes workspace');
    }

    const parts = relative(this.workspace, resolved).split(sep).filter(Boolean);
    let current = this.workspace;

    for (const part of parts) {
      current = resolve(current, part);
      try {
        const stats = lstatSync(current);

        if (stats.isSymbolicLink()) {
          throw new Error('Symlinks are forbidden');
        }

        if (stats.isFile() && stats.nlink > 1) {
          throw new Error('Hardlinked files are forbidden');
        }

        if (!inside(this.workspace, realpathSync(current))) {
          throw new Error('Canonical path escapes workspace');
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw error;
        }
      }
    }

    return resolved;
  }

  path(path: string, writing = false): string {
    const resolved = this.canonical(path);
    const deniedDirectories = this.config.directories.deny.map((configuredPath) =>
      this.canonical(configuredPath),
    );
    const allowedDirectories = this.config.directories.allow.map((configuredPath) =>
      this.canonical(configuredPath),
    );

    if (
      deniedDirectories.some((configuredPath) => inside(configuredPath, resolved)) ||
      !allowedDirectories.some((configuredPath) => inside(configuredPath, resolved))
    ) {
      throw new Error(`Directory denied by policy: ${path}`);
    }

    if (
      writing &&
      this.config.readOnlyFiles.some(
        (configuredPath) => this.canonical(configuredPath) === resolved,
      )
    ) {
      throw new Error(`File is read-only by policy: ${path}`);
    }

    return resolved;
  }

  command(command: string, cwd: string): string {
    const directory = this.path(cwd);

    if (!statSync(directory).isDirectory()) {
      throw new Error('Bash cwd is not a directory');
    }

    if (this.config.commands.deny.includes(command)) {
      throw new Error('Command explicitly denied');
    }

    if (!this.config.commands.allow.includes(command)) {
      throw new Error('Command is not explicitly allowed');
    }
    // Intentionally narrow grammar: exact bare words, no shell operators, quoting,
    // expansion, assignments, paths in arguments, or nested interpreters.
    if (!/^[A-Za-z0-9_-]+(?: [A-Za-z0-9_.-]+)*$/.test(command)) {
      throw new Error('Complex Bash syntax is forbidden');
    }

    const tokens = command.split(' ');

    if (['bash', 'sh', 'zsh', 'env', 'sudo', 'eval', 'exec'].includes(tokens[0]!)) {
      throw new Error('Nested shell or privileged execution is forbidden');
    }

    if (
      tokens.some(
        (token) => token === '..' || token === '.' || token.includes('/') || token.includes('\\'),
      ) ||
      tokens.includes('-c')
    ) {
      throw new Error('Paths and inline code in Bash arguments are forbidden');
    }

    return directory;
  }

  validate(call: ToolCall): Args {
    const args = validateArguments(call.function.name, call.function.arguments);

    if (call.function.name === 'Bash') {
      this.command(args.command as string, args.cwd as string);
    } else if (
      ['read_file', 'list_files', 'write_file', 'delete_file'].includes(call.function.name)
    ) {
      this.path(args.path as string, ['write_file', 'delete_file'].includes(call.function.name));
      if (
        call.function.name === 'write_file' &&
        Buffer.byteLength(args.content as string) > this.config.maxFileBytes
      ) {
        throw new Error('File exceeds policy maxFileBytes');
      }
    }

    return args;
  }
}
