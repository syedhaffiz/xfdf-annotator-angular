import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  inject,
  input,
  Output,
} from '@angular/core';

import { AnnotatorService } from '../../services/annotator.service';

/**
 * Bootstrap offcanvas wrapping the library-required `#log-entries` element.
 *
 * IMPORTANT: this component must always be in the DOM (not @if-guarded by
 * the parent) — `DocumentAnnotator` calls `getElementById('log-entries')`
 * once at construction time. If the element doesn't exist then, log events
 * are silently dropped for the lifetime of the annotator instance.
 */
@Component({
  selector: 'app-activity-log',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './activity-log.component.html',
})
export class ActivityLogComponent {
  readonly annotator = inject(AnnotatorService);

  readonly open = input<boolean>(false);

  @Output() readonly closed = new EventEmitter<void>();

  close(): void { this.closed.emit(); }

  clear(): void { this.annotator.clearLog(); }
}
