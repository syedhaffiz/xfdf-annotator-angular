import {
  ChangeDetectionStrategy,
  Component,
  computed,
  EventEmitter,
  input,
  Output,
  signal,
} from '@angular/core';

import {
  ASSET_DRAG_MIME,
  type Asset,
  type AssetGroup,
  assetGroups,
} from '../../asset_utils';

/**
 * Right-side offcanvas listing the built-in asset library.
 *
 * Placement model: click a tile to "arm" it, then click on a PDF/image
 * page to place the asset there. The panel stays open so the user can
 * place several assets in succession; clicking the armed tile a second
 * time (or pressing Esc on the page) disarms.
 *
 * Drag-and-drop is also supported as a secondary path (each tile is
 * `draggable`); the parent listens for asset drops on the document
 * viewport.
 *
 * NOTE: this offcanvas intentionally renders WITHOUT a modal backdrop —
 * the user must be able to click through to the document while the
 * panel is open.
 */
@Component({
  selector: 'app-assets-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './assets-panel.component.html',
})
export class AssetsPanelComponent {
  readonly open             = input<boolean>(false);
  /** ID of the currently-armed asset (drives the highlighted-tile state). */
  readonly armedAssetId     = input<string | null>(null);

  @Output() readonly closed      = new EventEmitter<void>();
  @Output() readonly assetClick  = new EventEmitter<Asset>();

  readonly query = signal<string>('');

  /** IDs of currently-collapsed groups — initialised from the static config. */
  readonly collapsedGroups = signal<Set<string>>(
    new Set(assetGroups.filter((g) => g.collapsed).map((g) => g.id)),
  );

  readonly visibleGroups = computed<(AssetGroup & { collapsed: boolean })[]>(() => {
    const q = this.query().trim().toLowerCase();
    const collapsed = this.collapsedGroups();
    return assetGroups.map((g) => {
      const filtered = q
        ? g.assets.filter(
            (a) =>
              a.name.toLowerCase().includes(q) ||
              (a.tags ?? []).some((t) => t.toLowerCase().includes(q)),
          )
        : g.assets;
      const isCollapsed = q ? false : collapsed.has(g.id);
      return { ...g, assets: filtered, collapsed: isCollapsed };
    }).filter((g) => g.assets.length > 0);
  });

  close(): void { this.closed.emit(); }

  onSearch(ev: Event): void {
    this.query.set((ev.target as HTMLInputElement).value);
  }

  toggleGroup(id: string): void {
    this.collapsedGroups.update((set) => {
      const next = new Set(set);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  onTileClick(asset: Asset): void {
    this.assetClick.emit(asset);
  }

  onAssetDragStart(ev: DragEvent, asset: Asset): void {
    if (!ev.dataTransfer) return;
    ev.dataTransfer.setData(ASSET_DRAG_MIME, asset.dataUrl);
    ev.dataTransfer.setData('text/plain', asset.name);
    ev.dataTransfer.effectAllowed = 'copy';

    const img = new Image();
    img.src = asset.dataUrl;
    if (img.complete) ev.dataTransfer.setDragImage(img, 12, 12);
  }
}
