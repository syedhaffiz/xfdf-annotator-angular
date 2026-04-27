import { Injectable, computed, signal } from '@angular/core';
import { DocumentAnnotator, type AnnotationTool, type AnnotationMode } from 'xfdf-annotator';
import * as pdfjsLib from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';

// Minimal structural types — we only access fabric via the library's
// (otherwise-private) internals, so we avoid a direct fabric import.
interface FabricObject {
  type?: string;
  set: (props: Record<string, unknown>) => unknown;
  setCoords?: () => void;
}
interface FabricCanvas {
  getZoom?: () => number;
  on?: (event: string, handler: (e: { target?: FabricObject }) => void) => void;
  off?: (event: string, handler: (e: { target?: FabricObject }) => void) => void;
  renderAll: () => void;
}

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
 * Wraps a single DocumentAnnotator instance and exposes its mutable bits as
 * Angular signals so templates can react to mode/tool changes.
 *
 * The underlying DocumentAnnotator manipulates the DOM directly via element
 * IDs (pages-container, log-entries, etc.) — so init() must be called only
 * after the host component's view is initialised.
 */
@Injectable({ providedIn: 'root' })
export class AnnotatorService {
  private _annotator: DocumentAnnotator | null = null;

  readonly tool = signal<AnnotationTool>('select');
  readonly mode = signal<AnnotationMode>('edit');
  readonly color = signal<string>('#f38ba8');
  readonly strokeWidth = signal<number>(2);
  readonly hasDocument = signal<boolean>(false);
  readonly userId = signal<string>('');

  // Separate pdfjs PDFDocumentProxy kept alongside the library's internal
  // copy — exposed so the thumbnails component can render previews.
  private readonly _pdfDoc = signal<PDFDocumentProxy | null>(null);
  readonly pdfDoc = this._pdfDoc.asReadonly();
  readonly pageCount = computed(() => this._pdfDoc()?.numPages ?? 0);

  /**
   * User zoom multiplier applied on top of the auto fit-to-page scale.
   *  1.0 = each page fits the visible viewport (default after every load).
   *  >1   = zoom in (page may overflow horizontally → user scrolls).
   *  <1   = zoom out.
   */
  readonly zoomLevel = signal<number>(1.0);
  static readonly ZOOM_MIN = 0.25;
  static readonly ZOOM_MAX = 4.0;
  static readonly ZOOM_STEP = 1.25;

  /** Must be called after the DOM has rendered (ngAfterViewInit). */
  init(): DocumentAnnotator {
    if (this._annotator) return this._annotator;

    const a = new DocumentAnnotator();
    this._annotator = a;
    this.userId.set(a.userId);

    // Apply defaults so the underlying canvas matches the UI's initial state
    a.setColor(this.color());
    a.setStrokeWidth(this.strokeWidth());
    a.setMode(this.mode());
    a.setTool(this.tool());

    return a;
  }

