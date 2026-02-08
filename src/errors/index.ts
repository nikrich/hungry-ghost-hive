// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Base error class for all Hive errors
 */
export class HiveError extends Error {
  public readonly code: string;

  constructor(message: string, code: string = 'HIVE_ERROR') {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    Object.setPrototypeOf(this, HiveError.prototype);
  }
}

/**
 * Configuration-related errors (missing keys, invalid settings, etc.)
 */
export class ConfigurationError extends HiveError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
    Object.setPrototypeOf(this, ConfigurationError.prototype);
  }
}

/**
 * Validation errors (incompatible inputs, invalid values, etc.)
 */
export class ValidationError extends HiveError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

/**
 * File system operation errors (path conflicts, permission issues, etc.)
 */
export class FileSystemError extends HiveError {
  constructor(message: string) {
    super(message, 'FILE_SYSTEM_ERROR');
    Object.setPrototypeOf(this, FileSystemError.prototype);
  }
}

/**
 * Concurrency/lock-related errors
 */
export class ConcurrencyError extends HiveError {
  constructor(message: string) {
    super(message, 'CONCURRENCY_ERROR');
    Object.setPrototypeOf(this, ConcurrencyError.prototype);
  }
}

/**
 * Resource initialization errors (failed to set up databases, providers, etc.)
 */
export class InitializationError extends HiveError {
  constructor(message: string) {
    super(message, 'INITIALIZATION_ERROR');
    Object.setPrototypeOf(this, InitializationError.prototype);
  }
}

/**
 * Runtime operational errors (processes failed, commands failed, etc.)
 */
export class OperationalError extends HiveError {
  constructor(message: string) {
    super(message, 'OPERATIONAL_ERROR');
    Object.setPrototypeOf(this, OperationalError.prototype);
  }
}

/**
 * Unsupported feature errors (unknown CLI types, unsupported providers, etc.)
 */
export class UnsupportedFeatureError extends HiveError {
  constructor(message: string) {
    super(message, 'UNSUPPORTED_FEATURE_ERROR');
    Object.setPrototypeOf(this, UnsupportedFeatureError.prototype);
  }
}

/**
 * Timeout errors (operations that exceed time limits)
 */
export class TimeoutError extends HiveError {
  constructor(message: string) {
    super(message, 'TIMEOUT_ERROR');
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * Not found errors (resources not found)
 */
export class NotFoundError extends HiveError {
  constructor(message: string) {
    super(message, 'NOT_FOUND_ERROR');
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

/**
 * Database corruption errors (empty DB loaded from non-empty file, parse failures)
 */
export class DatabaseCorruptionError extends HiveError {
  constructor(message: string) {
    super(message, 'DATABASE_CORRUPTION_ERROR');
    Object.setPrototypeOf(this, DatabaseCorruptionError.prototype);
  }
}

/**
 * Helper function to convert generic errors to Hive errors
 */
export function toHiveError(error: unknown, fallbackType: typeof HiveError = HiveError): HiveError {
  if (error instanceof HiveError) {
    return error;
  }
  if (error instanceof Error) {
    return new fallbackType(error.message);
  }
  return new fallbackType(String(error));
}
