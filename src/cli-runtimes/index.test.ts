import { describe, it, expect, vi } from 'vitest';
import { getCliRuntime, ClaudeRuntime, CodexRuntime, GeminiRuntime } from './index.js';
vi.mock('child_process', () => ({ execSync: vi.fn(() => '/bin/cli') }));
describe('CliRuntimes', () => {
  it('claude', () => { expect(new ClaudeRuntime().buildSpawnCommand('m')).toContain('--dangerously-skip-permissions'); });
  it('codex', () => { expect(new CodexRuntime().buildSpawnCommand('m')).toContain('--full-auto'); });
  it('gemini', () => { expect(new GeminiRuntime().buildSpawnCommand('m')).toContain('--model'); });
  it('factory', () => { expect(getCliRuntime('claude')).toBeInstanceOf(ClaudeRuntime); });
});
