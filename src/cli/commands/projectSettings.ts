import { constants } from 'node:fs';
import { copyFile, lstat, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export const PLUGIN_PATH = 'res://addons/godot_universal_mcp/plugin.cfg';
export const AUTOLOAD_PATH = '*res://addons/godot_universal_mcp/runtime_bridge.gd';

export async function readJsonObject(file: string): Promise<Record<string, unknown>> {
  let text: string;
  try { text = await readFile(file, 'utf8'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}; throw error; }
  let data: unknown;
  try { data = JSON.parse(text.replace(/^\uFEFF/, '')); }
  catch { throw new Error(`Invalid JSON in ${file}; JSONC comments/trailing commas are not modified automatically`); }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error(`Expected a JSON object in ${file}`);
  return data as Record<string, unknown>;
}

export async function assertLocalTarget(root: string, target: string): Promise<void> {
  const relative = path.relative(root, target);
  if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error('Installation target escapes the project');
  let current = root;
  for (const part of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw new Error(`Refusing symlink installation target: ${current}`); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
}

export async function projectDirectory(input: string): Promise<string> {
  const root = await realpath(path.resolve(input));
  await assertLocalTarget(root, path.join(root, 'project.godot'));
  if (!(await lstat(path.join(root, 'project.godot'))).isFile()) throw new Error('project.godot is not a file');
  return root;
}

export async function writeWithBackup(file: string, content: string): Promise<void> {
  try {
    if (await readFile(file, 'utf8') === content) return;
    await copyFile(file, `${file}.gumcp-${randomUUID()}.bak`, constants.COPYFILE_EXCL);
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  await writeFile(file, content, 'utf8');
}

export function editSetting(text: string, section: string, key: string, transform: (value: string | undefined) => string | undefined): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const starts = lines.map((line, index) => line.trim() === `[${section}]` ? index : -1).filter((index) => index >= 0);
  if (starts.length > 1) throw new Error(`Duplicate section ${section}`);
  const start = starts[0] ?? -1;
  if (start < 0) {
    const value = transform(undefined);
    return value === undefined ? text : `${text.trimEnd()}\n\n[${section}]\n${key}=${value}\n`;
  }
  let end = start + 1;
  while (end < lines.length && !/^\s*\[/.test(lines[end])) end++;
  const matches: number[] = [];
  for (let i = start + 1; i < end; i++) if (lines[i].split('=', 1)[0].trim() === key) matches.push(i);
  if (matches.length > 1) throw new Error(`Duplicate setting ${section}/${key}`);
  const index = matches[0];
  const value = transform(index === undefined ? undefined : lines[index].slice(lines[index].indexOf('=') + 1).trim());
  if (index !== undefined) {
    if (value === undefined) lines.splice(index, 1);
    else lines[index] = `${key}=${value}`;
  } else if (value !== undefined) lines.splice(start + 1, 0, `${key}=${value}`);
  return lines.join('\n');
}

export function editPlugin(text: string, enabled: boolean): string {
  return editSetting(text, 'editor_plugins', 'enabled', (value) => {
    const match = value?.match(/^PackedStringArray\(([\s\S]*)\)$/);
    if (value && !match) throw new Error('Unsupported editor_plugins/enabled syntax; enable the addon in Godot instead');
    const entries: unknown = JSON.parse(`[${match?.[1] ?? ''}]`);
    if (!Array.isArray(entries) || entries.some((entry) => typeof entry !== 'string')) throw new Error('Invalid plugin list');
    const result = entries.filter((entry) => entry !== PLUGIN_PATH);
    if (enabled) result.push(PLUGIN_PATH);
    return `PackedStringArray(${result.map((entry) => JSON.stringify(entry)).join(', ')})`;
  });
}

export function removeOwnedAutoloads(text: string): string {
  text = editSetting(text, 'autoload', 'GodotUniversalMcpRuntime', (value) => value === JSON.stringify(AUTOLOAD_PATH) ? undefined : value);
  return editSetting(text, 'autoload', 'GodotUniversalMcpBridge', (value) => value === '"*res://addons/godot_universal_mcp/bridge.gd"' ? undefined : value);
}
