/**
 * Slippy-map tile math — PURE (no I/O, no React, no logging; a fix's
 * coordinates are never printed anywhere, here or elsewhere).
 *
 * Standard Web-Mercator tiling as used by OpenStreetMap: at zoom z the
 * world is a 2^z × 2^z grid of square tiles. Longitude maps linearly;
 * latitude is clamped to the Mercator limit ±85.05112878. Tile x wraps
 * around the antimeridian (modulo 2^z); tile y does NOT wrap — it
 * clamps at the poles.
 */
import { MAP_TILE_SIZE } from './mapConfig';

export const MAX_MERCATOR_LAT = 85.05112878;

export interface TileFraction {
  /** Fractional tile coordinates: the integer part is the tile index,
   *  the fractional part is the position inside that tile (0..1). */
  x: number;
  y: number;
}

export function latLngToTileFraction(lat: number, lng: number, zoom: number): TileFraction {
  const n = 2 ** zoom;
  const clampedLat = Math.min(Math.max(lat, -MAX_MERCATOR_LAT), MAX_MERCATOR_LAT);
  const latRad = (clampedLat * Math.PI) / 180;
  const yFraction = ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n;
  return {
    x: ((lng + 180) / 360) * n,
    // The rounded clamp constant (85.05112878) sits a hair past the true
    // Mercator limit, so the raw fraction can land ~1e-11 outside
    // [0, n] at the poles — clamp it back into the world.
    y: Math.min(Math.max(yFraction, 0), n),
  };
}

export interface TileIndex {
  x: number;
  y: number;
}

/** The single tile containing a point. x wraps, y clamps. */
export function tileForLatLng(lat: number, lng: number, zoom: number): TileIndex {
  const n = 2 ** zoom;
  const f = latLngToTileFraction(lat, lng, zoom);
  return {
    x: wrapTileX(Math.floor(f.x), n),
    y: clampTileY(Math.floor(f.y), n),
  };
}

function wrapTileX(x: number, n: number): number {
  return ((x % n) + n) % n;
}

function clampTileY(y: number, n: number): number {
  return Math.min(Math.max(y, 0), n - 1);
}

export interface ViewportTile extends TileIndex {
  /** Position of the tile's top-left corner relative to the viewport's
   *  top-left corner, in pixels (may be negative / exceed the size). */
  left: number;
  top: number;
  key: string;
}

export interface ViewportTiles {
  tiles: ViewportTile[];
  /** Position of the fix point inside the viewport (its center). */
  markerLeft: number;
  markerTop: number;
}

/**
 * The exact set of tiles intersecting a width×height viewport centered
 * on (lat, lng) — and nothing more (OSM policy: viewport tiles only).
 */
export function tilesForViewport(args: {
  lat: number;
  lng: number;
  zoom: number;
  width: number;
  height: number;
  tileSize?: number;
}): ViewportTiles {
  const { lat, lng, zoom, width, height } = args;
  const tileSize = args.tileSize ?? MAP_TILE_SIZE;
  const n = 2 ** zoom;
  const f = latLngToTileFraction(lat, lng, zoom);

  // World-pixel coordinate of the fix, and of the viewport's top-left.
  const centerPx = f.x * tileSize;
  const centerPy = f.y * tileSize;
  const originX = centerPx - width / 2;
  const originY = centerPy - height / 2;

  const firstTileX = Math.floor(originX / tileSize);
  const lastTileX = Math.floor((originX + width - 1) / tileSize);
  const firstTileY = Math.max(Math.floor(originY / tileSize), 0);
  const lastTileY = Math.min(Math.floor((originY + height - 1) / tileSize), n - 1);

  const tiles: ViewportTile[] = [];
  for (let ty = firstTileY; ty <= lastTileY; ty++) {
    for (let tx = firstTileX; tx <= lastTileX; tx++) {
      const x = wrapTileX(tx, n);
      tiles.push({
        x,
        y: ty,
        left: tx * tileSize - originX,
        top: ty * tileSize - originY,
        key: `${zoom}/${x}/${ty}`,
      });
    }
  }

  return { tiles, markerLeft: width / 2, markerTop: height / 2 };
}
