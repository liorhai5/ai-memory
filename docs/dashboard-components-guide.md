# Dashboard Components Guide

**Status:** active  
**Scope:** `src/dashboard/client/src/`  
**Related:**
- `docs/dashboard-style-guide.md`
- `design-logs/005-dashboard.md`
- `design-logs/005-implementation-plan.md`

---

## 1) Purpose

Defines:
1. All entities that must be represented in the dashboard UI.
2. The component library needed for this system.
3. Component-to-view mapping.
4. Style guide references per component.

## 2) Entity Inventory

### 2.1 Core Domain Entities (from `src/types.ts`)

| Entity | Key fields | UI surfaces |
|--------|-----------|-------------|
| `MemoryEntry` | id, type, content, score, state, workspace, repetition_count, extraction_confidence, created_at | Memory Explorer, Retrieval Simulator, Link Graph, Maintenance |
| `CapturedEvent` | id, session_id, content, extraction_status, created_at | Session Timeline, Retrieval Simulator, Maintenance |
| `MemoryLink` | source_id, target_id, type, confidence | Memory Explorer (expanded), Link Graph |
| `SessionRow` | id, workspace, ide, status, turn_count, started_at, ended_at | Session Timeline |
| `PatternEntry` | id, regex, flags, precision, category_weight | Classifier Playground |
| `ClassificationResult` | type, pattern_id, extraction_confidence | Classifier Playground, Session Timeline |
| `RetrievalResult` | memories[], events[], used_tokens, truncated | Retrieval Simulator |
| `MaintenanceResult` | decayed, deduped, linksCleaned, promoted, archived | Maintenance Dashboard |
| `MaintenancePreview` | wouldDecay[], wouldDedup[], orphanLinks[], wouldPromote[], wouldArchive[] | Maintenance Dashboard |

### 2.2 View-Model Entities (derived, client-side)

| Entity | Derived from | Purpose |
|--------|-------------|---------|
| `ScoreBreakdown` | MemoryEntry + ScoringService | Score formula decomposition display |
| `MemoryWithLinks` | MemoryEntry + MemoryLink[] + linked entries | Expanded row in Memory Explorer |
| `EventWithClassification` | CapturedEvent + ClassificationResult | Events in Session Timeline with classification badges |
| `GraphNode` | MemoryEntry | Node in Link Graph (id, type, content, score, x, y) |
| `GraphEdge` | MemoryLink | Edge in Link Graph (source, target, type, confidence) |
| `RankedResult` | RetrievalResult item | Result in Retrieval Simulator with combined_score and token cost |

## 3) Component Library

### Layer A — Foundations

Implemented in `style.css` via CSS custom properties.

| Token group | Ref |
|------------|-----|
| Theme colors (neutral, text, semantic, type, link) | STYLE_GUIDE §3 |
| Typography (font families, scale, weights) | STYLE_GUIDE §4 |
| Spacing scale | STYLE_GUIDE §5 |
| Radius | STYLE_GUIDE §6 |
| Motion (easing, timing) | STYLE_GUIDE §9 |

### Layer B — Primitives

| Component | Props | States | STYLE_REF | Phase |
|-----------|-------|--------|-----------|-------|
| `Badge` | `label`, `color`, `variant: filled│outline` | rest | §3.4, §11 | 1 |
| `TypeBadge` | `type: MemoryType` | rest (color-mapped) | §3.4 | 1 |
| `LinkBadge` | `type: LinkType` | rest (color-mapped) | §3.4 | 1 |
| `StateBadge` | `state: MemoryState│ExtractionStatus│SessionStatus` | rest (color-mapped) | §3.3, §11 | 1 |
| `ScoreBar` | `breakdown: ScoreBreakdown` | rest | §3.5 | 1 |
| `TokenBudgetBar` | `used: number`, `budget: number`, `items: { label, tokens }[]` | rest | §3.5 | 1 |
| `Input` | `value`, `onChange`, `placeholder`, `type: text│number` | rest, hover, focus, disabled | §8 | 1 |
| `Select` | `value`, `options[]`, `onChange` | rest, hover, focus, disabled | §8 | 1 |
| `Button` | `label`, `onClick`, `variant: primary│secondary│ghost`, `loading?` | rest, hover, focus, active, disabled, loading | §8 | 1 |
| `Slider` | `value`, `min`, `max`, `onChange`, `label` | rest, hover, focus, active | §8 | 1 |
| `Spinner` | `size: sm│md` | — | §9 | 1 |
| `EmptyState` | `icon?`, `title`, `description` | — | §8 | 1 |
| `ErrorState` | `message`, `onRetry?` | — | §8 | 1 |

