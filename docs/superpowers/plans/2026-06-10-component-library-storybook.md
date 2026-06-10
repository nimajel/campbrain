# UI Component Library + Storybook Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a typed UI component library in `web/components/ui/` (thin wrappers over the existing `globals.css` classes) with a Storybook 9 catalog, and migrate the dashboard page to it as proof of adoption.

**Architecture:** Components compose existing global class names — no new CSS, `globals.css` stays the single restyle point. Storybook uses the `@storybook/nextjs-vite` framework with `globals.css` imported in preview so stories render exactly like the app. Stories are co-located CSF3 files with autodocs.

**Tech Stack:** Next.js 15, React 19, TypeScript strict, Storybook 9 (`@storybook/nextjs-vite`), Vite 6.

**Spec:** `docs/superpowers/specs/2026-06-10-component-library-storybook-design.md`

**Testing note:** No new unit-test infrastructure. These are presentational wrappers whose only logic is class-string composition; per the approved spec, the verification gates are `npm run typecheck` (covers all new .tsx strictly), `npm --prefix web run build-storybook` (all stories must compile and render at build time), `npm --prefix web run build`, and the existing root Vitest suite staying green. Run the relevant gates at the end of every task — do not commit if any fail.

**Conventions reminders:** TypeScript strict, no `any`. PascalCase component files (matches existing `web/components/`). Default exports for components (matches existing code). No comments/docstrings beyond what's shown. All commands run from the repo root `/Users/nimajelveh/campbrain`.

---

## File Structure

```
web/
  .storybook/
    main.ts                     Storybook config (framework, stories glob)
    preview.tsx                 globals.css import, fonts, backgrounds, autodocs
  components/
    ui/
      index.ts                  Barrel — grows as tasks add components
      Badge.tsx        + Badge.stories.tsx
      Button.tsx       + Button.stories.tsx
      Chip.tsx         + Chip.stories.tsx
      StatusDot.tsx    + StatusDot.stories.tsx
      SiteChip.tsx     + SiteChip.stories.tsx
      EmptyState.tsx   + EmptyState.stories.tsx
      Card.tsx         + Card.stories.tsx
      StatCard.tsx     + StatCard.stories.tsx
      PageHeader.tsx   + PageHeader.stories.tsx
      SectionTitle.tsx + SectionTitle.stories.tsx
      KVList.tsx       + KVList.stories.tsx   (also exports KVRow)
      Input.tsx        + Input.stories.tsx
      Toggle.tsx       + Toggle.stories.tsx
      Modal.tsx        + Modal.stories.tsx
    ProviderBadge.tsx           (existing) + ProviderBadge.stories.tsx
  app/
    components/SiteFilterPanel.tsx (existing) + SiteFilterPanel.stories.tsx
    map/DateRangePicker.tsx        (existing) + DateRangePicker.stories.tsx
    map/MapLegend.tsx              (existing) + MapLegend.stories.tsx
    page.tsx                    (modified — dashboard migration)
  package.json                  (modified — deps + scripts)
package.json                    (modified — root storybook passthrough script)
.gitignore                      (modified — storybook-static)
```

---

### Task 1: Storybook setup + Badge (smoke test)

**Files:**
- Modify: `web/package.json` (deps + scripts, via npm install)
- Create: `web/.storybook/main.ts`
- Create: `web/.storybook/preview.tsx`
- Create: `web/components/ui/Badge.tsx`
- Create: `web/components/ui/Badge.stories.tsx`
- Create: `web/components/ui/index.ts`
- Modify: `.gitignore`

- [ ] **Step 1: Install Storybook dependencies**

Run:
```bash
npm --prefix web install -D storybook@^9 @storybook/nextjs-vite@^9 vite@^6
```
Expected: installs cleanly (Storybook 9 supports Next 15 + React 19). If npm reports a peer conflict, stop and report — do not use `--force`.

- [ ] **Step 2: Create `web/.storybook/main.ts`**

```ts
import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
  framework: '@storybook/nextjs-vite',
  stories: ['../components/**/*.stories.tsx', '../app/**/*.stories.tsx'],
};

export default config;
```

- [ ] **Step 3: Create `web/.storybook/preview.tsx`**

Imports the app's real stylesheet and replicates the font setup from `web/app/layout.tsx` (which applies `--font-inter` / `--font-fraunces` variables on `<html>` — without this, `var(--font)` falls back to system fonts). Backgrounds use the app tokens: `--surface-2` (#fbfaf6, the `.main` body) as default, `--bg` (#ece5d6, page sand) as alternative.

