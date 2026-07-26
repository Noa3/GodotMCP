import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { ProjectConfig } from '../config/types';
import { findProjectRoot, readProjectConfig, writeProjectConfig } from '../config/project';
import { GodotClient } from '../godot/client';
import { createLogger } from '../utils/logger';
import { buildPromptDefinitions } from './prompts';
import { buildResourceDefinitions } from './resources';
import type { McpRuntimeContext } from './context';
import { buildToolRegistry } from './toolRegistry';

export interface CreateServerOptions {
  projectRoot?: string;
}

export async function resolveServerProjectRoot(explicitProjectRoot?: string): Promise<string> {
  const envRoot = process.env.GODOT_PROJECT_ROOT;
  if (envRoot) {
    return envRoot;
  }
  if (explicitProjectRoot) {
    return explicitProjectRoot;
  }
  const discovered = await findProjectRoot(process.cwd());
  if (discovered) {
    return discovered;
  }
  return process.cwd();
}

async function createContext(projectRoot: string): Promise<McpRuntimeContext> {
  const logger = createLogger();
  let currentConfig = await readProjectConfig(projectRoot);
  const editorClient = new GodotClient({
    host: currentConfig.tcp.host,
    port: currentConfig.tcp.editorPort,
    timeoutMs: currentConfig.tcp.timeoutMs,
    reconnectIntervalMs: currentConfig.tcp.reconnectIntervalMs,
    logger,
    clientName: 'editor',
  });
  const runtimeClient = new GodotClient({
    host: currentConfig.tcp.host,
    port: currentConfig.tcp.runtimePort,
    timeoutMs: currentConfig.tcp.timeoutMs,
    reconnectIntervalMs: currentConfig.tcp.reconnectIntervalMs,
    logger,
    clientName: 'runtime',
  });

  void editorClient.connect();
  void runtimeClient.connect();

  return {
    projectRoot,
    logger,
    editorClient,
    runtimeClient,
    getConfig: async (): Promise<ProjectConfig> => {
      currentConfig = await readProjectConfig(projectRoot);
      return currentConfig;
    },
    setConfig: async (config: Partial<ProjectConfig>): Promise<ProjectConfig> => {
      currentConfig = await writeProjectConfig(projectRoot, config);
      return currentConfig;
    },
  };
}

export async function createMcpServer(options: CreateServerOptions = {}): Promise<{ server: Server; transport: StdioServerTransport; context: McpRuntimeContext }> {
  const projectRoot = await resolveServerProjectRoot(options.projectRoot);
  const context = await createContext(projectRoot);
  const registry = buildToolRegistry(context);
  const resources = await buildResourceDefinitions(context, registry);
  const prompts = buildPromptDefinitions(context);

  const server = new Server(
    {
      name: 'godot-universal-mcp',
      version: '0.1.0',
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: registry.list().map((tool) => ({
      name: tool.name,
      title: tool.title,
      description: tool.description,
      inputSchema: tool.inputSchema,
    })),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => registry.call(request.params.name, request.params.arguments ?? {}));

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map((resource) => ({
      uri: resource.uri,
      name: resource.name,
      description: resource.description,
      mimeType: resource.mimeType,
    })),
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    const resource = resources.find((entry) => entry.uri === request.params.uri);
    if (!resource) {
      throw new Error(`Unknown resource: ${request.params.uri}`);
    }
    return {
      contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: await resource.read() }],
    };
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: prompts.map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments,
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const prompt = prompts.find((entry) => entry.name === request.params.name);
    if (!prompt) {
      throw new Error(`Unknown prompt: ${request.params.name}`);
    }
    return prompt.build((request.params.arguments ?? {}) as Record<string, string>);
  });

  const transport = new StdioServerTransport();
  return { server, transport, context };
}

export async function startMcpServer(options: CreateServerOptions = {}): Promise<void> {
  const { server, transport, context } = await createMcpServer(options);
  await server.connect(transport);

  const shutdown = async (): Promise<void> => {
    await context.editorClient.disconnect();
    await context.runtimeClient.disconnect();
    await server.close();
  };

  process.once('SIGINT', () => {
    void shutdown().finally(() => process.exit(0));
  });
  process.once('SIGTERM', () => {
    void shutdown().finally(() => process.exit(0));
  });
}
