import js from '@eslint/js';
import { createRequire } from 'node:module';
import tseslint from 'typescript-eslint';

const require = createRequire(import.meta.url);
let eslintConfigPrettier = null;
try {
  eslintConfigPrettier = require('eslint-config-prettier');
} catch {
  // Keep lint runnable when optional dev dependency is not installed in this environment.
}

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...(eslintConfigPrettier ? [eslintConfigPrettier] : []),
  {
    ignores: ['dist/**', 'node_modules/**'],
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.test.tsx'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  }
);
