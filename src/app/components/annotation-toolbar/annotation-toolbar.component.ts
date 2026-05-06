import {
  ChangeDetectionStrategy,
  Component,
  HostListener,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';
import type { AnnotationTool, LineStyle } from 'xfdf-annotator';

import { AnnotatorService } from '../../services/annotator.service';

export interface ToolDef {
  tool:  AnnotationTool;
  title: string;
  /** Bootstrap-Icons class name, e.g. "bi-cursor". */
  icon:  string;
  /** Single-letter shortcut (lower-case). */
  key?:  string;
}

/** A stroke dash pattern (or special line style) selectable from the popup. */
export interface DashPattern {
  id:        string;
  label:     string;
  /** Empty array = solid line. Ignored when `lineStyle` is `'arc'`. */
  dashArray: number[];
  /**
   * `'arc'` tells the library to render new shapes as cloud-style arc
   * borders. Defaults to `'solid'` when omitted.
   */
  lineStyle?: LineStyle;
}

/** Patterns mirroring the user's reference image (top → bottom). */
export const DASH_PATTERNS: DashPattern[] = [
  { id: 'solid',         label: 'Solid',                 dashArray: []                       },
  { id: 'dotted',        label: 'Dotted',                dashArray: [2, 4]                   },
  { id: 'short-dash',    label: 'Short Dashed',          dashArray: [6, 4]                   },
  { id: 'long-dash',     label: 'Long Dashed',           dashArray: [12, 6]                  },
  { id: 'extra-long',    label: 'Extra Long Dashed',     dashArray: [18, 8]                  },
  { id: 'dash-dot',      label: 'Dash–Dot',              dashArray: [10, 4, 2, 4]            },
  { id: 'dash-dot-dot',  label: 'Dash–Dot–Dot',          dashArray: [10, 4, 2, 4, 2, 4]      },
  { id: 'long-dash-dot', label: 'Long Dash–Dot',         dashArray: [16, 5, 3, 5]            },
  { id: 'arc',           label: 'Arc Line (Cloud)',      dashArray: [],  lineStyle: 'arc'    },
];

/**
 * Floating horizontal annotation toolbar — tool buttons, colour, brush size,
 * fill controls, line-type selector.  Visibility is controlled by the parent
 * (renders only when active).
 */
@Component({
  selector: 'app-annotation-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './annotation-toolbar.component.html',
})
export class AnnotationToolbarComponent {
  readonly annotator = inject(AnnotatorService);

  readonly tools = input.required<ToolDef[]>();

  // ── Line-type popup state ────────────────────────────────────────
  readonly patterns = DASH_PATTERNS;
  readonly lineMenuOpen = signal<boolean>(false);
  readonly lineMenuPos  = signal<{ left: number; top: number }>({ left: 0, top: 0 });

  /** Pattern object matching the service's current dashArray + lineStyle. */
  readonly currentPattern = computed<DashPattern>(() => {
    const cur = this.annotator.dashArray();
    const ls  = this.annotator.lineStyle();
    const found = DASH_PATTERNS.find(p =>
      (p.lineStyle ?? 'solid') === ls && sameArray(p.dashArray, cur),
    );
    return found ?? DASH_PATTERNS[0];
  });

  setTool(tool: AnnotationTool): void {
    if (this.annotator.mode() === 'view') return;
    if (tool === 'image') {
      // Image-stamp opens a hidden file picker handled by App via custom event.
      window.dispatchEvent(new CustomEvent('xfdf:request-image-pick'));
      return;
    }
    this.annotator.setTool(tool);
  }

  onColorChange(ev: Event): void {
    this.annotator.setColor((ev.target as HTMLInputElement).value);
  }

  onStrokeWidthChange(ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value);
    if (Number.isFinite(v)) this.annotator.setStrokeWidth(v);
  }

  onFillColorChange(ev: Event): void {
    this.annotator.setFillColor((ev.target as HTMLInputElement).value);
  }

  onFillOpacityChange(ev: Event): void {
    const v = Number((ev.target as HTMLInputElement).value);
    if (Number.isFinite(v)) this.annotator.setFillOpacity(v);
  }

  // ── Line-type popup handlers ─────────────────────────────────────

  /** Toggle the popup. Position it directly under the trigger button. */
  toggleLineMenu(ev: MouseEvent): void {
    ev.stopPropagation();
    if (this.lineMenuOpen()) {
      this.lineMenuOpen.set(false);
      return;
    }
    const btn  = ev.currentTarget as HTMLElement;
    const rect = btn.getBoundingClientRect();
    this.lineMenuPos.set({ left: rect.left, top: rect.bottom + 4 });
    this.lineMenuOpen.set(true);
  }

  selectPattern(p: DashPattern): void {
    this.annotator.setDashArray(p.dashArray, p.lineStyle ?? 'solid');
    this.lineMenuOpen.set(false);
  }

  /** Used by the template to highlight the currently selected pattern. */
  isCurrentPattern(p: DashPattern): boolean {
    return (p.lineStyle ?? 'solid') === this.annotator.lineStyle()
        && sameArray(p.dashArray, this.annotator.dashArray());
  }

  /** Helper for templates — turn a dash array into an SVG `stroke-dasharray` value. */
  dashAttr(arr: number[]): string | null {
    return arr.length ? arr.join(',') : null;
  }

  /** Outside-click closes the popup. The toggle button stops propagation, so this won't double-fire. */
  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.lineMenuOpen()) this.lineMenuOpen.set(false);
  }

  /** Esc also dismisses the popup. */
  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.lineMenuOpen()) this.lineMenuOpen.set(false);
  }

  undo(): void { this.annotator.undo(); }
  redo(): void { this.annotator.redo(); }
}

function sameArray(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
