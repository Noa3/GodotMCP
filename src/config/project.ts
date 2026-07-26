import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createDefaultProjectConfig, type DeepPartial, type ProjectConfig } from './types';

const CONFIG_DIRECTORY_NAME = '.godot-universal-mcp';
const CONFIG_FILE_NAME = 'config.json';

export function getConfigDirectory(projectRoot: string): string {
  return path.join(projectRoot, CONFIG_DIRECTORY_NAME);
}

export function getConfigPath(projectRoot: string): string {
  return path.join(getConfigDirectory(projectRoot), CONFIG_FILE_NAME);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function mergeProjectConfig<T extends object>(base: T, override: DeepPartial<T>): T {
  const result = { ...(base as unknown as Record<string, unknown>) } as Record<string, unknown>;

  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) {
      continue;
    }

    const current = result[key];
    if (Array.isArray(value)) {
      result[key] = [...value];
      continue;
    }

    if (isRecord(current) && isRecord(value)) {
      result[key] = mergeProjectConfig(current, value);
      continue;
    }

    result[key] = value;
  }

  return result as T;
}

export async function readProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const defaultConfig = createDefaultProjectConfig(projectRoot);
  const configPath = getConfigPath(projectRoot);

  try {
    const raw = await readFile(configPath, 'utf8');
    const parsed = JSON.parse(raw) as DeepPartial<ProjectConfig>;
    return mergeProjectConfig(defaultConfig as unknown as Record<string, unknown>, parsed as unknown as Record<string, unknown>) as unknown as ProjectConfig;
  } catch {
    return defaultConfig;
  }
}

export async function writeProjectConfig(projectRoot: string, config: DeepPartial<ProjectConfig>): Promise<ProjectConfig> {
  const merged = mergeProjectConfig(await readProjectConfig(projectRoot) as unknown as Record<string, unknown>, config as unknown as Record<string, unknown>) as unknown as ProjectConfig;
  await mkdir(getConfigDirectory(projectRoot), { recursive: true });
  await writeFile(getConfigPath(projectRoot), `${JSON.stringify(merged, null, 2)}\n`, 'utf8');
  return merged;
}

export async function ensureProjectConfig(projectRoot: string): Promise<ProjectConfig> {
  const config = await readProjectConfig(projectRoot);
  await writeProjectConfig(projectRoot, config);
  return config;
}

export async function findProjectRoot(startPath = process.cwd()): Promise<string | null> {
  let current = path.resolve(startPath);

  for (;;) {
    try {
      await access(path.join(current, 'project.godot'));
      return current;
    } catch {
      const parent = path.dirname(current);
      if (parent === current) {
        break;
      }
      current = parent;
    }
  }

  return null;
}
