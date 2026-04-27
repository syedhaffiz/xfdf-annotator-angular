// ─────────────────────────────────────────────────────────────────────
//  Built-in asset library — data: URL stamps the user can drop into
//  any page. Each asset is a self-contained PNG / SVG embedded as a
//  data URL so the library never makes a network request to render
//  them.
// ─────────────────────────────────────────────────────────────────────

const fireFill =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAABjklEQVR4AbSTOyiGURjHXVIuG0Upi0GUwmJQDDKZDCQLi8GAwkAWl8UmkcGipFgwG5TFQhGxyCKDxWA0ufyedOo97/c8532P8vX/nctzOf/v+973lBT98yfWoDX2+8QaXGEwCbkVY1DJqRWwBQdQBpmKMWhLnDbC+gzEkMlWjMFw6pge9kcQPCOYpNmpmsU4pNVPYBRM5TEopXsHqkDTvBZ0sSwDye9TPAiWmknUgCo5QE0QLIZdkAfKFFSDlQ0ZrNE0Bln6ouARVFkGfVQH/1vyTqcsPkCVZbCtVuvBBT38G9UMOkg1QR7Jrb6nUJ7XJnMjeNIMOr0Ke3NBagbq4ASmoAs8aQZyqbwiY/NA/BCeYQBE9TIk0QzekwWB9QS5ISgHp4JezeDWVf9hvk73aAaXFL1CrF5ouAFPmsE3FYsQq1mtQTOQuj0GeQWZcmmFqmMokGUghdMMqxDSJ8k5WAZVIQNpWGJoB/k18t7LW/LG/hw2oAXWwVSWgTTeMciv6WaWO1LL3AtyyZ6Yg/oBAAD//0jhkt8AAAAGSURBVAMAPAowMY+Qn2gAAAAASUVORK5CYII=';

const waterSplashFill =
  'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9ImN1cnJlbnRDb2xvciIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNNS42NDA5MiA2LjYzODc0TDEyLjAwNDkgMC4yNzQ3OEwxOC4zNjg4IDYuNjM4NzRDMjEuODgzNiAxMC4xNTM1IDIxLjg4MzYgMTUuODUxOSAxOC4zNjg4IDE5LjM2NjdDMTQuODU0MSAyMi44ODE0IDkuMTU1NjQgMjIuODgxNCA1LjY0MDkyIDE5LjM2NjdDMi4xMjYyIDE1Ljg1MTkgMi4xMjYyIDEwLjE1MzUgNS42NDA5MiA2LjYzODc0SDUuNjQwOTJaTTEzLjAwNDkgMTEuMDAyN1Y2LjUwMjdMOC41MDQ4OCAxMy4wMDI3SDExLjAwNDlWMTcuNTAyN0wxNS41MDQ5IDExLjAwMjdIMTMuMDA0OVoiLz48L3N2Zz4=';

const surveyFill =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAABjklEQVR4AbSTOyiGURjHXVIuG0Upi0GUwmJQDDKZDCQLi8GAwkAWl8UmkcGipFgwG5TFQhGxyCKDxWA0ufyedOo97/c8532P8vX/nctzOf/v+973lBT98yfWoDX2+8QaXGEwCbkVY1DJqRWwBQdQBpmKMWhLnDbC+gzEkMlWjMFw6pge9kcQPCOYpNmpmsU4pNVPYBRM5TEopXsHqkDTvBZ0sSwDye9TPAiWmknUgCo5QE0QLIZdkAfKFFSDlQ0ZrNE0Bln6ouARVFkGfVQH/1vyTqcsPkCVZbCtVuvBBT38G9UMOkg1QR7Jrb6nUJ7XJnMjeNIMOr0Ke3NBagbq4ASmoAs8aQZyqbwiY/NA/BCeYQBE9TIk0QzekwWB9QS5ISgHp4JezeDWVf9hvk73aAaXFL1CrF5ouAFPmsE3FYsQq1mtQTOQuj0GeQWZcmmFqmMokGUghdMMqxDSJ8k5WAZVIQNpWGJoB/k18t7LW/LG/hw2oAXWwVSWgTTeMciv6WaWO1LL3AtyyZ6Yg/oBAAD//0jhkt8AAAAGSURBVAMAPAowMY+Qn2gAAAAASUVORK5CYII=';

