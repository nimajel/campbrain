# Alert Scanner Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the saved-target alert scanner per the approved spec: cache-backed matching (no live fetches), hit lifecycle with at-least-once email delivery, freshness disclosure, an upgraded Recent-openings dashboard panel, a `notify-test` command, and removal of the live-fetch provider path.

**Architecture:** A new pure matcher (`src/scanner/match-candidates.ts`) evaluates candidates against `AvailabilityWindowEntry[]` from Postgres; `reconcileHits` (replacing `findNewHits`/`mergeHits`) owns prune/dedup/reappear/retry; `NotificationService.notify` returns a `DeliveryResult` that gates `notifiedAt` stamping. Hits state migrates to `version: 2` with a one-time `notifiedAt` backfill.

**Tech Stack:** Node 18 + TypeScript strict, Vitest, Resend, Next.js 15 (dashboard panel).

**Spec:** `docs/superpowers/specs/2026-06-09-alert-scanner-completion-design.md`

**Parallel-session guard:** Another session owns `web/app/map/**`, `web/app/api/map/**`, and `web/app/globals.css`. This plan must not touch those paths. Web changes are limited to `web/lib/state.ts`, `web/app/page.tsx`, `web/app/alerts/page.tsx`.

**Commit policy (user preference):** No auto-commits; single user checkpoint at the end.