### Layer C — Composite Patterns

| Component | Composed of | Props | STYLE_REF | Phase |
|-----------|------------|-------|-----------|-------|
| `PageHeader` | Typography | `title`, `subtitle?`, `actions?: ReactNode` | §7.2 | 1 |
| `FilterBar` | Select, Input | `filters: FilterConfig[]`, `values`, `onChange` | §7.2 | 1 |
| `DataTable` | Typography, Badge | `columns[]`, `data[]`, `sortBy?`, `onSort?`, `renderExpanded?`, `onRowClick?` | §7.2 | 1 |
| `ExpandableRow` | — (inside DataTable) | `expanded`, `onToggle`, `children` | §9 | 1 |
| `Pagination` | Button | `page`, `total`, `pageSize`, `onPageChange` | — | 1 |
| `SplitPanel` | — | `left`, `right`, `ratio?` | §7.2 | 2 |
| `DetailPanel` | Typography, Badge | `title`, `children` | §7.2 | 2 |
| `CollapsibleSection` | — | `title`, `count?`, `children`, `defaultOpen?` | §9 | 3 |

### Layer D — Domain Components

| Component | Entity | Composed of | STYLE_REF | Phase |
|-----------|--------|------------|-----------|-------|
| `MemoryRow` | MemoryEntry | TypeBadge, StateBadge, ScoreBar | §3.4, §11 | 1 |
| `MemoryDetail` | MemoryEntry + links | ScoreBar, LinkBadge, list | §3.4 | 1 |
| `RetrievalResultCard` | RankedResult | TypeBadge, score display | §3.4 | 1 |
| `InjectionPreview` | string (formatted text) | Mono text block | §4 | 1 |
| `ClassifierInput` | text + ClassificationResult | Input, TypeBadge, regex highlight | §3.4 | 2 |
| `BatchClassifierResults` | text[] + results[] | DataTable, TypeBadge | §3.4 | 2 |
| `PatternInventory` | PatternEntry[] | DataTable | §4 (mono for regex) | 2 |
| `SessionCard` | SessionRow | StateBadge, metadata | §11 | 2 |
| `EventRow` | EventWithClassification | TypeBadge, StateBadge, content | §3.4, §11 | 2 |
| `EventDetail` | CapturedEvent + MemoryEntry? | Content, classification, linked memory | §3.4 | 2 |
| `GraphCanvas` | GraphNode[], GraphEdge[] | SVG + d3-force | §3.4 | 3 |
| `GraphNodeInfo` | GraphNode | TypeBadge, ScoreBar, links | §3.4 | 3 |
| `SweepPreview` | MaintenancePreview | CollapsibleSection, DataTable | — | 3 |
| `SweepResult` | MaintenanceResult | Summary counts | — | 3 |
| `PendingList` | CapturedEvent[] | DataTable, StateBadge | §11 | 3 |

### Layer E — Page Templates

All views follow the same template:

```
PageHeader (title + optional action buttons)
──────────
FilterBar (optional, view-specific filters)
──────────
Primary Content (table / form+results / graph)
──────────
Secondary Panel (expanded details, optional)
```

| View | Template variation | STYLE_REF | Phase |
|------|-------------------|-----------|-------|
| MemoryExplorer | FilterBar + DataTable with expandable rows | §7.2 | 1 |
| RetrievalSimulator | Form (top) + SplitPanel results (bottom) | §7.2 | 1 |
| ClassifierPlayground | Input (top) + Result card + BatchTable + PatternInventory (stacked) | §7.2 | 2 |
| SessionTimeline | SplitPanel: session list (left) + events + detail (right) | §7.2 | 2 |
| LinkGraph | FilterBar + GraphCanvas + GraphNodeInfo sidebar | §7.2 | 3 |
| MaintenanceDashboard | Stats strip + action buttons + SweepPreview/Result + PendingList | §7.2 | 3 |

