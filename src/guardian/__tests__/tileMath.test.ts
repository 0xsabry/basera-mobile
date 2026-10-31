import { MAP_TILE_SIZE, tileUrl } from '../mapConfig';
import { latLngToTileFraction, tileForLatLng, tilesForViewport } from '../tileMath';

describe('latLngToTileFraction / tileForLatLng', () => {
  it('equator / prime meridian: z0 is the single world tile, z1 is tile (1,1)', () => {
    // At z0 the whole world is one tile; the point sits at its center.
    expect(latLngToTileFraction(0, 0, 0)).toEqual({ x: 0.5, y: 0.5 });
    expect(tileForLatLng(0, 0, 0)).toEqual({ x: 0, y: 0 });
    // At z1 the world is 2x2; (0,0) is the corner where tile (1,1) starts.
    expect(latLngToTileFraction(0, 0, 1)).toEqual({ x: 1, y: 1 });
    expect(tileForLatLng(0, 0, 1)).toEqual({ x: 1, y: 1 });
  });

  it('Cairo at z16 lands in the known tile range', () => {
    const f = latLngToTileFraction(30.0444, 31.2357, 16);
    expect(f.x).toBeCloseTo(38454.286, 2);
    expect(f.y).toBeCloseTo(27029.194, 2);
    expect(tileForLatLng(30.0444, 31.2357, 16)).toEqual({ x: 38454, y: 27029 });
  });

  it('clamps latitude beyond the Mercator limit instead of producing out-of-range tiles', () => {
    expect(tileForLatLng(89, 0, 2)).toEqual({ x: 2, y: 0 });
    expect(tileForLatLng(-89, 0, 2)).toEqual({ x: 2, y: 3 });
    expect(latLngToTileFraction(89, 0, 2).y).toBeGreaterThanOrEqual(0);
    expect(latLngToTileFraction(-89, 0, 2).y).toBeLessThanOrEqual(4);
  });

  it('wraps tile x at the antimeridian', () => {
    // lng = 180 is the same meridian as -180: tile x wraps to 0.
    expect(tileForLatLng(0, 180, 1)).toEqual({ x: 0, y: 1 });
    expect(tileForLatLng(0, -180, 1)).toEqual({ x: 0, y: 1 });
  });
});

describe('tilesForViewport', () => {
  it('Cairo z16, 330x200: returns exactly the covering set derived from the fraction math', () => {
    const width = 330;
    const height = 200;
    const zoom = 16;
    const f = latLngToTileFraction(30.0444, 31.2357, zoom);
    // Hand derivation: viewport origin (world px) = center - half size;
    // tiles from floor(origin/size) to floor((origin+size-1)/size).
    const originX = f.x * MAP_TILE_SIZE - width / 2;
    const originY = f.y * MAP_TILE_SIZE - height / 2;
    const xs = [Math.floor(originX / MAP_TILE_SIZE), Math.floor((originX + width - 1) / MAP_TILE_SIZE)];
    const ys = [Math.floor(originY / MAP_TILE_SIZE), Math.floor((originY + height - 1) / MAP_TILE_SIZE)];
    // The hand-derived ranges for Cairo are x 38453..38454, y 27028..27029.
    expect(xs).toEqual([38453, 38454]);
    expect(ys).toEqual([27028, 27029]);

    const { tiles, markerLeft, markerTop } = tilesForViewport({
      lat: 30.0444,
      lng: 31.2357,
      zoom,
      width,
      height,
    });
    expect(tiles).toHaveLength(4);
    expect(new Set(tiles.map((tile) => `${tile.x}/${tile.y}`))).toEqual(
      new Set(['38453/27028', '38454/27028', '38453/27029', '38454/27029']),
    );
    // Tile positions are anchored to the viewport origin.
    for (const tile of tiles) {
      expect(tile.left).toBeCloseTo(tile.x * MAP_TILE_SIZE - originX, 6);
      expect(tile.top).toBeCloseTo(tile.y * MAP_TILE_SIZE - originY, 6);
      expect(tile.key).toBe(`${zoom}/${tile.x}/${tile.y}`);
    }
    // The fix point sits exactly at the viewport center.
    expect(markerLeft).toBe(width / 2);
    expect(markerTop).toBe(height / 2);
  });

  it('returned tiles cover [0,width] x [0,height] with no gaps', () => {
    const width = 330;
    const height = 200;
    const { tiles } = tilesForViewport({ lat: 30.0444, lng: 31.2357, zoom: 16, width, height });
    const lefts = [...new Set(tiles.map((tile) => tile.left))].sort((a, b) => a - b);
    const tops = [...new Set(tiles.map((tile) => tile.top))].sort((a, b) => a - b);
    expect(lefts[0]).toBeLessThanOrEqual(0);
    expect(lefts[lefts.length - 1] + MAP_TILE_SIZE).toBeGreaterThanOrEqual(width);
    expect(tops[0]).toBeLessThanOrEqual(0);
    expect(tops[tops.length - 1] + MAP_TILE_SIZE).toBeGreaterThanOrEqual(height);
    for (let i = 1; i < lefts.length; i++) expect(lefts[i] - lefts[i - 1]).toBeCloseTo(MAP_TILE_SIZE, 6);
    for (let i = 1; i < tops.length; i++) expect(tops[i] - tops[i - 1]).toBeCloseTo(MAP_TILE_SIZE, 6);
  });

  it('wraps tile x across the antimeridian while keeping positions continuous', () => {
    const { tiles, markerLeft } = tilesForViewport({ lat: 0, lng: 179.99, zoom: 1, width: 330, height: 200 });
    const xs = tiles.map((tile) => tile.x);
    // The viewport straddles the wrap: it needs both the last tile (1)
    // and the wrapped first tile (0) of the 2-wide world.
    expect(xs).toContain(1);
    expect(xs).toContain(0);
    const lefts = [...new Set(tiles.map((tile) => tile.left))].sort((a, b) => a - b);
    for (let i = 1; i < lefts.length; i++) expect(lefts[i] - lefts[i - 1]).toBeCloseTo(MAP_TILE_SIZE, 6);
    expect(markerLeft).toBe(165);
  });

  it('clamps tile y at the poles (no tiles beyond the world edge)', () => {
    const north = tilesForViewport({ lat: 85.05112878, lng: 0, zoom: 2, width: 330, height: 200 });
    expect(north.tiles.every((tile) => tile.y >= 0 && tile.y < 4)).toBe(true);
    expect(Math.min(...north.tiles.map((tile) => tile.y))).toBe(0);
    const south = tilesForViewport({ lat: -85.05112878, lng: 0, zoom: 2, width: 330, height: 200 });
    expect(south.tiles.every((tile) => tile.y >= 0 && tile.y < 4)).toBe(true);
    expect(Math.max(...south.tiles.map((tile) => tile.y))).toBe(3);
  });
});

describe('tileUrl', () => {
  it('builds an HTTPS OSM tile URL from the template', () => {
    expect(tileUrl(38454, 27029, 16)).toBe('https://tile.openstreetmap.org/16/38454/27029.png');
  });
});
