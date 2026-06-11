# Saved Searches — Phase 9 Legacy-Target Retirement (Spec Addendum)

**Date:** 2026-06-10
**Status:** Implemented (merged to main 2026-06-10, commit da2722f + beb9357).
**Owner at design time:** architect
**Parent specs / required reading:**
  - [2026-06-10-saved-searches-design.md](2026-06-10-saved-searches-design.md) — esp. "File-level change map → Retired (after verification)" and the migration table.
  - [2026-06-10-saved-searches-plan.md](2026-06-10-saved-searches-plan.md) — Phase 9.
  - CLAUDE.md → Three Engines (Reservation Window Engine survives; Trip Target Engine moves to saved searches).

## Why this addendum exists

Phases 0–8 of saved searches are merged and e2e-verified. The parent plan's Phase 9 said
to "remove the legacy Target path: `src/config/alerts.ts`, `src/config/schemas.ts` Target
wiring; `web/lib/alerts.ts`; the `matchCandidates`/`generateScanCandidates` Target branch
in `runScan`." **That removal list is wrong** — it was written treating Target as *only*
the alert-scanning substrate. A code inventory (grep-verified) shows Target also powers the
**Reservation Window Engine** (`upcoming`, calendar sync, `/calendar`) and a full **`/alerts`
management UI**. Deleting `web/lib/alerts.ts` or the `schemas.ts` Target wiring would break
`/alerts`, `npm run upcoming`, and `npm run sync-calendar`. This addendum re-scopes Phase 9
to remove only the duplicate alert-scanning role, keep the booking-window role intact, and
de-lie the surfaces that would otherwise pretend to scan/alert.

## Verified consumer inventory (what each thing actually depends on)

| Consumer | Reads | Gated by `enabled`? | Role |
|---|---|---|---|
| `src/scanner/run-scan.ts` legacy loop | `listAlerts()` → `matchCandidates` | yes (`a.enabled`) | **Alert scanning** — duplicate of saved searches. **REMOVE.** |
| `web/lib/scanner.ts` + `/api/alerts/[id]/scan` | `matchCandidates` over a Target | n/a (per-alert button) | **Live "Scan now" affordance** on `/alerts`. **REMOVE** (would scan nothing meaningful once the scan loop is gone, and overlaps saved-search `/run`). |
| `web/app/alerts/` page + `AlertsClient` | `listAlertsWeb()` (`web/lib/alerts.ts`) | renders `enabled`, scan panel | **Target management UI.** **KEEP** but strip scan/alert affordances → becomes a booking-window surface (see Decision B). |
| 5 routes under `web/app/api/alerts/` | `web/lib/alerts.ts` CRUD + scanner | — | CRUD + enable/disable + scan. **KEEP CRUD; DROP scan route** (Decision B). |
| `src/cli/commands/upcoming.ts` (`npm run upcoming`) | `loadTargets()` (`src/config/targets.ts`) | **no** — uses ALL targets | **Reservation Window Engine.** **KEEP — do not touch.** |
| `src/cli/commands/sync-calendar.ts` | `calendarAlerts()` else `activeAlerts()` | partial (fallback uses `enabled`) | **Calendar sync.** **KEEP — do not touch.** |
| `web/app/calendar/page.tsx` | `listAlertsWeb()` filtered by `calendarEnabled` | by `calendarEnabled` | **Calendar surface.** **KEEP.** |
| `src/cli/commands/alerts.ts` | `listAlerts/enable/disable` | renders `enabled` | CLI list/enable/disable. **KEEP** (still useful for booking-window enable/calendar). |

**Load-bearing fact (constraint-4 resolution):** `npm run upcoming` does **not** gate on
`enabled` at all (`loadTargets()` returns every target). `sync-calendar` gates on
`calendarEnabled`, falling back to `activeAlerts()` (= `enabled`) only when zero
`calendarEnabled` rows exist. So the `enabled` flag on `/alerts` *can* still influence
calendar sync (via the fallback) but **never** influences `upcoming`. After retirement
`enabled` no longer gates any *alerting* (the legacy scan loop is gone). Keeping an
"Active/Disabled" toggle on `/alerts` that the user reads as "alert me" would lie; keeping
it labeled as a calendar/booking-window inclusion flag is honest. See Decision B.