**Deviations from spec (conscious):**
- Component 6's `web/lib/hits.ts` is folded into the existing `web/lib/state.ts` (it already owns hits-state reading; prefer editing existing files). The dashboard's existing "Recent Hits" table is upgraded in place.
- `HitsState` gains `version: 2` to make the rollout backfill explicit and testable (spec's "first load" rule, mechanized).

---

### Task 1: `availabilityAsOf` on the result types

**Files:**
- Modify: `src/types/scanner.ts` (`ScanResult`, `ScanResultJSON`, `serializeResult`)

- [ ] **Step 1:** Add `availabilityAsOf?: string; // ISO 8601 — oldest covering cache window` to `ScanResult` (after `bookingUrl?`) and to `ScanResultJSON`.
- [ ] **Step 2:** In `serializeResult`, after the `bookingUrl` line add:

```ts
if (r.availabilityAsOf !== undefined) out.availabilityAsOf = r.availabilityAsOf;
```

- [ ] **Step 3:** `npm run typecheck` — clean.

---

### Task 2: Cache-backed matcher (TDD)

**Files:**
- Create: `src/scanner/match-candidates.ts`
- Test: `test/match-candidates.test.ts`

- [ ] **Step 1: Write failing tests.** Build minimal `AvailabilityWindowEntry` fixtures inline (shape: `{ parkPageId, parkName, windowStart, windowEnd, scannedAt, sourceUrl, campgrounds: [{ id, name, bookingUrl?, sites: [{ name, dates: Record<date,status> }] }] }`). Target fixture: `{ id: 't1', name: 'Test', provider: 'california-parks', parkName: 'Park', parkPageId: '468', campgroundName: 'Ridge (sites 4-6)', acceptableSites: ['Campsite #4', 'Campsite #5'], ... }` (satisfy the `Alert` type with required fields).

Cases:
1. hit: site available all stay nights → one `ScanResult` with `hits` = matching sites, `bookingUrl` from campground, `scannedAt` ≈ now, `availabilityAsOf` = window's `scannedAt`
2. no-hit: site unavailable on one night → `hits: []`
3. stay spanning two windows → site available across both → hit; `availabilityAsOf` = the **older** of the two `scannedAt`s
4. `acceptableSites` intersection: available site not in `acceptableSites` → not a hit
5. campground-name mismatch → no hits
6. walk-up site name (e.g. `'Hike or Bike Campsite #HB1'`) → never a hit even if available
7. park absent from cache (empty windows array) → returns one result per candidate with `hits: []`, no throw

- [ ] **Step 2:** `npx vitest run test/match-candidates.test.ts` — FAIL (module missing).
- [ ] **Step 3: Implement.**

```ts
// src/scanner/match-candidates.ts
import { getAvailableSitesForStay } from '../cache/availability-cache.js';
import type { AvailabilityWindowEntry } from '../cache/types.js';
import { classifySite } from '../catalog/site-classifier.js';
import type { Alert } from '../config/alerts.js';
import type { ScanCandidate, ScanResult } from '../types/scanner.js';

function stayDates(arrivalDate: string, nights: number): string[] {
  const dates: string[] = [];
  const d = new Date(arrivalDate + 'T00:00:00');
  for (let i = 0; i < nights; i++) {
    dates.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return dates;
}

/** Oldest scannedAt among windows overlapping the stay — most conservative freshness. */
function oldestCoveringScan(windows: AvailabilityWindowEntry[], dates: string[]): string | undefined {
  const covering = windows.filter((w) => dates.some((d) => d >= w.windowStart && d <= w.windowEnd));
  if (covering.length === 0) return undefined;
  return covering.map((w) => w.scannedAt).sort()[0];
}

/**
 * Pure, cache-backed candidate matcher. No network, no filesystem.
 * Walk-up sites are filtered defensively even though the cache should
 * already exclude them from bookable pools.
 */
export function matchCandidates(
  target: Alert,
  candidates: ScanCandidate[],
  windows: AvailabilityWindowEntry[],
  now: string = new Date().toISOString(),
): ScanResult[] {
  return candidates.map((candidate) => {
    const dates = stayDates(candidate.arrivalDate, candidate.nights);
    const stays = getAvailableSitesForStay(windows, candidate.arrivalDate, candidate.nights);
    const cg = stays.find((s) => s.campgroundName === target.campgroundName);

    const available = (cg?.availableSites ?? []).filter(
      (name) => !classifySite(name, target.campgroundName).isWalkUp
    );
    const acceptable = new Set(target.acceptableSites);
    const hits = available
      .filter((name) => acceptable.has(name))
      .map((siteName) => ({ siteName, status: 'available', confidence: 'high' as const }));

    const result: ScanResult = {
      targetId: target.id,
      targetName: target.name,
      candidate,
      sourceUrl: windows[0]?.sourceUrl ?? '',
      debugHtmlPath: '',
      hits,
      parsingNotes: 'cache-backed',
      scannedAt: now,
    };
    if (cg?.bookingUrl !== undefined) result.bookingUrl = cg.bookingUrl;
    const asOf = oldestCoveringScan(windows, dates);
    if (asOf !== undefined) result.availabilityAsOf = asOf;
    return result;
  });
}
```

- [ ] **Step 4:** `npx vitest run test/match-candidates.test.ts` — PASS.

---

### Task 3: Hit lifecycle — `reconcileHits` + state v2 (TDD)

**Files:**
- Modify: `src/state/scan-state.ts`
- Test: `test/reconcile-hits.test.ts` (new; existing `test/scan-state.test.ts` untouched until Task 5)

- [ ] **Step 1:** Extend `AvailabilityHitRecord` with `notifiedAt?: string; disappearedAt?: string; availabilityAsOf?: string;` and `HitsState` with `version?: number;`.

- [ ] **Step 2:** Migrate in `readHitsState`: after parsing, if `state.version !== 2`, backfill `notifiedAt = lastSeenAt` on every hit lacking it, set `version = 2`. `writeHitsState` always writes `version: 2`. Empty default becomes `{ version: 2, hits: [] }`.

- [ ] **Step 3: Write failing tests** for `reconcileHits(existing, incoming, checkedKeys, now, today)`:
1. brand-new key → in `merged`, in `toNotify`
2. already present + `notifiedAt` set → `lastSeenAt` updated, NOT in `toNotify`
3. present in existing, absent from incoming, key in `checkedKeys` → `disappearedAt` set, not in `toNotify`
4. previously `disappearedAt`, present in incoming → `disappearedAt` cleared, in `toNotify` (reappeared)
5. existing hit with no `notifiedAt` (failed send last cycle), still present → in `toNotify` (retry)
6. `arrivalDate < today` → pruned from `merged`
7. absent + NOT in `checkedKeys` (park not scanned this run) → untouched, no `disappearedAt`
8. `readHitsState` v1→v2 migration: legacy file without `version` → all hits get `notifiedAt`; v2 file → unchanged

- [ ] **Step 4: Implement** `reconcileHits` in `scan-state.ts`:

```ts
export function reconcileHits(
  existing: HitsState,
  incoming: AvailabilityHitRecord[],
  checkedKeys: Set<string>,
  now: string,
  today: string,
): { merged: HitsState; toNotify: AvailabilityHitRecord[] } {
  const map = new Map<string, AvailabilityHitRecord>();
  for (const h of existing.hits) {
    if (h.arrivalDate < today) continue; // prune past stays
    map.set(hitKey(h), h);
  }

  const incomingKeys = new Set<string>();
  const toNotifyKeys = new Set<string>();

  for (const h of incoming) {
    const key = hitKey(h);
    incomingKeys.add(key);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, h);
      toNotifyKeys.add(key);
    } else if (prev.disappearedAt) {
      const { disappearedAt: _gone, ...rest } = prev;
      map.set(key, { ...rest, lastSeenAt: h.lastSeenAt, availabilityAsOf: h.availabilityAsOf ?? prev.availabilityAsOf });
      toNotifyKeys.add(key); // reappeared
    } else {
      map.set(key, { ...prev, lastSeenAt: h.lastSeenAt, availabilityAsOf: h.availabilityAsOf ?? prev.availabilityAsOf });
    }
  }

  for (const [key, h] of map) {
    if (!incomingKeys.has(key) && checkedKeys.has(key) && !h.disappearedAt) {
      map.set(key, { ...h, disappearedAt: now });
    }
  }

  // At-least-once: anything retained, visible, and never successfully notified retries.
  for (const [key, h] of map) {
    if (!h.notifiedAt && !h.disappearedAt) toNotifyKeys.add(key);
  }

  const hits = Array.from(map.values()).sort((a, b) => {
    const d = b.arrivalDate.localeCompare(a.arrivalDate);
    return d !== 0 ? d : a.siteName.localeCompare(b.siteName);
  });
  return {
    merged: { version: 2, hits },
    toNotify: hits.filter((h) => toNotifyKeys.has(hitKey(h))),
  };
}
```

Also extend `resultsToHitRecords` to copy `availabilityAsOf` from each result onto its records.

- [ ] **Step 5:** `npx vitest run test/reconcile-hits.test.ts` — PASS. (`findNewHits`/`mergeHits` stay until Task 5.)

---

### Task 4: Notification delivery contract (TDD)

**Files:**
- Modify: `src/notifications/notification-service.ts`, `email-notification-service.ts`, `console-notification-service.ts`
- Test: extend `test/notification.test.ts`

- [ ] **Step 1:** Contract:

```ts
export type DeliveryResult = 'delivered' | 'skipped-unconfigured' | 'failed';
export interface NotificationService {
  notify(alerts: AvailabilityAlert[]): Promise<DeliveryResult>;
}
```

`AvailabilityAlert` gains `availabilityAsOf?: string;`.

- [ ] **Step 2:** Console service returns `'delivered'`. Email service returns `'skipped-unconfigured'` when env is missing, `'failed'` on Resend `error` **or thrown exception** (wrap send in try/catch), `'delivered'` on success; empty input → `'delivered'`.
- [ ] **Step 3:** Email body: after the `Checked:` line add, when `a.availabilityAsOf` is set:

```ts
lines.push(`As of:      ${new Date(a.availabilityAsOf).toLocaleString('en-US', { timeZone: 'America/Los_Angeles', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })} — verify on the booking site before booking.`);
```

- [ ] **Step 4:** Extend `test/notification.test.ts`: `buildEmailBody` includes the "As of:" line when set / omits when absent; email service returns `skipped-unconfigured` with env unset. Run file — PASS.

---

### Task 5: `runScan` rewrite

**Files:**
- Modify: `src/scanner/run-scan.ts`
- Modify: `test/scan-state.test.ts` (drop `findNewHits`/`mergeHits` tests), `src/state/scan-state.ts` (delete both fns)
- Test: `test/worker.test.ts` likely mocks — check and update imports

- [ ] **Step 1:** Rewrite the per-alert loop:
  - Drop `getProvider` + `provider.scan`.
  - Group `alerts` by `(parkPageId, provider)`; `await getEntriesForPark(parkPageId, provider)` once per group inside try/catch (on error: log, mark those targets skipped, continue).
  - Per alert: `const results = matchCandidates(alert, candidates, windows)`; serialize; `writeLatestScan` as before.
  - Collect ALL alerts' `incoming` + `checkedKeys` (every `${alert.id}|${hit possible key}`… concretely: for every candidate × acceptableSite of scanned alerts, add `` `${alert.id}|${site}|${c.arrivalDate}|${c.endDate}` ``), then call `reconcileHits` ONCE after the loop with `now` + `today`; `writeHitsState(stateDir, merged)`.
  - Build notify items from `toNotify` (join back to each alert by `targetId` for park/campground names; carry `availabilityAsOf` from the hit record).
- [ ] **Step 2:** Stamping: send console batch (best effort, ignore result). Send email batch (only hits whose alert has `emailEnabled`); on `'delivered'` or `'skipped-unconfigured'` set `notifiedAt = now` on those hit records in `merged` and re-`writeHitsState`; on `'failed'` leave unset. Hits notify-eligible but email-disabled: stamp `notifiedAt` after console output (console is their only channel).
- [ ] **Step 3:** Delete `findNewHits` and `mergeHits` from `scan-state.ts`; update `test/scan-state.test.ts` (keep `resultsToHitRecords`, `buildScanSummary`, read/write tests).
- [ ] **Step 4:** `npm run typecheck` + `npm test` — green.

---

### Task 6: Retire the live-fetch provider path

**Files:**
- Modify: `src/providers/availability-provider.ts` (drop `scan` from the interface)
- Modify: `src/providers/california-parks-provider.ts`, `src/providers/recreation-gov-provider.ts` (delete `scan` + private `scanCandidate` + now-unused imports/helpers — verify each helper isn't used by the proactive path before deleting)
- Check: `test/provider.test.ts`, `test/recreation-gov-provider.test.ts` for `scan(`-dependent tests; convert or delete those cases

- [ ] **Step 1:** Remove interface method; remove implementations.
- [ ] **Step 2:** `npm run typecheck` — chase any stragglers.
- [ ] **Step 3:** `npm test` — green.

---

### Task 7: `notify-test` command

**Files:**
- Create: `src/cli/commands/notify-test.ts`
- Modify: `src/cli/index.ts`, `package.json` (add `"notify-test": "tsx src/cli/index.ts notify-test"` mirroring existing script style)

- [ ] **Step 1:** Command builds one sample `AvailabilityAlert` (fake hit, `availabilityAsOf` = now) and runs Console + Email services, printing each `DeliveryResult`. Exit code 0 regardless of `skipped-unconfigured`; exit 1 only on `failed`.
- [ ] **Step 2:** Wire into `src/cli/index.ts` following the existing command-registration pattern.
- [ ] **Step 3:** Run `npm run notify-test` — console block prints; email line shows `skipped-unconfigured` or `delivered` per env.

---

### Task 8: Dashboard "Recent openings" upgrade

**Files:**
- Modify: `web/lib/state.ts` (add `getActiveOpenings()`: hits with `arrivalDate >= today`, no `disappearedAt`, sorted `firstSeenAt` desc)
- Modify: `web/app/page.tsx` (Recent Hits table → Recent openings: add park/campground columns via alert join on `targetId`, "as of" freshness from `availabilityAsOf ?? lastSeenAt`, Book link when `bookingUrl`; empty state "No openings found yet.")
- Modify: `web/app/alerts/page.tsx` (render the same list below the alerts table)

**Do NOT touch** `web/app/globals.css` (map session owns it) — reuse existing `card`/`table`/`badge` classes only.

- [ ] **Step 1:** Implement reader + dashboard table.
- [ ] **Step 2:** `/alerts` section.
- [ ] **Step 3:** Visual check on the verify server (port 3002): dashboard renders with zero/active hits; no console errors.

---

### Task 9: Full verification + docs

- [ ] **Step 1:** `npm run typecheck` — clean.
- [ ] **Step 2:** `npm test` — green (expect ~415+: prior 402 + new matcher/reconcile/notification tests, minus deleted live-scan cases).
- [ ] **Step 3:** Manual: `npm run scan` (one-off) against the live DB — completes in seconds with no HTTP fetches to parks.ca.gov for matching; state files written; `npm run notify-test` behaves.
- [ ] **Step 4:** Update spec status header to "Implemented 2026-06-10"; note the two deviations. Leave CLAUDE.md Next Steps to doc-steward.
- [ ] **Step 5:** Single user checkpoint: present diff summary + ask about committing (coordinate with the map session's pending work).
