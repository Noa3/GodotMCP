import type { Logger } from 'pino';
import type { ProjectConfig } from '../config/types';
import type { GodotClient } from '../godot/client';

export interface McpRuntimeContext {
  projectRoot: string;
  logger: Logger;
  editorClient: GodotClient;
  runtimeClient: GodotClient;
  getConfig: () => Promise<ProjectConfig>;
  setConfig: (config: Partial<ProjectConfig>) => Promise<ProjectConfig>;
}
