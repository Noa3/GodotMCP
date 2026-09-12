import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import path from 'node:path';
import { z } from 'zod';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { jsonResult, errorResult, type ToolResult } from '../toolUtils';
import { createErrorPayload, ERROR_CODES } from '../../utils/errors';
import { discoverGodotBinary } from '../../utils/godotBinary';
import { getBridgeTools } from './bridgeTools';

/** Process ownership and logs belong to one MCP context, not module-global mutable state. */
export function getRuntimeTools(context: McpRuntimeContext): ToolDefinition[] {
  let running: ChildProcessWithoutNullStreams | null = null;
  let launched = false;
  let lastPid: number | undefined;
  const logs: Array<{ timestamp: string; source: string; message: string }> = [];
  const append = (source: string, message: string): void => {
    logs.push({ timestamp: new Date().toISOString(), source, message: message.slice(0, 8192) });
    if (logs.length > 500) logs.shift();
  };
  context.runtimeClient.on?.('status', (status: { state?: string }) => {
    if (status.state === 'disconnected') running?.kill('SIGTERM');
  });
  async function stop(): Promise<boolean> {
    const child = running;
    if (!child) return true;
    if (child.exitCode !== null || child.signalCode !== null) return true;
    return new Promise<boolean>((resolve) => {
      const onClose = (): void => { clearTimeout(timer); resolve(true); };
      const timer = setTimeout(() => { child.removeListener('close', onClose); resolve(false); }, 3000);
      child.once('close', onClose);
      child.kill('SIGTERM');
    });
  }
  async function launch(args: string[]): Promise<ToolResult> {
    const binary = await discoverGodotBinary(await context.getConfig());
    if (!binary) return errorResult(createErrorPayload(ERROR_CODES.TOOL_NOT_AVAILABLE, 'Unable to discover a Godot binary'));
    if (running) return jsonResult({ alreadyRunning: true, pid: running.pid, projectPath: context.projectRoot });
    const child = spawn(binary, ['--path', context.projectRoot, ...args], { cwd: context.projectRoot, stdio: 'pipe', shell: false });
    running = child;
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => append('stdout', data));
    child.stderr.on('data', (data: string) => append('stderr', data));
    child.on('close', (code, signal) => {
      append('process', `Exited: code=${code} signal=${signal}`);
      if (running === child) running = null;
    });
    return new Promise<ToolResult>((resolve) => {
      child.once('spawn', () => {
        launched = true;
        lastPid = child.pid;
        resolve(jsonResult({ launched: true, ready: false, pid: child.pid, projectPath: context.projectRoot,
          next: 'godot_runtime_wait_ready', isolated: false }));
      });
      child.on('error', (error) => {
        if (child.pid === undefined && running === child) running = null;
        append('process', error.message);
        resolve(errorResult(createErrorPayload(ERROR_CODES.INTERNAL_ERROR, `Godot launch failed: ${error.message}`)));
      });
    });
  }
  const argsSchema = z.array(z.literal('--headless')).max(1).optional();
  const argsJson = { type: 'array', items: { type: 'string', enum: ['--headless'] } };
  return [
    ...getBridgeTools(context, 'runtime'),
    {
      name: 'godot_run_project', title: 'Godot Run Project', riskLevel: 'write',
      description: 'Launch this project using the configured Godot executable. Only --headless is accepted as an extra flag. This is not isolated validation and can use game saves.',
      schema: z.object({ projectPath: z.string().optional(), args: argsSchema }).strict(),
      inputSchema: { type: 'object', additionalProperties: false, properties: { projectPath: { type: 'string' }, args: argsJson } },
      execute: async ({ projectPath, args }) => {
        if (projectPath && path.resolve(projectPath) !== path.resolve(context.projectRoot)) return errorResult(createErrorPayload(ERROR_CODES.PATH_OUTSIDE_PROJECT, 'Launch is restricted to the configured project'));
        return launch(args ?? []);
      },
    },
    {
      name: 'godot_stop_project', title: 'Godot Stop Managed Project', riskLevel: 'destructive',
      description: 'Stop only the process owned by this MCP context and await exit; never kill unrelated Godot processes.',
      schema: z.object({}).strict(), inputSchema: { type: 'object', additionalProperties: false },
      execute: async () => await stop() ? jsonResult({ stopped: true }) : errorResult(createErrorPayload(ERROR_CODES.TIMEOUT, 'Managed process has not exited')),
    },
    {
      name: 'godot_restart_project', title: 'Godot Restart Managed Project', riskLevel: 'write',
      description: 'Restart this context\'s project only after its previous process has exited.',
      schema: z.object({ args: argsSchema }).strict(), inputSchema: { type: 'object', additionalProperties: false, properties: { args: argsJson } },
      execute: async ({ args }) => await stop() ? launch(args ?? []) : errorResult(createErrorPayload(ERROR_CODES.TIMEOUT, 'Previous process has not exited; restart not attempted')),
    },
    {
      name: 'godot_runtime_logs', title: 'Godot Managed Process Logs', riskLevel: 'safe',
      description: 'Bounded stdout/stderr from this context\'s managed process only, not the editor debugger. supported=false and logs=null until a process was launched.',
      schema: z.object({ limit: z.number().int().min(1).max(500).optional() }).strict(),
      inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer' } } },
      execute: async ({ limit }) => jsonResult({ supported: launched, source: 'managed-process', projectPath: context.projectRoot,
        pid: running?.pid ?? lastPid ?? null, active: running !== null, logs: launched ? logs.slice(-(limit ?? 50)) : null }),
    },
  ];
}
