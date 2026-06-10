# Alert Scanner Completion — Design

**Date:** 2026-06-09
**Status:** Implemented 2026-06-10 (plan: `docs/superpowers/plans/2026-06-10-alert-scanner-completion.md`).
Deviations: Component 6's `web/lib/hits.ts` folded into the existing `web/lib/state.ts`
(`getActiveOpenings`) + a shared `RecentOpenings` component; `HitsState` gained an explicit
`version: 2` marker to mechanize the rollout backfill. Also converted the web "scan now"
path (`web/lib/scanner.ts`) to the cache-backed matcher — it was a second live-fetch
consumer the design didn't list.
**Parent specs:**
  - [2026-06-02-find-campsites-design.md](2026-06-02-find-campsites-design.md) (search/cache read model)
  - CLAUDE.md → Cache Architecture (Postgres grid), Three Engines (Availability Scanner Engine)

## Why this doc exists

The saved-target **alert scanner** is ~80% built and further along than CLAUDE.md's
`[~] saved-target matching WIP` note implies. End-to-end it already: defines/validates
targets (`data/targets.json`, `AlertSchema`), generates date candidates for all four date
modes (`src/rules/scan-candidates.ts`), evaluates hits, dedups them
(`findNewHits`/`mergeHits` keyed on `target|site|arrival|departure` with
`firstSeenAt`/`lastSeenAt`), notifies via console + email (Resend), and runs on its own
interval inside the `worker`.

The gap is the **data source**: `provider.scan()` does a **live HTTP fetch + HTML re-parse
per candidate**, every cycle — redundant with the per-site/per-day grid the proactive
scanner already stores in Postgres, slower, more fragile, and brushing against the project's
own anti-abusive-scraping guardrails. This design finishes the scanner by pointing matching
at the cached grid, hardens it to consumer-alerting (Google-Flights-style) standards, and
surfaces hits in the UI.

## Goals

1. **Cache-backed matching** — evaluate candidates against the Postgres grid, not live fetches.
2. **Reliable, consumer-grade alerts** — at-least-once delivery; freshness disclosure.
3. **Hit lifecycle hygiene** — prune past hits; re-notify on disappear→reappear.
4. **Visibility** — a "Recent openings" view in the web UI.
5. **Operability** — a `notify-test` command to verify notification config on demand.
6. **Cleanup** — retire the now-redundant live-fetch path.

## Non-goals

- Quiet-hours / digest scheduling. Campsite availability is highly perishable — a site that
  opens can be gone in minutes, so immediate delivery beats politeness. Deliberately skipped
  (YAGNI for a single-user tool); revisit only if alert fatigue becomes real.
- New notification channels (SMS/Slack) — separate roadmap items.
- User-defined saved searches UI — separate roadmap item. This design keeps `data/targets.json`
  as the source of alert definitions.
- Lowering the `worker` interval floor. Cache-backed scans are cheap enough to justify it
  later, but defaults stay unchanged here to keep scope tight.

---

## Architecture

The matcher becomes a **pure, cache-backed** function. The only structural change to
`runScan` is swapping the data source that produces `ScanResult[]`; the hit/state/notify
pipeline downstream is reused.

```
worker (every N min)
  └─ runScan
       ├─ load enabled alerts                         (config/alerts.ts, unchanged)
       ├─ group alerts by parkPageId
       ├─ for each park: getEntriesForPark()          (one Postgres read per park)
       ├─ matchCandidates(target, candidates, windows) (NEW — pure, no network)
       ├─ reconcileHits(existing, incoming, checked)   (NEW — prune + dedup + reappear)
       ├─ writeHitsState / writeLatestScan             (state/scan-state.ts, extended)
       └─ notify(console best-effort; email gating)    (notifications/*, extended for delivery result)
dashboard / /alerts
  └─ web/lib/hits.ts → RecentOpenings panel
```

### Component 1 — Cache-backed matcher (`src/scanner/match-candidates.ts`, new)

Pure function, fully unit-testable, zero I/O:

```ts
matchCandidates(
  target: Target,
  candidates: ScanCandidate[],
  windows: AvailabilityWindowEntry[],
): ScanResult[]
```

For each candidate:
1. `getAvailableSitesForStay(windows, candidate.arrivalDate, candidate.nights)` (existing
   pure fn) → per-campground available site names for that stay.
