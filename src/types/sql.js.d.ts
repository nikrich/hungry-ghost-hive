// Licensed under the Hungry Ghost Hive License. See LICENSE.

declare module 'sql.js' {
  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export interface Statement {
    bind(params?: unknown[]): boolean;
    step(): boolean;
    getAsObject(params?: unknown[]): Record<string, unknown>;
    get(params?: unknown[]): unknown[];
    free(): boolean;
    reset(): void;
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: unknown[]): Database;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsConfig {
    locateFile?: (filename: string) => string;
  }

  export default function initSqlJs(config?: SqlJsConfig): Promise<SqlJsStatic>;
}