## 4) Component-to-View Mapping

### Phase 1 Views

#### MemoryExplorer

```
PageHeader: "Memories" + stats summary (total, active, archived)
FilterBar: [TypeSelect] [StateSelect] [WorkspaceSelect] [SortSelect]
DataTable:
  columns: Type│Content│Score│State│Workspace│Reps│Created
  row component: MemoryRow
  expandable → MemoryDetail:
    ScoreBar: [type_weight][confidence][recency][repetition] = final
    Links list: LinkBadge + linked entry content + confidence
Pagination: bottom
```

Components used: `PageHeader`, `FilterBar`, `Select`, `DataTable`, `ExpandableRow`, `Pagination`, `TypeBadge`, `StateBadge`, `ScoreBar`, `LinkBadge`, `MemoryRow`, `MemoryDetail`, `EmptyState`, `Spinner`

#### RetrievalSimulator

```
PageHeader: "Retrieval Simulator"
Form section:
  Input: query text (full-width)
  Row: [WorkspaceSelect] [Slider: token_budget] [Input: top_k] [Button: Simulate]
SplitPanel (60/40):
  Left — Ranked Results:
    ordered list of RetrievalResultCard
    each shows: rank, TypeBadge, content, combined_score, token cost
    budget cut-off line between included/truncated
  Right — Injection Preview:
    InjectionPreview: mono block with formatted text
TokenBudgetBar: bottom, shows used/total + per-item breakdown
```

Components used: `PageHeader`, `Input`, `Select`, `Slider`, `Button`, `SplitPanel`, `RetrievalResultCard`, `InjectionPreview`, `TokenBudgetBar`, `TypeBadge`, `EmptyState`, `Spinner`

### Phase 2 Views

#### ClassifierPlayground

```
PageHeader: "Classifier Playground"
Section — Live Input:
  ClassifierInput: text input + result card (type, pattern, confidence, highlighted match)
Section — Batch Mode:
  Textarea + Button: "Classify All"
  BatchClassifierResults: table of text│type│pattern│confidence
  Summary: "N/M classified"
Section — Pattern Inventory:
  PatternInventory: table of category│id│regex│precision│weight
```

Components used: `PageHeader`, `ClassifierInput`, `BatchClassifierResults`, `PatternInventory`, `Input`, `Button`, `TypeBadge`, `DataTable`

#### SessionTimeline

```
PageHeader: "Sessions"
SplitPanel (35/65):
  Left — Session List:
    list of SessionCard (clickable)
    each shows: id (truncated), workspace, IDE icon, status, turns, time ago
    Pagination
  Right — Session Detail:
    Session metadata header
    DataTable of events (EventRow):
      columns: #│Content│Classification│Extraction│Memory?
      expandable → EventDetail:
        full content, classification breakdown, linked memory
```

Components used: `PageHeader`, `SplitPanel`, `SessionCard`, `StateBadge`, `Pagination`, `DataTable`, `EventRow`, `EventDetail`, `TypeBadge`, `DetailPanel`, `EmptyState`

### Phase 3 Views

#### LinkGraph

```
PageHeader: "Link Graph" + node/edge counts
FilterBar: [WorkspaceSelect] [TypeSelect] [Slider: min_score]
SplitPanel (70/30):
  Left — GraphCanvas:
    SVG with d3-force: nodes (colored circles) + edges (colored lines)
    Legend: type→color mapping for nodes and edges
    Zoom/pan controls
  Right — GraphNodeInfo (shown on node click):
    TypeBadge, content, score, state, workspace
    ScoreBar
    Links list
```

Components used: `PageHeader`, `FilterBar`, `SplitPanel`, `GraphCanvas`, `GraphNodeInfo`, `TypeBadge`, `ScoreBar`, `LinkBadge`, `Select`, `Slider`

#### MaintenanceDashboard

