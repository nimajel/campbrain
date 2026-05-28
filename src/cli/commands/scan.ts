import { loadTargets } from '../../config/targets.js';
import { generateScanCandidates } from '../../rules/scan-candidates.js';
import { CaliforniaParksProvider } from '../../providers/california-parks-provider.js';
import type { ScanResult } from '../../types/scanner.js';

export async function scanCommand(): Promise<void> {
  console.log('\n🔍 Availability Scanner\n');

  const targets = loadTargets();
  const provider = new CaliforniaParksProvider();

  const allResults: ScanResult[] = [];

  for (const target of targets) {
    console.log(`\nScanning: ${target.name}`);
    const candidates = generateScanCandidates(target);
    console.log(`  Generated ${candidates.length} scan candidates`);

    const results = await provider.scan(target, candidates);
    allResults.push(...results);
  }

  console.log('\n' + '═'.repeat(80));
  console.log('Scan Results\n');

  for (const result of allResults) {
    console.log(`📍 ${result.targetName}`);
    console.log(`   Arrival: ${result.candidate.arrivalDate} (${result.candidate.nights} night${result.candidate.nights > 1 ? 's' : ''})`);
    console.log(`   URL: ${result.sourceUrl}`);
    console.log(`   Debug: ${result.debugHtmlPath}`);
    console.log(`   Status: ${result.parsingNotes}`);

    if (result.hits.length > 0) {
      console.log('   Sites:');
      for (const hit of result.hits) {
        const confidenceBadge =
          hit.confidence === 'high' ? '✓' : hit.confidence === 'medium' ? '?' : '○';
        console.log(`     ${confidenceBadge} ${hit.siteName}: ${hit.status}`);
      }
    }
    console.log('');
  }

  console.log('═'.repeat(80) + '\n');
}
