#!/usr/bin/env node
import { Command } from 'commander';
import path from 'node:path';
import process from 'node:process';
import { ensureProjectConfig } from '../config/project';
import { formatDoctorReport, collectDoctorReport } from './commands/doctor';
import { runInstall } from './commands/install';
import { formatMcpConfig, type McpConfigTarget } from './commands/mcpConfig';
import { runUninstall } from './commands/uninstall';
import { discoverGodotBinary } from '../utils/godotBinary';
import { startMcpServer } from '../index';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const pkg = require('../../package.json') as { version: string; description: string };

async function runProject(projectPath: string): Promise<void> {
  const resolvedProjectPath = path.resolve(projectPath);
  const config = await ensureProjectConfig(resolvedProjectPath);
  const binary = await discoverGodotBinary(config);
  if (!binary) {
    throw new Error('Unable to discover a Godot binary. Set GODOT_BIN or configure .godot-universal-mcp/config.json');
  }
  const { spawn } = await import('node:child_process');
  const child = spawn(binary, ['--path', resolvedProjectPath], { stdio: 'inherit' });
  await new Promise<void>((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code && code !== 0) {
        reject(new Error(`Godot exited with code ${code}`));
        return;
      }
      resolve();
    });
  });
}

const program = new Command();
program
  .name('godot-universal-mcp')
  .description(pkg.description)
  .version(pkg.version)
  .action(async () => {
    await startMcpServer();
  });

program
  .command('install')
  .argument('<projectPath>')
  .option('--enable', 'Enable the Godot addon plugin in project.godot')
  .option('--autoload', 'Add the bridge as an autoload entry in project.godot')
  .action(async (projectPath: string, options: { enable?: boolean; autoload?: boolean }) => {
    const result = await runInstall(projectPath, options);
    process.stdout.write(`Installed Godot Universal MCP into ${result.projectPath}\n`);
    result.nextSteps.forEach((step, index) => process.stdout.write(`${index + 1}. ${step}\n`));
  });

program
  .command('uninstall')
  .argument('<projectPath>')
  .option('--remove-config', 'Remove .godot-universal-mcp and VS Code config')
  .option('--remove-autoload', 'Remove plugin/autoload settings from project.godot')
  .action(async (projectPath: string, options: { removeConfig?: boolean; removeAutoload?: boolean }) => {
    const result = await runUninstall(projectPath, options);
    process.stdout.write(`Removed: ${result.removed.join(', ')}\n`);
  });

program
  .command('doctor')
  .argument('[projectPath]')
  .option('--json', 'Return machine-readable JSON output')
  .action(async (projectPath: string | undefined, options: { json?: boolean }) => {
    const resolvedProjectPath = path.resolve(projectPath ?? process.cwd());
    const report = await collectDoctorReport(resolvedProjectPath);
    process.stdout.write(formatDoctorReport(report, Boolean(options.json)));
    if (!report.ok) {
      process.exitCode = 1;
    }
  });

program
  .command('init-project')
  .argument('<projectPath>')
  .action(async (projectPath: string) => {
    const resolvedProjectPath = path.resolve(projectPath);
    const config = await ensureProjectConfig(resolvedProjectPath);
    process.stdout.write(`Initialized config at ${resolvedProjectPath}/.godot-universal-mcp/config.json\n`);
    process.stdout.write(`${JSON.stringify(config, null, 2)}\n`);
  });

program
  .command('run')
  .argument('<projectPath>')
  .action(async (projectPath: string) => {
    await runProject(projectPath);
  });

program
  .command('mcp-config')
  .option('--target <target>', 'Config target: vscode or copilot-cli', 'vscode')
  .option('--project-path <projectPath>', 'Project root for GODOT_PROJECT_ROOT', process.cwd())
  .action((options: { target: McpConfigTarget; projectPath: string }) => {
    process.stdout.write(formatMcpConfig(options.projectPath, options.target));
  });

void program.parseAsync(process.argv).catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
