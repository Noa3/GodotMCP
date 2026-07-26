import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { collectDoctorReport, formatDoctorReport } from '../cli/commands/doctor';

const fixtureRoot = path.join(process.cwd(), '.test-artifacts', 'doctor-fixture');

describe('doctor command', () => {
  beforeAll(async () => {
    await rm(fixtureRoot, { recursive: true, force: true });
    await mkdir(path.join(fixtureRoot, 'addons', 'godot_universal_mcp'), { recursive: true });
    await mkdir(path.join(fixtureRoot, '.vscode'), { recursive: true });
    await writeFile(path.join(fixtureRoot, 'project.godot'), '[application]\nconfig/name="Fixture"\n');
    await writeFile(path.join(fixtureRoot, 'addons', 'godot_universal_mcp', 'plugin.cfg'), '[plugin]\nname="Fixture"\n');
    await writeFile(path.join(fixtureRoot, '.vscode', 'mcp.json'), '{"servers":{}}\n');
  });

  afterAll(async () => {
    await rm(path.join(process.cwd(), '.test-artifacts'), { recursive: true, force: true });
  });

  test('returns structured report', async () => {
    const report = await collectDoctorReport(fixtureRoot);
    expect(report.projectPath).toBe(fixtureRoot);
    expect(report.checks.some((check) => check.name === 'project-file' && check.ok)).toBe(true);
    expect(formatDoctorReport(report, true)).toContain('"checks"');
  });
});