## Decision Log

**Decision A — `runScan` legacy loop: remove it (the only true alert-scan retirement).**
*Chosen:* delete the legacy Target loop in `src/scanner/run-scan.ts` (the
`listAlerts → generateScanCandidates → matchCandidates → resultsToHitRecords` block, its
`checkedKeys` population, the `Skipping (disabled)` reporting, `windowsFor`, and the legacy
branch of `buildAvailabilityAlerts`). Saved searches are now the sole availability-alert
source. `reconcileHits`/`notify`/hit-state v3 are unchanged — they already key-agnostically
handle saved-search openings. *Rejected:* keep both loops "for safety" — that is exactly the
double-notification risk Phase 9 exists to remove, and the e2e gate already proved the
saved-search path. *Note:* the pure modules `matchCandidates`, `generateScanCandidates`,
`resultsToHitRecords`, `serializeResult`, `match-candidates.ts` are **retained on disk**
(still imported by `web/lib/scanner.ts` until Decision B lands, and covered by tests); we
remove only their *use as a scan source* in `run-scan.ts`. Minimal, reversible.

**Decision B — `/alerts` surface: keep as a booking-window/reminder manager, strip the
scan + alert affordances; do not rename in v1.** *Chosen:* the least-churn honest option.
Keep `web/lib/alerts.ts`, the page, `AlertsClient`, and the CRUD + enable/disable +
calendar routes. **Remove** the "Scan now" `ScanPanel` and last-scan/match rendering from
`AlertsClient`, and **delete** `web/app/api/alerts/[id]/scan/route.ts` + `web/lib/scanner.ts`
(its only consumer) so no affordance scans nothing. Relabel the per-card status chip from
"Active/Disabled" to "In calendar sync / Not synced" semantics (it now only influences the
`sync-calendar` fallback + the `/calendar` view), and add one line of copy: "Availability
alerts have moved to Saved Searches." Keep the nav label "Alerts" as-is for v1 (a rename to
"Booking Windows" is a doc-steward fast-follow, not load-bearing). *Rejected:* (1) delete
`/alerts` entirely — breaks the only UI for managing booking-window/calendar targets and
the migration source of truth, and orphans `/calendar`'s data; (2) leave `/alerts` as-is —
its Scan button and "Active" toggle would lie about alerting; (3) rename now — extra churn
for no functional gain, defer.

**Decision C — flip migrated rows' `alert_enabled` so alerting continuity is preserved.**
*Chosen:* extend `migrate-targets` with an idempotent reconciliation pass that, for each
saved search whose `definition.legacy.enabled === true`, sets `alert_enabled = true`
(idempotent: only flips false→true, never the reverse, and only when the legacy flag was
true). This runs as part of `npm run db:migrate-targets` and is also exposed as a guarded
step so it can be re-run standalone. Rationale: migration deliberately imported every row
with `alertEnabled: false` to avoid transition double-emails while BOTH loops were live
(legacy enabled-true rows were still being scanned by the legacy loop). Once Decision A
removes the legacy loop, those rows would silently stop alerting unless flipped. The
original enabled flag is preserved at `definition.legacy.enabled`, so this is a lossless,
idempotent promotion. *Rejected:* a manual "go enable them on `/saved`" instruction — fragile,
the user's alerting silently lapses if they forget; default-flip ALL migrated rows on —
would alert on rows whose legacy `enabled` was false (against user intent).

**Decision D — ordering: flip-then-remove, single PR, reversible.** *Chosen:* within the
one implementation pass, run the Decision-C flip BEFORE deleting the legacy loop (Decision A)
so there is never a window where an originally-enabled target is scanned by neither path.
Keep `data/targets.json` on disk (unchanged) — it remains the booking-window source and the
re-runnable migration input. The whole change is one revertible commit. *Rejected:* delete
loop first — opens an alerting gap; delete `targets.json` — breaks booking windows and
migration idempotency.

