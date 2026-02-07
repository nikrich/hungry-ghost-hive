import { describe, expect, it, vi, beforeEach } from 'vitest';
import { validatePullRequest, type PRValidationStatus } from '../../git/github.js';

// Mock the execa function
vi.mock('execa', () => ({
  execa: vi.fn(),
}));

describe('PR Command - Validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('validatePullRequest', () => {
    it('should return successful validation when PR passes all checks', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      // Mock successful responses
      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('state,mergeable')) {
          return {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergeable: 'MERGEABLE',
            }),
          } as any;
        }
        if (args.includes('bucket,name,status')) {
          return {
            stdout: JSON.stringify([
              { name: 'test-check', status: 'SUCCESS', bucket: 'PASS' },
              { name: 'lint-check', status: 'SUCCESS', bucket: 'PASS' },
            ]),
          } as any;
        }
        return { stdout: '[]' } as any;
      });

      const result = await validatePullRequest('/repo', 123);

      expect(result.isOpen).toBe(true);
      expect(result.isMergeable).toBe(true);
      expect(result.ciStatus).toBe('pass');
      expect(result.failedChecks).toEqual([]);
    });

    it('should detect closed PR', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('state,mergeable')) {
          return {
            stdout: JSON.stringify({
              state: 'CLOSED',
              mergeable: 'MERGEABLE',
            }),
          } as any;
        }
        return { stdout: '[]' } as any;
      });

      const result = await validatePullRequest('/repo', 123);

      expect(result.isOpen).toBe(false);
      expect(result.isMergeable).toBe(true);
    });

    it('should detect merge conflicts', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('state,mergeable')) {
          return {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergeable: 'CONFLICTING',
            }),
          } as any;
        }
        return { stdout: '[]' } as any;
      });

      const result = await validatePullRequest('/repo', 123);

      expect(result.isOpen).toBe(true);
      expect(result.isMergeable).toBe(false);
    });

    it('should detect failed CI checks', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('state,mergeable')) {
          return {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergeable: 'MERGEABLE',
            }),
          } as any;
        }
        if (args.includes('bucket,name,status')) {
          return {
            stdout: JSON.stringify([
              { name: 'tests', status: 'FAILURE', bucket: 'FAIL' },
              { name: 'lint', status: 'SUCCESS', bucket: 'PASS' },
            ]),
          } as any;
        }
        return { stdout: '[]' } as any;
      });

      const result = await validatePullRequest('/repo', 123);

      expect(result.ciStatus).toBe('fail');
      expect(result.failedChecks).toEqual(['tests']);
    });

    it('should detect pending CI checks', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('state,mergeable')) {
          return {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergeable: 'MERGEABLE',
            }),
          } as any;
        }
        if (args.includes('bucket,name,status')) {
          return {
            stdout: JSON.stringify([
              { name: 'tests', status: 'PENDING', bucket: 'PENDING' },
              { name: 'lint', status: 'SUCCESS', bucket: 'PASS' },
            ]),
          } as any;
        }
        return { stdout: '[]' } as any;
      });

      const result = await validatePullRequest('/repo', 123);

      expect(result.ciStatus).toBe('pending');
      expect(result.failedChecks).toEqual([]);
    });

    it('should handle multiple failed checks', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('state,mergeable')) {
          return {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergeable: 'MERGEABLE',
            }),
          } as any;
        }
        if (args.includes('bucket,name,status')) {
          return {
            stdout: JSON.stringify([
              { name: 'unit-tests', status: 'FAILURE', bucket: 'FAIL' },
              { name: 'integration-tests', status: 'FAILURE', bucket: 'FAIL' },
              { name: 'lint', status: 'SUCCESS', bucket: 'PASS' },
            ]),
          } as any;
        }
        return { stdout: '[]' } as any;
      });

      const result = await validatePullRequest('/repo', 123);

      expect(result.ciStatus).toBe('fail');
      expect(result.failedChecks).toEqual(['unit-tests', 'integration-tests']);
    });

    it('should handle empty checks response', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('state,mergeable')) {
          return {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergeable: 'MERGEABLE',
            }),
          } as any;
        }
        return { stdout: '[]' } as any;
      });

      const result = await validatePullRequest('/repo', 123);

      expect(result.ciStatus).toBe('unknown');
      expect(result.failedChecks).toEqual([]);
    });

    it('should handle CI check query failure gracefully', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('state,mergeable')) {
          return {
            stdout: JSON.stringify({
              state: 'OPEN',
              mergeable: 'MERGEABLE',
            }),
          } as any;
        }
        if (args.includes('bucket,name,status')) {
          throw new Error('GitHub API error');
        }
        return { stdout: '[]' } as any;
      });

      const result = await validatePullRequest('/repo', 123);

      expect(result.isOpen).toBe(true);
      expect(result.isMergeable).toBe(true);
      expect(result.ciStatus).toBe('unknown');
    });

    it('should throw error when PR query fails', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        if (args.includes('state,mergeable')) {
          throw new Error('PR not found');
        }
        return { stdout: '[]' } as any;
      });

      await expect(validatePullRequest('/repo', 999)).rejects.toThrow('PR not found');
    });

    it('should use stdio pipe for subprocess calls', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[], options: any) => {
        expect(options.stdio).toBe('pipe');
        return {
          stdout: JSON.stringify({
            state: 'OPEN',
            mergeable: 'MERGEABLE',
          }),
        } as any;
      });

      await validatePullRequest('/repo', 123);

      expect(mockExeca).toHaveBeenCalled();
    });

    it('should pass workDir as cwd to execa', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);
      const testDir = '/custom/repo/path';

      mockExeca.mockImplementation(async (cmd: string, args: string[], options: any) => {
        expect(options.cwd).toBe(testDir);
        return {
          stdout: JSON.stringify({
            state: 'OPEN',
            mergeable: 'MERGEABLE',
          }),
        } as any;
      });

      await validatePullRequest(testDir, 123);

      expect(mockExeca).toHaveBeenCalled();
    });

    it('should convert PR number to string in gh command', async () => {
      const { execa } = await import('execa');
      const mockExeca = vi.mocked(execa);

      mockExeca.mockImplementation(async (cmd: string, args: string[]) => {
        // Check that PR number is in args as string
        const prNumberIndex = args.indexOf('123');
        expect(prNumberIndex).toBeGreaterThan(-1);
        return {
          stdout: JSON.stringify({
            state: 'OPEN',
            mergeable: 'MERGEABLE',
          }),
        } as any;
      });

      await validatePullRequest('/repo', 123);

      expect(mockExeca).toHaveBeenCalled();
    });
  });

  describe('PRValidationStatus interface', () => {
    it('should have required properties', () => {
      const status: PRValidationStatus = {
        isOpen: true,
        isMergeable: true,
        ciStatus: 'pass',
        failedChecks: [],
      };

      expect(status.isOpen).toBeDefined();
      expect(status.isMergeable).toBeDefined();
      expect(status.ciStatus).toBeDefined();
      expect(status.failedChecks).toBeDefined();
    });

    it('should support all ciStatus values', () => {
      const statuses: Array<PRValidationStatus['ciStatus']> = [
        'pass',
        'fail',
        'pending',
        'unknown',
      ];

      statuses.forEach(status => {
        expect(['pass', 'fail', 'pending', 'unknown']).toContain(status);
      });
    });
  });
});
