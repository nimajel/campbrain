# Available-Only Availability Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop storing `unavailable` availability rows (~85–90% of the table) so the Neon free-tier database drops well under its 512 MB cap; `unavailable` becomes implied by row-absence within a covered `scan_windows` range.

**Architecture:** Single write-boundary change in `upsertEntry` (skip `unavailable` rows at insert; the existing per-window transactional delete-then-insert already removes stale `available` rows when a site books up). One migration truncates the `availability` table (instant space reclaim on Neon — `DELETE` would leave relation files full-size without a `VACUUM FULL`, which can't run inside a migration transaction) and tightens the CHECK constraint to `('available', 'unknown')` so a regression can never silently re-balloon storage. **No read-path changes:** every read (`mv_available_stays`, `filters.ts`, `search.ts`, `entries.ts` JOIN, digest builder, map endpoints) already filters `status = 'available'`, and coverage/freshness already comes from `scan_windows`, not availability rows. Parsers stay tri-state in memory — the filter lives only at the DB write boundary.

**Tech Stack:** Bun/Turborepo monorepo (`hosted-launch` branch), Drizzle ORM + drizzle-kit migrations, Neon Postgres (prod) / Docker Postgres (local), Vitest, GitHub Actions scanner.

## Global Constraints

- TypeScript strict, no `any`; kebab-case files; early returns.
- Branch: `hosted-launch`. Verify with `bun run typecheck` and `bun run test` (Turborepo) before calling any task done.
- DB integration tests silently skip when Postgres is unreachable. Before running them, prove the right DB answers:
  ```bash
  docker compose up -d
  cd packages/db && bun -e 'const pg = (await import("postgres")).default("postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain"); const r = await pg`SELECT current_database() AS db`; console.log(r[0].db); await pg.end()'
  ```
  Expected output: `campbrain`. If it errors or prints another name, a Homebrew Postgres from another project is shadowing :5432 — use the LAN-IP `DATABASE_URL` workaround (see memory note `env_postgres_port_shadow`) and pass it as `DATABASE_URL` to every test/migrate command below.
- Test runs must report the integration tests as **run**, not skipped — check Vitest output explicitly.
- Do not commit or push without the user's explicit approval (user preference: ask before committing). Commit steps below assume that approval was given at kickoff.
- Prod rollout is via the `Proactive Scan` GitHub Actions workflow, which applies migrations before scanning. Nothing needs to run manually against Neon except the optional size verification queries.

---

### Task 1: Filter `unavailable` at the DB write boundary

**Files:**
- Modify: `packages/db/src/queries/upsert.ts:84-96`
- Test: `packages/db/test/upsert.test.ts`

**Interfaces:**
- Consumes: existing `upsertEntry(db: TransactionalDb, entry: AvailabilityWindowEntry, providerId: string): Promise<void>` — signature unchanged.
- Produces: `upsertEntry` now persists only `available` and `unknown` rows. Task 2's constraint test relies on the `Tent 1` site this task's tests create under provider `test-1c`.

- [ ] **Step 1: Widen the test fixture type and write two failing tests**

In `packages/db/test/upsert.test.ts`, change the `makeEntry` signature (line 9) to accept all three statuses:

```typescript
function makeEntry(dates: Record<string, "available" | "unavailable" | "unknown">): AvailabilityWindowEntry {
```

Append these two tests inside the `describe` block, after the existing `"upserts park + scan_window but no sites for an empty (fully-booked) window"` test:

```typescript
  it.skipIf(!hasDb)("stores only available and unknown rows — never unavailable", async () => {
    await upsertEntry(env!.db, makeEntry({
      "2999-03-01": "available",
      "2999-03-02": "unavailable",
      "2999-03-03": "unknown",
    }), PROVIDER);
    const tent = await env!.client`
      SELECT a.date::text AS date, a.status FROM availability a JOIN sites s ON s.site_id = a.site_id
      WHERE s.provider_id = ${PROVIDER} AND s.site_name = 'Tent 1' ORDER BY a.date`;
    expect(tent.map((r) => [r["date"], r["status"]])).toEqual([
      ["2999-03-01", "available"],
      ["2999-03-03", "unknown"],
    ]);
  });

  it.skipIf(!hasDb)("removes a previously-available date that flips to unavailable on re-upsert", async () => {
    await upsertEntry(env!.db, makeEntry({ "2999-03-04": "available" }), PROVIDER);
    await upsertEntry(env!.db, makeEntry({ "2999-03-04": "unavailable" }), PROVIDER);
    const tent = await env!.client`
      SELECT a.date::text AS date FROM availability a JOIN sites s ON s.site_id = a.site_id
      WHERE s.provider_id = ${PROVIDER} AND s.site_name = 'Tent 1'`;
    expect(tent.map((r) => r["date"])).toEqual([]);
  });
```

(These rely on the existing behavior that every `makeEntry` upsert covers window `2999-03-01..08`, so the delete-then-insert wipes the whole window each call — no cross-test leakage.)

- [ ] **Step 2: Run tests to verify both fail**

```bash
cd packages/db && bun run test -- test/upsert.test.ts
```

Expected: the two new tests FAIL (`"2999-03-02", "unavailable"` is currently stored; the flipped date remains as an `unavailable` row). The three pre-existing tests still PASS. Confirm the suite did not skip (Global Constraints).

- [ ] **Step 3: Implement the filter in `upsertEntry`**

In `packages/db/src/queries/upsert.ts`, edit the step-8 loop (lines 90-92):

```typescript
        for (const [date, status] of Object.entries(site.dates)) {
          if (status === "unavailable") continue; // implied by absence within a covered scan_window — never stored
          availByKey.set(`${siteId}::${date}`, { siteId, date, status });
        }
```

Also update the comment on line 84 from `// 8. Bulk insert availability (dedupe by site_id::date)` to:

```typescript
    // 8. Bulk insert availability (dedupe by site_id::date; available/unknown only)
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd packages/db && bun run test -- test/upsert.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Run the full package suite + typecheck**

```bash
cd packages/db && bun run test && bun run typecheck
```

Expected: all green. (`entries`, `summary`, `search`, `filters` tests never seed `unavailable` rows, so nothing else moves.)

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/queries/upsert.ts packages/db/test/upsert.test.ts
git commit -m "feat(db): stop persisting 'unavailable' availability rows

'unavailable' is implied by row-absence within a covered scan_window;
the per-window delete-then-insert in upsertEntry already removes stale
available rows, so absence semantics are exact. Cuts the availability
table ~85-90% to fit the Neon free tier.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Migration — truncate stored rows + tighten the CHECK constraint

**Files:**
- Modify: `packages/db/src/schema.ts:75`
- Create: `packages/db/migrations/0008_available_only.sql` (drizzle-kit assigns the final name; content below)
- Test: `packages/db/test/upsert.test.ts`

**Interfaces:**
- Consumes: the `Tent 1` site under provider `test-1c` created by Task 1's tests (same file, earlier in the describe block).
- Produces: DB-level guarantee `availability.status IN ('available', 'unknown')`; an empty `availability` table on every environment at migration time (scanner repopulates on next run).

- [ ] **Step 1: Write the failing constraint test**

Append to the `describe` block in `packages/db/test/upsert.test.ts`:

```typescript
  it.skipIf(!hasDb)("rejects raw 'unavailable' inserts via CHECK constraint", async () => {
    const site = await env!.client`
      SELECT site_id FROM sites WHERE provider_id = ${PROVIDER} AND site_name = 'Tent 1' LIMIT 1`;
    const siteId = site[0]!["site_id"] as number;
    await expect(
      env!.client`INSERT INTO availability (site_id, date, status) VALUES (${siteId}, '2999-03-05', 'unavailable')`,
    ).rejects.toThrow(/availability_status_check/);
  });
```

- [ ] **Step 2: Run it to verify it fails**

```bash
cd packages/db && bun run test -- test/upsert.test.ts
```

Expected: new test FAILS (the old constraint still allows `'unavailable'`, so the insert resolves).

- [ ] **Step 3: Update the schema constraint**

In `packages/db/src/schema.ts` line 75, change:

```typescript
  check("availability_status_check", sql`status IN ('available', 'unavailable', 'unknown')`),
```

to:

```typescript
  check("availability_status_check", sql`status IN ('available', 'unknown')`),
```

- [ ] **Step 4: Generate the migration and set its exact content**

```bash
cd packages/db && bunx drizzle-kit generate --name=available_only
```

Whatever SQL drizzle-kit emits into `migrations/0008_available_only.sql`, replace the file body with exactly:

```sql
TRUNCATE TABLE "availability";--> statement-breakpoint
ALTER TABLE "availability" DROP CONSTRAINT "availability_status_check";--> statement-breakpoint
ALTER TABLE "availability" ADD CONSTRAINT "availability_status_check" CHECK (status IN ('available', 'unknown'));
```

Why TRUNCATE (not DELETE): TRUNCATE drops the relation files, returning space to Neon instantly and transactionally. DELETE would leave the files full-size until a `VACUUM FULL`, which cannot run inside a migration transaction. The data gap is acceptable: `/map` serves `park_digests` (untouched), and the same workflow run repopulates `availability` right after migrating. Do not edit `migrations/meta/` by hand — `drizzle-kit generate` maintains the journal and snapshot.

- [ ] **Step 5: Apply the migration locally and verify the test passes**

```bash
cd packages/db && DATABASE_URL="postgres://campbrain:campbrain_dev_password@localhost:5432/campbrain" bun run migrate
cd packages/db && bun run test -- test/upsert.test.ts
```

Expected: migrate prints `✅ migrations + MV applied`; all 6 tests PASS. (Ordering note: Vitest runs tests in a file sequentially, and earlier tests recreate `Tent 1` on every run, so the constraint test always has its fixture.)

- [ ] **Step 6: Run the full verification gate**

```bash
bun run typecheck && bun run test
```

Expected: all packages green; confirm `packages/db` integration tests ran (not skipped).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema.ts packages/db/migrations/ packages/db/test/upsert.test.ts
git commit -m "feat(db): migration 0008 — truncate availability + restrict status to available/unknown

TRUNCATE reclaims Neon space instantly (DELETE leaves relation files
full-size without a VACUUM FULL, which can't run in a migration txn).
The tightened CHECK makes reintroducing 'unavailable' rows a hard error.

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Ship to Neon and verify the scan recovers

**Files:**
- None (operational task; uses the committed work from Tasks 1–2)

**Interfaces:**
- Consumes: commits from Tasks 1–2 on `hosted-launch`.
- Produces: a green `Proactive Scan` run on a database under the 512 MB cap.

- [ ] **Step 1: Push (requires user approval per Global Constraints)**

```bash
git push origin hosted-launch
```

- [ ] **Step 2: Trigger the scan workflow immediately (don't wait for cron)**

```bash
gh workflow run "Proactive Scan" --repo nimajel/campbrain --ref hosted-launch
```

- [ ] **Step 3: Watch the run to completion**

```bash
gh run list --repo nimajel/campbrain --workflow "Proactive Scan" --limit 1
gh run watch <run-id> --repo nimajel/campbrain --exit-status
```

Expected: `Apply pending DB migrations` applies 0008 (truncate + constraint), then `Run proactive scan` completes without the storage-cap failure. The CA pass takes ~30–60 min, Rec.gov pass longer; total up to ~3 h.

- [ ] **Step 4: Verify sizes and status distribution on Neon**

Using the Neon `DATABASE_URL` from `.env` (append `?sslmode=require` if absent):

```bash
cd packages/db && DATABASE_URL="<neon-url>" bun -e '
const pg = (await import("postgres")).default(process.env.DATABASE_URL, { ssl: "require" });
console.log(await pg`SELECT pg_size_pretty(pg_total_relation_size(${"availability"})) AS availability_total, pg_size_pretty(pg_database_size(current_database())) AS db_total`);
console.log(await pg`SELECT status, COUNT(*)::int AS n FROM availability GROUP BY status`);
console.log(await pg`SELECT provider, MAX(built_at)::text AS latest_digest FROM park_digests GROUP BY provider`);
await pg.end()'
```

Expected: zero `unavailable` rows; `db_total` comfortably under 512 MB; `latest_digest` timestamps from this run. If the DB is still over budget, report the numbers — do not improvise further schema surgery.

- [ ] **Step 5: Spot-check the live map**

```bash
curl -s "https://campbrain-api.jelvehn.workers.dev/api/map/availability/summary" | head -c 400
```

Expected: JSON with non-zero park counts (not an error payload).

---

### Task 4: Reconcile documentation

**Files:**
- Owned by the doc-steward agent (CLAUDE.md convention: doc freshness belongs to doc-steward)

- [ ] **Step 1: Dispatch the doc-steward agent** with this context: "Availability storage is now available/unknown-only on `hosted-launch` (migration 0008). `unavailable` is implied by row-absence within a covered `scan_windows` range; the CHECK constraint enforces it. Update the data-model/cache reference docs, the hosted-launch master spec, and the CLAUDE.md cache-architecture notes where they describe storing the full per-site per-day grid. Also note the Neon 512 MB incident (2026-07-03) as resolved by this change."

- [ ] **Step 2: Review the doc diff, then commit** (with user approval) as `docs: reconcile availability storage docs with available-only schema`.

---

## Self-Review Notes (spec coverage)

- Store only available(+unknown) rows → Task 1. Replace-set writes → already present in `upsertEntry` (delete-then-insert per window, single transaction); Task 1 adds the regression test for the flip case.
- Purge existing rows + reclaim Neon space → Task 2 TRUNCATE (instant reclaim; no VACUUM needed).
- Regression guard → Task 2 CHECK constraint.
- Coverage-based reads / MV / digest / summary rewrites → **not needed**: verified that `mv.ts:11`, `filters.ts:47`, `search.ts:53,89`, `entries.ts:81`, `map-transforms.ts:170` all already filter to `available`, and freshness derives from `scan_windows` (`alert-match.ts:56-75`, `freshness.ts:3-13`). Parser types stay tri-state by design (in-memory truth; DB stores the subset).
- Rollout + verification → Task 3. Docs → Task 4.
