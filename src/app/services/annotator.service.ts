import { Injectable, computed, signal } from '@angular/core';
import {
  DocumentAnnotator,
  type AnnotationTool,
  type AnnotationMode,
  type LineStyle,
  type User,
} from 'xfdf-annotator';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// xfdf-annotator's PDFRenderer falls back to a CDN URL that doesn't always
// resolve (cdnjs hadn't published the matching pdf.js version at the time
// this app was built). Pin the worker to the local copy that angular.json
// emits to /assets/pdfjs/. This must run before DocumentAnnotator loads
// any PDF — setting it at module scope is fine because pdfjsLib is a
// singleton.
pdfjsLib.GlobalWorkerOptions.workerSrc = 'assets/pdfjs/pdf.worker.min.mjs';

/**
 * Normalise an SVG data URL so the asset paints at its natural size.
 *
 * Many of our assets ship with only `viewBox` (no width/height) and a
 * `fill="currentColor"`. Loaded directly into an HTML `<img>` (what
 * fabric.Image.fromURL does internally), they report
 * `naturalWidth = naturalHeight = 0` and never paint. We inject explicit
 * dimensions from the viewBox and replace currentColor with a solid
 * value so the SVG paints standalone — but we DON'T rasterize, so the
 * asset keeps its original (panel-equivalent) size on the page.
 *
 * Non-SVG data URLs are returned unchanged.
 */
function normalizeAssetDataUrl(dataUrl: string): string {
  if (!dataUrl.startsWith('data:image/svg+xml')) return dataUrl;

  const comma = dataUrl.indexOf(',');
  if (comma < 0) return dataUrl;
  const header = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const isB64 = /;base64$/i.test(header);
  let svg: string;
  try {
    svg = isB64 ? atob(body) : decodeURIComponent(body);
  } catch {
    return dataUrl;
  }

  if (!/<svg[^>]*\swidth\s*=/i.test(svg)) {
    const vb = /viewBox\s*=\s*["']([^"']+)["']/i.exec(svg);
    let w = 64,
      h = 64;
    if (vb) {
      const parts = vb[1]
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      if (parts.length === 4 && parts.every(Number.isFinite)) {
        w = parts[2];
        h = parts[3];
      }
    }
    svg = svg.replace(/<svg\b/i, `<svg width="${w}" height="${h}"`);
  }
  svg = svg.replace(/currentColor/g, '#1f2329');
  try {
    return 'data:image/svg+xml;base64,' + btoa(svg);
  } catch {
    return dataUrl;
  }
}

/** Decode a `data:...;base64,...` (or `data:...,...` URL-encoded) URL into a File. */
function dataURLToFile(dataUrl: string, filename: string): File | null {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const header = dataUrl.slice(5, comma); // strip "data:"
  const body = dataUrl.slice(comma + 1);
  const isBase64 = /;base64$/i.test(header);
  const mime = (isBase64 ? header.replace(/;base64$/i, '') : header) || 'application/octet-stream';
  let bytes: Uint8Array;
  try {
    if (isBase64) {
      const bin = atob(body);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    } else {
      bytes = new TextEncoder().encode(decodeURIComponent(body));
    }
  } catch {
    return null;
  }
  const ext = mime.split('/')[1]?.split('+')[0] ?? 'bin';
  // Cast: TS 5.9 narrows Uint8Array to ArrayBufferLike but BlobPart still wants ArrayBuffer.
  return new File([bytes.buffer as ArrayBuffer], `${filename}.${ext}`, { type: mime });
}

/**
 * Reactive Angular shim around `DocumentAnnotator`.
 *
 * The library owns annotation behaviour, fabric, XFDF, and undo/redo.
 * This service:
 *   • mirrors library state into Angular signals so templates re-render
 *     on every change,
 *   • adds Angular-only conveniences (asset placement, fit-to-page zoom,
 *     pdfjs proxy for the thumbnails sidebar),
 *   • wraps the library's load/save methods so callers can pass `File`,
 *     `Blob`, data URL, or remote URL interchangeably.
 *
 * It deliberately holds **no** annotation logic — fill, dash, line style,
 * undo/redo, snapshotting, fabric access, and XFDF custom tags all live
 * in the library now.
 */
@Injectable({ providedIn: 'root' })
export class AnnotatorService {
  private _annotator: DocumentAnnotator | null = null;