## File-level change map

**Modified (src):**
- `src/scanner/run-scan.ts` — **remove** the legacy Target loop and its supporting code:
  the `for (const alert of alerts)` scan block, the `alerts`/`allAlerts` filtering +
  `Skipping (disabled)` reporting, `windowsFor`/`windowsByPark`, `serializedById`,
  `resultsToHitRecords` usage, and the legacy branch in `buildAvailabilityAlerts` (keep the
  `savedSearchId` branch as the sole path; it no longer needs `alertsById`/`serializedById`
  params). Drop now-unused imports (`listAlerts`, `generateScanCandidates`, `matchCandidates`,
  `serializeResult`, `resultsToHitRecords`, `buildScanSummary`, `writeLatestScan`, `Alert`,
  `ScanResult`/`ScanResultJSON`, `hitKey` only if unused). Simplify `RunScanSummary`/
  `ScanTargetResult`/`RunScanOptions` to drop the Target-only fields (`targetId`,
  `includeDisabled`, `alert`, per-target `results`) — OR retain `targetId` as a no-op-safe
  param if any caller passes it; **planner: verify callers in `src/cli` + `web` first and
  prefer the smaller diff.**
- `src/cli/commands/migrate-targets.ts` — add the idempotent `alert_enabled` promotion
  (Decision C): after upsert, if `mapped.legacy.enabled === true`, call a store helper to set
  `alert_enabled = true` for that id (only false→true). Update the per-row log to say
  "imported + alerts ON (migrated from active legacy target)" vs "imported (legacy inactive)".
  Add the standalone guard so re-running the whole command stays a no-op for already-correct rows.

**Modified (src/saved-search):**
- `src/saved-search/store.ts` — add `enableSavedSearchAlert(id: string): Promise<void>` (or
  reuse `updateSavedSearch(id, { alertEnabled: true })`) for the Decision-C flip. **Planner:
  prefer reusing `updateSavedSearch` if it already exists; only add a helper if a narrower
  idempotent UPDATE is cleaner.**

**Deleted (web):**
- `web/app/api/alerts/[id]/scan/route.ts` — the live-scan affordance (overlaps saved-search
  `/run`; scans the retired path).
- `web/lib/scanner.ts` — its only consumer is the scan route above; remove with it.

**Modified (web):**
- `web/app/alerts/AlertsClient.tsx` — remove `ScanPanel`, the `runScan` fetch, last-scan/
  match rendering, and `isScanning` plumbing. Relabel the status chip to calendar-sync
  semantics; add the "Availability alerts have moved to Saved Searches → /saved" notice.
- `web/app/alerts/page.tsx` — drop `getLatestScanState`/`scanState` prop and the
  `RecentOpenings` panel here if it now belongs on `/saved`/dashboard only **(planner:
  confirm where RecentOpenings should live; keeping it is harmless but it now reflects
  saved-search openings, not Target scans — prefer leaving it on the dashboard only)**.

**Unchanged — explicitly DO NOT TOUCH (booking-window engine + migration input):**
- `src/config/schemas.ts`, `src/config/targets.ts`, `src/config/alerts.ts` (Target/Alert
  models + `loadTargets`/`activeAlerts`/`calendarAlerts`).
- `web/lib/alerts.ts` (Target CRUD — backs `/alerts` + `/calendar`).
- `src/cli/commands/upcoming.ts`, `src/cli/commands/sync-calendar.ts`,
  `src/cli/commands/alerts.ts`, `web/app/calendar/page.tsx`.
- `web/app/api/alerts/route.ts`, `[id]/route.ts`, `[id]/enable/route.ts`,
  `[id]/disable/route.ts` (CRUD + enable/disable — still drive calendar inclusion).
