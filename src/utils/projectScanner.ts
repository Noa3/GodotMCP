import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export interface ProjectFileEntry {
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

export interface WalkProjectOptions {
  root: string;
  ignorePatterns?: string[];
  maxEntries?: number;
  maxDepth?: number;
  includeDirectories?: boolean;
}

export interface WalkProjectResult {
  entries: ProjectFileEntry[];
  truncated: boolean;
}

interface MatcherRule {
  regex: RegExp;
  negated: boolean;
  directoryOnly: boolean;
}

function normalizeRelative(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\//, '');
}

function escapeRegex(input: string): string {
  return input.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

function compilePattern(pattern: string): MatcherRule | null {
  const trimmed = pattern.trim();
  if (!trimmed || trimmed.startsWith('#')) {
    return null;
  }

  const negated = trimmed.startsWith('!');
  const body = normalizeRelative(negated ? trimmed.slice(1) : trimmed);
  const directoryOnly = body.endsWith('/');
  const withoutSlash = directoryOnly ? body.slice(0, -1) : body;
  const anchored = trimmed.startsWith('/') || (!withoutSlash.includes('/') && !withoutSlash.includes('*'));
  const escaped = escapeRegex(withoutSlash)
    .replace(/\\\*\\\*/g, '.*')
    .replace(/\\\*/g, '[^/]*')
    .replace(/\\\?/g, '[^/]');
  const prefix = anchored ? '^' : '(^|.*/)';
  const suffix = directoryOnly ? '(/.*)?$' : '$';
  return {
    regex: new RegExp(`${prefix}${escaped}${suffix}`),
    negated,
    directoryOnly,
  };
}

export function createIgnoreMatcher(patterns: string[]): (relativePath: string, isDirectory: boolean) => boolean {
  const rules = patterns.map(compilePattern).filter((rule): rule is MatcherRule => rule !== null);

  return (relativePath: string, isDirectory: boolean): boolean => {
    const normalized = normalizeRelative(relativePath);
    let ignored = false;
    for (const rule of rules) {
      if (rule.directoryOnly && !isDirectory && !normalized.startsWith(`${normalized}/`)) {
        // no-op, handled by regex for descendants
      }
      if (rule.regex.test(normalized)) {
        ignored = !rule.negated;
      }
    }
    return ignored;
  };
}

export async function loadGitignorePatterns(projectRoot: string): Promise<string[]> {
  try {
    const gitignore = await readFile(path.join(projectRoot, '.gitignore'), 'utf8');
    return gitignore.split(/\r?\n/).filter(Boolean);
  } catch {
    return [];
  }
}

export async function walkProject(options: WalkProjectOptions): Promise<WalkProjectResult> {
  const matcher = createIgnoreMatcher(options.ignorePatterns ?? []);
  const maxEntries = options.maxEntries ?? 500;
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const entries: ProjectFileEntry[] = [];
  let truncated = false;

  async function visit(currentPath: string, depth: number): Promise<void> {
    if (entries.length >= maxEntries || depth > maxDepth) {
      truncated = true;
      return;
    }

    const dirEntries = await readdir(currentPath, { withFileTypes: true });
    dirEntries.sort((left, right) => left.name.localeCompare(right.name));

    for (const dirEntry of dirEntries) {
      const absolutePath = path.join(currentPath, dirEntry.name);
      const relativePath = normalizeRelative(path.relative(options.root, absolutePath));
      const isDirectory = dirEntry.isDirectory();
      if (matcher(relativePath + (isDirectory ? '/' : ''), isDirectory)) {
        continue;
      }

      if (isDirectory) {
        if (options.includeDirectories) {
          entries.push({ path: relativePath, type: 'directory' });
        }
        if (entries.length >= maxEntries) {
          truncated = true;
          return;
        }
        await visit(absolutePath, depth + 1);
      } else if (dirEntry.isFile()) {
        const fileStat = await stat(absolutePath);
        entries.push({ path: relativePath, type: 'file', size: fileStat.size });
      }

      if (entries.length >= maxEntries) {
        truncated = true;
        return;
      }
    }
  }

  await visit(options.root, 0);
  return { entries, truncated };
}
