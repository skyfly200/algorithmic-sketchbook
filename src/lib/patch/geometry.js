// The Patch Camera's 3D geometry subsystem, lifted out of PatchView. The THREE
// object builders need the (lazily-imported) three.js module, so they're bound
// through createGeometryKit(THREE); the colour maths, rebuild signature, 2D
// wireframe thumbnails and the per-frame warp are framework-free and exported
// directly (and unit-tested). The Camera node calls kit.buildGeoObject once per
// rebuild and updateObject() every frame.
import { genVoxels } from '../points.js'

// HSV (h 0-360, s/v 0-100) → HSL fractions, for THREE.Color.setHSL and CSS.
// Colour nodes store H/S/V; the classic single-hue look is the default S/V.
export function hsvToHsl(h, s, v) {
  const ss = (s ?? 72) / 100, vv = (v ?? 90) / 100
  const l = vv * (1 - ss / 2)
  const sl = l === 0 || l === 1 ? 0 : (vv - l) / Math.min(l, 1 - l)
  return { h: ((((h ?? 0) % 360) + 360) % 360) / 360, s: sl, l }
}
export function hsvCss(h, s, v) { const c = hsvToHsl(h, s, v); return `hsl(${Math.round(c.h * 360)}, ${Math.round(c.s * 100)}%, ${Math.round(c.l * 100)}%)` }

// Rebuild signature: any change here rebuilds the object in the camera. Point
// clouds and voxels bake their colours/size into the geometry, so those are part
// of their signature; a plain Shape updates colour live and leaves them out.
export function geoSig(geo) {
  const baked = geo.source === 'Shape' ? '' : `${geo.hue}/${geo.sat}/${geo.val}/${geo.pointSize}/${geo.verticalScale}`
  return [geo.source, geo.shape, geo.material, geo.detail, geo.flutes, geo.twist, geo.groove, geo.cloud, geo.voxel, geo.count, geo.res, geo.dataVer, baked].join('|')
}

export function disposeObject(obj) {
  obj.geometry?.dispose?.()
  obj.material?.dispose?.()
}

// Per-frame update: spin the object, keep single-colour materials tracking the
// node's hue, and run the "vertex shader" — push each vertex along its normal by
// a travelling wave of its base position so the mesh warps in geometry space.
export function updateObject(obj, geo, time) {
  const spin = geo.spin ?? 0.5
  obj.rotation.y = time * spin * 0.6
  obj.rotation.x = time * spin * 0.25 + 0.3
  // Voxels (InstancedMesh) and vertex/instance-coloured objects keep their own
  // colours; only override a single-colour material's colour, and only warp
  // objects that carry per-vertex base positions (shapes + point clouds).
  if (obj.isInstancedMesh) return
  if (obj.material.color && !obj.material.vertexColors) { const c = hsvToHsl(geo.hue ?? 160, geo.sat, geo.val); obj.material.color.setHSL(c.h, c.s, c.l) }
  const base = obj.userData.base, nrm = obj.userData.nrm
  if (!base || !nrm) return
  const isSolid = geo.source === 'Shape' && geo.material === 'Solid'
  const amp = geo.displace ?? 0
  const g = obj.geometry
  const pos = g.attributes.position
  if (amp < 0.001) {
    if (obj.userData.warped) {
      pos.array.set(base); pos.needsUpdate = true; obj.userData.warped = false
      if (isSolid) g.computeVertexNormals()
    }
  } else {
    const f = geo.freq ?? 2
    for (let i = 0; i < pos.count; i++) {
      const ix = i * 3
      const bx = base[ix], by = base[ix + 1], bz = base[ix + 2]
      const w = Math.sin(bx * f + time) * Math.cos(by * f * 1.3 - time * 0.8) * Math.sin(bz * f * 0.7 + time * 1.1)
      const sc = amp * 0.55 * w
      pos.array[ix] = bx + nrm[ix] * sc
      pos.array[ix + 1] = by + nrm[ix + 1] * sc
      pos.array[ix + 2] = bz + nrm[ix + 2] * sc
    }
    pos.needsUpdate = true
    obj.userData.warped = true
    if (isSolid) g.computeVertexNormals()
  }
}

