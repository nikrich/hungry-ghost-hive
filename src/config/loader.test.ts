import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { ConfigError, createDefaultConfig, loadConfig, setConfigValue } from './loader.js';

const tempDirs: string[] = [];

function createTempHiveDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'hive-config-test-'));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('config loader model/CLI compatibility', () => {
  it('loads default config with compatible model/cli_tool pairs', () => {
    const hiveDir = createTempHiveDir();
    const config = createDefaultConfig(hiveDir);

    expect(config.models.junior.model).toBe('gpt-4o-mini');
    expect(config.models.junior.cli_tool).toBe('codex');
  });

  it('rejects incompatible model/cli_tool combinations on load', () => {
    const hiveDir = createTempHiveDir();
    const configPath = join(hiveDir, 'hive.config.yaml');

    writeFileSync(
      configPath,
      `
version: "1.0"
models:
  junior:
    provider: openai
    model: gpt-4o-mini
    cli_tool: claude
`,
      'utf-8'
    );

    expect(() => loadConfig(hiveDir)).toThrow(ConfigError);
    expect(() => loadConfig(hiveDir)).toThrow(/models\.junior/);
  });

  it('rejects incompatible updates through setConfigValue', () => {
    const hiveDir = createTempHiveDir();
    const config = createDefaultConfig(hiveDir);

    expect(() => setConfigValue(config, 'models.junior.cli_tool', 'claude')).toThrow(ConfigError);
  });
});
