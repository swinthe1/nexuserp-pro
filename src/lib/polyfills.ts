// On a local server opened by its plain address (http://192.168.x.x) the browser hides crypto.randomUUID;
// the ids for sales, tables and offline work are made from crypto.getRandomValues instead.
if (typeof crypto !== 'undefined' && typeof crypto.randomUUID !== 'function' && typeof crypto.getRandomValues === 'function') {
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    value: () => {
      const b = crypto.getRandomValues(new Uint8Array(16))
      b[6] = (b[6]! & 0x0f) | 0x40; b[8] = (b[8]! & 0x3f) | 0x80
      const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
      return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}` as `${string}-${string}-${string}-${string}-${string}`
    },
  })
}
export {}