// Cheap wireframe skeletons (verts + edge index pairs) for the Geometry node's
// 2D thumbnail — one per shape so the preview matches the selected shape. Cached
// per shape since evalGeo runs every frame; the real 3D render is at the Camera.
const geoWireCache = new Map()
export function geoWire(shape) {
  if (geoWireCache.has(shape)) return geoWireCache.get(shape)
  const V = [], E = []
  const ringEdges = (idx) => { for (let i = 0; i < idx.length; i++) E.push([idx[i], idx[(i + 1) % idx.length]]) }
  const circle = (n, rad, y) => { const idx = []; for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n; idx.push(V.length); V.push([Math.cos(a) * rad, y, Math.sin(a) * rad]) } return idx }
  if (shape === 'Sphere') {
    const nlat = 4, nlon = 8, top = V.length; V.push([0, 1, 0]); const bot = V.length; V.push([0, -1, 0])
    const grid = []
    for (let i = 1; i < nlat; i++) { const phi = (Math.PI * i) / nlat, y = Math.cos(phi), r = Math.sin(phi); grid.push(circle(nlon, r, y)) }
    for (const row of grid) ringEdges(row)
    for (let j = 0; j < nlon; j++) { E.push([top, grid[0][j]]); for (let i = 0; i < grid.length - 1; i++) E.push([grid[i][j], grid[i + 1][j]]); E.push([grid[grid.length - 1][j], bot]) }
  } else if (shape === 'Icosahedron') {
    const t = 1.618033988749
    const raw = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    for (const v of raw) { const L = Math.hypot(v[0], v[1], v[2]); V.push([(v[0] / L) * 1.15, (v[1] / L) * 1.15, (v[2] / L) * 1.15]) }
    for (let i = 0; i < V.length; i++) for (let j = i + 1; j < V.length; j++) {
      const dx = V[i][0] - V[j][0], dy = V[i][1] - V[j][1], dz = V[i][2] - V[j][2]
      if (dx * dx + dy * dy + dz * dz < 1.6) E.push([i, j])
    }
  } else if (shape === 'Torus') {
    const Rr = 0.85, tr = 0.34, nu = 12, nv = 6, grid = []
    for (let i = 0; i < nu; i++) { const u = (2 * Math.PI * i) / nu, row = []; for (let j = 0; j < nv; j++) { const vv = (2 * Math.PI * j) / nv, cr = Rr + tr * Math.cos(vv); row.push(V.length); V.push([cr * Math.cos(u), tr * Math.sin(vv), cr * Math.sin(u)]) } grid.push(row) }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { E.push([grid[i][j], grid[(i + 1) % nu][j]]); E.push([grid[i][j], grid[i][(j + 1) % nv]]) }
  } else if (shape === 'Torus knot') {
    const p = 2, q = 3, n = 48, idx = []
    for (let i = 0; i < n; i++) { const a = (2 * Math.PI * i) / n, r = 0.6 + 0.28 * Math.cos(q * a); idx.push(V.length); V.push([r * Math.cos(p * a), 0.3 * Math.sin(q * a), r * Math.sin(p * a)]) }
    ringEdges(idx)
  } else if (shape === 'Cone') {
    const apex = V.length; V.push([0, 1.1, 0]); const idx = circle(12, 1, -0.7); ringEdges(idx)
    for (let i = 0; i < idx.length; i += 2) E.push([apex, idx[i]])
  } else if (shape === 'Cylinder') {
    const top = circle(12, 0.8, 0.85), bot = circle(12, 0.8, -0.85); ringEdges(top); ringEdges(bot)
    for (let i = 0; i < top.length; i += 2) E.push([top[i], bot[i]])
  } else if (shape === 'Plane') {
    const n = 4, s = 1.1, grid = []
    for (let i = 0; i <= n; i++) { const row = []; for (let j = 0; j <= n; j++) { row.push(V.length); V.push([(j / n * 2 - 1) * s, (i / n * 2 - 1) * s, 0]) } grid.push(row) }
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n; j++) { if (j < n) E.push([grid[i][j], grid[i][j + 1]]); if (i < n) E.push([grid[i][j], grid[i + 1][j]]) }
  } else if (shape === 'Gaudí column') {
    // a few stacked counter-twisted fluted rings sketch the intersected column
    const pts = 8, nring = 6, nu = 16, half = 1.05, baseR = 0.72, depth = 0.26, tw = Math.PI / 2
    const mod = (x, m) => ((x % m) + m) % m
    const grid = []
    for (let i = 0; i < nring; i++) {
      const v = i / (nring - 1), y = -half + v * half * 2, tA = v * tw, tB = v * -tw, ring = []
      for (let j = 0; j < nu; j++) {
        const a = (2 * Math.PI * j) / nu
        const r = Math.min(baseR + Math.cos(mod(a - tA, Math.PI * 2) * pts) * depth, baseR + Math.cos(mod(a - tB, Math.PI * 2) * pts) * depth)
        ring.push(V.length); V.push([Math.cos(a) * r, y, Math.sin(a) * r])
      }
      grid.push(ring)
    }
    for (const ring of grid) ringEdges(ring)
    for (let i = 0; i < nring - 1; i++) for (let j = 0; j < nu; j++) E.push([grid[i][j], grid[i + 1][j]])
  } else {
    V.push([-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1])
    E.push([0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7])
  }
  const w = { V, E }
  geoWireCache.set(shape, w)
  return w
}
// Draw the rotating wireframe glyph into the Geometry node's 2D thumbnail. W/H
// are the compositor canvas size (passed in from the view).
export function drawGeoGlyph(ctx, ang, hue, warp, shape, sat, val, W, H) {
  const cx = W / 2, cy = H * 0.44, R = Math.min(W, H) * 0.26
  const { V, E } = geoWire(shape)
  const ca = Math.cos(ang), sa = Math.sin(ang), cb = Math.cos(ang * 0.6), sb = Math.sin(ang * 0.6)
  const proj = V.map(([x, y, z]) => {
    let X = x * ca - z * sa, Z = x * sa + z * ca
    let Y = y * cb - Z * sb; Z = y * sb + Z * cb
    const wob = 1 + warp * 0.3 * Math.sin(ang * 3 + x + y + z)
    const s = 2.6 / (Z + 3.2)
    return [cx + X * R * s * wob, cy + Y * R * s * wob]
  })
  ctx.strokeStyle = hsvCss(hue, sat, val)
  ctx.lineWidth = Math.max(1.2, Math.min(W, H) * 0.006)
  ctx.beginPath()
  for (const [a, b] of E) { ctx.moveTo(proj[a][0], proj[a][1]); ctx.lineTo(proj[b][0], proj[b][1]) }
  ctx.stroke()
}

