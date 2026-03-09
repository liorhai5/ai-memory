# Dashboard Style Guide

**Status:** active  
**Scope:** `src/dashboard/client/`  
**Canonical CSS:** `src/dashboard/client/src/style.css`  
**Related:** `design-logs/005-dashboard.md`, `docs/dashboard-components-guide.md`

---

## 1) Purpose

Single source of truth for the dashboard's visual and interaction language.

Defines: tokens, layout rules, typography, component states, motion, accessibility.  
Does NOT define: component implementation details (see `docs/dashboard-components-guide.md`).

## 2) Product Tone

This is a **local debugging dashboard** — not a product UI. Optimize for:
- fast scanning of data-heavy tables and lists
- clear status communication
- professional dark theme consistent with `ai-gh-pipeline` dashboard
- zero decoration — every pixel earns its place

### 2.1 Design Principles

1. **Data-first** — tables, scores, and status are the content. Chrome is minimal.
2. **Scan before read** — type badges, score bars, and color coding let you skip reading.
3. **Progressive disclosure** — filters collapsed, row details expandable, advanced inputs hidden until needed.
4. **State-rich** — every async surface has loading/empty/error states. No blank voids.
5. **Consistent with family** — reuses the `Railway-Linear Dark v1` theme from `ai-gh-pipeline` for cross-tool consistency.

### 2.2 Primary References

1. Railway (dark premium tone)
2. Linear (density and focus)
3. Drizzle Studio (data inspection UX)

## 3) Theme: Railway-Linear Dark v1

Dark-first. No light mode planned.

### 3.1 Core Neutral Tokens

```css
--bg-canvas: #0d1117;
--bg-surface: #161b22;
--bg-surface-hover: #1c2128;
--bg-surface-active: #21262d;
--bg-inset: #010409;
--bg-overlay: #30363d;
--border-default: rgba(255, 255, 255, 0.08);
--border-muted: rgba(255, 255, 255, 0.05);
```

### 3.2 Text Tokens

```css
--text-primary: #e6edf3;
--text-secondary: #8b949e;
--text-muted: #484f58;
--text-link: #58a6ff;
```

### 3.3 Semantic State Tokens

```css
--accent-blue: #58a6ff;     /* info / in-progress */
--accent-green: #3fb950;    /* success / active */
--accent-yellow: #d29922;   /* warning / attention */
--accent-red: #f85149;      /* error / destructive */
--accent-purple: #bc8cff;   /* special state */
```

### 3.4 Memory-Type Color Tokens

Domain-specific colors for memory types and link types:

```css
/* Memory types */
--type-decision: #3B82F6;     /* blue */
--type-correction: #EF4444;   /* red */
--type-preference: #F59E0B;   /* amber */
--type-pattern: #8B5CF6;      /* purple */
--type-learning: #10B981;     /* emerald */
--type-fact: #6B7280;         /* gray */

/* Link types */
--link-related: #9CA3AF;      /* gray */
--link-supports: #22C55E;     /* green */
--link-contradicts: #EF4444;  /* red */
--link-refines: #3B82F6;      /* blue */
--link-supersedes: #F97316;   /* orange */

/* Memory states */
--state-active: var(--accent-green);
--state-superseded: var(--accent-yellow);
--state-archived: var(--text-muted);
```

### 3.5 Data Visualization Tokens

```css
--viz-1: #7aa2ff;
--viz-2: #5ec2a7;
--viz-3: #f2b26b;
--viz-4: #c792ea;
--viz-5: #7dd3fc;
```

Rules:
- Memory-type colors are the primary visual language. Use them consistently in badges, graph nodes, table highlights.
- Semantic state tokens (`--accent-*`) are for action feedback only (buttons, toasts, errors).
- `--viz-*` tokens are for charts and score breakdown bars only.

## 4) Typography

### 4.1 Font Families

```css
--font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
--font-mono: 'JetBrains Mono', 'SF Mono', 'Fira Code', monospace;
```

Load Inter and JetBrains Mono from Google Fonts (CDN). Acceptable since this is a local dashboard.

### 4.2 Type Scale

```css
--font-size-xs: 11px;    /* line-height: 16px — table metadata, timestamps */
--font-size-sm: 12px;    /* line-height: 18px — badges, secondary info */
--font-size-md: 14px;    /* line-height: 22px — body text, table cells (NOTE: 14px not 15px, denser) */
--font-size-lg: 16px;    /* line-height: 24px — section headers */
--font-size-xl: 20px;    /* line-height: 28px — page titles */
```

Font weights:
- `400` — body text
- `500` — emphasis, table headers
- `600` — page titles, section headers

Letter spacing:
- body: `normal`
- page titles: `-0.3px`

Rules:
- Mono is for: memory IDs, pattern regexes, JSON output, injection preview, content hashes.
- Sans is for everything else.
- No font size larger than `--font-size-xl` needed — this is a debugging tool, not a landing page.

