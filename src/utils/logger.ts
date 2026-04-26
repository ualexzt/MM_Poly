export interface Logger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  trace(trace: unknown): void;
}

export class ConsoleLogger implements Logger {
  info(message: string, meta?: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: 'info', time: Date.now(), message, ...meta }));
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.log(JSON.stringify({ level: 'warn', time: Date.now(), message, ...meta }));
  }

  error(message: string, meta?: Record<string, unknown>): void {
    console.error(JSON.stringify({ level: 'error', time: Date.now(), message, ...meta }));
  }

  trace(trace: unknown): void {
    console.log(JSON.stringify({ level: 'trace', time: Date.now(), ...trace }));
  }
}

export const defaultLogger: Logger = new ConsoleLogger();
