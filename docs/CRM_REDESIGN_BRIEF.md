# Growth Escalators CRM — Complete UI Redesign Brief

> **Purpose:** Share this document with Claude Design (or any design AI/tool) to redesign the entire CRM admin interface.
> **Target aesthetic:** Microsoft Fluent Design system — clean, professional, with **blue + white + orange** color scheme.
> **Current state:** Plain Tailwind CSS, dark slate sidebar, sky-blue accents, system fonts, no design tokens.

---

## 1. What the CRM Looks Like Today

### 1.1 Current Tech Stack
- **Framework:** React 18 + Vite (JSX, not TypeScript)
- **Styling:** Plain Tailwind CSS utility classes inline in JSX (no shadcn/ui, no CSS modules, no design tokens)
- **Icons:** `lucide-react`
- **Charts:** Custom SVG components (`FunnelChart`, `LineChart`, `StackedBars`, `KpiTile`)
- **Fonts:** System font stack only (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif`)
- **Routing:** `react-router-dom` v6 with `React.lazy()` code-splitting

### 1.2 Current Layout Structure
```
┌─────────────────────────────────────────────────┐
│ Sidebar (slate-900) │ TopBar (white, sticky)     │
│                     │                            │
│  Logo "GE"          │  Breadcrumbs │ Search │ 🔔 │
│  ─────────────      ├────────────────────────────┤
│  Personal           │                            │
│  • Dashboard        │   Page Content             │
│  • Inbox            │   (slate-50 background)    │
│                     │                            │
│  CRM                │   White cards with         │
│  • Contacts         │   rounded-lg borders       │
│  • Pipeline         │                            │
│  • Tasks            │                            │
│                     │                            │
│  Marketing          │                            │
│  • Ads              │                            │
│  • Social           │                            │
│                     │                            │
│  Wizmatch           │                            │
│  • Signals          │                            │
│  • Candidates       │                            │
│  • ...8 pages       │                            │
│                     │                            │
│  ─────────────      │                            │
│  User + Logout      │                            │
└─────────────────────────────────────────────────┘
```

### 1.3 Current Color Palette (Hardcoded)
| Element | Current Color | Tailwind Class |
|---|---|---|
| Sidebar background | `#0f172a` | `bg-slate-900` |
| Content background | `#f8fafc` | `bg-slate-50` / `body` CSS |
| Cards | `#ffffff` | `bg-white` |
| Primary action buttons | `#0ea5e9` / `#0284c7` | `bg-sky-500` / `bg-sky-600` |
| Active nav border | `#34d399` | `border-l-emerald-400` |
| Logo gradient | sky-500 → emerald-400 | `from-sky-500 to-emerald-400` |
| Text primary | `#0f172a` | `text-slate-900` |
| Text secondary | `#64748b` | `text-slate-500` |
| Nav text | `#94a3b8` | `text-slate-400` |
| Border/divider | `#e2e8f0` | `border-slate-200` |
| Brand (Tailwind config) | `brand.500: #0ea5e9` | Only 5 shades defined |

### 1.4 Current Tailwind Config
```javascript
// admin/tailwind.config.js — EXTREMELY MINIMAL
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
        },
      },
    },
  },
  plugins: [],
};
```

### 1.5 Current CSS (entire file)
```css
/* admin/src/index.css — 14 LINES TOTAL */
@tailwind base;
@tailwind components;
@tailwind utilities;

* { box-sizing: border-box; }

body {
  margin: 0;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif;
  background-color: #f8fafc;
  color: #0f172a;
}
```

---

## 2. Target Design Vision

### 2.1 Design Language: Fluent Design (Microsoft)

Fluent Design principles to apply:
- **Depth through layering:** Subtle shadows, not flat. Elevation levels for cards, modals, flyouts.
- **Material:** Acrylic/mica backgrounds for sidebar and overlays (translucent blur effect).
- **Motion:** Smooth, purposeful animations (slide-in panels, fade transitions, hover reveals).
- **Light:** Subtle hover highlights that "light up" interactive elements.
- **Scale:** Clean typography hierarchy with clear visual weight differentiation.

### 2.2 Color Scheme: Blue + White + Orange

#### Primary Palette — Blue (Trust, Professional)
| Token | Hex | Usage |
|---|---|---|
| `primary-50` | `#eff6ff` | Hover backgrounds, subtle tints |
| `primary-100` | `#dbeafe` | Selected states, badges |
| `primary-200` | `#bfdbfe` | Borders on focus |
| `primary-300` | `#93c5fd` | Disabled primary |
| `primary-400` | `#60a5fa` | Secondary hover |
| `primary-500` | `#3b82f6` | Primary buttons, active links |
| `primary-600` | `#2563eb` | Primary button hover |
| `primary-700` | `#1d4ed8` | Pressed states |
| `primary-800` | `#1e40af` | Sidebar dark sections |
| `primary-900` | `#1e3a8a` | Sidebar deepest |

#### Accent Palette — Orange (Energy, CTAs, Highlights)
| Token | Hex | Usage |
|---|---|---|
| `accent-50` | `#fff7ed` | Warning/warm hover |
| `accent-100` | `#ffedd5` | Notification backgrounds |
| `accent-200` | `#fed7aa` | Alert borders |
| `accent-400` | `#fb923c` | Secondary CTAs, progress bars |
| `accent-500` | `#f97316` | **Main accent — CTAs, highlights, badges** |
| `accent-600` | `#ea580c` | Accent button hover |
| `accent-700` | `#c2410c` | Pressed accent |

#### Neutral Palette — White/Gray (Clean Canvas)
| Token | Hex | Usage |
|---|---|---|
| `neutral-0` | `#ffffff` | Card backgrounds, modals |
| `neutral-50` | `#f8fafc` | Page background |
| `neutral-100` | `#f1f5f9` | Hover backgrounds |
| `neutral-200` | `#e2e8f0` | Borders, dividers |
| `neutral-300` | `#cbd5e1` | Disabled borders |
| `neutral-400` | `#94a3b8` | Placeholder text |
| `neutral-500` | `#64748b` | Secondary text |
| `neutral-600` | `#475569` | Body text |
| `neutral-700` | `#334155` | Headings |
| `neutral-800` | `#1e293b` | Sidebar bg (lighter than current) |
| `neutral-900` | `#0f172a` | Primary text |

#### Semantic Colors
| Token | Hex | Usage |
|---|---|---|
| `success-500` | `#22c55e` | Success states, positive metrics |
| `success-600` | `#16a34a` | Success button hover |
| `warning-500` | `#f59e0b` | Warning badges |
| `danger-500` | `#ef4444` | Error states, destructive actions |
| `danger-600` | `#dc2626` | Danger button hover |

### 2.3 Typography
- **Primary Font:** `Inter` (Google Fonts) — for all UI text, labels, tables, buttons
- **Monospace Font:** `JetBrains Mono` or `Fira Code` — for code snippets, API keys, JSON previews
- **Heading Weight:** 600 (semibold) for section headers, 700 (bold) for page titles
- **Body Weight:** 400 (regular) for content, 500 (medium) for labels/buttons

```css
/* Recommended font import */
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');

/* Or via fontsource for offline (npm install @fontsource/inter) */
```

### 2.4 Spacing & Border Radius
- **Border Radius:** `8px` for cards/buttons (Fluent standard), `4px` for inputs, `12px` for modals
- **Card Padding:** `24px` (px-6 py-6)
- **Section Spacing:** `32px` between major sections
- **Sidebar Width:** `240px` (current) or `256px` (slightly wider for breathing room)

### 2.5 Shadows (Fluent Elevation)
```css
--shadow-card: 0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.06);
--shadow-hover: 0 4px 12px rgba(0,0,0,0.08), 0 2px 4px rgba(0,0,0,0.06);
--shadow-modal: 0 20px 60px rgba(0,0,0,0.15), 0 8px 20px rgba(0,0,0,0.1);
--shadow-sidebar: 4px 0 24px rgba(0,0,0,0.06);
```

---

## 3. Component-by-Component Redesign Guide

### 3.1 Sidebar
**Current:** Solid `bg-slate-900`, emerald-400 active border, sky/emerald gradient logo.

**New (Fluent):**
- Background: Mica/Acrylic effect — `rgba(30, 41, 59, 0.95)` with `backdrop-filter: blur(20px)` (or solid `neutral-800` as fallback)
- Logo: Replace "GE" gradient with a cleaner blue-to-white wordmark: "Growth Escalators" with a small blue square logo containing a white upward arrow (escalator metaphor)
- Active nav item: Blue accent bar on left (`primary-500`), background `primary-50/10` overlay, text becomes white
- Hover nav item: Background `white/5`, text becomes `neutral-200`
- Section labels: `primary-300` uppercase, letter-spacing wider
- User avatar: Blue circle (`primary-500`) with white initial
- Orange accent: Notification badges use `accent-500`

### 3.2 TopBar
**Current:** White sticky bar, breadcrumbs left, search center, feedback/bell/avatar right.

**New (Fluent):**
- Background: White with `shadow-card` on scroll
- Search bar: Wider, `neutral-100` background, `neutral-200` border, `primary-500` focus ring. Rounded `8px`.
- Breadcrumb separator: Use chevron icon in `neutral-400`
- Add a subtle "command bar" feel: All action buttons in the topbar use the same icon button style (40x40px, `neutral-100` hover, `8px` radius)
- Notification bell: Show `accent-500` dot for unread

### 3.3 Cards
**Current:** `bg-white rounded-lg border border-slate-200 shadow-sm` (generic).

**New (Fluent):**
- Background: `neutral-0` (white)
- Border: `1px solid neutral-200`
- Border radius: `8px` (Fluent standard)
- Shadow: `var(--shadow-card)` at rest, `var(--shadow-hover)` on hover
- Transition: `all 200ms cubic-bezier(0.4, 0, 0.2, 1)`
- Optional: Blue top-accent bar (`primary-500`, 3px height) for priority cards

### 3.4 Tables
**Current:** Plain HTML `<table>` with Tailwind classes, `divide-y divide-slate-200`.

**New (Fluent):**
- Header: `neutral-50` background, `neutral-500` text, `text-xs font-semibold uppercase tracking-wider`, `12px` padding
- Rows: `neutral-0` background, `56px` height minimum, hover `neutral-50`
- Row borders: `1px solid neutral-100` (barely visible)
- Selected row: `primary-50` background, `primary-500` left border (3px)
- Action buttons in rows: Icon-only, `neutral-400` → `primary-600` on hover
- Status badges: See Badge section below

### 3.5 Buttons
**Current:** Inconsistent — some `bg-sky-600`, some `bg-slate-100`, inline styles in some places.

**New (Fluent) — 4 button variants:**

| Variant | Background | Text | Border | Usage |
|---|---|---|---|---|
| **Primary** | `primary-500` → hover `primary-600` | White | None | Main CTA (Save, Send, Create) |
| **Accent** | `accent-500` → hover `accent-600` | White | None | Secondary CTA (Export, Highlight) |
| **Standard** | `neutral-100` → hover `neutral-200` | `neutral-700` | `1px neutral-200` | Default actions (Cancel, Filter) |
| **Subtle** | Transparent → hover `neutral-100` | `neutral-600` | None | Tertiary actions, icon buttons |

- **Height:** `36px` standard, `32px` compact, `40px` large
- **Border radius:** `6px` (Fluent standard)
- **Font:** `14px`, `font-weight: 600`
- **Padding:** `px-4` horizontal, auto vertical
- **Focus ring:** `2px primary-400` with `2px` offset

### 3.6 Badges/Status Pills
**Current:** Inconsistent color maps per page (e.g., `STATUS_COLORS` object with hardcoded Tailwind classes).

**New (Fluent) — Standardized status badge system:**

| Status Type | Background | Text | Border |
|---|---|---|---|
| **Active/Success** | `success-500/10` | `success-600` | `success-500/20` |
| **Pending/Warning** | `warning-500/10` | `warning-600` | `warning-500/20` |
| **Error/Danger** | `danger-500/10` | `danger-600` | `danger-500/20` |
| **Info/Neutral** | `primary-500/10` | `primary-700` | `primary-500/20` |
| **Accent/Highlight** | `accent-500/10` | `accent-700` | `accent-500/20` |
| **Muted/Inactive** | `neutral-200` | `neutral-500` | `neutral-300` |

Format: `inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium`

### 3.7 Inputs/Form Controls
**Current:** `border border-slate-200 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-sky-500`

**New (Fluent):**
- Background: `neutral-0`
- Border: `1px solid neutral-300` at rest, `primary-500` on focus, `danger-500` on error
- Border radius: `4px` (Fluent inputs are slightly less rounded than cards)
- Height: `36px` standard
- Focus ring: `2px primary-200` subtle glow (not the harsh sky ring)
- Label: `13px font-semibold neutral-700` above input
- Helper text: `12px neutral-400` below input
- Placeholder: `neutral-400` italic

### 3.8 Modals/Dialogs
**Current:** Inline conditional rendering, inconsistent styling.

**New (Fluent):**
- Background: `neutral-0` with `shadow-modal`
- Border radius: `12px`
- Header: `18px font-bold neutral-900`, `24px` padding, bottom border `neutral-100`
- Body: `24px` padding, `14px` body text
- Footer: `16px` padding, right-aligned buttons with `12px` gap
- Backdrop: `rgba(0,0,0,0.4)` with `backdrop-blur(4px)`
- Animation: Fade-in + scale from `0.95` to `1.0`, `200ms ease-out`

### 3.9 Slide-In Panels (Drawers/Sheets)
**Current:** Inline conditional rendering, `fixed right-0`.

**New (Fluent):**
- Width: `480px` (standard) or `640px` (wide detail)
- Background: `neutral-0` with `shadow-modal`
- Slide animation: `300ms cubic-bezier(0.4, 0, 0.2, 1)` from right
- Header: Sticky top, `18px font-bold`, close button top-right
- Body: Scrollable, `24px` padding
- Backdrop: Same as modal

### 3.10 Charts/Analytics
**Current:** Custom SVG charts (`FunnelChart`, `LineChart`, `StackedBars`, `KpiTile`).

**New:**
- KPI Cards: Large number in `neutral-900 32px font-bold`, label in `neutral-500 13px`, trend arrow in `success-500` (up) or `danger-500` (down). Blue accent line at top.
- Charts: Use `primary-500` for primary data series, `accent-500` for comparison series, `neutral-300` for gridlines. Tooltip: `neutral-800` background, white text, `8px` radius.
- Consider migrating to **Recharts** for consistency and easier theming.

---

## 4. Page-by-Page Inventory (27 Pages Total)

### CRM Pages (19)
| Page | Route | Key UI Elements |
|---|---|---|
| Dashboard | `/dashboard` | KPI cards, charts, recent activity feed |
| Contacts | `/contacts` | Table with filters, slide-in detail, bulk actions |
| Pipeline | `/pipeline` | Kanban board with drag-drop |
| Pipeline Settings | `/pipelines/settings` | Stage management form |
| Email Templates | `/emails` | Template list + editor |
| Billing | `/billing` | Invoice table, payment cards |
| Finance | `/finance` | Expense table, attendance, leave approvals |
| Permissions | `/settings/permissions` | User table with role management |
| Audit Log | `/settings/audit` | Timeline table with filters |
| Ads | `/ads` | Ad account cards, performance charts |
| Meta Assets | `/meta-assets` | Asset grid |
| Social | `/social` | Social calendar, post composer |
| Inbox | `/inbox` | Email list + detail pane |
| Lead Discovery | `/discover` | Search form + results grid |
| Analytics | `/analytics` | Charts dashboard |
| SEO | `/seo` | SEO monitoring table |
| Intelligence | `/intelligence` | Chat interface + automation cards |
| Growth OS | `/growth-os` | Dashboard with widgets |
| WhatsApp Templates | `/whatsapp-templates` | Template list + editor |

### Task Pages (2)
| Page | Route | Key UI Elements |
|---|---|---|
| Tasks Board | `/tasks` | Kanban board |
| My Attendance | `/my-attendance` | Time tracking, calendar |

### Outreach Pages (3)
| Page | Route | Key UI Elements |
|---|---|---|
| Outreach Dashboard | `/outreach-dashboard` | KPI cards + charts |
| Outbound | `/outbound` | Prospect table with sequences |
| Links | `/links` | Short link table |

### Client Pages (2)
| Page | Route | Key UI Elements |
|---|---|---|
| Clients | `/clients` | Client cards grid |
| Client Detail | `/client/:id` | Tabbed detail view |

### Funnel Pages (1)
| Page | Route | Key UI Elements |
|---|---|---|
| Funnel Management | `/funnels` | Funnel builder + list |

### Wizmatch Pages (8)
| Page | Route | Key UI Elements |
|---|---|---|
| Signals Dashboard | `/wizmatch/signals` | Filter bar + scored signals table |
| Candidate Pool | `/wizmatch/candidates` | Filter bar + candidate table |
| Review Queue | `/wizmatch/queue` | Card-based email review layout |
| Domain Health | `/wizmatch/domains` | Status cards per domain |
| Compliance Log | `/wizmatch/compliance` | Date filter + audit table + suppression list |
| Placements Pipeline | `/wizmatch/placements` | Kanban: Submitted → Started → Lost |
| Primes Management | `/wizmatch/primes` | Prime company list + MSA upload |
| Analytics | `/wizmatch/analytics` | KPI cards + charts + learn loop |

---

## 5. Implementation Strategy

### 5.1 Recommended Approach: Design Tokens First

**Step 1:** Create CSS custom properties (design tokens) in `index.css`:
```css
:root {
  /* Colors */
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  --color-accent-500: #f97316;
  /* ... full palette ... */

  /* Shadows */
  --shadow-card: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-hover: 0 4px 12px rgba(0,0,0,0.08);

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;

  /* Typography */
  --font-sans: 'Inter', -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', monospace;
}
```

**Step 2:** Update `tailwind.config.js` with the full palette:
```javascript
colors: {
  primary: { 50: '#eff6ff', /* ... */ 900: '#1e3a8a' },
  accent: { 50: '#fff7ed', /* ... */ 700: '#c2410c' },
  neutral: { 0: '#ffffff', /* ... */ 900: '#0f172a' },
  success: { /* ... */ },
  warning: { /* ... */ },
  danger: { /* ... */ },
},
fontFamily: {
  sans: ['Inter', 'system-ui', 'sans-serif'],
  mono: ['JetBrains Mono', 'monospace'],
},
boxShadow: {
  'card': 'var(--shadow-card)',
  'hover': 'var(--shadow-hover)',
  'modal': 'var(--shadow-modal)',
},
borderRadius: {
  'sm': '4px',
  'md': '6px',
  'lg': '8px',
  'xl': '12px',
},
```

**Step 3:** Create reusable component classes in `index.css` using `@layer components`:
```css
@layer components {
  .btn-primary { @apply bg-primary-500 hover:bg-primary-600 text-white font-semibold rounded-md px-4 py-2 transition-all duration-200; }
  .btn-accent { @apply bg-accent-500 hover:bg-accent-600 text-white font-semibold rounded-md px-4 py-2 transition-all duration-200; }
  .btn-standard { @apply bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-200 font-semibold rounded-md px-4 py-2 transition-all duration-200; }
  .card { @apply bg-white border border-neutral-200 rounded-lg shadow-card transition-all duration-200; }
  .card-hover { @apply hover:shadow-hover; }
  .badge { @apply inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium; }
  .input { @apply w-full border border-neutral-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-200 focus:border-primary-500 transition-all; }
}
```

**Step 4:** Incrementally update each page/component to use new tokens.

### 5.2 Alternative: Full Migration to shadcn/ui

If the user wants a more structured approach, consider migrating to **shadcn/ui** (Radix primitives + Tailwind). This would:
- Provide accessible, pre-built components (Button, Card, Dialog, Table, Badge, Input, Select, etc.)
- Standardize all component patterns
- Make theming trivial (CSS variable based)
- Require more upfront work but cleaner long-term

**Recommended if:** The user plans to add many more features and wants maintainability.

### 5.3 What to Ask Claude Design For

When sharing this with Claude Design, request:

1. **High-fidelity mockups** of these 5 key screens:
   - Dashboard (KPI cards + activity feed + charts)
   - Contacts table (filters + table + slide-in detail)
   - Pipeline Kanban board
   - Wizmatch Signals dashboard
   - Wizmatch Review Queue (email approval cards)

2. **Design system spec** including:
   - Complete color palette with hex values
   - Typography scale (font sizes, weights, line heights)
   - Spacing system
   - Component specs (Button, Card, Table, Badge, Input, Modal, Drawer)
   - Shadow/elevation system
   - Animation specs (durations, easing curves)

3. **CSS/Tailwind code** ready to paste:
   - Updated `tailwind.config.js`
   - Updated `index.css` with design tokens
   - Reusable component classes
   - At least 3 component code examples (Button, Card, Table)

4. **Sidebar redesign** mockup — the most visible change. Request:
   - Dark blue sidebar (`neutral-800` / `primary-900`) with acrylic blur
   - New logo treatment
   - Active state with `primary-500` accent bar
   - Orange notification badges

---

## 6. Files to Share with Claude Design

### 6.1 Essential Files (paste these into the Claude Design conversation)

| File | Why |
|---|---|
| `admin/tailwind.config.js` | Current theme — minimal, needs expansion |
| `admin/src/index.css` | Current global styles — 14 lines, needs design tokens |
| `admin/src/components/Sidebar.jsx` | Main layout shell, sidebar structure |
| `admin/src/components/TopBar.jsx` | Top bar with search, breadcrumbs, user actions |
| `admin/src/components/navEntries.js` | Full navigation tree (all 27+ pages) |
| `admin/src/pages/DashboardPage.jsx` | Most complex page — KPI cards, charts, activity |
| `admin/src/pages/WizmatchSignalsPage.jsx` | Representative Wizmatch page — table + filters + drawer |

### 6.2 Reference Files (helpful for understanding patterns)

| File | Why |
|---|---|
| `admin/src/components/MetricCard.jsx` | KPI card pattern |
| `admin/src/components/StatCard.jsx` | Stat card pattern |
| `admin/src/components/Breadcrumbs.jsx` | Breadcrumb pattern |
| `admin/src/components/CommandPalette.jsx` | Cmd+K palette (Fluent-like feature) |
| `admin/src/components/EmptyState.jsx` | Empty state pattern |
| `admin/src/components/SkeletonLoader.jsx` | Loading state pattern |
| `admin/src/components/charts/KpiTile.jsx` | Chart component |
| `admin/src/lib/format.js` | Formatting utilities (currency, dates) |

### 6.3 Screenshots to Capture

Take screenshots of these pages from the live CRM at `https://crm.growthescalators.com` (after login):

1. **Dashboard** — shows KPI cards, charts, activity feed
2. **Contacts** — shows the main table pattern used everywhere
3. **Pipeline** — shows the Kanban board
4. **Inbox** — shows the split-pane email view
5. **Wizmatch Signals** — shows the newest pages with table + filters
6. **Wizmatch Review Queue** — shows the card-based email review layout
7. **Sidebar collapsed/expanded** — shows all nav sections

---

## 7. Suggested Implementation Order

If implementing the redesign incrementally (recommended over big-bang):

| Phase | Scope | Effort |
|---|---|---|
| **Phase 1** | Design tokens: `tailwind.config.js` + `index.css` + font import | 2 hrs |
| **Phase 2** | Sidebar redesign (most visible change) | 3 hrs |
| **Phase 3** | TopBar + search bar + breadcrumbs | 2 hrs |
| **Phase 4** | Shared components: Button, Card, Badge, Input classes | 3 hrs |
| **Phase 5** | Dashboard page (most complex, highest visibility) | 4 hrs |
| **Phase 6** | Contacts table pattern (used by 10+ pages) | 4 hrs |
| **Phase 7** | Pipeline Kanban | 3 hrs |
| **Phase 8** | Wizmatch 8 pages (same patterns, quick to update) | 4 hrs |
| **Phase 9** | Remaining pages (Outreach, Clients, Funnels, etc.) | 6 hrs |
| **Phase 10** | Polish: animations, transitions, hover states, focus states | 3 hrs |
| **Total** | | ~34 hrs |

---

## 8. Fluent Design Specific Touches

These details make it feel authentically "Fluent" rather than just another Tailwind theme:

### 8.1 Acrylic/Mica Effect (Sidebar + Modals)
```css
.sidebar-fluent {
  background: rgba(30, 41, 59, 0.85);
  backdrop-filter: blur(40px) saturate(125%);
  -webkit-backdrop-filter: blur(40px) saturate(125%);
}
```

### 8.2 Reveal Hover (Cards + List Items)
Subtle border that follows the mouse:
```css
.card-reveal {
  position: relative;
  overflow: hidden;
}
.card-reveal::before {
  content: '';
  position: absolute;
  inset: 0;
  background: radial-gradient(
    120px circle at var(--mouse-x, 50%) var(--mouse-y, 50%),
    rgba(59, 130, 246, 0.06),
    transparent 70%
  );
  opacity: 0;
  transition: opacity 200ms;
}
.card-reveal:hover::before { opacity: 1; }
```

### 8.3 Depth/Layering
- **Layer 0:** Page background (`neutral-50`)
- **Layer 1:** Cards, tables (`neutral-0` + `shadow-card`)
- **Layer 2:** Hover states, dropdowns (`neutral-0` + `shadow-hover`)
- **Layer 3:** Modals, flyouts (`neutral-0` + `shadow-modal`)
- **Layer 4:** Sidebar (darkest, `neutral-800` or acrylic)

### 8.4 Motion Specs
| Interaction | Duration | Easing |
|---|---|---|
| Hover background | `150ms` | `ease-out` |
| Hover shadow | `200ms` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Modal open | `200ms` | `cubic-bezier(0.16, 1, 0.3, 1)` (decelerate) |
| Modal close | `150ms` | `cubic-bezier(0.4, 0, 1, 1)` (accelerate) |
| Drawer slide | `300ms` | `cubic-bezier(0.4, 0, 0.2, 1)` |
| Page transition | `200ms` | `ease-out` |
| Toast notification | `300ms` slide + `200ms` fade | `ease-out` |

### 8.5 Focus States (Accessibility)
All interactive elements must have visible focus rings:
```css
*:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-primary-400), 0 0 0 4px var(--color-primary-200);
}
```

---

## 9. Prompt Template for Claude Design

Copy and paste this when starting a conversation with Claude Design:

---

> I'm redesigning the UI for an existing CRM admin panel called "Growth Escalators CRM." It's a React + Vite SPA using plain Tailwind CSS. The app has 27+ pages including a dashboard, contacts table, pipeline Kanban, inbox, and a staffing module called Wizmatch with 8 pages.
>
> **Current design:** Dark slate sidebar (bg-slate-900), sky-blue accents (bg-sky-500/600), system fonts, minimal Tailwind config with no design tokens. Everything is hardcoded Tailwind utility classes inline.
>
> **Target design:** Microsoft Fluent Design aesthetic. Clean, professional, depth through layering. Color scheme: **blue (primary), white (neutral base), orange (accent/highlight)**.
>
> I've attached a detailed redesign brief (this document) that includes:
> - Complete current design system analysis
> - Target color palette with hex values
> - Typography, spacing, shadow specs
> - Component-by-component redesign guidelines
> - All 27 pages inventoried with key UI elements
> - Implementation strategy with CSS code samples
>
> **What I need from you:**
> 1. High-fidelity mockups for: Dashboard, Contacts table, Pipeline Kanban, Wizmatch Signals, Wizmatch Review Queue
> 2. A complete design system spec (colors, typography, spacing, shadows, motion)
> 3. Production-ready code: updated `tailwind.config.js`, `index.css` with design tokens, and at least 5 reusable component code examples
> 4. A redesigned sidebar mockup (dark blue with acrylic effect, orange notification badges)
>
> Please design for clarity and density — this is a B2B CRM, not a marketing site. Tables and data displays should be compact but readable. Prioritize professional polish over decorative elements.

---

## 10. Summary

| Aspect | Current | Target |
|---|---|---|
| Design language | Ad-hoc Tailwind | Fluent Design |
| Color scheme | Slate + sky + emerald | Blue + white + orange |
| Fonts | System stack | Inter (Google Fonts) |
| Design tokens | None (hardcoded) | CSS custom properties + Tailwind theme |
| Components | Inline utility classes | Reusable component classes |
| Shadows | `shadow-sm` default | Fluent elevation system (card/hover/modal) |
| Motion | Minimal | Purposeful 200-300ms transitions |
| Sidebar | Solid slate-900 | Acrylic blur, blue active states |
| Badges | Inconsistent per page | Standardized 6-type system |
| Tables | Plain HTML | Fluent-style with hover, selection states |

**Key principle:** This is a data-dense B2B CRM. The redesign should make it feel **modern and professional** without sacrificing information density. Fluent Design's emphasis on depth, layering, and clean typography is ideal for this use case.