2. Select the campground whose name matches `target.campgroundName`.
3. `hits = availableSites ∩ target.acceptableSites`.
4. Compute `availabilityAsOf` = the **oldest** `scannedAt` among the windows covering the
   stay (most conservative freshness — see Component 6 / Gap B).
5. Emit a `ScanResult` with the existing shape: `targetId`, `targetName`, `candidate`,
   `sourceUrl` (booking/source URL from the window entry), `bookingUrl`, `hits`,
   `parsingNotes`, `scannedAt` (= now), plus the new `availabilityAsOf`. No `debugHtmlPath`,
   no HTML.

Walk-up (hike/bike) sites are already excluded from `availableSites` upstream in the cache,
so they cannot become hits. If a park has no covering windows in cache, the candidate yields
no hits (not an error).

### Component 2 — `runScan` rewrite (`src/scanner/run-scan.ts`)

- Resolve target set (by `targetId` / enabled / `includeDisabled`) — unchanged.
- Group alerts by `parkPageId`; call `getEntriesForPark(parkPageId, provider)` **once** per
  park (not once per candidate).
- Generate candidates (`generateScanCandidates`) and run `matchCandidates`.
- Feed serialized results into the extended hit/notify pipeline (Components 3–5).
- Remove the `getProvider(...).scan(...)` call entirely.
- Per-target errors (e.g. cache read failure) are caught, logged, and skipped; other targets
  still run.

Effect: a full alert scan becomes a handful of Postgres reads instead of dozens of HTTP
fetches — no scraping, near-instant.

### Component 3 — Hit lifecycle + at-least-once delivery (`src/state/scan-state.ts`)

`AvailabilityHitRecord` gains three optional fields:
- `notifiedAt?: string` — ISO timestamp of the last **successful** notification delivery.
- `disappearedAt?: string` — ISO timestamp set when a previously-seen hit was checked but
  found absent.
- `availabilityAsOf?: string` — cache freshness carried from the matcher (Gap B).

New function replaces `findNewHits`:

```ts
reconcileHits(
  existing: HitsState,
  incoming: AvailabilityHitRecord[],
  checkedKeys: Set<string>,   // every (target|site|arrival|departure) evaluated this scan
  now: string,
  today: string,
): { merged: HitsState; toNotify: AvailabilityHitRecord[] }
```

Rules:
- **Prune** — drop any hit whose `arrivalDate < today`.
- **Present (in `incoming`)**:
  - brand-new key → add; **eligible to notify**.
  - previously `disappearedAt` → clear `disappearedAt`; **eligible to notify** (reappeared).
  - already present, never disappeared → update `lastSeenAt` only; not eligible on this basis.
- **Absent but `checkedKeys` contains the key** (was checked, not available) → set
  `disappearedAt` (if not already).
- **Absent and not checked** (target/park not scanned this run) → leave untouched.
- **At-least-once safety net** — any retained hit with `notifiedAt` unset is **also** added
  to `toNotify`, so a hit whose prior send failed is retried next cycle.

`toNotify` is therefore: (newly available ∪ reappeared ∪ never-successfully-notified).

### Component 4 — Notification delivery contract (`src/notifications/*`)

`NotificationService.notify` returns a delivery result rather than swallowing errors:

```ts
type DeliveryResult = 'delivered' | 'skipped-unconfigured' | 'failed';
notify(alerts: AvailabilityAlert[]): Promise<DeliveryResult>;
```

- **ConsoleNotificationService** — always `delivered`; best-effort, never gates state.
- **EmailNotificationService**:
  - env (`RESEND_API_KEY` / `ALERT_EMAIL_TO` / `ALERT_EMAIL_FROM`) missing →
    `skipped-unconfigured`.
  - Resend send error / throw → `failed`.
  - success → `delivered`.

`runScan` stamping logic:
- Send the email batch (only hits from alerts with `emailEnabled`).
- On `delivered` or `skipped-unconfigured` → stamp `notifiedAt = now` on the included hits
  (nothing to retry in either case) and persist.
- On `failed` → leave `notifiedAt` unset → retried next cycle.
- Console output is independent and does not stamp `notifiedAt`.

This makes email delivery at-least-once: a transient Resend failure no longer silently drops
an alert (the current bug, where state is written before the send).

### Component 5 — Freshness disclosure (Gap B)

`AvailabilityAlert` gains `availabilityAsOf: string`. Email body adds a line per hit:

