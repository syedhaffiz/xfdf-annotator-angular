import {
  AfterViewChecked,
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  inject,
  input,
  signal,
  ViewChild,
} from '@angular/core';
import type { PDFDocumentProxy } from 'pdfjs-dist';

import { AnnotatorService } from '../../services/annotator.service';

interface Thumb {
  pageIndex: number;
  rendered: boolean;
}

const THUMB_WIDTH = 130;        // CSS px
const RENDER_SCALE_BASE = 0.25; // base scale before page-fit adjust

/**
 * Vertical strip of PDF page thumbnails. Click a thumbnail to scroll the
 * main viewport to that page. Thumbnails render lazily as they scroll into
 * view (IntersectionObserver), so initial mount cost is constant.
 */
@Component({
  selector: 'app-pdf-thumbnails',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './pdf-thumbnails.component.html',
})
export class PdfThumbnailsComponent implements AfterViewChecked {
  readonly annotator = inject(AnnotatorService);

  readonly open            = input<boolean>(false);
  readonly activePageIndex = input<number>(0);

  readonly thumbs = signal<Thumb[]>([]);

  @ViewChild('list', { static: false }) listEl?: ElementRef<HTMLElement>;

  private _io: IntersectionObserver | null = null;
  private _observedDoc: PDFDocumentProxy | null = null;

  constructor() {
    // Whenever the underlying pdfjs doc changes, rebuild the thumb list.
    effect(() => {
      const doc = this.annotator.pdfDoc();
      this._rebuild(doc);
    });
  }

  /**
   * The aside is `@if`-guarded by `open && thumbs.length > 0`, so listEl can
   * appear / disappear without us getting a clean "rendered" hook. Re-attach
   * the observer on every view-checked tick when state mismatches.
   */
  ngAfterViewChecked(): void {
    const doc = this.annotator.pdfDoc();
    if (doc && this.open() && this.listEl && this._observedDoc !== doc) {
      this._setupObserver(doc);
    } else if ((!doc || !this.open()) && this._io) {
      this._teardownObserver();
    }
  }

  private _rebuild(doc: PDFDocumentProxy | null): void {
    this._teardownObserver();
    if (!doc) {
      this.thumbs.set([]);
      return;
    }
    const next: Thumb[] = [];
    for (let i = 0; i < doc.numPages; i++) {
      next.push({ pageIndex: i, rendered: false });
    }
    this.thumbs.set(next);
    // Observer attaches on the next ngAfterViewChecked once the aside has rendered.
  }

  private _setupObserver(doc: PDFDocumentProxy): void {
    this._teardownObserver();
    this._observedDoc = doc;

    if (typeof IntersectionObserver === 'undefined') {
      this.thumbs().forEach((_, i) => this._renderThumb(doc, i));
      return;
    }
    const root = this.listEl?.nativeElement ?? null;
    this._io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const idx = Number((entry.target as HTMLElement).dataset['pageIndex']);
          if (Number.isFinite(idx)) this._renderThumb(doc, idx);
          this._io?.unobserve(entry.target);
        }
      },
      { root, rootMargin: '300px 0px' },
    );
    const hosts = this.listEl?.nativeElement.querySelectorAll<HTMLElement>('[data-page-index]');
    hosts?.forEach((el) => this._io?.observe(el));
  }

  private _teardownObserver(): void {
    this._io?.disconnect();
    this._io = null;
    this._observedDoc = null;
  }

  private async _renderThumb(doc: PDFDocumentProxy, pageIndex: number): Promise<void> {
    const list = this.thumbs();
    const t = list[pageIndex];
    if (!t || t.rendered) return;

    try {
      const page = await doc.getPage(pageIndex + 1);
      const baseVp = page.getViewport({ scale: 1 });
      const fitScale = THUMB_WIDTH / baseVp.width;
      const scale = Math.max(fitScale, RENDER_SCALE_BASE);
      const vp = page.getViewport({ scale });

      const dpr = window.devicePixelRatio || 1;
      const canvas = document.createElement('canvas');
      canvas.width  = Math.round(vp.width  * dpr);
      canvas.height = Math.round(vp.height * dpr);
      canvas.style.width  = '100%';
      canvas.style.height = 'auto';

      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      await page.render({ canvasContext: ctx, canvas, viewport: vp }).promise;

      const host = this.listEl?.nativeElement.querySelector<HTMLElement>(
        `[data-page-index="${pageIndex}"] .thumb-canvas-host`,
      );
      if (host) {
        host.innerHTML = '';
        host.appendChild(canvas);
      }

      this.thumbs.update((arr) =>
        arr.map((x, i) => (i === pageIndex ? { ...x, rendered: true } : x)),
      );
    } catch {
      /* RenderingCancelledException etc. — ignore */
    }
  }

  scrollToPage(pageIndex: number): void {
    const target = document.querySelector<HTMLElement>(
      `#pages-container [data-page-index="${pageIndex}"]`,
    );
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
