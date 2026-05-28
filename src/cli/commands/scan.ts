import { loadTargets } from '../../config/targets.js';
import { generateScanCandidates } from '../../rules/scan-candidates.js';
import { CaliforniaParksProvider } from '../../providers/california-parks-provider.js';
import type { ScanResult } from '../../types/scanner.js';

export async function scanCommand(options?: { debug?: boolean }): Promise<void> {
  console.log('\n🔍 Availability Scanner\n');

  const targets = loadTargets();
  const provider = new CaliforniaParksProvider();
  const debugMode = options?.debug ?? false;

  const allResults: ScanResult[] = [];

  for (const target of targets) {
    console.log(`\nScanning: ${target.name}`);
    const candidates = generateScanCandidates(target);
    console.log(`  Generated ${candidates.length} scan candidates`);

    const results = await provider.scan(target, candidates, debugMode);
    allResults.push(...results);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('Scan Results\n');

  const matches = allResults.filter((r) => r.parsingNotes.includes('🎯 MATCH'));
  if (matches.length > 0) {
    console.log(`🎯 ${matches.length} MATCH(ES) FOUND!\n`);
    for (const result of matches) {
      printResult(result);
    }
    console.log('');
  }

  const noMatches = allResults.filter((r) => !r.parsingNotes.includes('🎯 MATCH'));
  if (noMatches.length > 0) {
    console.log(`📋 ${noMatches.length} scans with no matches\n`);
    // Only show a summary for non-matches to avoid clutter
    for (const result of noMatches.slice(0, 5)) {
      console.log(
        `  ${result.candidate.arrivalDate} (${result.candidate.nights}N): ${result.parsingNotes}`
      );
    }
    if (noMatches.length > 5) {
      console.log(`  ... and ${noMatches.length - 5} more`);
    }
    console.log('');
  }

  console.log('═'.repeat(80) + '\n');
}

function printResult(result: ScanResult): void {
  console.log(`  ${result.candidate.arrivalDate} → ${result.candidate.endDate}`);
  console.log(`  ${result.targetName}`);
  console.log(`  ${result.parsingNotes}`);

  if (result.bookingUrl) {
    console.log(`  📅 Book: ${result.bookingUrl}`);
  }

  if (result.siteStatuses && result.siteStatuses.length > 0) {
    console.log('  Sites by date:');
    const byDate = new Map<string, typeof result.siteStatuses>();
    for (const status of result.siteStatuses) {
      const dateStatuses = byDate.get(status.siteName) || [];
      dateStatuses.push(status);
      byDate.set(status.siteName, dateStatuses);
    }

    for (const [siteName, statuses] of byDate) {
      const statusStr = statuses
        .map((s) => {
          if (s.status === 'available') return '✓';
          if (s.status === 'unavailable') return '✗';
          return '?';
        })
        .join('');
      console.log(`    ${siteName}: ${statusStr}`);
    }
  }

  if (result.debugHtmlPath) {
    console.log(`  📄 Debug: ${result.debugHtmlPath}`);
  }

  console.log('');
}