```
PageHeader: "Maintenance" + [WorkspaceSelect]
Stats strip: total memories│pending extractions│db path
Action bar: [Button: Preview Sweep] [Button: Execute Sweep (destructive style)]
SweepPreview (shown after preview):
  CollapsibleSection: "Would Decay (N)" → table of content│current→new score
  CollapsibleSection: "Would Dedup (N)" → table of hash│keep│remove
  CollapsibleSection: "Orphan Links (N)" → table
  CollapsibleSection: "Promote Candidates (N)" → table of content│sessions
  CollapsibleSection: "Staleness Candidates (N)" → table of content│score│days
SweepResult (shown after execute):
  Summary card: decayed│deduped│linksCleaned│promoted│archived
PendingList: DataTable of pending extractions
```

Components used: `PageHeader`, `Select`, `Button`, `CollapsibleSection`, `DataTable`, `SweepPreview`, `SweepResult`, `PendingList`, `StateBadge`, `EmptyState`, `Spinner`

## 5) Component Inventory Summary

| Layer | Component | Phase | Status |
|-------|-----------|-------|--------|
| B | Badge | 1 | planned |
| B | TypeBadge | 1 | planned |
| B | LinkBadge | 1 | planned |
| B | StateBadge | 1 | planned |
| B | ScoreBar | 1 | planned |
| B | TokenBudgetBar | 1 | planned |
| B | Input | 1 | planned |
| B | Select | 1 | planned |
| B | Button | 1 | planned |
| B | Slider | 1 | planned |
| B | Spinner | 1 | planned |
| B | EmptyState | 1 | planned |
| B | ErrorState | 1 | planned |
| C | PageHeader | 1 | planned |
| C | FilterBar | 1 | planned |
| C | DataTable | 1 | planned |
| C | ExpandableRow | 1 | planned |
| C | Pagination | 1 | planned |
| C | SplitPanel | 2 | planned |
| C | DetailPanel | 2 | planned |
| C | CollapsibleSection | 3 | planned |
| D | MemoryRow | 1 | planned |
| D | MemoryDetail | 1 | planned |
| D | RetrievalResultCard | 1 | planned |
| D | InjectionPreview | 1 | planned |
| D | ClassifierInput | 2 | planned |
| D | BatchClassifierResults | 2 | planned |
| D | PatternInventory | 2 | planned |
| D | SessionCard | 2 | planned |
| D | EventRow | 2 | planned |
| D | EventDetail | 2 | planned |
| D | GraphCanvas | 3 | planned |
| D | GraphNodeInfo | 3 | planned |
| D | SweepPreview | 3 | planned |
| D | SweepResult | 3 | planned |
| D | PendingList | 3 | planned |

**Totals:** Phase 1: 19 components, Phase 2: 8 components, Phase 3: 6 components.

## 6) File Organization

```
src/dashboard/client/src/
├── components/
│   ├── Badge.tsx            # Badge, TypeBadge, LinkBadge, StateBadge
│   ├── ScoreBar.tsx
│   ├── TokenBudgetBar.tsx
│   ├── DataTable.tsx        # DataTable + ExpandableRow
│   ├── FilterBar.tsx
│   ├── PageHeader.tsx
│   ├── Pagination.tsx
│   ├── SplitPanel.tsx       # Phase 2
│   ├── CollapsibleSection.tsx  # Phase 3
│   ├── Spinner.tsx
│   ├── EmptyState.tsx
│   ├── ErrorState.tsx
│   ├── Button.tsx
│   ├── Input.tsx
│   ├── Select.tsx
│   └── Slider.tsx
├── views/
│   ├── MemoryExplorer.tsx
│   ├── RetrievalSimulator.tsx
│   ├── ClassifierPlayground.tsx  # Phase 2
│   ├── SessionTimeline.tsx       # Phase 2
│   ├── LinkGraph.tsx             # Phase 3
│   └── MaintenanceDashboard.tsx  # Phase 3
```

Rules:
- Badge variants (Type/Link/State) can coexist in one file since they share the same pattern.
- DataTable includes ExpandableRow as an internal component.
- Each view file imports only the components it needs.
- No shared state management — each view manages its own state via `useState`/`useEffect` + RPC calls.
