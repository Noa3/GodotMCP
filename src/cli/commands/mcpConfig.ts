import path from 'node:path';

export type McpConfigTarget = 'vscode' | 'copilot-cli';
export const SERVER_KEY = 'godot';

/** Resolve the installed package, never a consumer project's Tools/ directory or an unverified npm package. */
export function localServerEntry(): string {
  return path.resolve(__dirname, '../../../dist/cli/index.js');
}

export function buildMcpConfig(projectPath: string, target: McpConfigTarget = 'vscode'): Record<string, unknown> {
  if (target !== 'vscode' && target !== 'copilot-cli') throw new Error('Unknown MCP configuration target');
  const server = {
    command: process.execPath,
    args: [localServerEntry()],
    env: { GODOT_PROJECT_ROOT: path.resolve(projectPath) },
  };
  return target === 'vscode'
    ? { servers: { [SERVER_KEY]: { type: 'stdio', ...server } } }
    : { mcpServers: { [SERVER_KEY]: server } };
}

export function formatMcpConfig(projectPath: string, target: McpConfigTarget = 'vscode'): string {
  return `${JSON.stringify(buildMcpConfig(projectPath, target), null, 2)}\n`;
}
