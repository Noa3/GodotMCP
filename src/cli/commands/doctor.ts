import net from 'node:net';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import { readProjectConfig } from '../../config/project';
import { discoverGodotBinary, readGodotVersion } from '../../utils/godotBinary';

export interface DoctorCheck {
  name: string;
  ok: boolean;
  severity: 'info' | 'warning' | 'critical';
  details: string;
}

export interface DoctorReport {
  projectPath: string;
  packageVersion: string;
  checks: DoctorCheck[];
  ok: boolean;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function checkPort(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
    socket.setTimeout(750, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

function packageVersion(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pkg = require('../../../package.json') as { version: string };
  return pkg.version;
}

export async function collectDoctorReport(projectPath: string): Promise<DoctorReport> {
  const resolvedProjectPath = path.resolve(projectPath);
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number.parseInt(process.versions.node.split('.')[0] ?? '0', 10);
  checks.push({
    name: 'node-version',
    ok: nodeMajor >= 20,
    severity: nodeMajor >= 20 ? 'info' : 'critical',
    details: `Node.js ${process.versions.node}`,
  });
  checks.push({
    name: 'package-version',
    ok: true,
    severity: 'info',
    details: packageVersion(),
  });

  const projectFileExists = await pathExists(path.join(resolvedProjectPath, 'project.godot'));
  checks.push({
    name: 'project-file',
    ok: projectFileExists,
    severity: projectFileExists ? 'info' : 'critical',
    details: projectFileExists ? 'project.godot found' : 'project.godot missing',
  });

  const addonInstalled = await pathExists(path.join(resolvedProjectPath, 'addons', 'godot_universal_mcp', 'plugin.cfg'));
  checks.push({
    name: 'addon-files',
    ok: addonInstalled,
    severity: addonInstalled ? 'info' : 'warning',
    details: addonInstalled ? 'Addon files present' : 'Addon files missing',
  });

  let pluginEnabled = false;
  if (projectFileExists) {
    const projectFileContent = await readFile(path.join(resolvedProjectPath, 'project.godot'), 'utf8');
    pluginEnabled = projectFileContent.includes('res://addons/godot_universal_mcp/plugin.cfg');
  }
  checks.push({
    name: 'plugin-enabled',
    ok: pluginEnabled,
    severity: pluginEnabled ? 'info' : 'warning',
    details: pluginEnabled ? 'Plugin enabled in project.godot' : 'Plugin not enabled in project.godot',
  });

  const vscodeConfigured = await pathExists(path.join(resolvedProjectPath, '.vscode', 'mcp.json'));
  checks.push({
    name: 'vscode-mcp-config',
    ok: vscodeConfigured,
    severity: vscodeConfigured ? 'info' : 'warning',
    details: vscodeConfigured ? '.vscode/mcp.json present' : '.vscode/mcp.json missing',
  });

  const config = await readProjectConfig(resolvedProjectPath);
  const editorPortReachable = await checkPort(config.tcp.editorPort);
  checks.push({
    name: 'editor-port',
    ok: editorPortReachable,
    severity: editorPortReachable ? 'info' : 'warning',
    details: `Port ${config.tcp.editorPort} ${editorPortReachable ? 'reachable' : 'not reachable'}`,
  });
  const runtimePortReachable = await checkPort(config.tcp.runtimePort);
  checks.push({
    name: 'runtime-port',
    ok: runtimePortReachable,
    severity: runtimePortReachable ? 'info' : 'warning',
    details: `Port ${config.tcp.runtimePort} ${runtimePortReachable ? 'reachable' : 'not reachable'}`,
  });

  const godotBinary = await discoverGodotBinary(config);
  const version = godotBinary ? await readGodotVersion(godotBinary) : null;
  checks.push({
    name: 'godot-binary',
    ok: Boolean(godotBinary),
    severity: godotBinary ? 'info' : 'warning',
    details: godotBinary ? `${godotBinary}${version ? ` (${version})` : ''}` : 'Godot binary not discovered',
  });

  return {
    projectPath: resolvedProjectPath,
    packageVersion: packageVersion(),
    checks,
    ok: checks.every((check) => check.severity !== 'critical' || check.ok),
  };
}

export function formatDoctorReport(report: DoctorReport, json = false): string {
  if (json) {
    return `${JSON.stringify(report, null, 2)}\n`;
  }
  const lines = [
    `Godot Universal MCP doctor for ${report.projectPath}`,
    `Package version: ${report.packageVersion}`,
    '',
    ...report.checks.map((check) => `${check.ok ? '✔' : '✖'} [${check.severity}] ${check.name}: ${check.details}`),
  ];
  return `${lines.join('\n')}\n`;
}
