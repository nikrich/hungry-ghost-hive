// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getParentMcpConfig } from './mcp-config.js';

describe('getParentMcpConfig', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-config-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return null when .claude directory does not exist', () => {
    const result = getParentMcpConfig(tempDir);
    expect(result).toBeNull();
  });

  it('should return null when settings files do not exist', () => {
    mkdirSync(join(tempDir, '.claude'), { recursive: true });
    const result = getParentMcpConfig(tempDir);
    expect(result).toBeNull();
  });

  it('should return null when settings.json has no mcpServers', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ someOtherKey: true }));

    const result = getParentMcpConfig(tempDir);
    expect(result).toBeNull();
  });

  it('should return null when mcpServers is empty', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ mcpServers: {} }));

    const result = getParentMcpConfig(tempDir);
    expect(result).toBeNull();
  });

  it('should return MCP config from settings.json', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const mcpServers = {
      myServer: { command: 'node', args: ['server.js'] },
    };
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ mcpServers }));

    const result = getParentMcpConfig(tempDir);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual(mcpServers);
  });

  it('should return MCP config from settings.local.json', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    const mcpServers = {
      localServer: { command: 'python', args: ['serve.py'] },
    };
    writeFileSync(join(claudeDir, 'settings.local.json'), JSON.stringify({ mcpServers }));

    const result = getParentMcpConfig(tempDir);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual(mcpServers);
  });

  it('should merge MCP config from both settings files', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({ mcpServers: { server1: { command: 'cmd1' } } })
    );
    writeFileSync(
      join(claudeDir, 'settings.local.json'),
      JSON.stringify({ mcpServers: { server2: { command: 'cmd2' } } })
    );

    const result = getParentMcpConfig(tempDir);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({
      server1: { command: 'cmd1' },
      server2: { command: 'cmd2' },
    });
  });

  it('should let settings.local.json override settings.json for same key', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(
      join(claudeDir, 'settings.json'),
      JSON.stringify({ mcpServers: { server1: { command: 'original' } } })
    );
    writeFileSync(
      join(claudeDir, 'settings.local.json'),
      JSON.stringify({ mcpServers: { server1: { command: 'override' } } })
    );

    const result = getParentMcpConfig(tempDir);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({
      server1: { command: 'override' },
    });
  });

  it('should ignore malformed JSON gracefully', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), 'not valid json{{{');
    writeFileSync(
      join(claudeDir, 'settings.local.json'),
      JSON.stringify({ mcpServers: { server1: { command: 'cmd1' } } })
    );

    const result = getParentMcpConfig(tempDir);
    expect(result).not.toBeNull();
    expect(JSON.parse(result!)).toEqual({ server1: { command: 'cmd1' } });
  });

  it('should return null when mcpServers is not an object', () => {
    const claudeDir = join(tempDir, '.claude');
    mkdirSync(claudeDir, { recursive: true });
    writeFileSync(join(claudeDir, 'settings.json'), JSON.stringify({ mcpServers: 'not-object' }));

    const result = getParentMcpConfig(tempDir);
    expect(result).toBeNull();
  });
});
