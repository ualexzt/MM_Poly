import fs from 'fs';
import path from 'path';

export interface JsonlEventWriterConfig {
  logDir: string;
  filePrefix: string;
  nowFn?: () => Date;
  onError?: (error: Error) => void;
}

export class JsonlEventWriter {
  private readonly nowFn: () => Date;

  constructor(private readonly config: JsonlEventWriterConfig) {
    this.nowFn = config.nowFn ?? (() => new Date());
  }

  getCurrentFilePath(): string {
    const date = this.nowFn().toISOString().slice(0, 10);
    return path.join(this.config.logDir, `${this.config.filePrefix}-${date}.jsonl`);
  }

  write(event: Record<string, unknown>): boolean {
    try {
      fs.mkdirSync(this.config.logDir, { recursive: true });
      fs.appendFileSync(this.getCurrentFilePath(), `${JSON.stringify(event)}\n`, 'utf8');
      return true;
    } catch (err) {
      this.config.onError?.(err as Error);
      return false;
    }
  }
}