  // ── Library-mirrored state (signals so templates re-render) ─────
  readonly tool        = signal<AnnotationTool>('select');
  readonly mode        = signal<AnnotationMode>('edit');
  readonly color       = signal<string>('#f38ba8');
  readonly strokeWidth = signal<number>(2);
  readonly fillColor   = signal<string>('#4a90e2');
  /** Stored as 0–100 for UI ergonomics; library uses 0–1. */
  readonly fillOpacity = signal<number>(0);
  readonly dashArray   = signal<number[]>([]);
  readonly lineStyle   = signal<LineStyle>('solid');

  readonly hasDocument = signal<boolean>(false);
  /** Identity of the human currently authoring annotations. */
  readonly user = signal<User | null>(null);
  /** @deprecated use `user()?.id`. */
  readonly userId = computed<string>(() => this.user()?.id ?? '');

  readonly canUndo = signal<boolean>(false);
  readonly canRedo = signal<boolean>(false);

  // Independent pdfjs proxy for the thumbnails sidebar. The library has
  // its own copy too; we keep this one so the sidebar can render without
  // reaching into library internals.
  private readonly _pdfDoc = signal<PDFDocumentProxy | null>(null);
  readonly pdfDoc = this._pdfDoc.asReadonly();
  readonly pageCount = computed(() => this._pdfDoc()?.numPages ?? 0);

  /** User zoom multiplier on top of the auto fit-to-page scale. */
  readonly zoomLevel = signal<number>(1.0);
  static readonly ZOOM_MIN  = 0.25;
  static readonly ZOOM_MAX  = 4.0;
  static readonly ZOOM_STEP = 1.25;

  /**
   * Must be called after the DOM has rendered (ngAfterViewInit).
   *
   * @param user  Optional `User` for the active session. If omitted, the
   *              library generates an anonymous identity whose displayName
   *              is the first 8 characters of the generated id.
   */
  init(user?: User): DocumentAnnotator {
    if (this._annotator) return this._annotator;

    const a = new DocumentAnnotator({
      ...(user ? { user } : {}),
      // Library pushes a notification on every history-stack change. Without
      // this, our canUndo/canRedo signals would only refresh when the user
      // calls undo()/redo() — never when they just *drew* something — so the
      // toolbar buttons would stay disabled forever.
      onChange: () => this._refreshHistorySignals(),
    });
    this._annotator = a;
    this.user.set(a.user);

    // Push our defaults down to the library.
    a.setColor(this.color());
    a.setStrokeWidth(this.strokeWidth());
    a.setMode(this.mode());
    a.setTool(this.tool());

    return a;
  }

  /** Throws if init() hasn't been called. */
  private get a(): DocumentAnnotator {
    if (!this._annotator) throw new Error('AnnotatorService not initialised');
    return this._annotator;
  }

  // ── Document load ─────────────────────────────────────────────────

  async loadFile(file: File): Promise<void> {
    await this.a.loadFile(file);
    this.hasDocument.set(true);

    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
    if (isPdf) {
      try { await this._loadPdfDoc(await file.arrayBuffer()); }
      catch { this._setPdfDoc(null); }
    } else {
      this._setPdfDoc(null);
    }
    this._setupZoom();
    this._refreshHistorySignals();
  }

  async loadURL(url: string, type: 'pdf' | 'image', label?: string): Promise<void> {
    await this.a.loadURL(url, type, label);
    this.hasDocument.set(true);

    if (type === 'pdf') {
      try { await this._loadPdfDoc(url); }
      catch { this._setPdfDoc(null); }
    } else {
      this._setPdfDoc(null);
    }
    this._setupZoom();
    this._refreshHistorySignals();
  }

  private async _loadPdfDoc(src: ArrayBuffer | string): Promise<void> {
    const task =
      typeof src === 'string'
        ? pdfjsLib.getDocument({ url: src, cMapPacked: true })
        : pdfjsLib.getDocument({ data: src });
    const doc = await task.promise;
    this._setPdfDoc(doc);
  }

  private _setPdfDoc(doc: PDFDocumentProxy | null): void {
    const prev = this._pdfDoc();
    if (prev && prev !== doc) prev.destroy().catch(() => {});
    this._pdfDoc.set(doc);
  }