## 5) Spacing

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 24px;
--space-6: 32px;
--space-7: 48px;
```

Rules:
- Table cell padding: `--space-2` to `--space-3`
- Card/section padding: `--space-4`
- Page margin: `--space-5` to `--space-6`
- Between major sections: `--space-5`

## 6) Radius

```css
--radius-sm: 4px;    /* badges, inputs */
--radius-md: 6px;    /* cards, panels */
--radius-lg: 8px;    /* modals, overlays */
```

Pills (full rounding) are only for type/state badges.

## 7) Layout

### 7.1 App Shell

```
┌────────────────────────────────────────────┐
│ Header (sticky)                            │
├──────────┬─────────────────────────────────┤
│ Sidebar  │ Main Content                    │
│ (fixed)  │ (scrollable)                    │
│          │                                 │
│ nav      │ PageHeader                      │
│ items    │ ─────────────────────           │
│          │ Filters / Controls              │
│          │ ─────────────────────           │
│          │ Primary Content                 │
│          │ (table / form / graph)          │
│          │                                 │
│          │ Secondary Panels                │
│          │ (expandable details)            │
└──────────┴─────────────────────────────────┘
```

### 7.2 Layout Rules

1. **Sidebar**: fixed-width (~200px), always visible. Contains view navigation links.
2. **Header**: project name + status summary. Sticky top.
3. **Main content**: scrollable. Max-width unconstrained (data tables need width).
4. **Page structure**: `PageHeader → Filters → Primary → Secondary` (consistent across all views).
5. **Density**: `medium-high` by default. Tables use `compact` density.
6. **Responsive**: not a priority — this is a local dev tool. Support ≥1024px viewport.

### 7.3 Sidebar Navigation

```
ai-memory Dashboard
─────────────────
📊  Memories        (Phase 1)
🔍  Retrieval       (Phase 1)
🏷️  Classifier      (Phase 2)
📅  Sessions        (Phase 2)
🔗  Link Graph      (Phase 3)
🔧  Maintenance     (Phase 3)
─────────────────
⚙️  Status          (always)
```

Active view: highlighted background (`--bg-surface-active`) + left accent border (`--accent-blue`, 2px).

## 8) Component State Contracts

Every interactive element defines at minimum:

| State | Treatment |
|-------|-----------|
| `rest` | Default appearance |
| `hover` | Subtle background shift (`--bg-surface-hover`) |
| `focus-visible` | Blue outline ring (2px, `--accent-blue`) |
| `active` | Pressed state (`--bg-surface-active`) |
| `disabled` | Reduced opacity (0.5), cursor: not-allowed |

Async components additionally define:

| State | Treatment |
|-------|-----------|
| `loading` | Skeleton shimmer or inline spinner |
| `empty` | Centered message with guidance text |
| `error` | Red border + error message + retry affordance |

## 9) Motion

### 9.1 Timing

```css
--ease-smooth: cubic-bezier(0.455, 0.03, 0.515, 0.955);
--motion-fast: 120ms;     /* hover, badge transitions */
--motion-normal: 200ms;   /* panel expand, filter change */
```

### 9.2 Usage

- **Row expand/collapse**: `--motion-normal`, height + opacity
- **Filter changes**: instant (re-render), no transition on data
- **Tab/view switch**: instant (no page transition animation)
- **Hover on table rows**: `--motion-fast`, background-color
- **Loading indicators**: skeleton shimmer, 1.4s cycle
- **Graph node drag**: no easing, follow pointer directly

### 9.3 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  * { transition-duration: 0ms !important; animation-duration: 0ms !important; }
}
```

## 10) Accessibility

Minimum bar:
- Text contrast: WCAG AA (≥4.5:1 normal, ≥3:1 large)
- Focus-visible on all keyboard-focusable controls
- Primary nav and actions operable via keyboard
- `prefers-reduced-motion` respected

Not in scope (local dev tool):
- Screen reader optimization
- RTL support
- Mobile responsive

## 11) Status Vocabulary

Use these labels consistently in badges and filters:

| Domain | Status values |
|--------|--------------|
| Memory state | `active`, `superseded`, `archived` |
| Memory type | `decision`, `correction`, `preference`, `pattern`, `learning`, `fact` |
| Link type | `related`, `supports`, `contradicts`, `refines`, `supersedes` |
| Extraction | `pending`, `extracted`, `failed` |
| Session | `active`, `completed`, `crashed` |

Rules:
- Always use these exact labels in UI — no synonyms.
- Backend terms map 1:1 to UI labels in this system (no view-model translation needed).

## 12) Governance

When changing styles:
1. Update this guide first.
2. Update `style.css` tokens.
3. Reference this guide in the relevant design-log or PR notes.

No new hardcoded colors/sizes — token-first policy.
