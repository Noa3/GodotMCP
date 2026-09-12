import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { jsonResult, errorResult } from '../toolUtils';
import { bridgeErrorPayload, createErrorPayload, ERROR_CODES } from '../../utils/errors';
import { discoverGodotBinary } from '../../utils/godotBinary';

let runningProcess: ChildProcessWithoutNullStreams | null = null;
const runtimeLogs: string[] = [];
let lastRunProjectPath: string | null = null;
function appendRuntimeLog(line: string): void {
  runtimeLogs.push(line.slice(0, 8192));
  if (runtimeLogs.length > 500) runtimeLogs.shift();
}
async function callRuntime(context: McpRuntimeContext, tool: string, params: Record<string, unknown> = {}) {
  const response = await context.runtimeClient.sendRequest(tool, params);
  return response.ok ? jsonResult(response.result) : errorResult(bridgeErrorPayload(response.error));
}

/** Wait for spawn instead of reporting success before an OS-level launch failure. */
async function launch(context: McpRuntimeContext, target: string, args: string[]) {
  const binary = await discoverGodotBinary(await context.getConfig());
  if (!binary) return errorResult(createErrorPayload(ERROR_CODES.TOOL_NOT_AVAILABLE, 'Unable to discover a Godot binary'));
  // Another launch may have completed while binary discovery was pending.
  if (runningProcess) return jsonResult({ alreadyRunning: true, pid: runningProcess.pid, projectPath: lastRunProjectPath });
  const child = spawn(binary, ['--path', target, ...args], { cwd: target, stdio: 'pipe' });
  runningProcess = child;
  lastRunProjectPath = target;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => appendRuntimeLog(chunk.trim()));
  child.stderr.on('data', (chunk: string) => appendRuntimeLog(chunk.trim()));
  child.on('close', (code, signal) => {
    appendRuntimeLog(`Process exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    if (runningProcess === child) runningProcess = null;
  });
  return new Promise<ReturnType<typeof jsonResult>>((resolve) => {
    child.once('spawn', () => resolve(jsonResult({ launched: true, binary, pid: child.pid, projectPath: target })));
    child.on('error', (error) => {
      if (runningProcess === child) runningProcess = null;
      appendRuntimeLog(error.message);
      resolve(errorResult(createErrorPayload(ERROR_CODES.INTERNAL_ERROR, `Godot launch failed: ${error.message}`)));
    });
  });
}

export function getRuntimeTools(context: McpRuntimeContext): ToolDefinition[] {
  const simple: Array<[string, string, string, 'safe' | 'write']> = [
    ['godot_runtime_tree', 'runtime.get_tree', 'Read the bounded live runtime tree. Paths are relative to /root.', 'safe'],
    ['godot_runtime_capabilities', 'runtime.get_capabilities', 'Discover runtime operations and language availability.', 'safe'],
    ['godot_runtime_perf', 'runtime.get_perf', 'Read live runtime performance counters.', 'safe'],
    ['godot_runtime_pause', 'runtime.pause', 'Pause gameplay; the debug bridge remains responsive.', 'write'],
    ['godot_runtime_resume', 'runtime.resume', 'Resume gameplay through the always-processing debug bridge.', 'write'],
  ];
  return [
    {
      name: 'godot_run_project', title: 'Godot Run Project',
      description: 'Launch project code using a discovered Godot binary. Trusted write access is required; this is not a sandbox.',
      schema: z.object({ projectPath: z.string().optional(), args: z.array(z.string()).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { projectPath: { type: 'string' }, args: { type: 'array', items: { type: 'string' } } } },
      riskLevel: 'write', requiresRuntime: true,
      execute: async ({ projectPath, args }) => {
        if (runningProcess) return jsonResult({ alreadyRunning: true, pid: runningProcess.pid, projectPath: lastRunProjectPath });
        return launch(context, projectPath ?? context.projectRoot, args ?? []);
      },
    },
    {
      name: 'godot_stop_project', title: 'Godot Stop Project', description: 'Request stopping a process launched by this server.',
      schema: z.object({}), inputSchema: { type: 'object', additionalProperties: false }, riskLevel: 'destructive', requiresRuntime: true,
      execute: async () => {
        if (!runningProcess) return jsonResult({ stopped: false, reason: 'No managed runtime process is running' });
        const child = runningProcess;
        return jsonResult({ stopRequested: child.kill('SIGTERM'), pid: child.pid });
      },
    },
    {
      name: 'godot_restart_project', title: 'Godot Restart Project', description: 'Restart a managed runtime after the previous process exits.',
      schema: z.object({ args: z.array(z.string()).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { args: { type: 'array', items: { type: 'string' } } } },
      riskLevel: 'write', requiresRuntime: true,
      execute: async ({ args }) => {
        const previous = lastRunProjectPath ?? context.projectRoot;
        const child = runningProcess;
        if (child) {
          const exited = await new Promise<boolean>((resolve) => {
            const onClose = (): void => { clearTimeout(timer); resolve(true); };
            const timer = setTimeout(() => { child.removeListener('close', onClose); resolve(false); }, 3000);
            child.once('close', onClose);
            child.kill('SIGTERM');
          });
          if (!exited) return errorResult(createErrorPayload(ERROR_CODES.TIMEOUT, 'Previous Godot process has not exited; restart was not attempted'));
        }
        return launch(context, previous, args ?? []);
      },
    },
    {
      name: 'godot_runtime_status', title: 'Godot Runtime Status', description: 'Read status from the runtime bridge, not just the TCP socket.',
      schema: z.object({}), inputSchema: { type: 'object', additionalProperties: false }, riskLevel: 'safe', requiresRuntime: true,
      execute: async () => callRuntime(context, 'runtime.get_status'),
    },
    ...simple.map(([name, command, description, riskLevel]): ToolDefinition => ({
      name, title: name.replace(/_/g, ' '), description, riskLevel, requiresRuntime: true,
      schema: z.object({}), inputSchema: { type: 'object', additionalProperties: false },
      execute: async () => callRuntime(context, command),
    })),
    {
      name: 'godot_runtime_screenshot', title: 'Godot Runtime Screenshot', description: 'Get a PNG screenshot limited to a 1024-pixel longest edge. Unavailable in headless mode.',
      schema: z.object({ encoding: z.enum(['base64', 'data-uri']).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { encoding: { type: 'string', enum: ['base64', 'data-uri'] } } },
      riskLevel: 'safe', requiresRuntime: true,
      execute: async ({ encoding }) => {
        const response = await context.runtimeClient.sendRequest('runtime.screenshot', {});
        if (!response.ok) return errorResult(bridgeErrorPayload(response.error));
        const image = response.result as { base64: string; format: string };
        return jsonResult(encoding === 'data-uri' ? { ...image, dataUri: `data:image/png;base64,${image.base64}`, base64: undefined } : image);
      },
    },
    {
      name: 'godot_runtime_logs', title: 'Godot Runtime Logs', description: 'Return bounded stdout/stderr from a process launched by this MCP server; not editor debugger logs.',
      schema: z.object({ limit: z.number().int().positive().max(500).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'number' } } }, riskLevel: 'safe', requiresRuntime: true,
      execute: async ({ limit }) => jsonResult({ source: 'managed-process', logs: runtimeLogs.slice(-(limit ?? 50)) }),
    },
  ];
}
