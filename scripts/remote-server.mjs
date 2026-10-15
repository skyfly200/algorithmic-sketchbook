/**
 * Phone / OSC remote relay on its own (`npm run build && npm run remote`); the
 * code lives in bridge/remote.mjs. `npm run bridge` runs it together with the
 * Art-Net bridge, and `npm run bridge:package` builds the installable bundle.
 */
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startRemote } from '../bridge/remote.mjs'

const root = fileURLToPath(new URL('../dist', import.meta.url))
if (!existsSync(`${root}/index.html`)) {
  console.error('\n  dist/ not found — run `npm run build` first, then `npm run remote`.\n')
  process.exit(1)
}
startRemote({
  root,
  httpPort: Number(process.env.REMOTE_PORT) || undefined,
  oscPort: Number(process.env.OSC_PORT) || undefined,
}).catch((e) => {
  console.error(`\n  ${e.message}\n`)
  process.exit(1)
})