- `data/targets.json` (stays on disk).
- `src/scanner/match-candidates.ts`, `src/rules/scan-candidates.ts`,
  `src/state/scan-state.ts` `resultsToHitRecords`/`hitKey` (retained; covered by tests).

## Acceptance criteria

1. `npm run typecheck` and `npm test` green (the full suite, incl. retained
   `match-candidates`/`scan-candidates`/`scan-state` tests, which still pass because those
   modules are not deleted).
2. `npm run scan` / a `npm run worker` cycle scans **only** alert-enabled saved searches —
   no `Scanning: <legacy target name>` lines, no `Skipping (disabled)` lines.
3. **No double notifications and no alerting gap:** a saved search migrated from an
   originally-`enabled` legacy target has `alert_enabled = true` after
   `npm run db:migrate-targets`, and a scan cycle that finds availability for it emails
   exactly once; a second cycle emails zero.
4. `npm run upcoming` output is **unchanged** (still lists all targets' booking windows).
5. `npm run sync-calendar --dry-run` is **unchanged** (same target pool, same drafts).
6. `/calendar` loads and lists `calendarEnabled` targets unchanged.
7. `/alerts` loads with **no** "Scan now" button and **no** last-scan panel; shows the
   "alerts moved to Saved Searches" notice; the status chip reads as calendar-sync, not
   alerting; CRUD + enable/disable still work (create/edit/delete a target round-trips).
8. `GET /api/alerts/[id]/scan` returns 404 (route deleted); the four CRUD/enable/disable
   routes still respond.
9. `npm run dev`: `/alerts`, `/saved`, `/calendar`, `/explore` load with no console/
   hydration errors.
10. `data/targets.json` is byte-identical (untouched on disk).
11. The whole change reverts cleanly in one commit.

## Test expectations

**Unit (Vitest):**
- `migrate-targets` — **new test:** a target with `enabled: true` migrates to a saved search
  with `alert_enabled = true` after the promotion pass; a target with `enabled: false`
  migrates with `alert_enabled = false`; the promotion is **idempotent** (running the command
  twice does not flip an already-true row off, nor flip a legacy-false row on); existing
  date-mode/lottery-skip/`definition.legacy` tests remain green.
- `run-scan` — **update tests** that assert legacy-Target scanning to assert it no longer
  runs: with only legacy targets in `targets.json` and zero alert-enabled saved searches, a
  scan produces zero openings and zero notifications; with one alert-enabled saved search and
  no legacy loop, the saved-search path is the only source feeding `reconcileHits`. Remove or
  rewrite any test that depended on the legacy `targetId`/`includeDisabled`/`Skipping
  (disabled)` behavior.
- `store.ts` — if `enableSavedSearchAlert` is added, test false→true flip is idempotent and
  does not touch other columns/`updatedAt` semantics per existing convention.

**Retained-as-is (regression guard):** `test/match-candidates.test.ts`,
`test/scan-candidates.test.ts`, `test/scan-state.test.ts` must stay green unchanged —
proves the removal is use-site-only, not a logic deletion.

**Integration / manual (the Phase-8 checklist, re-run post-retirement):**
- `npm run db:migrate-targets` flips the originally-active migrated row(s) to
  `alert_enabled = true`; re-run is a no-op (row count + flags unchanged).
- Full alert loop: alert-enabled saved search with current availability → `npm run scan` →
  one email → second `npm run scan` → no email → dashboard RecentOpenings shows the opening.
- `npm run upcoming` and `npm run sync-calendar --dry-run` diff-clean against pre-change output.

## Out of scope (explicit)

- Redesigning booking windows / the Reservation Window Engine off the Target model.
- Renaming the `/alerts` nav entry or building a dedicated "Booking Windows" surface
  (doc-steward fast-follow).
- Deleting `data/targets.json` or the Target/Alert schemas.
- Doc reconciliation (CLAUDE.md Next Steps, `docs/reference/engines/scanner.md`,
  surface docs) — route to **doc-steward** after this lands.
</content>
</invoke>