const sunFoggyFill =
  'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9ImN1cnJlbnRDb2xvciIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNNi4zNDE0MSAxNEM2LjEyMDMxIDEzLjM3NDQgNiAxMi43MDEzIDYgMTJDNiA4LjY4NjI5IDguNjg2MjkgNiAxMiA2QzE1LjMxMzcgNiAxOCA4LjY4NjI5IDE4IDEyQzE4IDE1LjMxMzcgMTUuMzEzNyAxOCAxMiAxOFYxNEg2LjM0MTQxWk02IDIwSDE1VjIySDZWMjBaTTEgMTFINFYxM0gxVjExWk0yIDE2SDEwVjE4SDJWMTZaTTExIDFIMTNWNEgxMVYxWk0zLjUxNDcyIDQuOTI4OTNMNC45Mjg5MyAzLjUxNDcyTDcuMDUwMjUgNS42MzYwNEw1LjYzNjA0IDcuMDUwMjVMMy41MTQ3MiA0LjkyODkzWk0xNi45NDk3IDE4LjM2NEwxOC4zNjQgMTYuOTQ5N0wyMC40ODUzIDE5LjA3MTFMMTkuMDcxMSAyMC40ODUzTDE2Ljk0OTcgMTguMzY0Wk0xOS4wNzExIDMuNTE0NzJMMjAuNDg1MyA0LjkyODkzTDE4LjM2NCA3LjA1MDI1TDE2Ljk0OTcgNS42MzYwNEwxOS4wNzExIDMuNTE0NzJaTTIzIDExVjEzSDIwVjExSDIzWiIvPjwvc3ZnPg==';

const hammerFill =
  'data:image/svg+xml;base64,PHN2ZyB2aWV3Qm94PSIwIDAgMjQgMjQiIGZpbGw9ImN1cnJlbnRDb2xvciIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTcgOFYySDIwQzIwLjU1MjMgMiAyMSAyLjQ0NzcyIDIxIDNWN0MyMSA3LjU1MjI4IDIwLjU1MjMgOCAyMCA4SDE3Wk0xNSAyMkMxNSAyMi41NTIzIDE0LjU1MjMgMjMgMTQgMjNIMTBDOS40NDc3MiAyMyA5IDIyLjU1MjMgOSAyMlY4SDIuNVY2LjA3NDM3QzIuNSA1LjcxODcgMi42ODg5MSA1LjM4OTggMi45OTYxMyA1LjIxMDU5TDguNSAySDE1VjIySDZWMjBaIi8+PC9zdmc+';

export interface Asset {
  id:      string;
  name:    string;
  dataUrl: string;
  /** Optional keyword tags used by the search filter. */
  tags?:   string[];
}

export interface AssetGroup {
  id:        string;
  name:      string;
  /** Whether the group should start collapsed in the panel. */
  collapsed?: boolean;
  assets:    Asset[];
}

export const assetGroups: AssetGroup[] = [
  {
    id:   'frequently-used',
    name: 'Frequently Used',
    assets: [
      { id: 'fire-1',  name: 'Fire',  dataUrl: fireFill,  tags: ['fire', 'flame', 'hazard'] },
      { id: 'water-1', name: 'Water', dataUrl: waterSplashFill, tags: ['water', 'splash', 'fluid'] },
    ],
  },
  {
    id:   'fire-detection-alarm-systems',
    name: 'Fire Detection & Alarm Systems',
    assets: [
      { id: 'fire-2',     name: 'Fire',     dataUrl: fireFill,     tags: ['fire', 'flame'] },
      { id: 'water-2',    name: 'Water',    dataUrl: waterSplashFill, tags: ['water'] },
      { id: 'survey-1',   name: 'Survey',   dataUrl: surveyFill,   tags: ['survey'] },
      { id: 'sunfoggy-1', name: 'Sun',      dataUrl: sunFoggyFill, tags: ['sun', 'weather'] },
    ],
  },
  {
    id:   'fire-suppression',
    name: 'Fire Suppression Systems',
    collapsed: true,
    assets: [
      { id: 'water-3',  name: 'Water',  dataUrl: waterSplashFill, tags: ['water'] },
      { id: 'fire-3',   name: 'Fire',   dataUrl: fireFill,   tags: ['fire'] },
    ],
  },
  {
    id:   'electrical',
    name: 'Electrical Equipment',
    collapsed: true,
    assets: [
      { id: 'hammer-1', name: 'Tool', dataUrl: hammerFill, tags: ['tool', 'hammer'] },
    ],
  },
  {
    id:   'hvac',
    name: 'HVAC Systems',
    collapsed: true,
    assets: [
      { id: 'sunfoggy-2', name: 'Sun', dataUrl: sunFoggyFill, tags: ['sun', 'weather'] },
    ],
  },
];

/** Flat list — kept for callers that don't care about grouping. */
export const assets: string[] = assetGroups.flatMap((g) => g.assets.map((a) => a.dataUrl));

/** MIME types recognised by the asset drop handler. */
export const ASSET_DRAG_MIME = 'application/x-xfdf-asset';