```
Availability as of: 2:45 PM PT — verify on the booking site before booking.
```

This pairs with the existing "availability can disappear quickly" disclaimer and is required
now that alerts read cached data (up to ~30 min stale near-term, hours far out) rather than
live fetches. The dashboard panel (Component 6) shows the same "as of" stamp.

### Component 6 — Web UI: Recent openings

- New `web/lib/hits.ts` — server-side reader over `.campbrain/state/availability-hits.json`
  (path resolved relative to repo root, mirroring `web/lib/alerts.ts`). Returns hits sorted
  by `firstSeenAt` desc, with past-`arrivalDate` and `disappearedAt` hits filtered out by
  default.
- New `RecentOpenings` component rendered on the dashboard (home page) and the `/alerts`
  page: per row — target · park · campground · site · arrival→departure (nights) · "as of"
  freshness · **Book** link. Empty state: "No openings found yet."

### Component 7 — `notify-test` command

- `src/cli/commands/notify-test.ts` — build a sample `AvailabilityAlert` and run it through
  `ConsoleNotificationService` + `EmailNotificationService`, printing the `DeliveryResult`.
- Wire `notify-test` into `src/cli/index.ts` and add `"notify-test"` to `package.json`
  scripts. Lets the user verify Resend/env config without waiting for a real hit.

### Component 8 — Retire the live-fetch path

- Remove `scan(...)` from the `AvailabilityProvider` interface and from both
  `CaliforniaParksProvider` and `RecreationGovProvider`.
- Remove `scanCandidate` and any helpers (`evaluateCandidate`, scan-only `parseAvailabilityHtml`
  usage) **only after verifying** they are not used by the proactive scanner
  (`proactiveScanWindow` has its own parsing path). If shared, leave the shared helper.
- The `scan` CLI command stays but is now cache-backed automatically via the rewritten
  `runScan` — useful for a manual one-off check.

---

## Data flow (end to end)

1. Proactive scanner keeps the Postgres grid current (unchanged).
2. `worker` fires `runScan` on its interval.
3. `runScan` reads cached windows per park → `matchCandidates` → `ScanResult[]`.
4. `reconcileHits` prunes, dedups, detects reappear, and selects `toNotify` (including
   never-notified retries).
5. State (`availability-hits.json`, `latest-scan-results.json`) is written.
6. Notifications fire; `notifiedAt` is stamped only on successful/unconfigured delivery.
7. Dashboard `RecentOpenings` reads the hits store and shows active openings with freshness.

## Error handling

| Condition | Behavior |
|---|---|
| Park has no cached windows | Candidate yields no hits; not an error. |
| Cache read fails for one target | Log + skip that target; other targets continue. |
| Email send fails (`failed`) | `notifiedAt` left unset → retried next cycle (at-least-once). |
| Email unconfigured (`skipped-unconfigured`) | `notifiedAt` stamped; no infinite retry; console already showed it. |
| Hit's `arrivalDate` in the past | Pruned by `reconcileHits`. |

## Testing

Unit (Vitest):
- **`matchCandidates`** — hit; no-hit; multi-window stay spanning two cached windows;
  `acceptableSites` intersection; campground-name mismatch → no hits; walk-up site never a
  hit; `availabilityAsOf` = oldest covering-window `scannedAt`; park absent from cache.
- **`reconcileHits`** — brand-new → notify; already-seen+notified → no notify; disappeared →
  `disappearedAt` set, no notify; reappeared → notify; never-notified retry → notify;
  past-date → pruned.
- **Notification contract** — Email `delivered` / `skipped-unconfigured` / `failed` mapping;
  `runScan` stamps `notifiedAt` only on non-`failed`.
- **`notify-test`** — smoke: runs both services, returns results without throwing.

Verification: `npm run typecheck`, `npm test`, and a manual `npm run worker` cycle showing a
cache-backed scan producing/!producing hits, plus dashboard render.

## Rollout notes

- The existing `availability-hits.json` records lack `notifiedAt`. On first run under the new
  code they'd all be eligible to notify (none has `notifiedAt`), which could fan out a burst
  of "re-notifications" for already-known openings. **Mitigation:** on first load, treat a
  record with no `notifiedAt` **and** an existing `firstSeenAt` older than this run as already
  notified (backfill `notifiedAt = lastSeenAt`) so only genuinely new openings fire. Document
  this one-time backfill in the migration step of the plan.
