export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export declare function setLogLevel(level: LogLevel): void;
export declare function getLogLevel(): LogLevel;
export declare function debug(message: string, ...args: unknown[]): void;
export declare function info(message: string, ...args: unknown[]): void;
export declare function success(message: string, ...args: unknown[]): void;
export declare function warn(message: string, ...args: unknown[]): void;
export declare function error(message: string, ...args: unknown[]): void;
export declare function highlight(text: string): string;
export declare function dim(text: string): string;
export declare function bold(text: string): string;
export declare function statusColor(status: string): string;
//# sourceMappingURL=logger.d.ts.map