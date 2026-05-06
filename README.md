# xfdf-annotator — Technical Integration Guide

A lightweight, browser-based PDF and image annotation library that saves and loads annotations using the **XFDF standard** (ISO 19444-1 / Adobe XFDF Specification). Built on top of [Fabric.js](http://fabricjs.com/) for canvas rendering and [PDF.js](https://mozilla.github.io/pdf.js/) for PDF support.

This guide explains how to install, configure, and integrate the library into Angular and React applications, and walks through every feature supported by the library — drawn directly from the canonical Angular reference implementation in `xfdf-annotator-angular`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Installation](#2-installation)
3. [Required DOM Anchors](#3-required-dom-anchors)
4. [Quickstart — Vanilla TS/JS](#4-quickstart--vanilla-tsjs)
5. [Angular Integration](#5-angular-integration)
6. [React Integration](#6-react-integration)
7. [Feature Reference](#7-feature-reference)
8. [API Reference](#8-api-reference)
9. [XFDF Format](#9-xfdf-format)
10. [Coordinate Systems](#10-coordinate-systems)
11. [Performance Notes](#11-performance-notes)
12. [Advanced Patterns (from the Angular reference)](#12-advanced-patterns-from-the-angular-reference)
13. [Troubleshooting](#13-troubleshooting)

---

## 1. Overview

`xfdf-annotator` exposes a top-level orchestrator class — `DocumentAnnotator` — that owns:

- Document rendering (`PDFRenderer` for PDFs, `ImageRenderer` for images)
- Per-page annotation canvases (`AnnotationCanvas`, one Fabric canvas per page)
- A floating Figma-style comment system (`CommentManager`)
- A real-time activity log (`ActivityLog`)
- XFDF serialisation and deserialisation (`toXFDF` / `fromXFDF`)

All of these are wired together by querying the host page for a fixed set of element IDs. Your framework's job is to render the required DOM scaffold, then construct a single `DocumentAnnotator` instance after the view exists.

**Headline features**

- Multi-format input: PDFs (multi-page) and raster images (PNG, JPG, JPEG, GIF, WebP, SVG, BMP)
- Drawing tools: Select, Freehand, Line, Arrow, Rectangle, Ellipse, Polygon, Text, Comment, Image stamp, Eraser
- Per-shape stroke colour, stroke width, dash pattern, fill colour, and fill opacity
- Cloud-border line style (`'arc'`) for revision-cloud / scalloped rectangles, lines, and polygons
- Built-in undo / redo with reactive `canUndo()` / `canRedo()` getters, hooked to a toolbar via the library's `onChange` callback
- First-class `User` identity (`{ id, displayName }`) shown in the activity log, comment threads, and a top-bar badge
- XFDF round-trip: standard `<annots>` for interop + lossless Fabric snapshot extension for pixel-perfect restore (Fabric serialises `fill`, `strokeDashArray`, and arc-cloud paths automatically — no custom XFDF tags required)
- Comment threads with numbered pins, replies, and persistence (with `userName` stored alongside `userId`)
- Activity log of every draw / erase / image / comment event (also persists `userName`)
- Two interaction modes: `edit` and `view` (read-only)
- Responsive scaling (auto re-renders on container resize) and HiDPI rendering
- Lazy PDF.js worker fallback — consumer overrides of `pdfjsLib.GlobalWorkerOptions.workerSrc` always win regardless of import order

---

## 2. Installation

### 2.1 Install the package

`xfdf-annotator` is published to npm: <https://www.npmjs.com/package/xfdf-annotator>.

```bash
npm install xfdf-annotator fabric pdfjs-dist
# or
yarn add xfdf-annotator fabric pdfjs-dist
# or
pnpm add xfdf-annotator fabric pdfjs-dist
```

`fabric` and `pdfjs-dist` are runtime peers — install them in the host application even if your bundler hoists them transitively.

```jsonc
// package.json (resulting fragment)
{
  "dependencies": {
    "xfdf-annotator": "^0.1.3",
    "fabric": "^7.3.1",
    "pdfjs-dist": "^5.7.284"
  }
}
```

> **Local development tip** — when iterating on the library and the app together, point the dependency at the local checkout instead:
>
> ```jsonc
> "xfdf-annotator": "file:../xfdf-annotator-v1"
> ```
>
> Re-run `npm install` after each library rebuild. To install a freshly built local library *without* rewriting `package.json`, use `npm install ../xfdf-annotator-v1 --no-save`. Switch back to the npm version reference once you're done.

### 2.2 Configure the PDF.js worker

`PDFRenderer` falls back to a CDN URL **lazily** (inside its `load()` method), and only when `pdfjsLib.GlobalWorkerOptions.workerSrc` isn't already set. That means consumer overrides always win, regardless of when they run relative to the library's imports. CDNs occasionally lag behind `pdfjs-dist` releases anyway, so the recommended pattern is to ship the worker as a static asset and pin it explicitly.

**Angular** (using `angular.json` `assets`):

```ts
// annotator.service.ts (top of file, runs once at module load)
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.min.mjs';
```

```jsonc
// angular.json — copy the worker into /assets/pdfjs/
{
  "projects": {
    "your-app": {
      "architect": {
        "build": {
          "options": {
            "assets": [
              { "glob": "pdf.worker.min.mjs",
                "input": "node_modules/pdfjs-dist/build/",
                "output": "/assets/pdfjs/" }
            ]
          }
        }
      }
    }
  }
}
```

**React (Vite/CRA)**: copy the worker to `/public/pdfjs/` and set:

```ts
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
```

### 2.3 Optional: Bootstrap Icons / styling

The Angular reference uses Bootstrap and Bootstrap Icons for the chrome (toolbar buttons, modals, offcanvases, toasts). The library itself ships **no styles** — you own the visual treatment. The only DOM-side requirement is that the elements listed in [§3](#3-required-dom-anchors) exist before `DocumentAnnotator` is constructed.

---

## 3. Required DOM Anchors

`DocumentAnnotator` reaches into the DOM by **element ID**. The default IDs (and what they're for) are:

| ID (default) | Purpose | Required? |
|---|---|---|
| `viewer-panel` | Outer panel observed by `ResizeObserver` for auto-rescale | Yes |
| `pages-container` | Where page wrappers (`.page-wrapper`) get injected | Yes |
| `document-viewport` | Scrollable viewport shown after a document loads | Yes |
| `empty-state` | "No document loaded" placeholder shown initially | Optional |
| `loading-overlay` | Spinner shown during load | Optional |
| `log-entries` | Activity log list. **Must exist at construction time** — events are dropped silently otherwise. | Yes (if you use the log) |
| `comment-thread-panel` | Floating thread reader panel — needs `.ctp-pin-num`, `.ctp-messages`, `.ctp-close`, `.ctp-reply-input`, `.ctp-reply-btn` children | Yes (if you use comments) |
| `new-comment-popup` | Popup for composing a new comment — needs `<textarea>`, `#btn-post-comment`, `#btn-cancel-comment` children | Yes (if you use comments) |
| `doc-title` / `doc-meta` | Filename + page-count display written by the library after load | Optional |
| `polygon-hint` | Hint banner shown when polygon tool is active | Optional |
| `toolbar-panel` | Toolbar element — gets the `.view-mode` class added/removed when `setMode()` is called | Optional |

All IDs are configurable via `DocumentAnnotatorOptions` (see [§8](#8-api-reference)).

A minimal scaffold:

```html
<main id="viewer-panel">
  <div id="empty-state">Open a PDF or image to start annotating</div>
  <div id="loading-overlay" style="display:none;">Loading…</div>
  <div id="document-viewport" style="display:none;">
    <div id="pages-container"></div>
  </div>
</main>

<aside><div id="log-entries"></div></aside>

<div id="comment-thread-panel" style="display:none;">
  <div class="ctp-header">
    <span class="ctp-pin-num"></span>
    <button class="ctp-close" aria-label="Close">×</button>
  </div>
  <div class="ctp-messages"></div>
  <div class="ctp-reply-bar">
    <input class="ctp-reply-input" placeholder="Reply…" />
    <button class="ctp-reply-btn">Send</button>
  </div>
</div>

<div id="new-comment-popup" style="display:none;">
  <textarea placeholder="Add a comment…"></textarea>
  <button id="btn-cancel-comment">Cancel</button>
  <button id="btn-post-comment">Post</button>
</div>
```

---

## 4. Quickstart — Vanilla TS/JS

```ts
import { DocumentAnnotator } from 'xfdf-annotator';

const annotator = new DocumentAnnotator({
  // Override DOM IDs if needed. Defaults shown.
  viewerPanelId:     'viewer-panel',
  pagesContainerId:  'pages-container',
  logContainerId:    'log-entries',
  emptyStateId:      'empty-state',
  loadingId:         'loading-overlay',
  viewportId:        'document-viewport',
  threadPanelId:     'comment-thread-panel',
  newCommentPopupId: 'new-comment-popup',
  displayScale:      1.5,        // base CSS scale before devicePixelRatio
  userId:            'haffiz',   // shows in comment author + log entries
});

// Open a file from a <input type="file"> change handler
fileInput.addEventListener('change', async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (file) await annotator.loadFile(file);
});

// Or load directly from a URL
await annotator.loadURL('/sample.pdf', 'pdf', 'Sample.pdf');

// Switch tool / colour / stroke width / mode
annotator.setTool('rectangle');
annotator.setColor('#e74c3c');
annotator.setStrokeWidth(3);
annotator.setMode('view');   // read-only

// Save / restore
const xml = annotator.save();           // XFDF XML string
await annotator.restore(xml);           // hydrates pages + comments + log

// Clean up when navigating away
annotator.destroy();
```

---

## 5. Angular Integration

The Angular reference (`xfdf-annotator-angular`) wraps the library in a service that exposes mutable state as Angular signals. This is the recommended pattern for any Angular app.

### 5.1 Bootstrap & root component

The library queries the DOM by ID at construction time, so initialisation **must** run after `ngAfterViewInit`. Tear down in `ngOnDestroy`.

```ts
// app.ts
import {
  AfterViewInit, Component, OnDestroy, inject,
} from '@angular/core';
import { AnnotatorService } from './services/annotator.service';

@Component({
  selector: 'app-root',
  standalone: true,
  templateUrl: './app.html',
})
export class App implements AfterViewInit, OnDestroy {
  readonly annotator = inject(AnnotatorService);

  ngAfterViewInit(): void {
    this.annotator.init();  // constructs DocumentAnnotator now that the DOM is real
  }

  ngOnDestroy(): void {
    this.annotator.destroy();
  }
}
```

### 5.2 The annotator service

The service is a thin reactive shim — the library owns annotation behaviour, fabric, XFDF, undo/redo, fill, dash, and arc-cloud rendering. The Angular service only mirrors state into signals and forwards calls.

```ts
// services/annotator.service.ts
import { Injectable, computed, signal } from '@angular/core';
import {
  DocumentAnnotator,
  type AnnotationTool, type AnnotationMode,
  type LineStyle, type User,
} from 'xfdf-annotator';
import * as pdfjsLib from 'pdfjs-dist';

// Pin the PDF.js worker before the library tries to load any PDF.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.min.mjs';

@Injectable({ providedIn: 'root' })
export class AnnotatorService {
  private _annotator: DocumentAnnotator | null = null;

  // ── Library-mirrored state ──
  readonly tool        = signal<AnnotationTool>('select');
  readonly mode        = signal<AnnotationMode>('edit');
  readonly color       = signal<string>('#f38ba8');
  readonly strokeWidth = signal<number>(2);
  readonly fillColor   = signal<string>('#4a90e2');
  readonly fillOpacity = signal<number>(0);   // 0–100 in UI; library uses 0–1
  readonly dashArray   = signal<number[]>([]);
  readonly lineStyle   = signal<LineStyle>('solid');

  readonly hasDocument = signal<boolean>(false);
  readonly user        = signal<User | null>(null);
  readonly userId      = computed(() => this.user()?.id ?? '');  // legacy

  readonly canUndo = signal(false);
  readonly canRedo = signal(false);

  init(user?: User): DocumentAnnotator {
    if (this._annotator) return this._annotator;
    const a = new DocumentAnnotator({
      ...(user ? { user } : {}),
      // Library pushes a notification on every history-stack change.
      // Without this, canUndo/canRedo would only refresh inside our own
      // undo()/redo() — never when the user *drew* something — so the
      // toolbar buttons would stay [disabled] forever.
      onChange: () => this._refreshHistorySignals(),
    });
    this._annotator = a;
    this.user.set(a.user);

    // Push UI defaults into the underlying canvas
    a.setColor(this.color());
    a.setStrokeWidth(this.strokeWidth());
    a.setMode(this.mode());
    a.setTool(this.tool());
    return a;
  }

  private get a(): DocumentAnnotator {
    if (!this._annotator) throw new Error('AnnotatorService not initialised');
    return this._annotator;
  }

  async loadFile(file: File): Promise<void> {
    await this.a.loadFile(file);
    this.hasDocument.set(true);
    this._refreshHistorySignals();
  }

  setTool(t: AnnotationTool):  void { this.tool.set(t);        this.a.setTool(t); }
  setMode(m: AnnotationMode):  void { this.mode.set(m);        this.a.setMode(m); }
  setColor(c: string):         void { this.color.set(c);       this.a.setColor(c); }
  setStrokeWidth(w: number):   void { this.strokeWidth.set(w); this.a.setStrokeWidth(w); }
  setFillColor(c: string):     void { this.fillColor.set(c);   this.a.setFillColor(c); }

  /** UI uses 0–100 for ergonomics; library expects 0–1. */
  setFillOpacity(percent: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    this.fillOpacity.set(clamped);
    this.a.setFillOpacity(clamped / 100);
  }

  setDashArray(arr: number[], style: LineStyle = 'solid'): void {
    this.dashArray.set([...arr]);
    this.lineStyle.set(style);
    this.a.setDashArray(arr);
    this.a.setLineStyle(style);
  }

  // Undo / redo — library does the work; we just refresh signals.
  async undo() { await this.a.undo(); this._refreshHistorySignals(); }
  async redo() { await this.a.redo(); this._refreshHistorySignals(); }

  private _refreshHistorySignals(): void {
    if (!this._annotator) return;
    this.canUndo.set(this.a.canUndo());
    this.canRedo.set(this.a.canRedo());
  }

  saveXFDF(): string { return this.a.save(); }
  async restoreXFDF(x: string): Promise<void> {
    await this.a.restore(x);
    this._refreshHistorySignals();
  }

  insertImage(f: File): void { this.a.insertImage(f); }
  clearLog(): void           { this.a.clearLog(); }

  destroy(): void {
    if (this._annotator) {
      this._annotator.destroy();
      this._annotator = null;
      this.hasDocument.set(false);
    }
    this.canUndo.set(false);
    this.canRedo.set(false);
  }
}
```

> **Why mirror the library's state into signals at all?** Angular templates can't reactively read non-signal values. The library exposes plain getters (`canUndo()`, `getColor()`, …) which never *push* updates. The `onChange` callback is the bridge: every time the library mutates its history stack, we pull the new values and push them into signals so `[disabled]="!canUndo()"` actually updates.

### 5.3 The DOM scaffold (template)

The full scaffold from `app.html` includes Bootstrap chrome — here is the trimmed essential structure:

```html
<!-- app.html -->
<main id="viewer-panel" class="position-relative d-flex flex-column">
  <!-- Floating annotation toolbar (only when in edit mode and toolbar tab is open) -->
  @if (centerTab() === 'tools') {
    <app-annotation-toolbar [tools]="tools"></app-annotation-toolbar>
  }

  <div id="empty-state">Open a PDF or image to start annotating</div>
  <div id="loading-overlay">Loading…</div>

  <div id="document-viewport">
    <div id="pages-container"></div>
  </div>
</main>

<!-- ALWAYS rendered — DocumentAnnotator queries `#log-entries` at construction time -->
<app-activity-log [open]="logOpen()" (closed)="closeLog()"></app-activity-log>

<!-- Comment thread + new-comment popup must always be in the DOM -->
<div id="comment-thread-panel">…</div>
<div id="new-comment-popup">…</div>

<input #fileInput type="file" class="d-none"
       accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp"
       (change)="onFileChosen($event)" />
```

> **Important** — components hosting library-required IDs must always be in the DOM. The activity log component, in particular, is *not* `@if`-guarded by its `open` flag; only its visibility is. Otherwise `getElementById('log-entries')` returns `null` and every event is silently dropped.

### 5.4 Annotation toolbar component

The reference toolbar exposes every styling control the library supports: tool buttons, stroke colour, stroke width, line type (dash patterns + arc-cloud), fill colour, fill opacity, and undo/redo.

```ts
// components/annotation-toolbar/annotation-toolbar.component.ts
import {
  ChangeDetectionStrategy, Component, HostListener,
  computed, inject, input, signal,
} from '@angular/core';
import type { AnnotationTool, LineStyle } from 'xfdf-annotator';
import { AnnotatorService } from '../../services/annotator.service';

export interface ToolDef {
  tool: AnnotationTool;
  title: string;
  icon: string;
  key?: string;
}

/** A line-type pattern selectable from the popup. */
export interface DashPattern {
  id: string;
  label: string;
  /** Empty array = solid line. Ignored when `lineStyle === 'arc'`. */
  dashArray: number[];
  /** `'arc'` triggers cloud-border rendering for new shapes. */
  lineStyle?: LineStyle;
}

export const DASH_PATTERNS: DashPattern[] = [
  { id: 'solid',         label: 'Solid',                dashArray: []                       },
  { id: 'dotted',        label: 'Dotted',               dashArray: [2, 4]                   },
  { id: 'short-dash',    label: 'Short Dashed',         dashArray: [6, 4]                   },
  { id: 'long-dash',     label: 'Long Dashed',          dashArray: [12, 6]                  },
  { id: 'extra-long',    label: 'Extra Long Dashed',    dashArray: [18, 8]                  },
  { id: 'dash-dot',      label: 'Dash–Dot',             dashArray: [10, 4, 2, 4]            },
  { id: 'dash-dot-dot',  label: 'Dash–Dot–Dot',         dashArray: [10, 4, 2, 4, 2, 4]      },
  { id: 'long-dash-dot', label: 'Long Dash–Dot',        dashArray: [16, 5, 3, 5]            },
  { id: 'arc',           label: 'Arc Line (Cloud)',     dashArray: [],  lineStyle: 'arc'    },
];

@Component({
  selector: 'app-annotation-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './annotation-toolbar.component.html',
})
export class AnnotationToolbarComponent {
  readonly annotator = inject(AnnotatorService);
  readonly tools     = input.required<ToolDef[]>();

  readonly patterns      = DASH_PATTERNS;
  readonly lineMenuOpen  = signal(false);
  readonly lineMenuPos   = signal({ left: 0, top: 0 });

  readonly currentPattern = computed<DashPattern>(() => {
    const cur = this.annotator.dashArray();
    const ls  = this.annotator.lineStyle();
    return DASH_PATTERNS.find(p =>
      (p.lineStyle ?? 'solid') === ls && sameArray(p.dashArray, cur),
    ) ?? DASH_PATTERNS[0];
  });

  setTool(tool: AnnotationTool): void {
    if (this.annotator.mode() === 'view') return;
    if (tool === 'image') {
      window.dispatchEvent(new CustomEvent('xfdf:request-image-pick'));
      return;
    }
    this.annotator.setTool(tool);
  }

  onColorChange(e: Event):       void { this.annotator.setColor((e.target as HTMLInputElement).value); }
  onStrokeWidthChange(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) this.annotator.setStrokeWidth(v);
  }
  onFillColorChange(e: Event):   void { this.annotator.setFillColor((e.target as HTMLInputElement).value); }
  onFillOpacityChange(e: Event): void {
    const v = Number((e.target as HTMLInputElement).value);
    if (Number.isFinite(v)) this.annotator.setFillOpacity(v);   // 0–100
  }

  toggleLineMenu(ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.lineMenuOpen()) { this.lineMenuOpen.set(false); return; }
    const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    this.lineMenuPos.set({ left: rect.left, top: rect.bottom + 4 });
    this.lineMenuOpen.set(true);
  }
  selectPattern(p: DashPattern): void {
    this.annotator.setDashArray(p.dashArray, p.lineStyle ?? 'solid');
    this.lineMenuOpen.set(false);
  }
  isCurrentPattern(p: DashPattern): boolean {
    return (p.lineStyle ?? 'solid') === this.annotator.lineStyle()
        && sameArray(p.dashArray, this.annotator.dashArray());
  }
  dashAttr(arr: number[]): string | null { return arr.length ? arr.join(',') : null; }

  @HostListener('document:click')          onDocumentClick() { if (this.lineMenuOpen()) this.lineMenuOpen.set(false); }
  @HostListener('document:keydown.escape') onEscape()        { if (this.lineMenuOpen()) this.lineMenuOpen.set(false); }

  undo(): void { this.annotator.undo(); }
  redo(): void { this.annotator.redo(); }
}

function sameArray(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
```

The template renders SVG previews of every pattern (including a real arc-chain `<path>` for the cloud option, not a fake dash) in a fixed-positioned popup so the toolbar's `overflow-x: auto` wrapper can't clip the dropdown.

> **Toolbar centring gotcha** — the toolbar host wrapper must **not** use a CSS `transform` (e.g. Bootstrap's `translate-middle-x`). A non-`none` transform turns that ancestor into the containing block for `position: fixed` descendants, which would cause the line-type popup to anchor to the wrapper instead of the viewport and open off-screen. Use auto-margins (`left: 0; right: 0; margin-inline: auto; width: max-content;`) to centre it instead.

### 5.5 Tool registry (component property)

The reference declares the toolset declaratively in `app.ts`:

```ts
readonly tools: ToolDef[] = [
  { tool: 'select',    title: 'Select (V)',      icon: 'bi-cursor',         key: 'v' },
  { tool: 'freehand',  title: 'Freehand (P)',    icon: 'bi-pencil',         key: 'p' },
  { tool: 'line',      title: 'Line (L)',        icon: 'bi-slash-lg',       key: 'l' },
  { tool: 'arrow',     title: 'Arrow (A)',       icon: 'bi-arrow-up-right', key: 'a' },
  { tool: 'rectangle', title: 'Rectangle (R)',   icon: 'bi-square',         key: 'r' },
  { tool: 'circle',    title: 'Ellipse (C)',     icon: 'bi-circle',         key: 'c' },
  { tool: 'polygon',   title: 'Polygon (G)',     icon: 'bi-pentagon',       key: 'g' },
  { tool: 'text',      title: 'Text (T)',        icon: 'bi-fonts',          key: 't' },
  { tool: 'comment',   title: 'Comment (M)',     icon: 'bi-chat-left-text', key: 'm' },
  { tool: 'image',     title: 'Image stamp (I)', icon: 'bi-image',          key: 'i' },
  { tool: 'eraser',    title: 'Eraser (E)',      icon: 'bi-eraser',         key: 'e' },
];
```

### 5.6 Keyboard shortcuts

Use `@HostListener` on the root component so shortcuts work everywhere except inside text inputs:

```ts
@HostListener('window:keydown', ['$event'])
onKeydown(ev: KeyboardEvent): void {
  const t = ev.target as HTMLElement | null;
  if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

  const def = this.tools.find((x) => x.key === ev.key.toLowerCase());
  if (def) {
    ev.preventDefault();
    this._setToolFromShortcut(def.tool);
  }
}
```

### 5.7 Top-bar user badge

The top bar reads `annotator.user()` and renders a small pill with the human-readable display name. The full user id is exposed via the tooltip for support.

```html
@if (annotator.user(); as u) {
  <span class="user-badge d-inline-flex align-items-center gap-1 px-2 py-1 rounded-pill border"
        [title]="'User ID: ' + u.id">
    <i class="bi bi-person-circle"></i>
    <span class="small fw-medium text-truncate" style="max-width: 8rem;">
      {{ u.displayName }}
    </span>
  </span>
}
```

Pass an explicit `User` to `annotator.init({ id, displayName })` so the badge — and every activity log entry / comment author label — shows real names instead of a truncated UUID. When the consumer omits `user`, the library generates a random id and uses its first 8 characters as the display name.

### 5.8 Undo / redo wiring

The library owns the snapshot stack and pushes a notification through the `onChange` callback the service registers in `init()`. The toolbar buttons bind to `canUndo` / `canRedo` signals that the service refreshes on every notification:

```html
<button [disabled]="!annotator.canUndo()" (click)="undo()" title="Undo (Ctrl+Z)">
  <i class="bi bi-arrow-counterclockwise"></i>
</button>
<button [disabled]="!annotator.canRedo()" (click)="redo()" title="Redo (Ctrl+Shift+Z)">
  <i class="bi bi-arrow-clockwise"></i>
</button>
```

Bind keyboard shortcuts on the host component:

```ts
@HostListener('window:keydown', ['$event'])
onKeydown(ev: KeyboardEvent) {
  if (ev.key === 'z' && (ev.ctrlKey || ev.metaKey) && !ev.shiftKey) {
    ev.preventDefault();
    this.annotator.undo();
  } else if ((ev.key === 'y' && (ev.ctrlKey || ev.metaKey)) ||
             (ev.key === 'z' && (ev.ctrlKey || ev.metaKey) && ev.shiftKey)) {
    ev.preventDefault();
    this.annotator.redo();
  }
  // …other shortcuts…
}
```

> **Without `onChange`, undo / redo would appear broken.** The service can read `a.canUndo()` at any time, but Angular templates only re-render when a *signal* changes. If we only refreshed the signals inside the service's own `undo()` / `redo()` methods, the buttons would stay `[disabled]` after the user just *drew* something — and a disabled button never fires its click handler. The library's `onChange` push is the missing edge that closes the loop.

### 5.9 Saving and restoring XFDF

```ts
// In app.ts
saveXFDF(): void {
  if (!this.annotator.hasDocument()) return;
  const xml  = this.annotator.saveXFDF();
  const blob = new Blob([xml], { type: 'application/vnd.adobe.xfdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `annotations-${Date.now()}.xfdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async onXfdfChosen(ev: Event): Promise<void> {
  const file = (ev.target as HTMLInputElement).files?.[0];
  if (!file) return;
  await this.annotator.restoreXFDF(await file.text());
}
```

---

## 6. React Integration

The same architecture works in React. The library's lifecycle maps cleanly onto a single `useEffect` mounting block.

### 6.1 React Provider (Context-based service equivalent)

```tsx
// AnnotatorProvider.tsx
import {
  createContext, useCallback, useContext, useEffect,
  useMemo, useRef, useState,
} from 'react';
import {
  DocumentAnnotator,
  type AnnotationTool, type AnnotationMode,
} from 'xfdf-annotator';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';

interface AnnotatorAPI {
  ready: boolean;
  hasDocument: boolean;
  tool:   AnnotationTool;
  mode:   AnnotationMode;
  color:  string;
  width:  number;
  userId: string;

  loadFile:    (f: File) => Promise<void>;
  loadURL:     (url: string, type: 'pdf' | 'image', label?: string) => Promise<void>;
  setTool:     (t: AnnotationTool) => void;
  setMode:     (m: AnnotationMode) => void;
  setColor:    (c: string) => void;
  setWidth:    (n: number) => void;
  insertImage: (f: File) => void;
  saveXFDF:    () => string;
  restoreXFDF: (xml: string) => Promise<void>;
  clearLog:    () => void;
}

const Ctx = createContext<AnnotatorAPI | null>(null);

export function AnnotatorProvider({ children }: { children: React.ReactNode }) {
  const ref = useRef<DocumentAnnotator | null>(null);
  const [ready, setReady]       = useState(false);
  const [hasDoc, setHasDoc]     = useState(false);
  const [tool, _setTool]        = useState<AnnotationTool>('select');
  const [mode, _setMode]        = useState<AnnotationMode>('edit');
  const [color, _setColor]      = useState<string>('#e74c3c');
  const [width, _setWidth]      = useState<number>(3);
  const [userId, setUserId]     = useState<string>('');

  // Construct AFTER first paint so #viewer-panel etc. exist in the DOM.
  useEffect(() => {
    const a = new DocumentAnnotator();
    ref.current = a;
    setUserId(a.userId);

    a.setColor(color);
    a.setStrokeWidth(width);
    a.setMode(mode);
    a.setTool(tool);

    setReady(true);
    return () => { a.destroy(); ref.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const api = useMemo<AnnotatorAPI>(() => ({
    ready, hasDocument: hasDoc, tool, mode, color, width, userId,
    loadFile: async (f) => { await ref.current!.loadFile(f); setHasDoc(true); },
    loadURL:  async (u, t, l) => { await ref.current!.loadURL(u, t, l); setHasDoc(true); },
    setTool:  (t) => { _setTool(t); ref.current!.setTool(t); },
    setMode:  (m) => { _setMode(m); ref.current!.setMode(m); },
    setColor: (c) => { _setColor(c); ref.current!.setColor(c); },
    setWidth: (n) => { _setWidth(n); ref.current!.setStrokeWidth(n); },
    insertImage: (f) => ref.current!.insertImage(f),
    saveXFDF:    () => ref.current!.save(),
    restoreXFDF: async (xml) => { await ref.current!.restore(xml); },
    clearLog:    () => ref.current!.clearLog(),
  }), [ready, hasDoc, tool, mode, color, width, userId]);

  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export function useAnnotator(): AnnotatorAPI {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAnnotator must be used inside <AnnotatorProvider>');
  return v;
}
```

### 6.2 React shell component

```tsx
// AnnotatorShell.tsx
import { useRef } from 'react';
import { useAnnotator } from './AnnotatorProvider';

export function AnnotatorShell() {
  const a = useAnnotator();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const xfdfInputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="vh-100 d-flex flex-column">
      {/* Top bar */}
      <header className="d-flex p-2 gap-2 border-bottom">
        <button onClick={() => fileInputRef.current?.click()}>Open</button>
        <button disabled={!a.hasDocument} onClick={() => downloadXfdf(a.saveXFDF())}>
          Save XFDF
        </button>
        <button onClick={() => xfdfInputRef.current?.click()}>Load XFDF</button>
        <button onClick={() => a.setMode(a.mode === 'edit' ? 'view' : 'edit')}>
          Mode: {a.mode}
        </button>
      </header>

      {/* Toolbar */}
      <Toolbar />

      {/* Library-required scaffold */}
      <main id="viewer-panel" className="flex-grow-1 position-relative">
        <div id="empty-state">Open a PDF or image to start annotating</div>
        <div id="loading-overlay" style={{ display: 'none' }}>Loading…</div>
        <div id="document-viewport" style={{ display: 'none' }}>
          <div id="pages-container" />
        </div>
      </main>

      <aside><div id="log-entries" /></aside>

      <div id="comment-thread-panel" style={{ display: 'none' }}>
        <div className="ctp-header">
          <span className="ctp-pin-num" />
          <button className="ctp-close" aria-label="Close">×</button>
        </div>
        <div className="ctp-messages" />
        <div className="ctp-reply-bar">
          <input className="ctp-reply-input" placeholder="Reply…" />
          <button className="ctp-reply-btn">Send</button>
        </div>
      </div>

      <div id="new-comment-popup" style={{ display: 'none' }}>
        <textarea placeholder="Add a comment…" />
        <button id="btn-cancel-comment">Cancel</button>
        <button id="btn-post-comment">Post</button>
      </div>

      <input ref={fileInputRef} type="file" hidden
             accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.svg,.bmp"
             onChange={async (e) => {
               const f = e.target.files?.[0];
               e.currentTarget.value = '';
               if (f) await a.loadFile(f);
             }} />
      <input ref={xfdfInputRef} type="file" hidden accept=".xfdf,.xml"
             onChange={async (e) => {
               const f = e.target.files?.[0];
               e.currentTarget.value = '';
               if (f) await a.restoreXFDF(await f.text());
             }} />
    </div>
  );
}

function Toolbar() {
  const a = useAnnotator();
  const tools: { tool: any; label: string; key?: string }[] = [
    { tool: 'select',    label: 'Select',    key: 'v' },
    { tool: 'freehand',  label: 'Pen',       key: 'p' },
    { tool: 'rectangle', label: 'Rect',      key: 'r' },
    { tool: 'circle',    label: 'Ellipse',   key: 'c' },
    { tool: 'line',      label: 'Line',      key: 'l' },
    { tool: 'arrow',     label: 'Arrow',     key: 'a' },
    { tool: 'polygon',   label: 'Polygon',   key: 'g' },
    { tool: 'text',      label: 'Text',      key: 't' },
    { tool: 'comment',   label: 'Comment',   key: 'm' },
    { tool: 'eraser',    label: 'Eraser',    key: 'e' },
  ];
  return (
    <div id="toolbar-panel">
      {tools.map((t) => (
        <button key={t.tool}
                disabled={a.mode === 'view'}
                onClick={() => a.setTool(t.tool)}
                className={a.tool === t.tool ? 'active' : ''}>
          {t.label}
        </button>
      ))}
      <input type="color" value={a.color} onChange={(e) => a.setColor(e.target.value)} />
      <input type="range" min={1} max={20} value={a.width}
             onChange={(e) => a.setWidth(Number(e.target.value))} />
    </div>
  );
}

function downloadXfdf(xml: string) {
  const blob = new Blob([xml], { type: 'application/vnd.adobe.xfdf' });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `annotations-${Date.now()}.xfdf`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
```

### 6.3 Mounting

```tsx
// App.tsx
import { AnnotatorProvider } from './AnnotatorProvider';
import { AnnotatorShell }    from './AnnotatorShell';

export default function App() {
  return (
    <AnnotatorProvider>
      <AnnotatorShell />
    </AnnotatorProvider>
  );
}
```

> **Tip** — under React 18 Strict Mode, the mounting effect runs twice in development. The provider above handles this correctly by destroying the previous instance in the cleanup function. If you see two annotator instances briefly, that's the intended behaviour and only happens in development.

---

## 7. Feature Reference

### 7.1 Document loading

| Method | Use case |
|---|---|
| `loadFile(file)` | Open a PDF or image `File` object (e.g. from `<input type="file">`) |
| `loadURL(url, type, label?)` | Open a document from a URL — `type` is `'pdf'` or `'image'` |

`getDocumentType(nameOrMime)` is exported as a utility for sniffing PDFs vs. images from filename or MIME type.

The reference adds `loadBlob` and `loadDataURL` helpers that wrap a Blob/data URL into a File and delegate to `loadFile`. Useful when the document arrives from `fetch()` or an API endpoint:

```ts
async loadBlob(blob: Blob, filename = 'document'): Promise<void> {
  const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
  await this.loadFile(file);
}

async loadDataURL(dataUrl: string, filename = 'document'): Promise<void> {
  const res = await fetch(dataUrl);    // browsers fetch data: URLs natively
  const blob = await res.blob();
  await this.loadBlob(blob, filename);
}
```

### 7.2 Annotation tools

| Tool | Key | Behaviour |
|---|---|---|
| `select` | V | Click to select; drag handles to resize; Delete key removes |
| `freehand` | P | Free-draw ink strokes (pencil) |
| `line` | L | Click-drag straight line |
| `arrow` | A | Click-drag line with arrowhead |
| `rectangle` | R | Click-drag outlined rectangle |
| `circle` | C | Click-drag outlined ellipse (named `'circle'` at runtime) |
| `polygon` | G | Click to place vertices; click near first point or **Enter** to close; **Escape** to cancel |
| `text` | T | Click to place an editable text label (commits on blur, removed if empty) |
| `comment` | M | Click empty space to drop a numbered comment pin and open the new-comment popup |
| `eraser` | E | Click an annotation to remove it |
| `image` | I | Stamp an image file onto the active page (typically opens a hidden file picker) |

A minimum-size guard (`MIN_SIZE = 4`) prevents accidental tiny shapes; arrows below this length are dropped.

```ts
annotator.setTool('rectangle');
annotator.setColor('#3498db');
annotator.setStrokeWidth(2);
```

### 7.3 Modes — edit vs. view

Switching to view mode locks every page canvas: drawing, selection, and erasing are disabled, and `.view-mode` is added to `#toolbar-panel` so you can grey out controls in CSS. Comment pins remain interactive in view mode (so reviewers can read existing threads) and switch to non-interactive when an editing tool other than `comment` is active.

```ts
annotator.setMode('view');
annotator.setMode('edit');
const m = annotator.getMode();   // 'edit' | 'view'
```

### 7.4 Stroke, fill, and line style

Every shape tool reads its style from six pieces of state on the library. Setting any of them affects **new** annotations only — existing annotations are not retroactively restyled.

```ts
// Stroke
annotator.setColor('#e74c3c');
annotator.setStrokeWidth(3);
annotator.setDashArray([10, 4, 2, 4]);          // dash–dot, or [] for solid

// Fill (rect / ellipse / circle / polygon / triangle)
annotator.setFillColor('#4a90e2');
annotator.setFillOpacity(0.3);                  // 0 = transparent, 1 = opaque

// Cloud-border style for new rect / line / polygon
annotator.setLineStyle('arc');                  // or 'solid'
```

The Angular reference exposes all of these through the floating annotation toolbar — the line-type selector is a popup with live SVG previews (real arcs for cloud, real dashes for everything else, not approximations).

### 7.5 Undo / redo

```ts
annotator.canUndo();   // boolean
annotator.canRedo();   // boolean
await annotator.undo();
await annotator.redo();
```

The library maintains an XFDF snapshot stack capped at 50 entries; every annotation event pushes a snapshot. Loading a new document resets the stack to a fresh baseline. See [§5.8](#58-undo--redo-wiring) for the Angular wire-up.

### 7.6 Image stamping

Two flavours:

```ts
// "Centred on active page, scaled down to ≤40% of page width if oversized."
annotator.insertImage(file);
```

That's the library default. The reference project adds a `insertImageAt(dataUrl, name, pageEl, clientX, clientY)` helper that:

1. Synthesises a `mousedown` on `pageEl` so the library's internal `_activePageIndex` updates.
2. Reaches into the per-page Fabric canvas and registers a one-shot `object:added` listener.
3. Calls the regular `insertImage(file)` flow.
4. When the new image lands, overrides `originX/Y`, `left/top`, and `scaleX/Y = 1` so the asset renders at the exact click point at its natural size.

Use this when you have a pre-defined assets palette and want pixel-precise placement (drag-and-drop, click-to-place from a sidebar, etc.). See [§12.2](#122-asset-palette-with-click-to-place) for the full pattern.

### 7.7 Comments

Comments are Figma-style numbered pins with reply threads.

- Activate the `comment` tool, then click empty space on a page → the new-comment popup opens at the cursor.
- After posting, a numbered pin appears at the click location and the thread panel opens.
- Clicking a pin re-opens its thread; replies are added through the panel's input.
- Comments are persisted in the XFDF `ext:comments` extension.

The comment system requires both `#comment-thread-panel` (with `.ctp-pin-num`, `.ctp-messages`, `.ctp-close`, `.ctp-reply-input`, `.ctp-reply-btn`) and `#new-comment-popup` (with a `<textarea>`, `#btn-post-comment`, `#btn-cancel-comment`). Both must exist when `DocumentAnnotator` is constructed.

Pin coordinates are stored in *base* (unzoomed) page space, so they reposition correctly when the canvas re-scales. Comment messages persist both `userId` and `userName`, so threads stay readable on later reloads even if the user is no longer in the host application's directory.

### 7.8 Activity log

Every draw, erase, image stamp, and comment placement fires an `ActivityEntry` callback that prepends a row into `#log-entries`. Entry shape:

```ts
interface ActivityEntry {
  id:           string;
  description:  string;        // 'Drew rectangle on page 2'
  action:       'added' | 'removed';
  tool:         AnnotationTool | 'system' | string;
  pageIndex:    number;
  objectId?:    string;
  userId:       string;
  userName?:    string;        // displayName at event time — persisted in XFDF
  timestamp:    number;        // ms since epoch
}
```

The library's renderer prefers `userName` (when present) over a truncated `userId` — so log rows show real names, while still tooltipping the underlying id for support.

Log entries are persisted in XFDF as the `ext:log` extension. After a `restore()`, the log re-populates from saved entries automatically.

```ts
annotator.clearLog();
```

### 7.9 Responsive scaling and HiDPI

`DocumentAnnotator` attaches a `ResizeObserver` to `#viewer-panel`. When the panel resizes, it:

- Recomputes the fit-to-width scale (default `containerWidth × 0.92 ÷ basePageWidth`)
- Re-renders all PDF pages at the new scale (existing render tasks are cancelled to avoid pile-up)
- Resizes every Fabric canvas via `setZoom` + `setDimensions`
- Repositions all comment pins

PDF rendering applies `displayScale × devicePixelRatio` to backing-canvas pixels for crisp HiDPI output, while CSS dimensions stay at the logical scale.

The reference project replaces the library's default `getScale` to add a user-controlled zoom level on top of fit-to-page (see [§12.1](#121-user-zoom-on-top-of-fit-to-page)).

### 7.10 PDF.js worker pinning

`PDFRenderer` falls back to a default CDN worker URL **only if** `pdfjsLib.GlobalWorkerOptions.workerSrc` is unset, and that fallback is checked **lazily** inside `load()` — not at module-load time. That means a consumer override always wins, regardless of import order:

```ts
import * as pdfjsLib from 'pdfjs-dist';
pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
// ...later, the library's load() sees the override and skips the CDN URL.
```

### 7.11 Lifecycle teardown

Always call `destroy()` on unmount. It disposes every Fabric canvas, cancels any pending PDF render tasks, revokes blob URLs, and clears the comment manager.

```ts
ngOnDestroy(): void { this.annotator.destroy(); }      // Angular
useEffect(() => () => annotator.destroy(), []);        // React
```

---

## 8. API Reference

### 8.1 `DocumentAnnotator`

```ts
new DocumentAnnotator(options?: DocumentAnnotatorOptions)
```

```ts
interface DocumentAnnotatorOptions {
  // DOM IDs (defaults shown)
  viewerPanelId?:     string;   // 'viewer-panel'
  pagesContainerId?:  string;   // 'pages-container'
  logContainerId?:    string;   // 'log-entries'
  emptyStateId?:      string;   // 'empty-state'
  loadingId?:         string;   // 'loading-overlay'
  viewportId?:        string;   // 'document-viewport'
  threadPanelId?:     string;   // 'comment-thread-panel'
  newCommentPopupId?: string;   // 'new-comment-popup'

  // Display
  displayScale?:      number;   // 1.5

  // Identity (preferred)
  user?:              User;
  // Identity (legacy — auto-converted to a User)
  userId?:            string;

  // Reactive hook fired on every history-stack change
  onChange?:          () => void;
}

interface User {
  id: string;
  displayName: string;
}
```

| Method | Signature | Description |
|---|---|---|
| `loadFile` | `(file: File) => Promise<void>` | Open a PDF or image File |
| `loadURL` | `(url, type, label?) => Promise<void>` | Open a document from a URL |
| `setMode` / `getMode` | — | Switch / read interaction mode |
| `setTool` | `(tool: AnnotationTool) => void` | Activate a tool |
| `setColor` / `setStrokeWidth` | — | Stroke colour and width |
| `setFillColor` / `setFillOpacity` | — | Fill colour, fill opacity 0–1 |
| `setDashArray` / `setLineStyle` | — | Stroke dash pattern, `'solid'` vs `'arc'` cloud-border |
| `getColor` / `getStrokeWidth` / `getFillColor` / `getFillOpacity` / `getDashArray` / `getLineStyle` | — | Read current style values |
| `insertImage` | `(file: File) => void` | Stamp an image onto the active page |
| `save` | `() => string` | Export annotations as XFDF XML |
| `restore` | `(xml: string) => Promise<void>` | Import annotations from XFDF |
| `undo` / `redo` | `() => Promise<void>` | Walk the snapshot stack |
| `canUndo` / `canRedo` | `() => boolean` | Whether undo / redo is currently meaningful |
| `clearLog` | `() => void` | Empty the activity log |
| `destroy` | `() => void` | Tear down all canvases and free resources |
| `user` | `User` (readonly) | Active user `{ id, displayName }` |
| `userId` | `string` (readonly, deprecated) | Stable id of the active user — alias of `user.id` |

### 8.2 `AnnotationCanvas`

Internal class — managed by `DocumentAnnotator`. Exposed for advanced consumers who want to embed individual page canvases.

```ts
new AnnotationCanvas({ user, onEvent, onCommentPlace })
```

Key methods: `createCanvas`, `resize`, `destroy`, `setTool`, `setMode`, `setColor`, `setStrokeWidth`, `setFillColor`, `setFillOpacity`, `setDashArray`, `setLineStyle`, `insertImage`, `toJSON`, `loadFromData`.

### 8.3 `PDFRenderer` and `ImageRenderer`

Both implement the `IRenderer` interface:

```ts
interface IRenderer {
  readonly pageCount: number;
  renderPage(pageIndex: number, canvas: HTMLCanvasElement): Promise<{ width: number; height: number }>;
  destroy(): void;
}
```

Use `PDFRenderer` directly if you want to render thumbnails or an outline panel using the same loaded document. The Angular reference does this in `pdf-thumbnails.component.ts` — it loads its own `pdfjsLib.getDocument()` instance alongside the library's, sharing the same source URL.

### 8.4 XFDF utilities

```ts
import { toXFDF, fromXFDF } from 'xfdf-annotator';

const xml: string = toXFDF({ docId, pages, comments, log });
const { pages, comments, log } = fromXFDF(xmlString);
```

### 8.5 Other utilities

```ts
import {
  generateUUID,    // () => string                — UUID v4 with crypto.randomUUID fallback
  debounce,        // <T>(fn, delay) => T          — trailing-edge debounce
  formatTime,      // (ts: number) => string       — locale time string
  getDocumentType, // (s: string) => 'pdf' | 'image' | null
  toPdfDate,       // (ts: number) => string       — 'D:YYYYMMDDHHmmss'
  fromPdfDate,     // (s: string)  => number       — ms since epoch
} from 'xfdf-annotator';
```

### 8.6 Type exports

The library exports every type used in its public surface:

```ts
import type {
  DocumentType, PageDimensions, IRenderer,
  AnnotationTool, AnnotationMode, LineStyle,
  User,
  XFDFRect, XFDFVertex, XFDFAnnotation, XFDFPageData,
  XFDFDocument, XFDFSerialiseInput,
  CommentMessage, CommentThread,
  ActivityEntry,
  AnnotatorDOMOptions, DocumentAnnotatorOptions,
  AnnotationEventHandler,    // (entry: ActivityEntry) => void
  AnnotationChangeHandler,   // () => void — onChange notifier
  CommentPlaceHandler,
  AnnotationCanvasOptions,
} from 'xfdf-annotator';
```

---

## 9. XFDF Format

`xfdf-annotator` writes XFDF that is **interoperable with Adobe Acrobat and other XFDF readers** for basic shapes, while embedding a lossless Fabric snapshot for pixel-perfect round-trips of everything the standard doesn't cover.

A saved XFDF document looks like:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<xfdf xmlns="http://ns.adobe.com/xfdf/"
      xmlns:ext="http://xfdf-annotator.example.com/ext/1.0"
      xml:space="preserve">

  <f href="my-document.pdf"/>

  <!-- Standard XFDF — readable by Acrobat & friends -->
  <annots>
    <square page="0" name="…" color="#e74c3c" width="3" rect="50,700,200,650"/>
    <ink    page="0" name="…" color="#000000" width="2" inklist="…"/>
    <freetext page="1" name="…" rect="…">Some text</freetext>
  </annots>

  <!-- Extension: lossless Fabric.js snapshot per page (primary restore path) -->
  <ext:canvas-data>
    <ext:page index="0"><![CDATA[ {"version":"…","objects":[…]} ]]></ext:page>
    <ext:page index="1"><![CDATA[ {"version":"…","objects":[…]} ]]></ext:page>
  </ext:canvas-data>

  <!-- Extension: comment threads -->
  <ext:comments counter="3"> … </ext:comments>

  <!-- Extension: activity log -->
  <ext:log><![CDATA[ [ … ] ]]></ext:log>
</xfdf>
```

### Sections

| Section | Purpose |
|---|---|
| `<annots>` | Standard XFDF annotations (`ink`, `square`, `circle`, `line`, `polyline`, `polygon`, `freetext`). Geometry is in PDF coordinate space (origin bottom-left, Y up). |
| `ext:canvas-data` | Per-page Fabric.js JSON in `CDATA`. The **primary** restore path — guarantees round-trip fidelity for images, opacity, styled text, and stroke-width caching. |
| `ext:comments` | Serialised comment threads — pin position (in base canvas coordinates), messages, resolved state, and the running counter. |
| `ext:log` | Activity log entries for an audit trail. |

### Why two representations?

- The standard `<annots>` block makes annotations **readable** by external tools — open the file in Acrobat and you'll see the rectangles, ink, and text.
- The `ext:canvas-data` block makes them **restorable** in the same library with no information loss — fonts, image data, opacity, and metadata that don't fit the standard schema are preserved.

When you call `restore(xml)`, the library uses `ext:canvas-data` first (lossless), falling back to `<annots>` only if the extension is missing.

### Fill, dash, and arc-cloud round-trip — for free

Fabric's default `toObject()` serialiser includes `fill`, `strokeDashArray`, and `Path` data. Because the library writes Fabric snapshots (in `ext:canvas-data`) using `fc.toObject(CUSTOM_PROPS)`, every fill colour, fill opacity, dash pattern, and arc-cloud shape **round-trips automatically through XFDF**. No custom XFDF tags or extra metadata are needed. (Earlier versions of the Angular app worked around this with extra `<xfdf-annotator-fills>` / `<xfdf-annotator-dashes>` tags; those workarounds were removed once the styling was lifted into the library at draw time.)

---

## 10. Coordinate Systems

| System | Origin | Y direction | Units |
|---|---|---|---|
| Screen / Fabric | Top-left | Down ↓ | px (= PDF pts at scale 1) |
| XFDF / PDF | Bottom-left | Up ↑ | PDF points |

Conversion:

- screen → PDF: `pdfY = pageHeight − screenY`
- PDF → screen: `screenY = pageHeight − pdfY`

`AnnotationCanvas` runs in screen space; `xfdf.ts` performs the flip during serialisation. You should rarely need to think about this, but it matters when you reach into Fabric directly (e.g., for the `insertImageAt` pattern in [§12.2](#122-asset-palette-with-click-to-place), where coordinates stay in *design* space).

---

## 11. Performance Notes

- **Parallel PDF page loading** — all `PDFPageProxy` objects fetched with `Promise.all` (O(1) round trips vs. sequential O(n)).
- **Progressive rendering** — page 1 paints first so the viewport is interactive immediately; remaining pages render in parallel in the background.
- **Dirty-page serialisation** — `AnnotationCanvas.toJSON()` only re-serialises pages modified since the last save; clean pages return cached JSON.
- **Cancellable PDF render tasks** — stale render tasks are cancelled on resize so rapid resizing doesn't pile up work (`RenderingCancelledException` is swallowed).
- **String-builder XFDF** — `toXFDF` builds via `array + join` rather than DOM construction; 10–50× faster for large annotation sets.
- **Single-reflow DOM build** — page wrappers are collected into a `DocumentFragment` and appended in one operation.

---

## 12. Advanced Patterns (from the Angular reference)

These are not part of the library's public API — they are integration recipes you may want to copy when building higher-fidelity UIs.

### 12.1 User zoom on top of fit-to-page

The library auto-sizes pages to ~92% of `#viewer-panel` width. To layer a user-controlled zoom on top:

```ts
// In AnnotatorService
readonly zoomLevel = signal<number>(1.0);
static readonly ZOOM_MIN  = 0.25;
static readonly ZOOM_MAX  = 4.0;
static readonly ZOOM_STEP = 1.25;

zoomIn():  void { this.setZoom(this.zoomLevel() * AnnotatorService.ZOOM_STEP); }
zoomOut(): void { this.setZoom(this.zoomLevel() / AnnotatorService.ZOOM_STEP); }
fitToPage(): void { this.setZoom(1.0); }

setZoom(level: number): void {
  const clamped = Math.max(AnnotatorService.ZOOM_MIN,
                  Math.min(AnnotatorService.ZOOM_MAX, level || 1));
  this.zoomLevel.set(clamped);
  this._applyScale(this._fitScale() * clamped);
}

private _setupZoom(): void {
  // Patch the renderer's getScale so the library's own resize path
  // uses our fit-to-page formula instead of the default 92% width.
  const internal = this._annotator as unknown as {
    _renderer?: { getScale: (w: number) => number };
  };
  if (!internal._renderer) return;
  internal._renderer.getScale = () => this._fitScale() * this.zoomLevel();
  this.fitToPage();
}
```

`_fitScale()` reads `#document-viewport` client dimensions minus padding and divides by the first page's base dimensions — fitting the page to the largest dimension. `_applyScale()` replicates the library's internal resize logic (page-wrapper widths, PDF re-render, Fabric `resize`, comment reposition).

This pattern reaches into private fields (`_renderer`, `_baseDims`, `_currentScale`, `_canvas._pages`, `_comments`). You're trading on the library's internals — pin a specific library version and re-test on upgrade.

### 12.2 Asset palette with click-to-place

The reference's `AssetsPanelComponent` shows a sidebar of pre-defined SVG/PNG stamps. Clicking a tile "arms" it; the next click on a page places it.

```ts
async insertImageAt(
  dataUrl: string, name: string,
  pageEl: HTMLElement, clientX: number, clientY: number,
): Promise<void> {
  const file = dataURLToFile(normalizeAssetDataUrl(dataUrl), name);
  if (!file) return;

  // 1. Make the clicked page the active page so the library inserts there.
  pageEl.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, clientX, clientY,
  }));

  // 2. Reach into the library's per-page fabric canvas.
  const internal = this._annotator as unknown as {
    _activePageIndex: number;
    _canvas: { _pages: Array<{ fc: any } | undefined> };
  };
  const pageIdx = internal._activePageIndex ?? 0;
  const fc = internal._canvas?._pages?.[pageIdx]?.fc;
  if (!fc) { this.a.insertImage(file); return; }   // fallback to centred default

  // 3. Compute click point in fabric design-space coordinates.
  const rect = pageEl.getBoundingClientRect();
  const zoom = (typeof fc.getZoom === 'function' ? fc.getZoom() : 1) || 1;
  const designX = (clientX - rect.left) / zoom;
  const designY = (clientY - rect.top)  / zoom;

  // 4. One-shot reposition handler.
  let done = false;
  const handler = (e: { target?: any } = {}) => {
    const obj = e.target;
    if (done || !obj) return;
    if (obj.type !== 'image' && obj.type !== 'Image') return;
    done = true;
    obj.set({
      originX: 'center', originY: 'center',
      left: designX, top: designY,
      scaleX: 1, scaleY: 1,
    });
    obj.setCoords?.();
    fc.renderAll();
    fc.off?.('object:added', handler);
  };
  fc.on('object:added', handler);

  this.a.insertImage(file);

  // Safety net: clear the listener if it never fires.
  setTimeout(() => { if (!done) fc.off?.('object:added', handler); }, 5000);
}
```

The full reference also normalises SVG data URLs (injects width/height from `viewBox`, replaces `currentColor`) so rasterless SVGs paint at their natural panel size.

### 12.3 Drag-and-drop file open

```ts
@HostListener('window:dragover', ['$event'])
onDragOver(ev: DragEvent): void {
  if (this._hasFiles(ev)) {
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
  }
}

@HostListener('window:drop', ['$event'])
async onWindowDrop(ev: DragEvent): Promise<void> {
  if (!this._hasFiles(ev)) return;
  ev.preventDefault();
  const file = ev.dataTransfer?.files?.[0];
  if (file) await this.annotator.loadFile(file);
}

private _hasFiles(ev: DragEvent): boolean {
  const types = ev.dataTransfer?.types;
  return !!types && Array.prototype.indexOf.call(types, 'Files') !== -1;
}
```

### 12.4 PDF thumbnails sidebar

The thumbnails component shares the loaded PDF with the annotator by maintaining its own `pdfjsLib.getDocument()` instance from the same source. Render lazily on viewport intersection:

```ts
private _setupObserver(doc: PDFDocumentProxy): void {
  this._io = new IntersectionObserver(
    (entries) => entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const idx = Number((entry.target as HTMLElement).dataset['pageIndex']);
      if (Number.isFinite(idx)) this._renderThumb(doc, idx);
      this._io?.unobserve(entry.target);
    }),
    { root: this.listEl?.nativeElement ?? null, rootMargin: '300px 0px' },
  );
  this.listEl?.nativeElement
    .querySelectorAll<HTMLElement>('[data-page-index]')
    .forEach((el) => this._io?.observe(el));
}
```

Click a thumbnail → scroll to its page wrapper:

```ts
scrollToPage(pageIndex: number): void {
  document.querySelector<HTMLElement>(
    `#pages-container [data-page-index="${pageIndex}"]`,
  )?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
```

### 12.5 Theme service (Bootstrap dark/light)

Set `data-bs-theme` on `<html>`, persist to `localStorage`, fall back to `matchMedia`:

```ts
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this._initial());
  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.setAttribute('data-bs-theme', t);
      try { localStorage.setItem('xfdf-annotator.theme', t); } catch {}
    });
  }
  toggle(): void { this.theme.update((t) => t === 'dark' ? 'light' : 'dark'); }
  private _initial(): Theme { /* …read storage, fallback to system pref… */ }
}
```

### 12.6 Toast notifications

The reference uses a tiny inline toast queue rather than a separate service:

```ts
readonly toasts = signal<Toast[]>([]);
private _nextToastId = 1;

private _toast(text: string, kind: ToastKind, durationMs = 2400): void {
  const id = this._nextToastId++;
  this.toasts.update((arr) => [...arr, { id, text, kind }]);
  setTimeout(() => {
    this.toasts.update((arr) => arr.filter((t) => t.id !== id));
  }, durationMs);
}
```

---

## 13. Troubleshooting

**Activity log is empty even though I'm drawing.**
The `#log-entries` element didn't exist when `DocumentAnnotator` was constructed. The activity log component must always be rendered in the DOM (only its visibility toggled). Move the `@if` from the host element to a child wrapper.

**PDF won't render — "worker not loaded" or hangs forever.**
The CDN default for `pdfjs-dist`'s worker doesn't always have the version you need. Pin `pdfjsLib.GlobalWorkerOptions.workerSrc` to a worker shipped via your app's static assets.

**SVG asset stamps render at zero size.**
Many SVGs ship without explicit `width`/`height` and report `naturalWidth = 0` when loaded into an `<img>`. Inject explicit dimensions from `viewBox` and replace `currentColor` with a concrete colour before passing to `insertImage`. See `normalizeAssetDataUrl` in the reference's `annotator.service.ts`.

**`getElementById` returns null in production but works in dev.**
Strict CSS-modules / scoped styles can rename IDs in some build setups. The library uses **literal `id="…"` attributes**, not data attributes — make sure your bundler doesn't rewrite them.

**Image stamp lands centred even though I want it at the click point.**
The library default centres images. Use the `insertImageAt` pattern from [§12.2](#122-asset-palette-with-click-to-place) to override `left/top` after the `object:added` event fires.

**Comments don't open.**
`#comment-thread-panel` and `#new-comment-popup` must be in the DOM at construction time, with the right child classes/IDs. See [§3](#3-required-dom-anchors).

**Library upgrade broke my private-field hacks.**
The advanced patterns in [§12](#12-advanced-patterns-from-the-angular-reference) reach into underscore-prefixed fields (`_renderer`, `_baseDims`, `_canvas._pages`, etc.). They are **not** part of the public API. Pin a specific library version and re-verify on upgrade.

**Undo / redo buttons stay disabled even after I draw something.**
You forgot to wire `onChange`. The library's history stack updates correctly on every annotation event, but `canUndo()` / `canRedo()` are plain getters — Angular won't re-evaluate them until a *signal* changes. Pass an `onChange: () => this._refreshHistorySignals()` callback to `new DocumentAnnotator({...})` (the reference `AnnotatorService` already does this).

**PDF still tries to fetch the worker from a CDN even though I set `workerSrc`.**
Earlier library versions ran their CDN fallback at module-load time, before consumer overrides could win. Upgrade to **0.1.3 or later** — the fallback now runs lazily inside `load()`, so any override set anywhere before the first `loadFile()` / `loadURL()` call is preserved.

**Activity log / comment thread shows opaque user IDs instead of names.**
You constructed `DocumentAnnotator` without an explicit `user`, so the library generated a random session id and used its first 8 characters as the display name. Pass `{ user: { id, displayName } }` (or call `service.init({ id, displayName })`) to surface the real name in the badge, log, and comment threads.

**Line-type popup opens off-screen.**
Don't put a CSS `transform` on the toolbar host wrapper. A non-`none` transform makes that ancestor the containing block for `position: fixed` descendants, which mis-anchors the popup. Centre the toolbar with auto-margins (`left: 0; right: 0; margin-inline: auto; width: max-content;`) instead of Bootstrap's `translate-middle-x`.

**Arc-cloud rectangle moves to the top-left of the canvas after drawing.**
Fixed in library 0.1.3. The arc-cloud Path now generates its data in *local* coordinates and is positioned via `setPositionByOrigin(centre, 'center', 'center')`, so it always lands centred on the source rectangle's bounding box regardless of `originX`/`originY`.

---

## License

MIT
