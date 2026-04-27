import { Injectable, signal, effect } from '@angular/core';

export type Theme = 'light' | 'dark';

const STORAGE_KEY = 'xfdf-annotator.theme';

/**
 * Toggles Bootstrap's `data-bs-theme` attribute on <html> and remembers
 * the choice in localStorage. The initial value is read from storage,
 * falling back to the system preference.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<Theme>(this._initial());

  constructor() {
    // Reflect every change to the DOM. Effects run inside an injection
    // context — perfect for cross-cutting side-effects like this.
    effect(() => {
      const t = this.theme();
      document.documentElement.setAttribute('data-bs-theme', t);
      try { localStorage.setItem(STORAGE_KEY, t); } catch { /* private mode */ }
    });
  }

  toggle(): void {
    this.theme.update((t) => (t === 'dark' ? 'light' : 'dark'));
  }

  set(t: Theme): void { this.theme.set(t); }

  private _initial(): Theme {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* ignore */ }
    return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
}