// Bind the three.js object builders to a loaded THREE module. Everything that
// calls `new THREE.*` lives here; the Camera makes one kit once THREE loads.
export function createGeometryKit(THREE) {
  function buildGeometry(shape, detail, geo) {
    const d = Math.max(0, Math.min(4, Math.round(detail ?? 2)))
    switch (shape) {
      case 'Sphere': return new THREE.SphereGeometry(1, 24 + d * 12, 16 + d * 8)
      case 'Torus': return new THREE.TorusGeometry(0.85, 0.34, 16 + d * 6, 40 + d * 16)
      case 'Icosahedron': return new THREE.IcosahedronGeometry(1.15, d)
      case 'Torus knot': return new THREE.TorusKnotGeometry(0.75, 0.26, 90 + d * 40, 12 + d * 4)
      case 'Cone': return new THREE.ConeGeometry(1, 1.8, 24 + d * 12, 3 + d * 3)
      case 'Cylinder': return new THREE.CylinderGeometry(0.8, 0.8, 1.7, 24 + d * 12, 2 + d * 2)
      case 'Plane': return new THREE.PlaneGeometry(2.2, 2.2, 12 + d * 10, 12 + d * 10)
      case 'Gaudí column': return buildGaudiColumn(d, geo?.flutes, geo?.twist, geo?.groove)
      default: return new THREE.BoxGeometry(1.5, 1.5, 1.5, 4 + d * 6, 4 + d * 6, 4 + d * 6)
    }
  }
  // A Gaudí column: sweep two fluted star profiles up a shaft, twisting each the
  // opposite way, and keep their radial minimum (the intersection). Where the
  // counter-twists cross, the flutes fold into the branching forms Gaudí used
  // for the Sagrada Família. Centred on the origin and scaled to unit-ish size.
  function buildGaudiColumn(d, flutes, twist, groove) {
    const points = Math.max(3, Math.round(flutes ?? 8))
    const twRad = ((twist ?? 90) * Math.PI) / 180
    const depth = Math.max(0, groove ?? 0.28)
    const baseR = 0.72
    const half = 1.15 // column runs y = -half .. +half
    const radial = Math.max(32, points * (10 + d * 8))
    const rows = 40 + d * 40
    const mod = (n, m) => ((n % m) + m) % m
    const fluteR = (angle, tw) => baseR + Math.cos(mod(angle - tw, Math.PI * 2) * points) * depth
    const verts = [], uvs = []
    for (let yi = 0; yi <= rows; yi++) {
      const v = yi / rows
      const y = -half + v * (half * 2)
      const twA = v * twRad, twB = v * -twRad
      for (let ri = 0; ri <= radial; ri++) {
        const u = ri / radial
        const a = u * Math.PI * 2
        const r = Math.min(fluteR(a, twA), fluteR(a, twB)) // Gaudí intersection
        verts.push(Math.cos(a) * r, y, Math.sin(a) * r)
        uvs.push(u, v)
      }
    }
    const idx = [], stride = radial + 1
    for (let yi = 0; yi < rows; yi++) for (let ri = 0; ri < radial; ri++) {
      const aI = yi * stride + ri, bI = aI + 1, cI = (yi + 1) * stride + ri, dI = cI + 1
      idx.push(aI, bI, dI, aI, dI, cI)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3))
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
    g.setIndex(idx)
    g.computeVertexNormals()
    return g
  }
  function makeMaterial(material, hue, sat, val) {
    const c = hsvToHsl(hue ?? 160, sat, val)
    const col = new THREE.Color().setHSL(c.h, c.s, c.l)
    if (material === 'Wireframe') return new THREE.MeshBasicMaterial({ color: col, wireframe: true })
    if (material === 'Normals') return new THREE.MeshNormalMaterial({ flatShading: true })
    if (material === 'Points') return new THREE.PointsMaterial({ color: col, size: 0.045, sizeAttenuation: true })
    return new THREE.MeshStandardMaterial({ color: col, metalness: 0.25, roughness: 0.45 })
  }
  function buildObject(geo) {
    const g = buildGeometry(geo.shape, geo.detail, geo)
    if (!g.attributes.normal) g.computeVertexNormals()
    const base = Float32Array.from(g.attributes.position.array)
    const nrm = Float32Array.from(g.attributes.normal.array)
    const mat = makeMaterial(geo.material, geo.hue, geo.sat, geo.val)
    const obj = geo.material === 'Points' ? new THREE.Points(g, mat) : new THREE.Mesh(g, mat)
    obj.userData = { source: 'Shape', base, nrm, warped: false }
    return obj
  }
  // Generate a procedural point cloud: {positions, colors} in unit-ish space,
  // tinted from the node's hue by a per-point factor t (height/radius).
  function genPointCloud(type, count, hue, sat, val) {
    const n = Math.max(200, Math.min(140000, Math.round(count || 8000)))
    const pos = new Float32Array(n * 3), col = new Float32Array(n * 3)
    const base = hsvToHsl(hue ?? 200, sat, val), c = new THREE.Color()
    for (let i = 0; i < n; i++) {
      let x = 0, y = 0, z = 0, t = 0.5
      if (type === 'Sphere') {
        const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u), rr = 1.1 * (0.92 + Math.random() * 0.1)
        x = Math.cos(a) * r * rr; y = u * rr; z = Math.sin(a) * r * rr; t = (u + 1) / 2
      } else if (type === 'Torus') {
        const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI * 2, R = 0.85, rr = 0.35
        x = (R + rr * Math.cos(b)) * Math.cos(a); y = rr * Math.sin(b); z = (R + rr * Math.cos(b)) * Math.sin(a); t = (Math.sin(b) + 1) / 2
      } else if (type === 'Terrain') {
        x = (Math.random() * 2 - 1) * 1.4; z = (Math.random() * 2 - 1) * 1.4
        y = (Math.sin(x * 2.3) * Math.cos(z * 2.1) + Math.sin(x * 5 + z * 3) * 0.4) * 0.35; t = y + 0.5
      } else if (type === 'Cube') {
        x = Math.random() * 2 - 1; y = Math.random() * 2 - 1; z = Math.random() * 2 - 1; t = (y + 1) / 2
      } else { // Galaxy
        const arm = Math.floor(Math.random() * 3), rad = Math.pow(Math.random(), 0.6) * 1.4
        const ang = rad * 3.4 + arm * (Math.PI * 2 / 3) + (Math.random() - 0.5) * 0.5
        x = Math.cos(ang) * rad; z = Math.sin(ang) * rad; y = (Math.random() - 0.5) * 0.14 * (1.3 - rad); t = 1 - rad / 1.4
      }
      pos[i * 3] = x; pos[i * 3 + 1] = y; pos[i * 3 + 2] = z
      c.setHSL(base.h, base.s, Math.min(0.88, base.l * (0.45 + t * 0.9)))
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b
    }
    return { positions: pos, colors: col }
  }
  function buildPointsObject(geo) {
    const data = geo.cloudData || genPointCloud(geo.cloud, geo.count, geo.hue, geo.sat, geo.val)
    const g = new THREE.BufferGeometry()
    const positions = Float32Array.from(data.positions)
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
    if (data.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(Float32Array.from(data.colors), 3))
    const mat = new THREE.PointsMaterial({ size: geo.pointSize || 0.03, sizeAttenuation: true, vertexColors: !!data.colors })
    if (!data.colors) { const cc = hsvToHsl(geo.hue, geo.sat, geo.val); mat.color.setHSL(cc.h, cc.s, cc.l) }
    const obj = new THREE.Points(g, mat)
    // radial "normals" so the displace warp still works on a cloud
    const nrm = new Float32Array(positions.length)
    for (let i = 0; i < positions.length; i += 3) { const l = Math.hypot(positions[i], positions[i + 1], positions[i + 2]) || 1; nrm[i] = positions[i] / l; nrm[i + 1] = positions[i + 1] / l; nrm[i + 2] = positions[i + 2] / l }
    obj.userData = { source: 'Point cloud', base: positions, nrm, warped: false }
    return obj
  }
  // Voxel grid → one InstancedMesh of little cubes, coloured by height.
  function buildVoxelObject(geo) {
    const { cells, N } = genVoxels(geo.voxel, geo.res)
    const count = cells.length / 3
    const size = (2 / N) * 0.9
    const box = new THREE.BoxGeometry(size, size, size)
    const mat = new THREE.MeshStandardMaterial({ metalness: 0.2, roughness: 0.6 })
    const inst = new THREE.InstancedMesh(box, mat, Math.max(1, count))
    const m = new THREE.Matrix4(), c = new THREE.Color(), base = hsvToHsl(geo.hue, geo.sat, geo.val)
    for (let i = 0; i < count; i++) {
      const x = cells[i * 3], y = cells[i * 3 + 1], z = cells[i * 3 + 2]
      m.makeTranslation(x, y, z); inst.setMatrixAt(i, m)
      c.setHSL(base.h, base.s, Math.min(0.85, base.l * (0.5 + (y + 1) / 2 * 0.7))); inst.setColorAt(i, c)
    }
    inst.instanceMatrix.needsUpdate = true
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true
    inst.userData = { source: 'Voxel', warped: false }
    return inst
  }
  function buildTerrainObject(geo) {
    const T = geo.terrainData
    const N = T?.ready ? T.N : 24
    const g = new THREE.PlaneGeometry(2.6, 2.6, N - 1, N - 1)
    g.rotateX(-Math.PI / 2)
    const pos = g.attributes.position
    const vscale = geo.verticalScale ?? 0.6
    const base = hsvToHsl(geo.hue, geo.sat, geo.val), c = new THREE.Color()
    const col = new Float32Array(pos.count * 3)
    if (T?.ready) {
      const range = (T.maxH - T.minH) || 1
      for (let i = 0; i < pos.count; i++) {
        const nh = (T.heights[i] - T.minH) / range
        pos.setY(i, (nh - 0.4) * vscale * 1.4)
        if (T.colors) { col[i * 3] = T.colors[i * 3]; col[i * 3 + 1] = T.colors[i * 3 + 1]; col[i * 3 + 2] = T.colors[i * 3 + 2] }
        else { c.setHSL(base.h, base.s, 0.22 + nh * 0.62); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
      }
      pos.needsUpdate = true
    } else {
      for (let i = 0; i < pos.count; i++) { c.setHSL(base.h, base.s, 0.35); col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b }
    }
    g.computeVertexNormals()
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3))
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.05, roughness: 0.95 })
    const obj = new THREE.Mesh(g, mat)
    obj.userData = { source: 'Terrain', base: Float32Array.from(pos.array), nrm: Float32Array.from(g.attributes.normal.array), warped: false }
    return obj
  }
  function buildGeoObject(geo) {
    let obj
    if (geo.source === 'Point cloud') obj = buildPointsObject(geo)
    else if (geo.source === 'Voxel') obj = buildVoxelObject(geo)
    else if (geo.source === 'Terrain') obj = buildTerrainObject(geo)
    else obj = buildObject(geo)
    obj.userData.sig = geoSig(geo)
    return obj
  }
  return { buildGeometry, buildGaudiColumn, makeMaterial, buildObject, genPointCloud, buildPointsObject, buildVoxelObject, buildTerrainObject, buildGeoObject }
}
