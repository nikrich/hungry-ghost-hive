import { CliRuntimeType, CliRuntimeBuilder } from './types.js';
/**
 * Factory function to get the appropriate CLI runtime builder
 * @param runtimeType - The type of CLI runtime to use
 * @returns The corresponding runtime builder instance
 * @throws Error if the runtime type is unknown
 */
export declare function getCliRuntimeBuilder(runtimeType: CliRuntimeType): CliRuntimeBuilder;
/**
 * Validate that a CLI binary is available in the system PATH
 * @param binary - The name of the binary to check
 * @returns Promise that resolves to true if binary exists, false otherwise
 */
export declare function validateCliBinary(binary: string): Promise<boolean>;
/**
 * Validate that the CLI runtime binary is available
 * @param runtimeType - The type of CLI runtime to validate
 * @returns Promise that resolves to true if binary exists, false otherwise
 */
export declare function validateCliRuntime(runtimeType: CliRuntimeType): Promise<boolean>;
export type { CliRuntimeType, CliRuntimeBuilder };
export { ClaudeRuntimeBuilder } from './claude.js';
export { CodexRuntimeBuilder } from './codex.js';
export { GeminiRuntimeBuilder } from './gemini.js';
//# sourceMappingURL=index.d.ts.map