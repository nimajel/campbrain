# /available Page — Manual Test Checklist

Run these after `npm run worker` has populated the cache and `npm run dev` is running at http://localhost:3001/available.

---

## Anchor Park — Lake Oroville SRA

All category 2 cross-checks use **Lake Oroville SRA** as the primary test park. It consistently has availability and covers multiple campground types useful for filter testing.

| | |
|---|---|
| CampBrain parkPageId | `462` |
| ReserveCalifornia | https://www.reservecalifornia.com/park/662 |
| parks.ca.gov API | https://www.parks.ca.gov/AvailabilityInfo?arrival_date=YYYY-MM-DD&length=8&page_id=462 |

**Campgrounds in the catalog:**

| Campground | ReserveCalifornia unit | Notes |
|---|---|---|
| Loafer Creek Camp (sites 1-43) | [/park/662/547](https://reservecalifornia.com/park/662/547) | Main drive-in campground, 41 sites — primary for 1N/2N checks |
| Floating Camping Area | [/park/662/522](https://reservecalifornia.com/park/662/522) | Unique floating sites FL02–FL10 |
| Loafer Creek Horse Campground | [/park/662/575](https://reservecalifornia.com/park/662/575) | Equestrian sites LH01–LH15 — use for `exclude_equestrian` filter check |
| Group Boat-In Area | [/park/662/525](https://reservecalifornia.com/park/662/525) | Single group site GB01 — use for `exclude_group` filter check |
| Bloomer Knoll / Bloomer Point / Craig Saddle / Foreman Creek | /park/662/1995–1998 | Boat-in campgrounds |

---

## Category 1 — Catalog & Park Population

- [ ] **1.1 — Park count**: Open browser console, run `fetch('/api/available').then(r=>r.json()).then(d=>console.log(d.entries.length))`. Should reflect 88 parks with data.
- [ ] **1.2 — Known park names appear**: Confirm these park names are present in at least one date group when filters are cleared:
  - [ ] Lake Oroville SRA (page_id 462)
  - [ ] Jedediah Smith Redwoods SP (page_id 413)
  - [ ] Angel Island SP (page_id 468)
  - [ ] Crystal Cove SP (page_id 418)
- [ ] **1.3 — No "failed" parks**: Parks with `discoveryStatus: failed` (111 parks) must not appear. Cross-check: any park showing in UI should be findable on ReserveCalifornia.
- [ ] **1.4 — Lake Oroville campground names match catalog**: Expand the Lake Oroville card — all 8 campgrounds listed above should appear.

---

## Category 2 — Availability Cross-Check (vs. ReserveCalifornia)

**Primary park**: Lake Oroville SRA — https://www.reservecalifornia.com/park/662

**Protocol for each test:**
1. Find the date and sites shown for Lake Oroville in the app
2. Open ReserveCalifornia at the link above, select the same arrival date
3. Compare site-level availability campground by campground

**Before starting**: confirm "Last scan Xm ago" is <2h. If stale, click "↺ Refresh now" and wait for completion.

### 2A — Weekday within next 7 days

Turn off "Weekends only". Find Lake Oroville on a **Tuesday, Wednesday, or Thursday** arrival.

- [ ] Date: `__________`
- [ ] Campground checked: Loafer Creek Camp (sites 1-43)
- [ ] Sites shown available in app: `____________________`
- [ ] Sites shown available on [ReserveCalifornia](https://reservecalifornia.com/park/662/547): `____________________`
- [ ] Match? Y / N — if N, note discrepancy: `____________________`

### 2B — Weekend within next 7 days

Keep "Weekends only" on. Find Lake Oroville on the nearest **Friday or Saturday**.

- [ ] Date: `__________` (circle: Fri / Sat)
- [ ] Campground checked: Loafer Creek Camp (sites 1-43)
- [ ] Sites shown available in app: `____________________`
- [ ] Sites shown available on [ReserveCalifornia](https://reservecalifornia.com/park/662/547): `____________________`
- [ ] Match? Y / N — if N, note discrepancy: `____________________`
- [ ] Also check Floating Camping Area — sites FL02–FL10 match between app and [ReserveCalifornia](https://reservecalifornia.com/park/662/522): Y / N

### 2C — Mid-range Saturday (~10 weeks out)

Set date range to a Saturday approximately 10 weeks from today.

- [ ] Date: `__________`
- [ ] Lake Oroville appears in results? Y / N
- [ ] Sites shown available in app (Loafer Creek): `____________________`
- [ ] Sites shown available on [ReserveCalifornia](https://reservecalifornia.com/park/662/547): `____________________`
- [ ] Match? Y / N

### 2D — Far-out date (~180 days from today)

Set date range to a date approximately 180 days from today.

- [ ] Date: `__________`
- [ ] Lake Oroville appears in results? Y / N
- [ ] If yes — sites in app vs. [ReserveCalifornia](https://reservecalifornia.com/park/662/547) match: Y / N
- [ ] If no results at all: confirm cache has far-out entries (check `entryCount` — should be ~2,024)

### 2E — 1-night availability correctness

Using Loafer Creek Camp, find a site the app shows as available for **1 night**.

- [ ] Date / site: `____________________`
- [ ] On [ReserveCalifornia Loafer Creek](https://reservecalifornia.com/park/662/547), that site is available that night: Y / N
- [ ] A site the app does NOT show is confirmed unavailable on ReserveCalifornia: Y / N

### 2F — 2-night consecutive stay

Using Loafer Creek Camp, find a site the app shows as available for **2 nights**.

- [ ] Arrival date / site: `____________________`
- [ ] On [ReserveCalifornia](https://reservecalifornia.com/park/662/547), BOTH nights are available for that site: Y / N
- [ ] Find a site available night 1 but not night 2 on ReserveCalifornia — confirm it does NOT appear in the app for a 2N stay: Y / N

### 2G — Non-consecutive availability (gap test)

On [ReserveCalifornia Loafer Creek](https://reservecalifornia.com/park/662/547), find a site where nights 1 and 2 are available but night 3 is booked.

- [ ] Arrival date / site: `____________________`
- [ ] App shows that site for 1N starting night 1: Y / N
- [ ] App shows that site for 2N starting night 1: Y / N
- [ ] App does NOT show that site for 2N starting night 2 (since night 3 unavailable): Y / N

---

## Category 3 — Filter Logic (UI Verification)

Run with default filter state first, then toggle each filter. Use Lake Oroville SRA to verify filter-specific campground types.

### Site filters
- [ ] **Exclude group sites**: Toggle on — "Group Boat-In Area" row disappears from Lake Oroville card
- [ ] **Exclude equestrian**: Toggle on — "Loafer Creek Horse Campground" row disappears from Lake Oroville card
- [ ] **Exclude day-use & picnic areas**: Toggle on — any "Day Use" or "Picnic" entries park-wide disappear
- [ ] **Hike-in sites only**: Toggle on — only rows with "hike-in" or "walk-in" in site/campground name remain (Lake Oroville likely disappears entirely)

### Date and stay filters
- [ ] **Weekends only (default ON)**: Only Friday and Saturday arrival dates show in list
- [ ] **Weekends only OFF**: Tuesday/Wednesday/Thursday dates appear
- [ ] **1N filter**: Only 1-night rows show per campground
- [ ] **2N filter**: Only 2-night rows show — verify these require BOTH nights available
- [ ] **All nights**: Both 1N and 2N rows appear per campground
- [ ] **Date from**: Set to next Friday — no results before that date
- [ ] **Date to**: Set 2 weeks from now — no results past that date
- [ ] **Clear dates button**: Resets from/to; full date range returns
- [ ] **Pagination resets after filter change**: Scroll to bottom and click "Show more", then change any filter — should return to first 10 groups

### Available only toggle
- [ ] **Available only ON (default)**: No parks show "No availability" badge
- [ ] **Available only OFF**: Parks with 0 open sites appear with "Nothing available" gray badge

---

## Category 4 — Refresh Button

- [ ] **4.1 — Button state while running**: Click "↺ Refresh now" — button immediately shows "Refreshing…" and is disabled
- [ ] **4.2 — Success message**: After scan completes (~1–2 min), message shows "Done — N entries updated in Xs"
- [ ] **4.3 — Entries update**: After refresh completes, newly available sites appear without a page reload
- [ ] **4.4 — Rate limit**: Click refresh again within 5 minutes — should show "Please wait Xs before refreshing again"
- [ ] **4.5 — Entry count**: "N windows cached" in bottom-right updates after refresh (should be ~2,024)
- [ ] **4.6 — Last scan time**: Timestamp updates to "just now" after refresh completes

---

## Category 5 — UI Display Correctness

- [ ] **5.1 — Nightly fee**: Expand a park card — fee shows as "$35/night · **$70 total**" for a 2-night row
- [ ] **5.2 — Book button URL**: Right-click a "Book ↗" button → copy URL — confirm `date=YYYY-MM-DD` matches that row's arrival date and `night=N` matches the nights count
- [ ] **5.3 — Book button absent**: A row with no available sites should have no "Book ↗" button
- [ ] **5.4 — Park cards collapsed**: On initial load, all park cards show header only (no campground rows)
- [ ] **5.5 — Park card toggle**: Click a park header — campground rows expand; click again — they collapse
- [ ] **5.6 — "Show more" pagination**: Initially 10 date groups shown; "Show more dates" button adds 10 more
- [ ] **5.7 — Site chips**: Available sites appear as green chips inside expanded campground rows
- [ ] **5.8 — Weekend date styling**: Friday/Saturday arrival dates appear bold; Monday–Thursday appear muted

---

## Regression Checks

After running any of the above, confirm:
- [ ] No console errors or React hydration warnings
- [ ] Filter response time is visually fast (<200ms per toggle)
- [ ] Page loads without a white flash or layout shift
