// Minimal in-memory localStorage for the Node test environment so the Pinia
// stores (which read/write it at module load and in persist()) run cleanly.
// Node's own experimental localStorage global throws without a backing file, so
// we always install our own working stub over it.
const store = new Map()
const shim = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => { store.set(k, String(v)) },
  removeItem: (k) => { store.delete(k) },
  clear: () => { store.clear() },
}
Object.defineProperty(globalThis, 'localStorage', { value: shim, writable: true, configurable: true })
