import { refreshCatalog } from '../../catalog/refresh-catalog.js';
import { listCatalogParks } from '../../catalog/catalog-store.js';
import type { DiscoveryStatus } from '../../catalog/types.js';

export interface CatalogRefreshOptions {
  park?: string;
  provider?: string;
  force?: boolean;
  maxAgeDays?: number;
}

export async function catalogRefreshCommand(opts: CatalogRefreshOptions = {}): Promise<void> {
  console.log('\n📚 Catalog Refresh\n');

  const summary = await refreshCatalog({
    ...(opts.park !== undefined ? { parkName: opts.park } : {}),
    ...(opts.provider !== undefined ? { provider: opts.provider } : {}),
    ...(opts.force !== undefined ? { force: opts.force } : {}),
    ...(opts.maxAgeDays !== undefined ? { maxAgeDays: opts.maxAgeDays } : {}),
    logger: (m) => console.log(m),
  });

  console.log('\n' + '═'.repeat(60));
  console.log(
    `Attempted ${summary.attempted} · ✅ ${summary.succeeded} succeeded · ❌ ${summary.failed} failed`
  );
  if (summary.failed > 0) {
    console.log('\nFailures:');
    for (const r of summary.results.filter((x) => x.status === 'failed')) {
      console.log(`  • ${r.parkName}: ${r.error}`);
    }
  }
  console.log('');
}

function statusIcon(status: DiscoveryStatus | undefined): string {
  switch (status) {
    case 'success':
      return '✅';
    case 'failed':
      return '❌';
    case 'pending':
      return '⏳';
    default:
      return '⚪';
  }
}

export function catalogListCommand(): void {
  const parks = listCatalogParks();
  console.log('\n📚 Catalog\n');
  console.log('═'.repeat(72));
  for (const p of parks) {
    const siteCount = p.campgrounds.reduce((n, c) => n + c.sites.length, 0);
    const updated = p.lastUpdatedAt ? p.lastUpdatedAt.slice(0, 10) : '—';
    console.log(
      `${statusIcon(p.discoveryStatus)} ${p.parkName}` +
        `\n     ${p.campgrounds.length} campground(s), ${siteCount} site(s) · updated ${updated}` +
        (p.discoveryError ? `\n     ⚠ ${p.discoveryError}` : '')
    );
  }
  console.log('═'.repeat(72));
  console.log(`\n${parks.length} park(s) in catalog\n`);
}
