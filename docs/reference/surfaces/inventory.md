# Surface Inventory — Non-Core Pages

**Status:** partial

Live pages that have not (yet) been given full surface docs. Each is flagged `keep-candidate` or `possibly-legacy`; the user plans to prune. Promote to a full surface doc in `surfaces/` if kept.

Nav membership is based on `web/app/components/nav-links.ts` (7 nav links: `/explore`, `/map`, `/saved`, `/alerts`, `/scan-history`, `/calendar`, `/settings`).

---

| Route | File | In nav? | Purpose (one line) | Status guess |
|---|---|---|---|---|
| `/saved` | `web/app/saved/page.tsx` + `SavedSearchesClient.tsx` | Yes | Saved searches index — list, run, edit, enable-alert, delete saved searches | keep-candidate |
| `/alerts` | `web/app/alerts/page.tsx` | Yes | Booking-window / calendar-sync target manager — no scan affordances (moved to `/saved`); "Availability alerts have moved to Saved Searches" notice | keep-candidate |
| `/scan-history` | `web/app/scan-history/page.tsx` | Yes | Lists per-alert scan summaries sorted by recency, and all recorded availability hit records | keep-candidate |
| `/calendar` | `web/app/calendar/page.tsx` | Yes | Google Calendar integration status — shows token setup state, lists calendar-enabled alerts, and booking-reminder sync status | keep-candidate |
| `/settings` | `web/app/settings/page.tsx` | Yes | System setup status (Postgres, catalog, token file), cache stats, and scan coverage summary | keep-candidate |
| `/catalog` | `web/app/catalog/page.tsx` | No | Browse the full park catalog with discovery status and campground counts; no server-side `force-dynamic` (static at build) | possibly-legacy |
| `/scan` | `web/app/scan/page.tsx` | No | Per-target scan runner — select a target, trigger an on-demand scan, view hits and scan state for that target | possibly-legacy |
| `/targets` | `web/app/targets/page.tsx` | No | Configure raw scan targets (JSON-file backed); predates the Alerts UI at `/alerts` | possibly-legacy |
| `/windows` | `web/app/windows/page.tsx` | No | Booking-window calculator — groups all target reservation windows by month, shows 6-month open dates and 8 AM PT release times | possibly-legacy |

---

## Notes

- `/catalog`, `/scan`, `/targets`, `/windows` are not in the nav and are not linked from any core surface. They may be pruned in the planned surface consolidation.
- `/targets` is a lower-level predecessor to `/alerts`; both read from `data/targets.json` via `loadTargets()` / `listAlertsWeb()`. If `/alerts` is the canonical CRUD surface, `/targets` is redundant.
- `/scan` overlaps with the old alert scan trigger in `/alerts` (now removed); it operates on raw `Target` objects. `POST /api/alerts/[id]/scan` has been deleted; `/scan` is likely broken.
- `/windows` uses `getBookingWindows()` from `web/lib/windows.ts` and `loadTargets()`. It is useful for the reservation-window engine but has no inbound links.
- Routes consumed by possibly-legacy pages: `/api/scan` (by `/scan`), `/api/targets` (by `/targets`), `/api/alerts` (by `/alerts`) — see [api.md](../api.md).

---

## Dependencies

- [api.md](../api.md) — routes consumed by these pages (noted per row above)
