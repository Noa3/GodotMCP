import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProjectConfig } from '../config/types';

const execFileAsync = promisify(execFile);
const KNOWN_BINARIES = ['godot4', 'godot', 'Godot_v4'];

async function isExecutable(candidate: string): Promise<boolean> {
  try {
    await access(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

async function which(binaryName: string): Promise<string | null> {
  const pathEntries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  for (const entry of pathEntries) {
    const candidate = path.join(entry, binaryName);
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }
  return null;
}

export async function discoverGodotBinary(config?: ProjectConfig): Promise<string | null> {
  const candidates = [
    process.env.GODOT_BIN,
    config?.godot.binaryPath,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    if (await isExecutable(candidate)) {
      return candidate;
    }
  }

  for (const binaryName of KNOWN_BINARIES) {
    const located = await which(binaryName);
    if (located) {
      return located;
    }
  }

  return null;
}

export async function readGodotVersion(binaryPath: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(binaryPath, ['--version']);
    const output = `${stdout}${stderr}`.trim();
    return output || null;
  } catch {
    return null;
  }
}