```tsx
import type { Preview } from '@storybook/nextjs-vite';
import React from 'react';
import { Inter, Fraunces } from 'next/font/google';
import '../app/globals.css';

const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
const fraunces = Fraunces({ subsets: ['latin'], weight: ['400', '600', '700'], variable: '--font-fraunces', display: 'swap' });

const preview: Preview = {
  parameters: {
    backgrounds: {
      options: {
        app: { name: 'App body', value: '#fbfaf6' },
        page: { name: 'Page sand', value: '#ece5d6' },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'app' },
  },
  decorators: [
    (Story) => (
      <div
        className={`${inter.variable} ${fraunces.variable}`}
        style={{ fontFamily: 'var(--font)', fontSize: 14, lineHeight: 1.6, color: 'var(--text)', padding: 16 }}
      >
        <Story />
      </div>
    ),
  ],
  tags: ['autodocs'],
};

export default preview;
```

- [ ] **Step 4: Add scripts to `web/package.json`**

In the `"scripts"` block add:
```json
"storybook": "storybook dev -p 6006",
"build-storybook": "storybook build"
```

- [ ] **Step 5: Create `web/components/ui/Badge.tsx`**

Wraps `.badge .badge-*` (see `globals.css`). `title` and `style` pass-throughs are required by existing dashboard usage (`title="Email enabled"`, `ProviderBadge`'s `fontSize` override).

```tsx
import type { CSSProperties, ReactNode } from 'react';

export type BadgeTone = 'green' | 'red' | 'blue' | 'gray' | 'match';

export default function Badge({
  tone,
  children,
  title,
  style,
}: {
  tone: BadgeTone;
  children: ReactNode;
  title?: string;
  style?: CSSProperties;
}) {
  return (
    <span className={`badge badge-${tone}`} title={title} style={style}>
      {children}
    </span>
  );
}
```

- [ ] **Step 6: Create `web/components/ui/Badge.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Badge from './Badge';

const meta = {
  title: 'UI/Badge',
  component: Badge,
  args: { tone: 'green', children: 'Available' },
} satisfies Meta<typeof Badge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Green: Story = {};
export const Red: Story = { args: { tone: 'red', children: 'Unavailable' } };
export const Blue: Story = { args: { tone: 'blue', children: 'california-parks' } };
export const Gray: Story = { args: { tone: 'gray', children: 'walk-up' } };
export const Match: Story = { args: { tone: 'match', children: 'Site #4' } };
export const AllTones: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <Badge tone="green">green</Badge>
      <Badge tone="red">red</Badge>
      <Badge tone="blue">blue</Badge>
      <Badge tone="gray">gray</Badge>
      <Badge tone="match">match</Badge>
    </div>
  ),
};
```

- [ ] **Step 7: Create `web/components/ui/index.ts`**

```ts
export { default as Badge } from './Badge';
export type { BadgeTone } from './Badge';
```

- [ ] **Step 8: Ignore Storybook build output**

Append to `.gitignore` (repo root):
```
web/storybook-static/
```

- [ ] **Step 9: Verify**

Run: `npm run typecheck`
Expected: passes (both root and web tsc).

Run: `npm --prefix web run build-storybook`
Expected: ends with a line like `Output directory: .../web/storybook-static` and exit code 0. The Badge stories compile.

- [ ] **Step 10: Commit**

```bash
git add web/.storybook web/components/ui web/package.json web/package-lock.json .gitignore
git commit -m "feat(ui): Storybook 9 setup (nextjs-vite) + Badge primitive with stories"
```
(If the lockfile is at the repo root instead of `web/`, add that path instead.)

---

### Task 2: Button

**Files:**
- Create: `web/components/ui/Button.tsx`
- Create: `web/components/ui/Button.stories.tsx`
- Modify: `web/components/ui/index.ts`

- [ ] **Step 1: Create `web/components/ui/Button.tsx`**

Wraps `.btn` + `.btn-{variant}` + `.btn-sm`. `variant` omitted renders bare `.btn` (existing usage, e.g. the Book buttons in `MapClient.tsx` use `btn btn-sm`). Renders `<a>` when `href` is provided (Book/Manage links are anchors styled as buttons). Class order is `btn`, variant, size — matching existing markup exactly.

```tsx
import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'ghost' | 'slate' | 'danger' | 'success';

interface BaseProps {
  variant?: ButtonVariant;
  size?: 'sm';
  children: ReactNode;
}

type AsButton = BaseProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AsAnchor = BaseProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export type ButtonProps = AsButton | AsAnchor;

function btnClasses(variant?: ButtonVariant, size?: 'sm', className?: string): string {
  return ['btn', variant && `btn-${variant}`, size && `btn-${size}`, className]
    .filter(Boolean)
    .join(' ');
}

export default function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant, size, className, children, ...rest } = props;
    return (
      <a className={btnClasses(variant, size, className)} {...rest}>
        {children}
      </a>
    );
  }
  const { variant, size, className, children, type, ...rest } = props;
  return (
    <button type={type ?? 'button'} className={btnClasses(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}
```

- [ ] **Step 2: Create `web/components/ui/Button.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Button from './Button';

const meta = {
  title: 'UI/Button',
  component: Button,
  args: { children: 'Button' },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bare: Story = {};
export const Primary: Story = { args: { variant: 'primary', children: '+ New alert' } };
export const Ghost: Story = { args: { variant: 'ghost' } };
export const Slate: Story = { args: { variant: 'slate' } };
export const Danger: Story = { args: { variant: 'danger', children: 'Delete' } };
export const Success: Story = { args: { variant: 'success', children: 'Saved' } };
export const Small: Story = { args: { variant: 'ghost', size: 'sm', children: 'Manage →' } };
export const Disabled: Story = { args: { variant: 'primary', disabled: true } };
export const AsLink: Story = {
  args: { variant: 'primary', size: 'sm', href: 'https://www.parks.ca.gov', children: 'Book' },
};
export const AllVariants: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <Button>bare</Button>
      <Button variant="primary">primary</Button>
      <Button variant="ghost">ghost</Button>
      <Button variant="slate">slate</Button>
      <Button variant="danger">danger</Button>
      <Button variant="success">success</Button>
      <Button variant="primary" size="sm">primary sm</Button>
      <Button variant="primary" disabled>disabled</Button>
    </div>
  ),
};
```

- [ ] **Step 3: Add to barrel `web/components/ui/index.ts`**

```ts
export { default as Button } from './Button';
export type { ButtonProps, ButtonVariant } from './Button';
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` → passes.
Run: `npm --prefix web run build-storybook` → exit 0, Button stories included.

- [ ] **Step 5: Commit**

```bash
git add web/components/ui
git commit -m "feat(ui): Button primitive — variants, sm size, anchor mode"
```

---

### Task 3: Display primitives — Chip, StatusDot, SiteChip, EmptyState

**Files:**
- Create: `web/components/ui/Chip.tsx` + `Chip.stories.tsx`
- Create: `web/components/ui/StatusDot.tsx` + `StatusDot.stories.tsx`
- Create: `web/components/ui/SiteChip.tsx` + `SiteChip.stories.tsx`
- Create: `web/components/ui/EmptyState.tsx` + `EmptyState.stories.tsx`
- Modify: `web/components/ui/index.ts`

- [ ] **Step 1: Create `web/components/ui/Chip.tsx`**

```tsx
import type { ReactNode } from 'react';

export type ChipTone = 'green' | 'red' | 'gray' | 'yellow';

export default function Chip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={`chip chip-${tone}`}>{children}</span>;
}
```

- [ ] **Step 2: Create `web/components/ui/Chip.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Chip from './Chip';

const meta = {
  title: 'UI/Chip',
  component: Chip,
  args: { tone: 'green', children: 'fresh' },
} satisfies Meta<typeof Chip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Green: Story = {};
export const Red: Story = { args: { tone: 'red', children: 'error' } };
export const Gray: Story = { args: { tone: 'gray', children: 'stale' } };
export const Yellow: Story = { args: { tone: 'yellow', children: 'pending' } };
```

- [ ] **Step 3: Create `web/components/ui/StatusDot.tsx`**

Note: `web/app/calendar/page.tsx` has a local component also named `StatusDot` (`{ ok: boolean }` props). That one stays untouched — same name, different file scope, no conflict.

```tsx
export type DotTone = 'green' | 'red' | 'gray' | 'yellow';

export default function StatusDot({ tone }: { tone: DotTone }) {
  return <span className={`dot dot-${tone}`} />;
}
```

- [ ] **Step 4: Create `web/components/ui/StatusDot.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import StatusDot from './StatusDot';

const meta = {
  title: 'UI/StatusDot',
  component: StatusDot,
  args: { tone: 'green' },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Green: Story = {};
export const AllTones: Story = {
  render: () => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span><StatusDot tone="green" /> enabled / available</span>
      <span><StatusDot tone="red" /> error / unavailable</span>
      <span><StatusDot tone="gray" /> disabled / unknown</span>
      <span><StatusDot tone="yellow" /> pending</span>
    </div>
  ),
};
```

- [ ] **Step 5: Create `web/components/ui/SiteChip.tsx`**

Wraps `.site-chip` / `.site-chip--more`. Existing usage (`MapClient.tsx:53-64`): plain chips are `<span title=... style=...>`, the "+N more" / "Show fewer" chips are `<button>` with the `--more` modifier. Render a button whenever `onClick` is provided.

```tsx
import type { CSSProperties, ReactNode } from 'react';

export default function SiteChip({
  children,
  more = false,
  onClick,
  title,
  style,
}: {
  children: ReactNode;
  more?: boolean;
  onClick?: () => void;
  title?: string;
  style?: CSSProperties;
}) {
  const className = more ? 'site-chip site-chip--more' : 'site-chip';
  if (onClick) {
    return (
      <button type="button" className={className} onClick={onClick} title={title} style={style}>
        {children}
      </button>
    );
  }
  return (
    <span className={className} title={title} style={style}>
      {children}
    </span>
  );
}
```

- [ ] **Step 6: Create `web/components/ui/SiteChip.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import SiteChip from './SiteChip';

const meta = {
  title: 'UI/SiteChip',
  component: SiteChip,
  args: { children: 'Site 4' },
} satisfies Meta<typeof SiteChip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Muted: Story = { args: { children: 'Site 12 (walk-up)', style: { opacity: 0.75 } } };
export const More: Story = { args: { more: true, onClick: () => {}, children: '+8 more' } };
export const ChipRow: Story = {
  render: () => (
    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
      <SiteChip>Site 4</SiteChip>
      <SiteChip>Site 5</SiteChip>
      <SiteChip>Site 6</SiteChip>
      <SiteChip more onClick={() => {}}>+8 more</SiteChip>
    </div>
  ),
};
```

- [ ] **Step 7: Create `web/components/ui/EmptyState.tsx`**

```tsx
import type { ReactNode } from 'react';

export default function EmptyState({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}
```

- [ ] **Step 8: Create `web/components/ui/EmptyState.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import EmptyState from './EmptyState';

const meta = {
  title: 'UI/EmptyState',
  component: EmptyState,
  args: { children: 'No openings found yet.' },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithLink: Story = {
  render: () => (
    <EmptyState>
      No alerts configured. <a href="/alerts">Create your first alert →</a>
    </EmptyState>
  ),
};
```

- [ ] **Step 9: Add to barrel `web/components/ui/index.ts`**

```ts
export { default as Chip } from './Chip';
export type { ChipTone } from './Chip';
export { default as StatusDot } from './StatusDot';
export type { DotTone } from './StatusDot';
export { default as SiteChip } from './SiteChip';
export { default as EmptyState } from './EmptyState';
```

- [ ] **Step 10: Verify**

Run: `npm run typecheck` → passes.
Run: `npm --prefix web run build-storybook` → exit 0.

- [ ] **Step 11: Commit**

```bash
git add web/components/ui
git commit -m "feat(ui): Chip, StatusDot, SiteChip, EmptyState primitives with stories"
```

---

### Task 4: Layout primitives — Card, StatCard, PageHeader, SectionTitle, KVList

**Files:**
- Create: `web/components/ui/Card.tsx` + `Card.stories.tsx`
- Create: `web/components/ui/StatCard.tsx` + `StatCard.stories.tsx`
- Create: `web/components/ui/PageHeader.tsx` + `PageHeader.stories.tsx`
- Create: `web/components/ui/SectionTitle.tsx` + `SectionTitle.stories.tsx`
- Create: `web/components/ui/KVList.tsx` + `KVList.stories.tsx`
- Modify: `web/components/ui/index.ts`

- [ ] **Step 1: Create `web/components/ui/Card.tsx`**

`style` pass-through is required by existing usage (dashboard sets `opacity`, `RecentOpenings` sets `padding: 0`). `actions` renders the `.card-actions` row used on `/alerts`.

```tsx
import type { CSSProperties, ReactNode } from 'react';

export default function Card({
  children,
  actions,
  style,
}: {
  children: ReactNode;
  actions?: ReactNode;
  style?: CSSProperties;
}) {
  return (
    <div className="card" style={style}>
      {children}
      {actions && <div className="card-actions">{actions}</div>}
    </div>
  );
}
```

- [ ] **Step 2: Create `web/components/ui/Card.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Card from './Card';
import Button from './Button';

const meta = {
  title: 'UI/Card',
  component: Card,
  args: { children: 'Card content' },
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithActions: Story = {
  render: () => (
    <Card
      actions={
        <>
          <Button variant="ghost" size="sm">Edit</Button>
          <Button variant="danger" size="sm">Delete</Button>
        </>
      }
    >
      <h3 style={{ margin: 0 }}>Angel Island weekends</h3>
      <p style={{ margin: '8px 0 0', color: 'var(--muted)', fontSize: 13 }}>
        Angel Island SP · Ridge Sites · Sites: 4, 5, 6
      </p>
    </Card>
  ),
};
export const Dimmed: Story = { args: { style: { opacity: 0.6 }, children: 'Disabled alert card' } };
```

- [ ] **Step 3: Create `web/components/ui/StatCard.tsx`**

`valueStyle` is required by the dashboard ("Current matches" turns green when > 0).

```tsx
import type { CSSProperties, ReactNode } from 'react';

export default function StatCard({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: ReactNode;
  valueStyle?: CSSProperties;
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={valueStyle}>{value}</div>
    </div>
  );
}
```

- [ ] **Step 4: Create `web/components/ui/StatCard.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import StatCard from './StatCard';

const meta = {
  title: 'UI/StatCard',
  component: StatCard,
  args: { label: 'Active alerts', value: 3 },
} satisfies Meta<typeof StatCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Highlighted: Story = {
  args: { label: 'Current matches', value: 12, valueStyle: { color: 'var(--green)' } },
};
export const StatGrid: Story = {
  render: () => (
    <div className="grid-3">
      <StatCard label="Active alerts" value={<>3<span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400 }}>/5</span></>} />
      <StatCard label="Current matches" value={12} valueStyle={{ color: 'var(--green)' }} />
      <StatCard label="Total hits recorded" value={48} />
    </div>
  ),
};
```

- [ ] **Step 5: Create `web/components/ui/PageHeader.tsx`**

```tsx
export default function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {subtitle && <p className="page-subtitle">{subtitle}</p>}
    </div>
  );
}
```

- [ ] **Step 6: Create `web/components/ui/PageHeader.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import PageHeader from './PageHeader';

const meta = {
  title: 'UI/PageHeader',
  component: PageHeader,
  args: { title: 'Dashboard', subtitle: 'Campsite availability monitoring' },
} satisfies Meta<typeof PageHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const TitleOnly: Story = { args: { title: 'Settings', subtitle: undefined } };
```

- [ ] **Step 7: Create `web/components/ui/SectionTitle.tsx`**

```tsx
export default function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <>
      <div className="section-title">{title}</div>
      {desc && <p className="section-desc">{desc}</p>}
    </>
  );
}
```

- [ ] **Step 8: Create `web/components/ui/SectionTitle.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import SectionTitle from './SectionTitle';

const meta = {
  title: 'UI/SectionTitle',
  component: SectionTitle,
  args: { title: 'Notification channels' },
} satisfies Meta<typeof SectionTitle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithDescription: Story = {
  args: { title: 'Discover campgrounds', desc: 'Search the ReserveCalifornia catalog by park name.' },
};
```

- [ ] **Step 9: Create `web/components/ui/KVList.tsx`**

`label` is `ReactNode`, not `string` — existing usage on `/calendar` puts a status dot inside `.kv-key`.

```tsx
import type { ReactNode } from 'react';

export function KVRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{label}</span>
      <span className="kv-val">{children}</span>
    </div>
  );
}

export default function KVList({ items }: { items: Array<{ key: string; value: ReactNode }> }) {
  return (
    <>
      {items.map((item) => (
        <KVRow key={item.key} label={item.key}>
          {item.value}
        </KVRow>
      ))}
    </>
  );
}
```

- [ ] **Step 10: Create `web/components/ui/KVList.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import KVList, { KVRow } from './KVList';
import StatusDot from './StatusDot';

const meta = {
  title: 'UI/KVList',
  component: KVList,
  args: {
    items: [
      { key: 'Provider', value: 'california-parks' },
      { key: 'Park', value: 'Angel Island SP' },
      { key: 'Window opens', value: '2026-07-01 8:00 AM PT' },
    ],
  },
} satisfies Meta<typeof KVList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithRichLabels: Story = {
  render: () => (
    <>
      <KVRow label={<><StatusDot tone="green" /> Client ID</>}>configured</KVRow>
      <KVRow label={<><StatusDot tone="red" /> Client secret</>}>missing</KVRow>
    </>
  ),
};
```

- [ ] **Step 11: Add to barrel `web/components/ui/index.ts`**

```ts
export { default as Card } from './Card';
export { default as StatCard } from './StatCard';
export { default as PageHeader } from './PageHeader';
export { default as SectionTitle } from './SectionTitle';
export { default as KVList, KVRow } from './KVList';
```

- [ ] **Step 12: Verify**

Run: `npm run typecheck` → passes.
Run: `npm --prefix web run build-storybook` → exit 0.

- [ ] **Step 13: Commit**

```bash
git add web/components/ui
git commit -m "feat(ui): Card, StatCard, PageHeader, SectionTitle, KVList primitives with stories"
```

---

### Task 5: Form primitives + Modal — Input, Toggle, Modal

**Files:**
- Create: `web/components/ui/Input.tsx` + `Input.stories.tsx`
- Create: `web/components/ui/Toggle.tsx` + `Toggle.stories.tsx`
- Create: `web/components/ui/Modal.tsx` + `Modal.stories.tsx`
- Modify: `web/components/ui/index.ts`

- [ ] **Step 1: Create `web/components/ui/Input.tsx`**

Wraps `.form-input` (bordered input used in the map filter bar). With `label`, wraps in the `.form-row` label pattern used by the alert form.

```tsx
import type { InputHTMLAttributes } from 'react';

export default function Input({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const input = (
    <input {...rest} className={['form-input', className].filter(Boolean).join(' ')} />
  );
  if (!label) return input;
  return (
    <label className="form-row">
      {label}
      {input}
    </label>
  );
}
```

- [ ] **Step 2: Create `web/components/ui/Input.stories.tsx`**

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Input from './Input';

const meta = {
  title: 'UI/Input',
  component: Input,
  args: { placeholder: 'City, address, or zip' },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithLabel: Story = {
  args: { label: 'Alert name', placeholder: 'Angel Island Ridge weekends' },
};
export const DateInput: Story = { args: { type: 'date' } };
```

- [ ] **Step 3: Create `web/components/ui/Toggle.tsx`**

Wraps `.toggle` / `.toggle-slider` (defined in `globals.css:137-149` but currently unused in any TSX — this component gives the switch a home). CSS contract: container is `position: relative` with a hidden checkbox and a `+ .toggle-slider` sibling; wrapping in `<label>` makes the slider clickable. Labels cannot nest, so the text variant uses an outer `.label-inline` label with the switch as an inner `<span className="toggle">`.

```tsx
'use client';

export default function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
}) {
  const control = (
    <>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-slider" />
    </>
  );
  if (!label) return <label className="toggle">{control}</label>;
  return (
    <label className="label-inline" style={{ display: 'flex' }}>
      <span className="toggle">{control}</span>
      {label}
    </label>
  );
}
```

- [ ] **Step 4: Create `web/components/ui/Toggle.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Toggle from './Toggle';

