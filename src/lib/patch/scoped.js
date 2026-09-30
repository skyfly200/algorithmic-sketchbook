// A stable array-shaped handle whose contents are whichever array `getArr()`
// currently returns. Patch has two decks (graphs); the ~300 places in the view
// that read `nodes` / `edges` / `links` keep working unchanged because those
// names are scoped arrays pointing at the deck "in scope" — the edited deck by
// default, or the deck the compositor is evaluating while it runs a pass.
//
// Reads and writes forward to the underlying (Vue-reactive) array, so templates,
// watchers and computeds that touch it still track the real data. `track()` is
// called on every read so a consumer also re-runs when the *scope* changes (the
// editor switching decks) — give it a read of the ref that holds the edit index.
export function scopedArray(getArr, track) {
  const fwd = (k) => { track?.(); const a = getArr(); const v = a[k]; return typeof v === 'function' ? v.bind(a) : v }
  return new Proxy([], { // the [] target makes Array.isArray() true for the handle
    get: (_, k) => fwd(k),
    set(_, k, v) { getArr()[k] = v; return true },
    has: (_, k) => k in getArr(),
    deleteProperty: (_, k) => delete getArr()[k],
    ownKeys: () => Reflect.ownKeys(getArr()),
    getOwnPropertyDescriptor(_, k) {
      const d = Reflect.getOwnPropertyDescriptor(getArr(), k)
      if (d && k !== 'length') d.configurable = true // proxy invariant: absent on target ⇒ must be configurable
      return d
    },
  })
}
