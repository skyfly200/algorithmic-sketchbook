// Runs the detail-upscale fragment shader on a test picture that was drawn small and enlarged 3x
// with bilinear filtering, and writes before / after side by side.
import { chromium } from 'playwright'
import fs from 'node:fs'
fs.mkdirSync('scripts/scratch/out', { recursive: true })
const js = fs.readFileSync('sketches/detail-upscale/sketch.js', 'utf8')
const FRAG = js.split('const FRAG = `')[1].split('`\n\nconst canvas')[0]
const scale = +(process.argv[2] || 3)
const browser = await chromium.launch({ channel: 'msedge', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
const page = await (await browser.newContext()).newPage()
page.on('pageerror', (e) => console.log('PAGEERR', e.message))
await page.goto('about:blank')
const url = await page.evaluate(([FRAG, scale]) => {
  const W = 480, H = 270
  const small = document.createElement('canvas'); small.width = W / scale; small.height = H / scale
  const s = small.getContext('2d'); s.fillStyle = '#20242e'; s.fillRect(0, 0, small.width, small.height)
  s.fillStyle = '#fff'; s.font = `bold ${44 / scale}px sans-serif`; s.fillText('Detail', 20 / scale, 80 / scale)
  s.strokeStyle = '#f90'; s.lineWidth = 1; s.beginPath(); s.moveTo(10 / scale, 130 / scale); s.lineTo(W / scale - 10 / scale, 190 / scale); s.stroke()
  s.fillStyle = '#39f'; s.fillRect(W * 0.6 / scale, 40 / scale, 80 / scale, 60 / scale)
  const big = document.createElement('canvas'); big.width = W; big.height = H
  const b = big.getContext('2d'); b.imageSmoothingEnabled = true; b.imageSmoothingQuality = 'high'; b.drawImage(small, 0, 0, W, H)
  const c = document.createElement('canvas'); c.width = W; c.height = H
  const gl = c.getContext('webgl2', { preserveDrawingBuffer: true })
  const sh = (t, src) => { const o = gl.createShader(t); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o }
  const p = gl.createProgram()
  gl.attachShader(p, sh(gl.VERTEX_SHADER, `#version 300 es\nin vec2 position;out vec2 v_uv;void main(){v_uv=position*0.5+0.5;gl_Position=vec4(position,0.0,1.0);}`))
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(p); gl.useProgram(p)
  const vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, big)
  gl.uniform1i(gl.getUniformLocation(p, 'u_tex'), 0); gl.uniform2f(gl.getUniformLocation(p, 'u_res'), W, H)
  gl.uniform1f(gl.getUniformLocation(p, 'u_r'), scale); gl.uniform1f(gl.getUniformLocation(p, 'u_push'), 0.7)
  gl.uniform1f(gl.getUniformLocation(p, 'u_sharp'), 0.6); gl.uniform1f(gl.getUniformLocation(p, 'u_gate'), 0.04)
  gl.drawArrays(gl.TRIANGLES, 0, 3)
  const m = document.createElement('canvas'); m.width = W * 2 + 8; m.height = H
  const x = m.getContext('2d'); x.fillStyle = '#000'; x.fillRect(0, 0, m.width, H); x.drawImage(big, 0, 0); x.drawImage(c, W + 8, 0)
  return m.toDataURL('image/png')
}, [FRAG, scale])
fs.writeFileSync('scripts/scratch/out/upscale-shader.png', Buffer.from(url.split(',')[1], 'base64'))
console.log('ok')
await browser.close()
