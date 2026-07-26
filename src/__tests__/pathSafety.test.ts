import path from 'node:path';
import { isDeniedPath, isPathSafe, resolveProjectPath } from '../security/pathSafety';

describe('pathSafety', () => {
  const projectRoot = path.resolve(process.cwd(), 'path-safety-project');

  test('allows project relative paths', () => {
    expect(resolveProjectPath(projectRoot, 'scenes/main.tscn')).toBe(path.join(projectRoot, 'scenes', 'main.tscn'));
  });

  test('rejects traversal outside the project', () => {
    expect(() => resolveProjectPath(projectRoot, '../../etc/passwd')).toThrow('PATH_OUTSIDE_PROJECT');
  });

  test('recognizes safe absolute paths', () => {
    expect(isPathSafe(projectRoot, path.join(projectRoot, 'scripts', 'player.gd'))).toBe(true);
    expect(isPathSafe(projectRoot, path.resolve(projectRoot, '..', 'other'))).toBe(false);
  });

  test('matches denied paths across platforms', () => {
    expect(isDeniedPath('.git/config', ['.git', 'node_modules'])).toBe(true);
    expect(isDeniedPath('scenes/main.tscn', ['.git', 'node_modules'])).toBe(false);
    expect(isDeniedPath('node_modules\\package\\index.js', ['node_modules'])).toBe(true);
  });
});
