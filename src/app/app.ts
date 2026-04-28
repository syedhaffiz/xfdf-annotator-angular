import {
  AfterViewInit,
  ChangeDetectionStrategy,
  Component,
  HostListener,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import type { AnnotationTool, AnnotationMode } from 'xfdf-annotator';

import { AnnotatorService } from './services/annotator.service';
import { ThemeService } from './services/theme.service';

import { TopBarComponent } from './components/top-bar/top-bar.component';
import { AnnotationToolbarComponent, type ToolDef } from './components/annotation-toolbar/annotation-toolbar.component';
import { ActivityLogComponent } from './components/activity-log/activity-log.component';
import { PdfThumbnailsComponent } from './components/pdf-thumbnails/pdf-thumbnails.component';
import { AssetsPanelComponent } from './components/assets-panel/assets-panel.component';
import { ASSET_DRAG_MIME, type Asset } from './asset_utils';

type ToastKind = 'info' | 'success' | 'error';
interface Toast { id: number; text: string; kind: ToastKind; }

type UrlMode = 'direct' | 'blob' | 'dataurl';
interface UrlModalState { open: boolean; mode: UrlMode; }

const URL_MODE_LABELS: Record<UrlMode, { title: string; hint: string; submit: string }> = {
  direct:  { title: 'Open file from URL',       hint: 'Enter a direct URL to a PDF or image file',         submit: 'Open URL' },
  blob:    { title: 'Open from API (Blob)',     hint: 'Enter an API endpoint that returns a binary Blob',  submit: 'Fetch Blob' },
  dataurl: { title: 'Open from API (Data URL)', hint: 'Enter an API endpoint that returns a data: URL',    submit: 'Fetch Data URL' },
};

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    TopBarComponent,
    AnnotationToolbarComponent,
    ActivityLogComponent,
    PdfThumbnailsComponent,
    AssetsPanelComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class App implements AfterViewInit, OnDestroy {
  readonly annotator = inject(AnnotatorService);
  readonly theme     = inject(ThemeService);

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

  // ── Tab / sidebar state ───────────────────────────────────────────
  /** null = no annotate-toolbar shown. */
  readonly centerTab   = signal<'tools' | null>('tools');
  readonly logOpen     = signal<boolean>(false);
  readonly assetsOpen  = signal<boolean>(false);
  readonly thumbsOpen  = signal<boolean>(false);

  /** Asset the user clicked in the AssetsPanel — placed on the next page click. */
  readonly armedAsset  = signal<Asset | null>(null);

  // ── Toast queue (inlined — no separate service) ───────────────────
  readonly toasts = signal<Toast[]>([]);
  private _nextToastId = 1;

  // ── URL / API loaders ─────────────────────────────────────────────
  readonly urlModal = signal<UrlModalState>({ open: false, mode: 'direct' });
  readonly urlInput = signal<string>('');
  readonly urlBusy  = signal<boolean>(false);
  readonly urlModeLabels = URL_MODE_LABELS;

  // ── Drag-and-drop ─────────────────────────────────────────────────
  readonly isDragging = signal<boolean>(false);
  private _dragDepth = 0;

  // ── Open-file dropdown (manual — Bootstrap JS isn't loaded) ───────
  readonly openMenuOpen = signal<boolean>(false);
  readonly openMenuPos  = signal<{ left: number; top: number }>({ left: 0, top: 0 });

  // ── Lifecycle ─────────────────────────────────────────────────────
  ngAfterViewInit(): void {
    // DocumentAnnotator queries the DOM by ID — must run after view init.
    this.annotator.init();
  }

  ngOnDestroy(): void {
    this.annotator.destroy();
  }

  // ── Tab handlers ──────────────────────────────────────────────────
  toggleToolsTab(): void {
    this.centerTab.update((t) => (t === 'tools' ? null : 'tools'));
  }
  toggleLog():    void { this.logOpen.update((v) => !v); }
  closeLog():     void { this.logOpen.set(false); }
  toggleAssets(): void { this.assetsOpen.update((v) => !v); }
  closeAssets():  void {
    this.assetsOpen.set(false);
    this.armedAsset.set(null);  // closing the panel cancels selection
  }

  // ── Asset click-to-place ──────────────────────────────────────────
  onAssetClick(asset: Asset): void {
    // Clicking the armed tile a second time disarms.
    if (this.armedAsset()?.id === asset.id) {
      this.armedAsset.set(null);
      return;
    }
    if (!this.annotator.hasDocument()) {
      this._toast('Open a document first', 'info');
      return;
    }
    if (this.annotator.mode() === 'view') {
      this._toast('Switch to edit mode to place assets', 'info');
      return;
    }
    this.armedAsset.set(asset);
    this._toast(`"${asset.name}" armed — click a page to place (one-shot)`, 'info');
  }

  /**
   * Capture-phase click on the page to place the armed asset before any
   * other handlers (fabric / library) consume it.
   */
  async onPageClickCapture(ev: MouseEvent): Promise<void> {
    const armed = this.armedAsset();
    if (!armed) return;

    const target = ev.target as HTMLElement | null;
    const pageLayers = target?.closest<HTMLElement>('.page-layers');
    if (!pageLayers) return;

    ev.preventDefault();
    ev.stopPropagation();

    // Disarm immediately — each placement requires a fresh asset selection.
    this.armedAsset.set(null);

    try {
      await this.annotator.insertImageAt(
        armed.dataUrl, armed.name, pageLayers, ev.clientX, ev.clientY,
      );
      this._toast(`Placed ${armed.name}`, 'success');
    } catch (e) {
      this._toast(`Failed to place asset: ${this._msg(e)}`, 'error');
    }
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    if (this.armedAsset()) {
      this.armedAsset.set(null);
      this._toast('Asset placement cancelled', 'info');
    }
  }
  toggleThumbs(): void { this.thumbsOpen.update((v) => !v); }

  // ── Mode / tool / save / load ─────────────────────────────────────
  setMode(mode: AnnotationMode): void { this.annotator.setMode(mode); }

  clearLog(): void { this.annotator.clearLog(); }

  saveXFDF(): void {
    if (!this.annotator.hasDocument()) return;
    try {
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
      this._toast('XFDF saved', 'success');
    } catch (e) {
      this._toast(`Save failed: ${this._msg(e)}`, 'error');
    }
  }

  // ── File pickers ──────────────────────────────────────────────────
  async onFileChosen(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file  = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await this.annotator.loadFile(file);
      // PDFs auto-open thumbnails; images close them.
      this.thumbsOpen.set(this.annotator.pageCount() > 0);
      this._toast(`Loaded ${file.name}`, 'success');
    } catch (e) {
      this._toast(`Failed to load: ${this._msg(e)}`, 'error');
    }
  }

  onImageChosen(ev: Event): void {
    const input = ev.target as HTMLInputElement;
    const file  = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      this.annotator.insertImage(file);
    } catch (e) {
      this._toast(`Failed to insert image: ${this._msg(e)}`, 'error');
    }
  }

  async onXfdfChosen(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file  = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      await this.annotator.restoreXFDF(await file.text());
      this._toast('XFDF restored', 'success');
    } catch (e) {
      this._toast(`Failed to load XFDF: ${this._msg(e)}`, 'error');
    }
  }

  // ── URL / API loaders ─────────────────────────────────────────────
  openUrlDialog(mode: UrlMode): void {
    this.urlInput.set('');
    this.urlModal.set({ open: true, mode });
  }
  closeUrlDialog(): void {
    if (this.urlBusy()) return;
    this.urlModal.set({ open: false, mode: this.urlModal().mode });
  }
  onUrlInput(ev: Event): void {
    this.urlInput.set((ev.target as HTMLInputElement).value);
  }
  async submitUrl(): Promise<void> {
    const url = this.urlInput().trim();
    if (!url || this.urlBusy()) return;

    const mode = this.urlModal().mode;
    this.urlBusy.set(true);
    try {
      if (mode === 'direct') {
        const type = this._urlType(url);
        await this.annotator.loadURL(url, type, this._filenameFromUrl(url));
      } else if (mode === 'blob') {
        const res  = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        await this.annotator.loadBlob(blob, this._filenameFromUrl(url));
      } else {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const txt = (await res.text()).trim();
        const dataUrl = txt.startsWith('data:')
          ? txt
          : (() => { try { return JSON.parse(txt).dataUrl as string; } catch { return txt; } })();
        if (!dataUrl?.startsWith('data:')) throw new Error('Response is not a data: URL');
        await this.annotator.loadDataURL(dataUrl, this._filenameFromUrl(url));
      }
      this.thumbsOpen.set(this.annotator.pageCount() > 0);
      this._toast('Document loaded', 'success');
      this.urlModal.set({ open: false, mode });
    } catch (e) {
      this._toast(`Failed to load: ${this._msg(e)}`, 'error');
    } finally {
      this.urlBusy.set(false);
    }
  }

  // ── Drag-and-drop (files OR asset stamps) ─────────────────────────
  @HostListener('window:dragenter', ['$event'])
  onDragEnter(ev: DragEvent): void {
    if (!this._hasFiles(ev)) return;
    ev.preventDefault();
    this._dragDepth++;
    this.isDragging.set(true);
  }

  @HostListener('window:dragover', ['$event'])
  onDragOver(ev: DragEvent): void {
    // Allow both external file drags and in-app asset drags.
    if (this._hasFiles(ev) || this._hasAsset(ev)) {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'copy';
    }
  }

  @HostListener('window:dragleave', ['$event'])
  onDragLeave(ev: DragEvent): void {
    if (!this._hasFiles(ev)) return;
    this._dragDepth = Math.max(0, this._dragDepth - 1);
    if (this._dragDepth === 0) this.isDragging.set(false);
  }

  @HostListener('window:drop', ['$event'])
  async onWindowDrop(ev: DragEvent): Promise<void> {
    // ── Asset drop: place a stamp on the dropped page ─────────────
    if (this._hasAsset(ev)) {
      ev.preventDefault();
      if (!this.annotator.hasDocument()) {
        this._toast('Open a document before placing an asset', 'info');
        return;
      }
      if (this.annotator.mode() === 'view') {
        this._toast('Switch to edit mode to place assets', 'info');
        return;
      }
      const dataUrl = ev.dataTransfer?.getData(ASSET_DRAG_MIME);
      const name    = ev.dataTransfer?.getData('text/plain') || 'asset';
      if (!dataUrl) return;

      // Drop target's enclosing page — required for click-point placement.
      const target = ev.target as HTMLElement | null;
      const pageLayers = target?.closest<HTMLElement>('.page-layers');
      if (!pageLayers) {
        this._toast('Drop on a page to place the asset', 'info');
        return;
      }

      try {
        await this.annotator.insertImageAt(
          dataUrl, name, pageLayers, ev.clientX, ev.clientY,
        );
        this._toast(`Placed ${name}`, 'success');
      } catch (e) {
        this._toast(`Failed to place asset: ${this._msg(e)}`, 'error');
      }
      this.armedAsset.set(null);  // disarm after a successful drop too
      return;
    }

    // ── File drop: load the file as a new document ────────────────
    if (!this._hasFiles(ev)) return;
    ev.preventDefault();
    this._dragDepth = 0;
    this.isDragging.set(false);

    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    try {
      await this.annotator.loadFile(file);
      this.thumbsOpen.set(this.annotator.pageCount() > 0);
      this._toast(`Loaded ${file.name}`, 'success');
    } catch (e) {
      this._toast(`Failed to load: ${this._msg(e)}`, 'error');
    }
  }

  private _hasAsset(ev: DragEvent): boolean {
    const types = ev.dataTransfer?.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, ASSET_DRAG_MIME) !== -1;
  }

  // ── Open-file dropdown ────────────────────────────────────────────
  toggleOpenMenu(ev: MouseEvent): void {
    ev.stopPropagation();
    if (!this.openMenuOpen()) {
      const rect = (ev.currentTarget as HTMLElement).getBoundingClientRect();
      this.openMenuPos.set({ left: rect.right - 220, top: rect.bottom + 4 });
    }
    this.openMenuOpen.update((v) => !v);
  }
  closeOpenMenu(): void { this.openMenuOpen.set(false); }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.openMenuOpen()) this.openMenuOpen.set(false);
  }

  // ── Image-stamp pick request from AnnotationToolbar ──────────────
  @HostListener('window:xfdf:request-image-pick')
  onRequestImagePick(): void {
    document.querySelector<HTMLInputElement>('input[type=file][accept="image/*"]')?.click();
  }

  // ── Keyboard shortcuts ────────────────────────────────────────────
  @HostListener('window:keydown', ['$event'])
  onKeydown(ev: KeyboardEvent): void {
    const t = ev.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;

    // Ctrl/Cmd+Z = undo · Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y = redo
    const ctrl = ev.ctrlKey || ev.metaKey;
    if (ctrl && ev.key.toLowerCase() === 'z') {
      ev.preventDefault();
      if (ev.shiftKey) this.annotator.redo();
      else this.annotator.undo();
      return;
    }
    if (ctrl && ev.key.toLowerCase() === 'y') {
      ev.preventDefault();
      this.annotator.redo();
      return;
    }

    if (ev.ctrlKey || ev.metaKey || ev.altKey) return;

    const def = this.tools.find((x) => x.key === ev.key.toLowerCase());
    if (def) {
      ev.preventDefault();
      this._setToolFromShortcut(def.tool);
    }
  }

  private _setToolFromShortcut(tool: AnnotationTool): void {
    if (this.annotator.mode() === 'view') return;
    if (tool === 'image') {
      this.onRequestImagePick();
      return;
    }
    this.annotator.setTool(tool);
  }

  // ── Helpers ───────────────────────────────────────────────────────
  private _toast(text: string, kind: ToastKind, durationMs = 2400): void {
    const id = this._nextToastId++;
    this.toasts.update((arr) => [...arr, { id, text, kind }]);
    setTimeout(() => {
      this.toasts.update((arr) => arr.filter((t) => t.id !== id));
    }, durationMs);
  }

  private _msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }

  private _hasFiles(ev: DragEvent): boolean {
    const types = ev.dataTransfer?.types;
    if (!types) return false;
    return Array.prototype.indexOf.call(types, 'Files') !== -1;
  }

  private _urlType(url: string): 'pdf' | 'image' {
    try {
      const path = new URL(url, window.location.href).pathname.toLowerCase();
      if (path.endsWith('.pdf')) return 'pdf';
    } catch { /* fall through */ }
    return /\.pdf(\?|#|$)/i.test(url) ? 'pdf' : 'image';
  }

  private _filenameFromUrl(url: string): string {
    try {
      const path = new URL(url, window.location.href).pathname;
      const last = path.split('/').filter(Boolean).pop();
      if (last) return decodeURIComponent(last);
    } catch { /* ignore */ }
    return 'document';
  }
}
