import path from 'node:path';
import { ERROR_CODES } from '../utils/errors';

function normalizePathForComparison(inputPath: string): string {
  const resolved = path.resolve(inputPath);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function normalizeSegments(inputPath: string): string[] {
  return inputPath.replace(/\\/g, '/').split('/').filter(Boolean);
}

export function isPathSafe(projectRoot: string, resolvedPath: string): boolean {
  const normalizedRoot = normalizePathForComparison(projectRoot);
  const normalizedResolved = normalizePathForComparison(resolvedPath);
  if (normalizedResolved === normalizedRoot) {
    return true;
  }
  return normalizedResolved.startsWith(`${normalizedRoot}${path.sep}`);
}

export function isDeniedPath(candidatePath: string, denylist: string[]): boolean {
  const candidateSegments = normalizeSegments(candidatePath);
  const normalizedCandidate = candidateSegments.join('/');

  return denylist.some((entry) => {
    const normalizedEntry = entry.replace(/\\/g, '/').replace(/^\//, '').replace(/\/$/, '');
    if (!normalizedEntry) {
      return false;
    }

    const entrySegments = normalizeSegments(normalizedEntry);
    if (candidateSegments.some((_, index) => entrySegments.every((segment, offset) => candidateSegments[index + offset] === segment))) {
      return true;
    }

    return normalizedCandidate === normalizedEntry || normalizedCandidate.startsWith(`${normalizedEntry}/`);
  });
}

export function resolveProjectPath(projectRoot: string, inputPath: string): string {
  const resolvedRoot = path.resolve(projectRoot);
  const candidatePath = path.isAbsolute(inputPath)
    ? path.resolve(inputPath)
    : path.resolve(resolvedRoot, inputPath);

  if (!isPathSafe(resolvedRoot, candidatePath)) {
    throw new Error(`${ERROR_CODES.PATH_OUTSIDE_PROJECT}: ${inputPath}`);
  }

  return candidatePath;
}
