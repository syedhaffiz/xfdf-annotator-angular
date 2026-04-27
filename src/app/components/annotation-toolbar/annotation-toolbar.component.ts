import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
} from '@angular/core';
import type { AnnotationTool } from 'xfdf-annotator';

import { AnnotatorService } from '../../services/annotator.service';

export interface ToolDef {
  tool:  AnnotationTool;
  title: string;
  /** Bootstrap-Icons class name, e.g. "bi-cursor". */
  icon:  string;
  /** Single-letter shortcut (lower-case). */
  key?:  string;
}

/**
 * Floating horizontal annotation toolbar — tool buttons, color, brush size.
 * Visibility is controlled by the parent (renders only when active).
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
}
