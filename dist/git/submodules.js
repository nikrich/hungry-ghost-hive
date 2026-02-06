import { execa } from 'execa';
import { existsSync } from 'fs';
import { join } from 'path';
/**
 * Add a git submodule
 */
export async function addSubmodule(rootDir, url, path, branch = 'main') {
    const fullPath = join(rootDir, path);
    if (existsSync(fullPath)) {
        throw new Error(`Path already exists: ${fullPath}`);
    }
    await execa('git', ['submodule', 'add', '-b', branch, url, path], {
        cwd: rootDir,
    });
}
/**
 * Initialize submodules
 */
export async function initSubmodules(rootDir) {
    await execa('git', ['submodule', 'init'], { cwd: rootDir });
}
/**
 * Update submodules
 */
export async function updateSubmodules(rootDir, recursive = true) {
    const args = ['submodule', 'update'];
    if (recursive) {
        args.push('--recursive');
    }
    await execa('git', args, { cwd: rootDir });
}
/**
 * Initialize and update submodules
 */
export async function initAndUpdateSubmodules(rootDir) {
    await execa('git', ['submodule', 'update', '--init', '--recursive'], {
        cwd: rootDir,
    });
}
/**
 * Remove a submodule
 */
export async function removeSubmodule(rootDir, path) {
    // Deinitialize the submodule
    await execa('git', ['submodule', 'deinit', '-f', path], { cwd: rootDir });
    // Remove from .git/modules
    await execa('git', ['rm', '-f', path], { cwd: rootDir });
}
/**
 * List all submodules
 */
export async function listSubmodules(rootDir) {
    try {
        const { stdout } = await execa('git', ['submodule', 'status'], {
            cwd: rootDir,
        });
        if (!stdout.trim()) {
            return [];
        }
        const submodules = [];
        for (const line of stdout.split('\n')) {
            const match = line.match(/^[\s+-]?([a-f0-9]+)\s+(\S+)(?:\s+\((.+)\))?/);
            if (match) {
                const [, commit, path, branch] = match;
                submodules.push({
                    path,
                    url: await getSubmoduleUrl(rootDir, path),
                    branch: branch?.replace('heads/', ''),
                    commit,
                });
            }
        }
        return submodules;
    }
    catch {
        return [];
    }
}
/**
 * Get the URL of a submodule
 */
export async function getSubmoduleUrl(rootDir, path) {
    try {
        const { stdout } = await execa('git', [
            'config', '--file', '.gitmodules',
            `submodule.${path}.url`,
        ], { cwd: rootDir });
        return stdout.trim();
    }
    catch {
        return '';
    }
}
/**
 * Check if a path is a submodule
 */
export async function isSubmodule(rootDir, path) {
    const submodules = await listSubmodules(rootDir);
    return submodules.some(s => s.path === path);
}
/**
 * Sync submodule URLs
 */
export async function syncSubmodules(rootDir) {
    await execa('git', ['submodule', 'sync'], { cwd: rootDir });
}
/**
 * Fetch updates for all submodules
 */
export async function fetchSubmodules(rootDir) {
    await execa('git', ['submodule', 'foreach', 'git', 'fetch'], {
        cwd: rootDir,
    });
}
//# sourceMappingURL=submodules.js.map