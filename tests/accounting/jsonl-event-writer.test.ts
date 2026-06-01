import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonlEventWriter } from '../../src/accounting/jsonl-event-writer';

describe('JsonlEventWriter', () => {
  it('should append events as JSON lines and create log directory', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latency-jsonl-'));
    const writer = new JsonlEventWriter({ logDir: path.join(dir, 'logs'), filePrefix: 'latency-arb-orders' });

    writer.write({ eventType: 'signal', timestamp: 1700000000000, value: 1 });
    writer.write({ eventType: 'skip', timestamp: 1700000001000, reason: 'test' });

    const filePath = writer.getCurrentFilePath();
    expect(fs.existsSync(filePath)).toBe(true);

    const lines = fs.readFileSync(filePath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0])).toEqual({ eventType: 'signal', timestamp: 1700000000000, value: 1 });
    expect(JSON.parse(lines[1])).toEqual({ eventType: 'skip', timestamp: 1700000001000, reason: 'test' });
  });

  it('should use date from injected clock in file name', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'latency-jsonl-'));
    const writer = new JsonlEventWriter({
      logDir: dir,
      filePrefix: 'latency-arb-orders',
      nowFn: () => new Date('2026-06-01T12:00:00Z'),
    });

    expect(path.basename(writer.getCurrentFilePath())).toBe('latency-arb-orders-2026-06-01.jsonl');
  });
});
