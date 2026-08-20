import { describe, it, expect } from 'vitest'
import { lonToTileX, latToTileY, mapTileUrl, terrainTileUrl, decodeElev } from '../src/lib/geoTiles.js'

describe('web mercator tile math', () => {
  it('centres (0,0) at the middle tile', () => {
    expect(lonToTileX(0, 0)).toBeCloseTo(0.5, 6)
    expect(latToTileY(0, 0)).toBeCloseTo(0.5, 6)
  })
  it('maps the antimeridian and poles to the edges', () => {
    expect(lonToTileX(-180, 0)).toBeCloseTo(0, 6)
    expect(lonToTileX(180, 0)).toBeCloseTo(1, 6)
    expect(latToTileY(85.0511, 0)).toBeGreaterThan(0) // near top
    expect(latToTileY(85.0511, 0)).toBeLessThan(0.01)
  })
  it('scales with zoom', () => {
    expect(lonToTileX(0, 2)).toBeCloseTo(2, 6) // 0.5 * 2^2
  })
})

describe('mapTileUrl', () => {
  it('uses free public sources with no key', () => {
    expect(mapTileUrl('Street', 3, 1, 2, '', 'maptiler')).toContain('openstreetmap.org/3/1/2')
    // Esri satellite swaps to {z}/{y}/{x}
    expect(mapTileUrl('Satellite', 3, 1, 2, '', 'maptiler')).toContain('/3/2/1')
    expect(mapTileUrl('Topographic', 3, 1, 2, '', 'maptiler')).toContain('opentopomap')
    expect(mapTileUrl('Dark', 3, 1, 2, '', 'maptiler')).toContain('cartocdn')
  })
  it('upgrades to MapTiler / Mapbox when a key is present', () => {
    expect(mapTileUrl('Satellite', 3, 1, 2, 'KEY', 'maptiler')).toContain('api.maptiler.com')
    expect(mapTileUrl('Satellite', 3, 1, 2, 'KEY', 'maptiler')).toContain('key=KEY')
    expect(mapTileUrl('Street', 3, 1, 2, 'KEY', 'mapbox')).toContain('api.mapbox.com')
  })
})

describe('terrain DEM', () => {
  it('defaults to free Terrarium tiles', () => {
    expect(terrainTileUrl(5, 1, 2, '', 'maptiler')).toContain('elevation-tiles-prod/terrarium/5/1/2')
  })
  it('uses terrain-RGB with a key', () => {
    expect(terrainTileUrl(5, 1, 2, 'KEY', 'mapbox')).toContain('terrain-rgb')
  })
  it('decodes elevation per provider', () => {
    // Terrarium encodes sea level (32768) → 0m
    expect(decodeElev(128, 0, 0, '', 'maptiler')).toBeCloseTo(0, 3)
    // terrain-RGB base is -10000m at (0,0,0)
    expect(decodeElev(0, 0, 0, 'KEY', 'mapbox')).toBeCloseTo(-10000, 3)
  })
})
