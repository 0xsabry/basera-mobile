/**
 * OpenStreetMap tile configuration for the in-app map preview.
 *
 * OSM Tile Usage Policy compliance (https://operations.osmfoundation.org/policies/tiles/):
 * - HTTPS only — tiles are fetched exclusively from tile.openstreetmap.org
 *   over TLS via the template below.
 * - Viewport tiles only — the preview requests ONLY the tiles that
 *   intersect the visible map area (see tileMath.tilesForViewport);
 *   there is no prefetching, no bulk downloading and no offline tile
 *   storage or caching layer in the app.
 * - An explicit User-Agent is sent with every tile request
 *   (MAP_TILE_USER_AGENT): the generic okhttp default UA is blocked by
 *   the OSM tile servers, and the policy requires apps to identify
 *   themselves anyway.
 * - Attribution is mandatory: MAP_TILE_ATTRIBUTION must always be
 *   visible on the rendered preview (LocationMapPreview renders it on
 *   a chip in the corner at all times).
 */

export const MAP_TILE_URL_TEMPLATE = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export const MAP_TILE_ATTRIBUTION = '© OpenStreetMap contributors';

export const MAP_TILE_USER_AGENT = 'BASERA/1.1 (me.auramarketing.basera)';

export const MAP_DEFAULT_ZOOM = 16;

export const MAP_TILE_SIZE = 256;

/** Build the tile image URL for tile coordinates (x, y) at zoom z. */
export function tileUrl(x: number, y: number, z: number): string {
  return MAP_TILE_URL_TEMPLATE.replace('{z}', String(z))
    .replace('{x}', String(x))
    .replace('{y}', String(y));
}
