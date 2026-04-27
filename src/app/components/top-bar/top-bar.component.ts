import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  inject,
  input,
  Output,
} from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { AnnotationMode } from 'xfdf-annotator';

import { AnnotatorService } from '../../services/annotator.service';
import { ThemeService } from '../../services/theme.service';

/**
 * Application top bar — doc title, mode toggle, file actions, view tabs,
 * thumbnail toggle, theme switcher, user-id badge.
 *
 * Owns no view state of its own — all toggles bubble up to the parent App
 * via outputs / are read off the AnnotatorService signals.
 */
@Component({
  selector: 'app-top-bar',
  standalone: true,
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './top-bar.component.html',
})
export class TopBarComponent {
  readonly annotator = inject(AnnotatorService);
  readonly theme     = inject(ThemeService);

  // ── Inputs ────────────────────────────────────────────────────────
  readonly toolsTabActive  = input<boolean>(false);
  readonly logTabActive    = input<boolean>(false);
  readonly assetsTabActive = input<boolean>(false);
  readonly thumbsOpen      = input<boolean>(false);
  readonly openMenuOpen    = input<boolean>(false);

  // ── Outputs ───────────────────────────────────────────────────────
  @Output() readonly modeChange       = new EventEmitter<AnnotationMode>();
  @Output() readonly toolsTabClick    = new EventEmitter<void>();
  @Output() readonly logTabClick      = new EventEmitter<void>();
  @Output() readonly assetsTabClick   = new EventEmitter<void>();
  @Output() readonly thumbsToggle     = new EventEmitter<void>();
  @Output() readonly openMenuToggle   = new EventEmitter<MouseEvent>();
  @Output() readonly saveClick        = new EventEmitter<void>();
  @Output() readonly loadXfdfClick    = new EventEmitter<void>();

  setMode(mode: AnnotationMode): void { this.modeChange.emit(mode); }
}
