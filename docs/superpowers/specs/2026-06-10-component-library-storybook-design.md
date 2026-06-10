# CampBrain UI Component Library + Storybook — Design

**Date:** 2026-06-10
**Status:** approved

## Goal

Create a reusable, typed UI component library for the CampBrain web app and a Storybook
catalog to visualize and develop components in isolation. Components are extracted from
the existing `globals.css` utility classes and inline JSX; pages migrate to them
incrementally.

## Decisions

- **Scope:** Extract a primitives library; migrate pages opportunistically (no big-bang
  refactor). One proof-of-adoption migration ships with the initial work.
- **Purpose:** Visual catalog + dev sandbox only. No interaction tests, a11y addon, or
  visual regression tooling. Testing stays in Vitest.
- **Coverage:** Extracted primitives plus stories for existing self-contained components.
  Leaflet-coupled components and nav components are out of scope for the first pass.
- **Styling:** Components are thin typed wrappers composing the existing `globals.css`
  class names. No new CSS. `globals.css` remains the single restyle point, per
  `docs/reference/design-system.md`.

## Library structure

- New directory: `web/components/ui/` — one component per PascalCase `.tsx` file
  (matches the existing `web/components/` convention).
- Barrel export: `web/components/ui/index.ts` — consumers import from
  `@/components/ui`.
- Stories co-located: `Button.stories.tsx` next to `Button.tsx`, CSF3 with `autodocs`.
- Components are client-safe, presentational, and stateless except where the wrapped
  behavior requires state (`Modal`, `Toggle`). Strict TypeScript, no `any`.

## Component set (initial)

Primitives extracted from the `globals.css` class inventory:

| Component | Wraps | API |
|---|---|---|
| `Button` | `.btn`, `.btn-primary/ghost/slate/danger/success`, `.btn-sm`, `:disabled` | `variant?: "primary" \| "ghost" \| "slate" \| "danger" \| "success"` (omitted = bare `.btn`, matching existing usage), `size?: "sm"`, `disabled?`; renders `<a>` when `href` is passed, else `<button>` |
| `Badge` | `.badge`, `.badge-green/red/blue/gray/match` | `tone: "green" \| "red" \| "blue" \| "gray" \| "match"`, children |
| `Chip` | `.chip`, `.chip-green/red/gray/yellow` | `tone: "green" \| "red" \| "gray" \| "yellow"`, children |
| `StatusDot` | `.dot`, `.dot-green/red/gray/yellow` | `tone: "green" \| "red" \| "gray" \| "yellow"` |
| `Card` | `.card`, `.card-actions` | children, `actions?: ReactNode` |
| `StatCard` | `.stat-label`, `.stat-value` | `label: string`, `value: ReactNode` |
| `EmptyState` | `.empty` | children |
| `KVList` / `KVRow` | `.kv-row/.kv-key/.kv-val` | `items: { key: string; value: ReactNode }[]` (list) or `keyName`/`value` (row) |
| `PageHeader` | `.page-header`, `.page-subtitle` | `title: string`, `subtitle?: string` |
| `SectionTitle` | `.section-title`, `.section-desc` | `title: string`, `desc?: string` |
| `SiteChip` | `.site-chip`, `.site-chip--more` | `name: string`, `more?: boolean` |
| `Input` | `.form-input` (+ `.form-row`, `.form-grid` layout helpers) | standard input props, `label?: string` |
| `Toggle` | `.toggle`, `.toggle-slider` | `checked`, `onChange`, `label?` |
| `Modal` | `.modal`, `.modal-backdrop`, `.modal-header`, `.modal-close` | `open`, `onClose`, `title`, children |

Existing components that get stories **without modification**: `ProviderBadge`,
`SiteFilterPanel`, `DateRangePicker`, `MapLegend`, `RecentOpenings`.

Out of scope (first pass): `LeafletMap`, `MarkerClusterGroup`, `ResultsList`,
`NavBar`/`NavMenu`, `ParkMapPopover`, page-level composites in `MapClient.tsx`.

## Storybook setup

- Storybook 9, framework **`@storybook/nextjs-vite`**, installed in `web/`.
- Config in `web/.storybook/`:
  - `main.ts` — stories glob covering `web/components/**` and `web/app/**` co-located
    stories; framework `@storybook/nextjs-vite`; no extra addons.
  - `preview.ts` — imports `../app/globals.css`; canvas background set to the app page
    background token so components render on true colors.
- Scripts: `storybook` (dev server, port 6006) and `build-storybook` in
  `web/package.json`; root `package.json` gets a passthrough `storybook` script.
- Story format: CSF3, `tags: ["autodocs"]`, controls for variant/tone props.

## Proof-of-adoption migration

Migrate the dashboard (`web/app/page.tsx`) to consume the primitives (`Card`,
`StatCard`, `Badge`, `Button`, `EmptyState`, `KVList`). Rendered markup must produce the
same class names as before — zero visual change. All other pages migrate
opportunistically when touched. **New UI must use the library going forward.**

## Error handling

Components are presentational wrappers; no error paths beyond TypeScript enforcing
valid variants at compile time. `Modal` closes on backdrop click and via its × close
button, matching the existing modal in `AlertsClient.tsx` (no Escape handling, for
parity).

## Verification

- `npm run typecheck` passes (root + web)
- `npm test` passes (no behavior changes expected)
- `npm run build-storybook` succeeds — gate for "all stories compile"
- `npm --prefix web run build` succeeds with the dashboard migration
- Manual: Storybook loads at :6006; spot-check components against the live app

## Docs follow-up (post-ship, doc-steward)

- Point `docs/reference/design-system.md` shared-components section at
  `web/components/ui/` and fix the stale Tailwind/token claims.
- Correct CLAUDE.md stack section (Tailwind reference; Next/React versions).
