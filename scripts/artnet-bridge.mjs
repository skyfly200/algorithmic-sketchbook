/**
 * Art-Net → browser bridge on its own (`npm run artnet-bridge`); the code lives
 * in bridge/artnet.mjs. `npm run bridge` runs it together with the phone/OSC
 * relay, and `npm run bridge:package` builds the installable bundle.
 */
import { startArtnet } from '../bridge/artnet.mjs'

startArtnet()
