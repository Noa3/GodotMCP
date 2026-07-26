import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { z } from 'zod';
import type { McpRuntimeContext } from '../context';
import type { ToolDefinition } from '../toolRegistry';
import { jsonResult, errorResult } from '../toolUtils';
import { createErrorPayload, ERROR_CODES } from '../../utils/errors';
import { discoverGodotBinary } from '../../utils/godotBinary';

let runningProcess: ChildProcessWithoutNullStreams | null = null;
const runtimeLogs: string[] = [];
let lastRunProjectPath: string | null = null;

function appendRuntimeLog(line: string): void {
  runtimeLogs.push(line);
  if (runtimeLogs.length > 500) {
    runtimeLogs.shift();
  }
}

async function callRuntime(context: McpRuntimeContext, tool: string, params: Record<string, unknown> = {}) {
  const response = await context.runtimeClient.sendRequest(tool, params);
  if (!response.ok) {
    return errorResult(createErrorPayload(ERROR_CODES.GODOT_RUNTIME_NOT_CONNECTED, response.error?.message ?? 'Godot runtime is not connected', response.error?.details ?? context.runtimeClient.getStatus()));
  }
  return jsonResult(response.result);
}

export function getRuntimeTools(context: McpRuntimeContext): ToolDefinition[] {
  return [
    {
      name: 'godot_run_project',
      title: 'Godot Run Project',
      description: 'Launch the Godot project when a Godot binary can be discovered.',
      schema: z.object({ projectPath: z.string().optional(), args: z.array(z.string()).optional() }),
      inputSchema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          projectPath: { type: 'string' },
          args: { type: 'array', items: { type: 'string' } },
        },
      },
      riskLevel: 'write',
      requiresRuntime: true,
      execute: async ({ projectPath, args }) => {
        if (runningProcess) {
          return jsonResult({ alreadyRunning: true, pid: runningProcess.pid, projectPath: lastRunProjectPath });
        }
        const config = await context.getConfig();
        const binary = await discoverGodotBinary(config);
        if (!binary) {
          return errorResult(createErrorPayload(ERROR_CODES.TOOL_NOT_AVAILABLE, 'Unable to discover a Godot binary'));
        }
        const targetProject = projectPath ?? context.projectRoot;
        const child = spawn(binary, ['--path', targetProject, ...(args ?? [])], {
          cwd: targetProject,
          stdio: 'pipe',
        });
        runningProcess = child;
        lastRunProjectPath = targetProject;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => appendRuntimeLog(chunk.trim()));
        child.stderr.on('data', (chunk: string) => appendRuntimeLog(chunk.trim()));
        child.on('close', (code, signal) => {
          appendRuntimeLog(`Process exited with code=${code ?? 'null'} signal=${signal ?? 'null'}`);
          runningProcess = null;
        });
        return jsonResult({ launched: true, binary, pid: child.pid, projectPath: targetProject });
      },
    },
    {
      name: 'godot_stop_project',
      title: 'Godot Stop Project',
      description: 'Stop a project launched by godot_run_project.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'destructive',
      requiresRuntime: true,
      execute: async () => {
        if (!runningProcess) {
          return jsonResult({ stopped: false, reason: 'No managed runtime process is running' });
        }
        runningProcess.kill('SIGTERM');
        const pid = runningProcess.pid;
        runningProcess = null;
        return jsonResult({ stopped: true, pid });
      },
    },
    {
      name: 'godot_restart_project',
      title: 'Godot Restart Project',
      description: 'Restart a managed Godot runtime process.',
      schema: z.object({ args: z.array(z.string()).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { args: { type: 'array', items: { type: 'string' } } } },
      riskLevel: 'write',
      requiresRuntime: true,
      execute: async ({ args }) => {
        const previousProjectPath = lastRunProjectPath ?? context.projectRoot;
        if (runningProcess) {
          runningProcess.kill('SIGTERM');
          runningProcess = null;
        }
        const config = await context.getConfig();
        const binary = await discoverGodotBinary(config);
        if (!binary) {
          return errorResult(createErrorPayload(ERROR_CODES.TOOL_NOT_AVAILABLE, 'Unable to discover a Godot binary'));
        }
        const child = spawn(binary, ['--path', previousProjectPath, ...(args ?? [])], {
          cwd: previousProjectPath,
          stdio: 'pipe',
        });
        runningProcess = child;
        child.stdout.setEncoding('utf8');
        child.stderr.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => appendRuntimeLog(chunk.trim()));
        child.stderr.on('data', (chunk: string) => appendRuntimeLog(chunk.trim()));
        child.on('close', () => {
          runningProcess = null;
        });
        return jsonResult({ restarted: true, pid: child.pid, binary, projectPath: previousProjectPath });
      },
    },
    {
      name: 'godot_runtime_status',
      title: 'Godot Runtime Status',
      description: 'Return runtime bridge and managed process status.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      requiresRuntime: true,
      execute: async () => jsonResult({ bridge: context.runtimeClient.getStatus(), process: runningProcess ? { pid: runningProcess.pid, projectPath: lastRunProjectPath } : null }),
    },
    {
      name: 'godot_runtime_tree',
      title: 'Godot Runtime Tree',
      description: 'Fetch the live runtime scene tree through the bridge.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      requiresRuntime: true,
      execute: async () => callRuntime(context, 'runtime_tree'),
    },
    {
      name: 'godot_runtime_screenshot',
      title: 'Godot Runtime Screenshot',
      description: 'Fetch a runtime screenshot from the bridge.',
      schema: z.object({ encoding: z.enum(['base64', 'data-uri']).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { encoding: { type: 'string', enum: ['base64', 'data-uri'] } } },
      riskLevel: 'safe',
      requiresRuntime: true,
      execute: async ({ encoding }) => callRuntime(context, 'runtime_screenshot', { encoding: encoding ?? 'base64' }),
    },
    {
      name: 'godot_runtime_logs',
      title: 'Godot Runtime Logs',
      description: 'Return runtime logs from the managed process or bridge.',
      schema: z.object({ limit: z.number().int().positive().max(500).optional() }),
      inputSchema: { type: 'object', additionalProperties: false, properties: { limit: { type: 'number' } } },
      riskLevel: 'safe',
      requiresRuntime: true,
      execute: async ({ limit }) => jsonResult({ logs: runtimeLogs.slice(-(limit ?? 50)) }),
    },
    {
      name: 'godot_runtime_perf',
      title: 'Godot Runtime Performance',
      description: 'Fetch runtime performance stats from the bridge.',
      schema: z.object({}),
      inputSchema: { type: 'object', additionalProperties: false },
      riskLevel: 'safe',
      requiresRuntime: true,
      execute: async () => callRuntime(context, 'runtime_perf'),
    },
  ];
}
