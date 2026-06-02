import { readFileSync } from 'node:fs';
import { summarizePairCostAnalyticsEvents } from '../analytics/pair-cost-analytics-summary';

function main(): void {
  const path = process.argv[2];
  if (!path) {
    console.error('Usage: node dist/scripts/summarize-pair-cost-analytics.js <pair-cost-jsonl>');
    process.exit(1);
  }

  const events: Record<string, unknown>[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Ignore malformed lines so one bad write does not block reporting.
    }
  }

  console.log(JSON.stringify(summarizePairCostAnalyticsEvents(events), null, 2));
}

main();