function ToggleDemo({ label, disabled }: { label?: string; disabled?: boolean }) {
  const [checked, setChecked] = useState(true);
  return <Toggle checked={checked} onChange={setChecked} label={label} disabled={disabled} />;
}

const meta = {
  title: 'UI/Toggle',
  component: Toggle,
  args: { checked: true, onChange: () => {} },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Interactive: Story = { render: () => <ToggleDemo /> };
export const WithLabel: Story = { render: () => <ToggleDemo label="Email notifications" /> };
export const Disabled: Story = { args: { checked: false, disabled: true } };
```

- [ ] **Step 5: Create `web/components/ui/Modal.tsx`**

Mirrors the modal markup in `web/app/alerts/AlertsClient.tsx:380-385` exactly: backdrop click (on the backdrop itself, not children) closes, plus the × button. No Escape handling, matching existing behavior.

```tsx
'use client';

import type { ReactNode } from 'react';

export default function Modal({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  if (!open) return null;
  return (
    <div
      className="modal-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal">
        <div className="modal-header">
          <h2 style={{ margin: 0 }}>{title}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Create `web/components/ui/Modal.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Modal from './Modal';
import Button from './Button';

function ModalDemo() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>Open modal</Button>
      <Modal open={open} onClose={() => setOpen(false)} title="New Camping Alert">
        <p style={{ marginTop: 0 }}>Modal body content goes here.</p>
        <div className="card-actions">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => setOpen(false)}>Save alert</Button>
        </div>
      </Modal>
    </>
  );
}

const meta = {
  title: 'UI/Modal',
  component: Modal,
  args: { open: true, onClose: () => {}, title: 'New Camping Alert', children: 'Body' },
} satisfies Meta<typeof Modal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};
export const Interactive: Story = { render: () => <ModalDemo /> };
```

- [ ] **Step 7: Add to barrel `web/components/ui/index.ts`**

```ts
export { default as Input } from './Input';
export { default as Toggle } from './Toggle';
export { default as Modal } from './Modal';
```

- [ ] **Step 8: Verify**

Run: `npm run typecheck` → passes.
Run: `npm --prefix web run build-storybook` → exit 0.

- [ ] **Step 9: Commit**

```bash
git add web/components/ui
git commit -m "feat(ui): Input, Toggle, Modal primitives with stories"
```

---

### Task 6: Stories for existing components

**Files:**
- Create: `web/components/ProviderBadge.stories.tsx`
- Create: `web/app/components/SiteFilterPanel.stories.tsx`
- Create: `web/app/map/DateRangePicker.stories.tsx`
- Create: `web/app/map/MapLegend.stories.tsx`

No existing component is modified in this task.

- [ ] **Step 1: Create `web/components/ProviderBadge.stories.tsx`**

Provider IDs come from `PROVIDER_BADGES` in `web/lib/providers.ts` (`california-parks`, `recreation-gov`). Unknown IDs render nothing by design.

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import ProviderBadge from './ProviderBadge';

const meta = {
  title: 'Components/ProviderBadge',
  component: ProviderBadge,
  args: { providerId: 'california-parks' },
} satisfies Meta<typeof ProviderBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const CaliforniaParks: Story = {};
export const RecreationGov: Story = { args: { providerId: 'recreation-gov' } };
export const UnknownProviderRendersNothing: Story = { args: { providerId: 'unknown' } };
```

- [ ] **Step 2: Create `web/app/components/SiteFilterPanel.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import SiteFilterPanel from './SiteFilterPanel';
import { EMPTY_TAXONOMY } from '../../lib/site-taxonomy';
import type { TaxonomyState } from '../../lib/site-taxonomy';

function PanelDemo({ groups, dense }: { groups?: Array<'access' | 'kinds' | 'hide'>; dense?: boolean }) {
  const [state, setState] = useState<TaxonomyState>(EMPTY_TAXONOMY);
  return <SiteFilterPanel state={state} onChange={setState} groups={groups} dense={dense} />;
}

const meta = {
  title: 'Components/SiteFilterPanel',
  component: SiteFilterPanel,
  args: { state: EMPTY_TAXONOMY, onChange: () => {} },
} satisfies Meta<typeof SiteFilterPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AllGroups: Story = { render: () => <PanelDemo /> };
export const Dense: Story = { render: () => <PanelDemo dense /> };
export const HideGroupOnly: Story = { render: () => <PanelDemo groups={['hide']} /> };
```

- [ ] **Step 3: Create `web/app/map/DateRangePicker.stories.tsx`**

```tsx
import { useState } from 'react';
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import DateRangePicker from './DateRangePicker';

function PickerDemo({ mobile }: { mobile?: boolean }) {
  const [range, setRange] = useState({ from: '', to: '' });
  return (
    <DateRangePicker
      from={range.from}
      to={range.to}
      mobile={mobile}
      onChange={(from, to) => setRange({ from, to })}
    />
  );
}

const meta = {
  title: 'Components/DateRangePicker',
  component: DateRangePicker,
  args: { from: '', to: '', onChange: () => {} },
} satisfies Meta<typeof DateRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = { render: () => <PickerDemo /> };
export const MobileInline: Story = { render: () => <PickerDemo mobile /> };
```

- [ ] **Step 4: Create `web/app/map/MapLegend.stories.tsx`**

`MapLegend` is absolutely positioned (bottom-left) and expands on hover, so it needs a positioned container.

```tsx
import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import MapLegend from './MapLegend';

const meta = {
  title: 'Components/MapLegend',
  component: MapLegend,
  args: { dateFilterActive: false },
  decorators: [
    (Story) => (
      <div style={{ position: 'relative', height: 240, background: '#dce6d3', borderRadius: 8 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MapLegend>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const WithDateFilter: Story = { args: { dateFilterActive: true } };
```

- [ ] **Step 5: Verify**

Run: `npm run typecheck` → passes.
Run: `npm --prefix web run build-storybook` → exit 0.

Known risk: `SiteFilterPanel` transitively imports `web/lib/site-taxonomy.ts`, which re-exports `isWalkUpSite` from `../../src/catalog/site-classifier.js` (a `.js` specifier pointing at a `.ts` file). Vite resolves this pattern, and `site-classifier.ts` is pure regex logic with no Node dependencies. If the Storybook build nevertheless fails resolving it, the fix is to import `ACCESS_GROUP`/`KIND_GROUP`/`HIDE_GROUP` directly — but try as written first and report if the workaround was needed.

- [ ] **Step 6: Manually spot-check in the dev server**

Run: `npm --prefix web run storybook` (port 6006), open the four component stories, confirm: pills toggle in SiteFilterPanel, the date popover opens and selects a range, the legend expands on hover, provider badges show correct labels/colors. Stop the server when done.

- [ ] **Step 7: Commit**

```bash
git add web/components/ProviderBadge.stories.tsx web/app/components/SiteFilterPanel.stories.tsx web/app/map/DateRangePicker.stories.tsx web/app/map/MapLegend.stories.tsx
git commit -m "feat(ui): stories for ProviderBadge, SiteFilterPanel, DateRangePicker, MapLegend"
```

---

### Task 7: Dashboard proof-of-adoption migration

**Files:**
- Modify: `web/app/page.tsx`

The rendered markup must be class-for-class identical to the current page. Only the JSX expression of it changes.

- [ ] **Step 1: Rewrite `web/app/page.tsx`**

Replace the full file with:

```tsx
import { listAlertsWeb } from '../lib/alerts';
import { getLatestScanState, getHitsState } from '../lib/state';
import RecentOpenings from './components/RecentOpenings';
import { Badge, Button, Card, EmptyState, PageHeader, StatCard, StatusDot } from '../components/ui';
import type { Alert } from '../lib/alerts';
import type { LatestScanSummary } from '../lib/state';

export const dynamic = 'force-dynamic';

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function dateRangeLabel(alert: Alert): string {
  switch (alert.dateMode) {
    case 'exact_dates': return `${alert.exactStartDate ?? '?'} → ${alert.exactEndDate ?? '?'}`;
    case 'date_range':
    case 'weekend_range': return `${alert.rangeStart ?? '?'} – ${alert.rangeEnd ?? '?'}${alert.weekendsOnly ? ' (wkds)' : ''}`;
    case 'next_available_weekend': return `Next ${alert.nextWeeksCount ?? 12} weekends`;
  }
}

function AlertRow({ alert, scan }: { alert: Alert; scan?: LatestScanSummary }) {
  return (
    <Card style={{ opacity: alert.enabled ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <StatusDot tone={alert.enabled ? 'green' : 'gray'} />
        <h3 style={{ margin: 0, flex: 1 }}>{alert.name}</h3>
        <Badge tone="blue">{alert.provider}</Badge>
        {alert.emailEnabled && <Badge tone="gray" title="Email enabled">📧</Badge>}
        {alert.calendarEnabled && <Badge tone="gray" title="Calendar enabled">📅</Badge>}
      </div>

      <div style={{ display: 'flex', gap: 24, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
        <span>{alert.parkName} · {alert.campgroundName}</span>
        <span>{dateRangeLabel(alert)}</span>
        <span>Sites: {alert.acceptableSites.join(', ')}</span>
      </div>

      {scan && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', display: 'flex', gap: 20, fontSize: 12 }}>
          <span style={{ color: 'var(--muted)' }}>Last scan {relativeTime(scan.scannedAt)}</span>
          <span style={{ color: scan.matchCount > 0 ? 'var(--green)' : 'var(--muted)', fontWeight: scan.matchCount > 0 ? 600 : 400 }}>
            {scan.matchCount > 0
              ? `🎯 ${scan.matchCount} match${scan.matchCount !== 1 ? 'es' : ''}`
              : `${scan.candidatesScanned} candidates, no matches`}
          </span>
        </div>
      )}

      {!scan && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)', fontSize: 12, color: 'var(--muted)' }}>
          Not scanned yet
        </div>
      )}

      <div style={{ marginTop: 10 }}>
        <Button href="/alerts" variant="ghost" size="sm">Manage →</Button>
      </div>
    </Card>
  );
}

export default function DashboardPage() {
  const alerts = listAlertsWeb();
  const scanState = getLatestScanState();
  const hitsState = getHitsState();

  const activeAlerts = alerts.filter((a) => a.enabled);
  const totalMatches = Object.values(scanState).reduce((sum, s) => sum + s.matchCount, 0);
  const totalHits = hitsState.hits.length;
  const lastScanTime = Object.values(scanState)
    .map((s) => s.scannedAt)
    .sort()
    .at(-1);

  return (
    <>
      <PageHeader title="Dashboard" subtitle="Campsite availability monitoring" />

      <div className="grid-3" style={{ marginBottom: 24 }}>
        <StatCard
          label="Active alerts"
          value={<>{activeAlerts.length}<span style={{ fontSize: 14, color: 'var(--muted)', fontWeight: 400 }}>/{alerts.length}</span></>}
        />
        <StatCard
          label="Current matches"
          value={totalMatches}
          valueStyle={totalMatches > 0 ? { color: 'var(--green)' } : undefined}
        />
        <StatCard label="Total hits recorded" value={totalHits} />
      </div>

      {lastScanTime && (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 24 }}>
          Last scan {relativeTime(lastScanTime)} · <a href="/scan-history">View full history</a>
        </div>
      )}

      <RecentOpenings limit={5} />

      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <h2 style={{ margin: 0, flex: 1 }}>Alerts</h2>
        <Button href="/alerts" variant="primary" size="sm">+ New alert</Button>
      </div>

      {alerts.length === 0 && (
        <EmptyState>
          No alerts configured. <a href="/alerts">Create your first alert →</a>
        </EmptyState>
      )}

      {alerts.map((a) => (
        <AlertRow key={a.id} alert={a} scan={scanState[a.id]} />
      ))}
    </>
  );
}
```

Markup-equivalence map (verify while editing):
- `<div className="page-header"><h1>…</h1><p className="page-subtitle">…</p></div>` → `PageHeader` ✓
- `<div className="card"><div className="stat-label">…</div><div className="stat-value" style=…>…</div></div>` → `StatCard` ✓
- `<span className="dot dot-green|dot-gray" />` → `StatusDot` ✓
- `<span className="badge badge-blue|badge-gray" title=…>` → `Badge` ✓
- `<a href="/alerts" className="btn btn-ghost btn-sm">` / `btn btn-primary btn-sm` → `Button href` ✓
- `<div className="empty">` → `EmptyState` ✓
- `<div className="card" style={{opacity:…}}>` → `Card style` ✓ (the “Manage →” wrapper div stays a plain `<div style={{marginTop:10}}>`, NOT the `actions` slot — the original has no `.card-actions`)

- [ ] **Step 2: Verify build + typecheck**

Run: `npm run typecheck` → passes.
Run: `npm --prefix web run build` → builds with no errors.

- [ ] **Step 3: Verify the page renders identically**

Start `npm run dev`, load `http://localhost:3001/`, confirm: stat cards, alert cards, badges, dots, Manage/+ New alert buttons all look unchanged; no console errors or hydration warnings. Stop the server.

- [ ] **Step 4: Commit**

```bash
git add web/app/page.tsx
git commit -m "refactor(dashboard): consume ui component library (markup-identical)"
```

---

### Task 8: Root script + full verification

**Files:**
- Modify: `package.json` (root)

- [ ] **Step 1: Add root passthrough script**

In root `package.json` scripts, after `"dev"`:
```json
"storybook": "npm --prefix web run storybook",
```

- [ ] **Step 2: Full verification suite**

Run each, all must pass:
```bash
npm run typecheck
npm test
npm --prefix web run build
npm --prefix web run build-storybook
```
Expected: typecheck clean, 340 Vitest tests pass, both builds exit 0.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: root storybook script"
```

- [ ] **Step 4: Post-ship documentation**

Dispatch the **doc-steward** agent (or run the `doc-steward` skill) to reconcile:
- `docs/reference/design-system.md` — add the `web/components/ui/` library + Storybook, fix stale Tailwind/token claims
- `CLAUDE.md` — Commands section (`npm run storybook`), stack corrections