  /** Wraps a Blob in a File and loads it. */
  async loadBlob(blob: Blob, filename = 'document'): Promise<void> {
    const file = new File([blob], filename, { type: blob.type || 'application/octet-stream' });
    await this.loadFile(file);
  }

  /** Decodes a data: URL into a Blob and loads it. */
  async loadDataURL(dataUrl: string, filename = 'document'): Promise<void> {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    await this.loadBlob(blob, filename);
  }

  // ── Tool / style ──────────────────────────────────────────────────

  setTool(tool: AnnotationTool): void { this.tool.set(tool); this.a.setTool(tool); }
  setMode(mode: AnnotationMode): void { this.mode.set(mode); this.a.setMode(mode); }
  setColor(color: string): void       { this.color.set(color); this.a.setColor(color); }
  setStrokeWidth(width: number): void { this.strokeWidth.set(width); this.a.setStrokeWidth(width); }

  setFillColor(color: string): void {
    this.fillColor.set(color);
    this.a.setFillColor(color);
  }

  /** UI passes 0–100; library expects 0–1. */
  setFillOpacity(percent: number): void {
    const clamped = Math.max(0, Math.min(100, Math.round(percent)));
    this.fillOpacity.set(clamped);
    this.a.setFillOpacity(clamped / 100);
  }

  setDashArray(arr: number[], style: LineStyle = 'solid'): void {
    this.dashArray.set(Array.isArray(arr) ? [...arr] : []);
    this.lineStyle.set(style);
    this.a.setDashArray(arr);
    this.a.setLineStyle(style);
  }

  // ── Image / asset insertion ──────────────────────────────────────

  insertImage(file: File): void {
    this.a.insertImage(file);
  }

  /**
   * Insert an image asset (data URL) at a specific point on a specific page.
   * Converts the client-space drop/click coordinates to scene (unscaled canvas)
   * coordinates, then delegates to the library's coordinate-aware insertImageAt.
   */
  async insertImageAt(
    dataUrl: string,
    name: string,
    pageEl: HTMLElement,
    clientX: number,
    clientY: number,
  ): Promise<void> {
    const normalized = normalizeAssetDataUrl(dataUrl);
    const file = dataURLToFile(normalized, name);
    if (!file) return;

    // Resolve page index from the wrapper's data attribute.
    const wrapper = pageEl.closest<HTMLElement>('[data-page-index]');
    const pageIndex = wrapper ? parseInt(wrapper.dataset['pageIndex'] ?? '0', 10) : 0;

    // Convert client coords to scene (unscaled canvas) coords.
    // _currentScale equals the Fabric canvas zoom set by resize().
    const internal = this._annotator as unknown as { _currentScale?: number };
    const scale = internal._currentScale ?? 1;
    const rect = pageEl.getBoundingClientRect();
    const sceneX = (clientX - rect.left) / scale;
    const sceneY = (clientY - rect.top) / scale;

    this.a.insertImageAt(file, pageIndex, sceneX, sceneY);
  }

  clearLog(): void { this.a.clearLog(); }

  // ── XFDF I/O ──────────────────────────────────────────────────────

  saveXFDF(): string { return this.a.save(); }

  async restoreXFDF(xml: string): Promise<void> {
    await this.a.restore(xml);
    this._refreshHistorySignals();
  }

  // ── Undo / redo (delegates to library, mirrors signals) ──────────

  async undo(): Promise<void> {
    await this.a.undo();
    this._refreshHistorySignals();
  }

  async redo(): Promise<void> {
    await this.a.redo();
    this._refreshHistorySignals();
  }

  /**
   * Pull `canUndo`/`canRedo` from the library. The library doesn't expose
   * change events for the history stack, so we tick this manually after
   * every operation that could shift the index.
   */
  private _refreshHistorySignals(): void {
    if (!this._annotator) return;
    this.canUndo.set(this.a.canUndo());
    this.canRedo.set(this.a.canRedo());
  }

  // ── Zoom ─────────────────────────────────────────────────────────

  /** Reset zoom to the auto-fit baseline (1.0) and re-layout. */
  fitToPage(): void { this.setZoom(1.0); }
  zoomIn(): void  { this.setZoom(this.zoomLevel() * AnnotatorService.ZOOM_STEP); }
  zoomOut(): void { this.setZoom(this.zoomLevel() / AnnotatorService.ZOOM_STEP); }

