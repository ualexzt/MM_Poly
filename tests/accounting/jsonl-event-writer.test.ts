import fs from 'fs';
import os from 'os';
import path from 'path';
import { JsonlEventWriter } from '../../src/accounting/jsonl-event-writer';

describe('JsonlEventWriter', () => {
  it('writes one JSON object per line to a UTC-dated file', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jsonl-writer-'));
    const writer = new JsonlEventWriter({
      logDir: dir,
      filePrefix: 'pair-cost',
      nowFn: () => new Date('2026-06-02T12:00:00.000Z'),
    });

    expect(writer.write({ eventType: 'startup', value: 1 })).toBe(true);
    expect(writer.write({ eventType: 'scan', value: 2 })).toBe(true);

    const file = path.join(dir, 'pair-cost-2026-06-02.jsonl');
    expect(fs.readFileSync(file, 'utf8')).toBe(
      '{"eventType":"startup","value":1}\n{"eventType":"scan","value":2}\n',
    );
  });
});
