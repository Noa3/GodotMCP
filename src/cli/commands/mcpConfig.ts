import path from 'node:path';

export type McpConfigTarget = 'vscode' | 'copilot-cli';

export function buildMcpConfig(projectPath: string, target: McpConfigTarget = 'vscode'): Record<string, unknown> {
  const resolvedProjectPath = path.resolve(projectPath);
  const command = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  const base = {
    command,
    args: ['godot-universal-mcp'],
    env: {
      GODOT_PROJECT_ROOT: resolvedProjectPath,
    },
  };

  if (target === 'copilot-cli') {
    return {
      mcpServers: {
        godot: base,
      },
    };
  }

  return {
    servers: {
      godot: base,
    },
  };
}

export function formatMcpConfig(projectPath: string, target: McpConfigTarget = 'vscode'): string {
  return `${JSON.stringify(buildMcpConfig(projectPath, target), null, 2)}\n`;
}