  /** Throws if init() hasn't been called — useful for narrowing in callers. */
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
      try {
        await this._loadPdfDoc(await file.arrayBuffer());
      } catch {
        this._setPdfDoc(null);
      }
    } else {
      this._setPdfDoc(null);
    }
    this._setupZoom();
  }

  async loadURL(url: string, type: 'pdf' | 'image', label?: string): Promise<void> {
    await this.a.loadURL(url, type, label);
    this.hasDocument.set(true);

    if (type === 'pdf') {
      try {
        await this._loadPdfDoc(url);
      } catch {
        this._setPdfDoc(null);
      }
    } else {
      this._setPdfDoc(null);
    }
    this._setupZoom();
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
    const res = await fetch(dataUrl); // browsers fetch data: URLs natively
    const blob = await res.blob();
    await this.loadBlob(blob, filename);
  }

  // ── Tool / style ──────────────────────────────────────────────────

  setTool(tool: AnnotationTool): void {
    this.tool.set(tool);
    this.a.setTool(tool);
  }

  setMode(mode: AnnotationMode): void {
    this.mode.set(mode);
    this.a.setMode(mode);
  }

  setColor(color: string): void {
    this.color.set(color);
    this.a.setColor(color);
  }

  setStrokeWidth(width: number): void {
    this.strokeWidth.set(width);
    this.a.setStrokeWidth(width);
  }

  insertImage(file: File): void {
    this.a.insertImage(file);
  }

  /**
   * Insert an image asset (data URL) at a specific point on a specific page.
   *
   * The library's `_placeImage` always centres the image on the active
   * page and may scale it down to fit. We need the asset to land where
   * the user *clicked* and at its *natural* size. Strategy:
   *
   *   1. Synthesize a `mousedown` on `pageEl` so the library's internal
   *      `_activePageIndex` updates to that page.
   *   2. Reach into the library's private fabric canvas for that page
   *      and register a one-shot `object:added` listener.
   *   3. Trigger the library's normal `insertImage(file)` flow.
   *   4. When the new image lands on the canvas, override its position
   *      (with `originX/Y: 'center'`) and reset its scale to 1 so the
   *      asset renders at the size it had in the panel.
   *
   * Falls back to the centred default if the private fabric canvas is
   * unavailable (e.g., library version drift).
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

    // Make the clicked page active first.
    pageEl.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        cancelable: true,
        clientX,
        clientY,
      }),
    );

    const internal = this._annotator as unknown as {
      _activePageIndex: number;
      _canvas: { _pages: Array<{ fc: FabricCanvas } | undefined> };
    };
    const pageIdx = internal._activePageIndex ?? 0;
    const fc = internal._canvas?._pages?.[pageIdx]?.fc;

    if (!fc) {
      // Fallback — library default (centred).
      this.a.insertImage(file);
      return;
    }

    // Compute the click point in fabric design-space coordinates.
    const rect = pageEl.getBoundingClientRect();
    const zoom = (typeof fc.getZoom === 'function' ? fc.getZoom() : 1) || 1;
    const designX = (clientX - rect.left) / zoom;
    const designY = (clientY - rect.top) / zoom;

    // One-shot reposition handler. Library calls `_attachMeta(r, "image", n)`
    // before `t.fc.add(r)` so we can spot the right object via `kind === 'image'`.
    let done = false;
    const handler = (e: { target?: FabricObject } = {}) => {
      const obj = e.target;
      if (done || !obj) return;
      const kind = (obj as FabricObject & { kind?: string }).kind;
      const isImage = kind === 'image' || obj.type === 'image' || obj.type === 'Image';
      if (!isImage) return;
      done = true;
      obj.set({
        originX: 'center',
        originY: 'center',
        left: designX,
        top: designY,
        scaleX: 1,
        scaleY: 1,
      });
      obj.setCoords?.();
      fc.renderAll();
      fc.off?.('object:added', handler);
    };
    fc.on?.('object:added', handler);

    this.a.insertImage(file);

    // Safety net: if for any reason `object:added` never fires, drop the listener.
    setTimeout(() => {
      if (!done) fc.off?.('object:added', handler);
    }, 5000);
  }

  clearLog(): void {
    this.a.clearLog();
  }

  // ── XFDF I/O ──────────────────────────────────────────────────────

  saveXFDF(): string {
    return this.a.save();
  }

  async restoreXFDF(xml: string): Promise<void> {
    await this.a.restore(xml);
  }

  // ── Zoom ─────────────────────────────────────────────────────────

  /** Reset zoom to the auto-fit baseline (1.0) and re-layout. */
  fitToPage(): void {
    this.setZoom(1.0);
  }

  zoomIn(): void {
    this.setZoom(this.zoomLevel() * AnnotatorService.ZOOM_STEP);
  }
  zoomOut(): void {
    this.setZoom(this.zoomLevel() / AnnotatorService.ZOOM_STEP);
  }

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
   * After a load completes:
   *  1. Patch the renderer's `getScale` so the library's own
   *     ResizeObserver path uses our fit-to-page formula instead of its
   *     "92% of viewer width" default.
   *  2. Reset zoom to 1.0 (fit-to-page) and re-layout.
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
   * Replicate the library's private resize logic at our chosen scale —
   * resize page wrappers, re-render PDF pages, resize fabric canvases,
   * reposition comment pins.
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
      ).catch(() => {
        /* RenderingCancelledException etc. */
      });
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
  }
}
