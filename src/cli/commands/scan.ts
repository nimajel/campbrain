import { runScan } from '../../scanner/run-scan.js';
import { endDb } from '../../cache/db.js';
import type { ScanResult, DailySiteStatus } from '../../types/scanner.js';

export interface ScanCommandOptions {
  debug?: boolean;
  notify?: boolean;
  targetId?: string;
}

export async function scanCommand(options: ScanCommandOptions = {}): Promise<void> {
  console.log('\n🔍 Availability Scanner\n');

  let summary;
  try {
    summary = await runScan({
      debug: options.debug,
      notify: options.notify !== false,
      targetId: options.targetId,
    });
  } finally {
    // The cache-backed scan opens a Postgres pool; close it so the CLI exits promptly.
    await endDb();
  }

  const allResults = summary.targets.flatMap((t) => t.results);
  const matches = allResults.filter((r) => r.hits.length > 0);
  const nonMatches = allResults.filter((r) => r.hits.length === 0);

  console.log('\n' + '═'.repeat(72));

  if (matches.length > 0) {
    console.log(`\n🎯 ${matches.length} MATCH(ES) FOUND\n`);
    for (const r of matches) {
      printMatch(r);
    }
  } else {
    console.log('\nNo matches found.\n');
  }

  if (nonMatches.length > 0) {
    console.log(`📋 ${nonMatches.length} scans with no matches`);
    const sample = nonMatches.slice(0, 3);
    for (const r of sample) {
      const range = `${r.candidate.arrivalDate} (${r.candidate.nights}N)`;
      console.log(`  ${range}: ${r.parsingNotes}`);
    }
    if (nonMatches.length > 3) {
      console.log(`  … and ${nonMatches.length - 3} more`);
    }
  }

  console.log(`\n💾 State saved`);
  console.log('\n' + '═'.repeat(72) + '\n');
}

function printMatch(result: ScanResult): void {
  const { candidate, targetName, sourceUrl, bookingUrl, statusBySite, debugHtmlPath } = result;

  console.log(`  Target:  ${targetName}`);
  console.log(`  Dates:   ${candidate.arrivalDate} → ${candidate.endDate} (${candidate.nights}N)`);
  console.log(`  URL:     ${sourceUrl}`);
  if (bookingUrl) console.log(`  Book:    ${bookingUrl}`);

  if (statusBySite && statusBySite.size > 0) {
    console.log('  Sites:');
    for (const [siteName, statuses] of statusBySite) {
      const row = statuses.map(statusIcon).join(' ');
      const dates = statuses.map((s) => s.date.slice(5)).join(' ');
      console.log(`    ${siteName}`);
      console.log(`      dates:  ${dates}`);
      console.log(`      status: ${row}`);
    }
  }

  if (debugHtmlPath) console.log(`  Debug:   ${debugHtmlPath}`);
  console.log('');
}

function statusIcon(ds: DailySiteStatus): string {
  if (ds.status === 'available') return '✓';
  if (ds.status === 'unavailable') return '✗';
  return '?';
}
