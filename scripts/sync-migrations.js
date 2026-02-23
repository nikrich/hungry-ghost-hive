#!/usr/bin/env node

// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { cpSync, mkdirSync, rmSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const sourceDir = join(__dirname, '..', 'src', 'db', 'migrations');
const targetDir = join(__dirname, '..', 'dist', 'db', 'migrations');

// Ensure the output mirrors source exactly to avoid stale or nested migration files.
rmSync(targetDir, { force: true, recursive: true });
mkdirSync(targetDir, { recursive: true });
cpSync(sourceDir, targetDir, { recursive: true });