  /** Set the zoom multiplier (clamped). */
  setZoom(level: number): void {
    const clamped = Math.max(
      AnnotatorService.ZOOM_MIN,
      Math.min(AnnotatorService.ZOOM_MAX, level || 1),
    );
    this.zoomLevel.set(clamped);
    this._applyScale(this._fitScale() * clamped);
  }

  /**
   * Patch the renderer's `getScale` so the library's own ResizeObserver
   * path uses our fit-to-page formula, then reset to 1.0 and re-layout.
   *
   * This still touches one library private (`_renderer`), and could
   * become a public `setScaleStrategy(fn)` API in a future library
   * release — flagged but not blocking the current refactor.
   */
  private _setupZoom(): void {
    const internal = this._annotator as unknown as {
      _renderer?: { getScale: (w: number) => number };
    };
    const renderer = internal._renderer;
    if (!renderer) return;
    renderer.getScale = () => this._fitScale() * this.zoomLevel();
    this.fitToPage();
  }

  /** Compute the scale that makes the first page fit the document viewport. */
  private _fitScale(): number {
    const internal = this._annotator as unknown as {
      _baseDims?: Array<{ width: number; height: number }>;
    };
    const dims = internal._baseDims?.[0];
    if (!dims) return 1;

    const viewport = document.getElementById('document-viewport');
    if (!viewport) return 1;
    const cs = getComputedStyle(viewport);
    const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
    const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const availW = Math.max(100, viewport.clientWidth - padX);
    const availH = Math.max(100, viewport.clientHeight - padY);

    return Math.min(availW / dims.width, availH / dims.height);
  }

  /**
   * Replicate the library's private resize logic at our chosen scale.
   * Like `_setupZoom`, this could be replaced by a single public
   * `setScale(scale)` method on the library.
   */
  private _applyScale(scale: number): void {
    const internal = this._annotator as unknown as {
      _baseDims?: Array<{ width: number; height: number }>;
      _currentScale: number;
      _docType: 'pdf' | 'image' | null;
      _renderer?: {
        renderPage?: (i: number, el: HTMLCanvasElement, scale: number) => Promise<unknown>;
      };
      _canvas?: { resize?: (i: number, scale: number) => void };
      _comments?: { repositionAll?: (scale: number) => void };
      _opts?: { pagesContainerId?: string };
    };
    const dims = internal._baseDims;
    if (!dims?.length || !Number.isFinite(scale) || scale <= 0) return;

    internal._currentScale = scale;
    const containerId = internal._opts?.pagesContainerId ?? 'pages-container';
    const container = document.getElementById(containerId);
    if (!container) return;

    const pdfRenders: Array<{ i: number; el: HTMLCanvasElement }> = [];

    for (let i = 0; i < dims.length; i++) {
      const { width, height } = dims[i];
      const w = Math.round(width * scale);
      const h = Math.round(height * scale);
      const wrapper = container.querySelector<HTMLElement>(`[data-page-index="${i}"]`);
      if (!wrapper) continue;

      const layers = wrapper.querySelector<HTMLElement>('.page-layers');
      if (layers) {
        layers.style.width = w + 'px';
        layers.style.height = h + 'px';
      }

      if (internal._docType === 'pdf') {
        const c = wrapper.querySelector<HTMLCanvasElement>('.pdf-layer');
        if (c) pdfRenders.push({ i, el: c });
      } else {
        const im = wrapper.querySelector<HTMLElement>('.image-layer');
        if (im) {
          im.style.width = w + 'px';
          im.style.height = h + 'px';
        }
      }
      internal._canvas?.resize?.(i, scale);
    }

    if (pdfRenders.length && internal._renderer?.renderPage) {
      Promise.all(
        pdfRenders.map(({ i, el }) => internal._renderer!.renderPage!(i, el, scale)),
      ).catch(() => { /* RenderingCancelledException etc. */ });
    }
    internal._comments?.repositionAll?.(scale);
  }

  destroy(): void {
    if (this._annotator) {
      this._annotator.destroy();
      this._annotator = null;
      this.hasDocument.set(false);
    }
    this._setPdfDoc(null);
    this.canUndo.set(false);
    this.canRedo.set(false);
  }
}
