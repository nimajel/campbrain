import { loadTargets } from '../../config/targets.js';
import { generateScanCandidates } from '../../rules/scan-candidates.js';
import { CaliforniaParksProvider } from '../../providers/california-parks-provider.js';
import type { ScanResult, DailySiteStatus } from '../../types/scanner.js';

export async function scanCommand(options?: { debug?: boolean }): Promise<void> {
  console.log('\n🔍 Availability Scanner\n');

  const targets = loadTargets();
  const provider = new CaliforniaParksProvider();
  const debugMode = options?.debug ?? false;

  const allResults: ScanResult[] = [];

  for (const target of targets) {
    console.log(`Scanning: ${target.name}`);
    const candidates = generateScanCandidates(target);
    console.log(`  ${candidates.length} candidates`);

    const results = await provider.scan(target, candidates, debugMode);
    allResults.push(...results);
  }

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

  // Summary of non-matches (compact)
  if (nonMatches.length > 0) {
    console.log(`📋 ${nonMatches.length} scans with no matches`);
    const limitedSample = nonMatches.slice(0, 3);
    for (const r of limitedSample) {
      const range = `${r.candidate.arrivalDate} (${r.candidate.nights}N)`;
      console.log(`  ${range}: ${r.parsingNotes}`);
    }
    if (nonMatches.length > 3) {
      console.log(`  … and ${nonMatches.length - 3} more`);
    }
  }

  console.log('\n' + '═'.repeat(72) + '\n');
}

function printMatch(result: ScanResult): void {
  const { candidate, targetName, sourceUrl, bookingUrl, statusBySite, debugHtmlPath } =
    result;

  console.log(`  Target:  ${targetName}`);
  console.log(`  Dates:   ${candidate.arrivalDate} → ${candidate.endDate} (${candidate.nights}N)`);
  console.log(`  URL:     ${sourceUrl}`);
  if (bookingUrl) console.log(`  Book:    ${bookingUrl}`);

  if (statusBySite && statusBySite.size > 0) {
    console.log('  Sites:');
    for (const [siteName, statuses] of statusBySite) {
      const row = statuses.map(statusIcon).join(' ');
      const dates = statuses.map((s) => s.date.slice(5)).join(' '); // MM-DD
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
