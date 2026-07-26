import { mergeProjectConfig } from '../config/project';
import { createDefaultProjectConfig } from '../config/types';

describe('config merge', () => {
  test('deep merges nested config values', () => {
    const base = createDefaultProjectConfig('/game');
    const merged = mergeProjectConfig(base, {
      tcp: { editorPort: 9600 },
      security: { allowWrite: true, trustMode: 'trusted' },
      scan: { ignore: ['.git/', 'build/'] },
    });

    expect(merged.tcp.editorPort).toBe(9600);
    expect(merged.tcp.runtimePort).toBe(base.tcp.runtimePort);
    expect(merged.security.allowWrite).toBe(true);
    expect(merged.security.trustMode).toBe('trusted');
    expect(merged.scan.ignore).toEqual(['.git/', 'build/']);
  });
});
