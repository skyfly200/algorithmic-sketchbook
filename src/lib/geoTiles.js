// Slippy-map (Web Mercator) tile math and provider URL builders for the Geodata
// and Terrain nodes. Free, no-key public sources are the default; a MapTiler or
// Mapbox key (from Settings) upgrades the imagery/elevation. Pure functions —
// the key/provider are passed in — so the projection and URL logic can be
// unit-tested without the Pinia store.

// Longitude/latitude → fractional tile coordinate at zoom z.
export const lonToTileX = (lon, z) => (lon + 180) / 360 * (2 ** z)
export const latToTileY = (lat, z) => { const r = lat * Math.PI / 180; return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (2 ** z) }

// Imagery tile URL. Note Esri (the free satellite default) uses {z}/{y}/{x} order.
export function mapTileUrl(layer, z, x, y, key, prov) {
  if (key && prov === 'maptiler') {
    const set = layer === 'Satellite' ? 'satellite-v2' : layer === 'Topographic' ? 'outdoor-v2' : layer === 'Dark' ? 'streets-v2-dark' : 'streets-v2'
    const ext = layer === 'Satellite' ? 'jpg' : 'png'
    return `https://api.maptiler.com/maps/${set}/${z}/${x}/${y}.${ext}?key=${key}`
  }
  if (key && prov === 'mapbox') {
    if (layer === 'Satellite') return `https://api.mapbox.com/v4/mapbox.satellite/${z}/${x}/${y}@2x.jpg90?access_token=${key}`
    const style = layer === 'Dark' ? 'dark-v11' : layer === 'Topographic' ? 'outdoors-v12' : 'streets-v12'
    return `https://api.mapbox.com/styles/v1/mapbox/${style}/tiles/512/${z}/${x}/${y}@2x?access_token=${key}`
  }
  // free defaults
  if (layer === 'Satellite') return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`
  if (layer === 'Topographic') return `https://a.tile.opentopomap.org/${z}/${x}/${y}.png`
  if (layer === 'Dark') return `https://a.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`
  return `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png`
}

// Elevation (DEM) tile URL — terrain-RGB with a key, else free Terrarium tiles.
export function terrainTileUrl(z, x, y, key, prov) {
  if (key && prov === 'mapbox') return `https://api.mapbox.com/v4/mapbox.terrain-rgb/${z}/${x}/${y}.pngraw?access_token=${key}`
  if (key && prov === 'maptiler') return `https://api.maptiler.com/tiles/terrain-rgb-v2/${z}/${x}/${y}.webp?key=${key}`
  return `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png` // free, CORS-enabled
}

// Decode an elevation-tile pixel to metres, matching the provider's encoding.
export function decodeElev(r, g, b, key, prov) {
  if (key && (prov === 'mapbox' || prov === 'maptiler')) return -10000 + (r * 65536 + g * 256 + b) * 0.1 // terrain-RGB
  return (r * 256 + g + b / 256) - 32768 // Terrarium
}
