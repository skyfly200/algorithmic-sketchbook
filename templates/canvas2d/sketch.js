const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

function resize() {
  canvas.width = window.innerWidth * devicePixelRatio
  canvas.height = window.innerHeight * devicePixelRatio
}

function frame(now) {
  const t = now * 0.001

  ctx.fillStyle = '#05060a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  // Your sketch here — a pulsing circle to start with.
  const r = (Math.sin(t * 2) * 0.25 + 0.75) * Math.min(canvas.width, canvas.height) * 0.2
  ctx.beginPath()
  ctx.arc(canvas.width / 2, canvas.height / 2, r, 0, Math.PI * 2)
  ctx.strokeStyle = 'hsl(230, 80%, 70%)'
  ctx.lineWidth = 3 * devicePixelRatio
  ctx.stroke()

  requestAnimationFrame(frame)
}

window.addEventListener('resize', resize)
resize()
requestAnimationFrame(frame)
