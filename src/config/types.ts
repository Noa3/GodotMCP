export type TrustMode = 'read-only' | 'trusted';

export interface ProjectConfig {
  version: number;
  projectRoot: string;
  tcp: {
    host: string;
    editorPort: number;
    runtimePort: number;
    timeoutMs: number;
    reconnectIntervalMs: number;
  };
  security: {
    allowWrite: boolean;
    trustMode: TrustMode;
    deniedPaths: string[];
  };
  scan: {
    maxFiles: number;
    maxFileSizeBytes: number;
    ignore: string[];
  };
  godot: {
    binaryPath?: string;
  };
  addon: {
    enabled: boolean;
    autoload: boolean;
  };
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends Record<string, unknown>
      ? DeepPartial<T[K]>
      : T[K];
};

export const DEFAULT_DENIED_PATHS = ['.git', '.godot', '.godot-import', '.import', 'node_modules', '.env'];

export function createDefaultProjectConfig(projectRoot: string): ProjectConfig {
  return {
    version: 1,
    projectRoot,
    tcp: {
      host: '127.0.0.1',
      editorPort: 9500,
      runtimePort: 9501,
      timeoutMs: 10_000,
      reconnectIntervalMs: 3_000,
    },
    security: {
      allowWrite: false,
      trustMode: 'read-only',
      deniedPaths: DEFAULT_DENIED_PATHS,
    },
    scan: {
      maxFiles: 500,
      maxFileSizeBytes: 512 * 1024,
      ignore: ['.git/', '.godot/', '.godot-import/', '.import/', 'node_modules/', '.godot-universal-mcp/'],
    },
    godot: {},
    addon: {
      enabled: false,
      autoload: false,
    },
  };
}
