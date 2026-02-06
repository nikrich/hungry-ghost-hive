/**
 * State Detector Factory
 *
 * Factory function to create the appropriate state detector based on CLI type
 */
import { CLIType, StateDetector } from './types.js';
/**
 * Get the appropriate state detector for the specified CLI type
 *
 * @param cliType - The type of CLI to get a detector for
 * @returns StateDetector instance for the specified CLI
 * @throws Error if the CLI type is not supported
 */
export declare function getStateDetector(cliType: CLIType): StateDetector;
/**
 * Check if a CLI type is supported
 *
 * @param cliType - The CLI type to check
 * @returns True if the CLI type is supported
 */
export declare function isSupportedCLI(cliType: string): cliType is CLIType;
//# sourceMappingURL=factory.d.ts.map