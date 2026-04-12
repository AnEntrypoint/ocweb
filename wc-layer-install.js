async function extractBinaryFromTgz(url, binaryName) {
  const r = await fetch(url)
  if (!r.ok) throw new Error('fetch failed: ' + url + ' ' + r.status)
  const ds = new DecompressionStream('gzip')
  const reader = r.body.pipeThrough(ds).getReader()
  let pending = new Uint8Array(0)
  function concat(a, b) { const c = new Uint8Array(a.length + b.length); c.set(a); c.set(b, a.length); return c }
  while (true) {
    const { done, value } = await reader.read()
    if (value) pending = concat(pending, value)
    let off = 0
    while (pending.length - off >= 512) {
      const hdr = pending.slice(off, off + 512)
      const name = new TextDecoder().decode(hdr.slice(0, 100)).replace(/\0/g, '').trim()
      if (!name) { off += 512; continue }
      const szOct = new TextDecoder().decode(hdr.slice(124, 136)).replace(/\0/g, '').trim()
      const sz = parseInt(szOct, 8) || 0
      const blocks = Math.ceil(sz / 512) * 512
      if (pending.length - off < 512 + blocks) break
      const baseName = name.split('/').pop()
      if (baseName === binaryName && sz > 0) return pending.slice(off + 512, off + 512 + sz)
      off += 512 + blocks
    }
    if (off > 0) pending = pending.slice(off)
    if (done) break
  }
  throw new Error('binary not found in tgz: ' + binaryName)
}

function idbLayerDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('opencrabs-layers', 1)
    req.onupgradeneeded = e => { e.target.result.createObjectStore('layer-binaries') }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function idbPut(key, value) {
  return idbLayerDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('layer-binaries', 'readwrite')
    tx.objectStore('layer-binaries').put(value, key)
    tx.oncomplete = () => { db.close(); resolve() }
    tx.onerror = () => { db.close(); reject(tx.error) }
  }))
}

function idbGet(key) {
  return idbLayerDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction('layer-binaries', 'readonly')
    const r2 = tx.objectStore('layer-binaries').get(key)
    r2.onsuccess = () => { db.close(); resolve(r2.result) }
    r2.onerror = () => { db.close(); reject(r2.error) }
  }))
}

export async function installLayerBinaries(layerIds) {
  if (!layerIds || !layerIds.length) return { mounts: [], idbMounts: [], extraPaths: [] }
  const r = await fetch('./containers/layers.json')
  if (!r.ok) throw new Error('layers.json fetch failed: ' + r.status)
  const all = await r.json()
  const mounts = [], idbMounts = [], extraPaths = []
  for (const id of layerIds) {
    const layer = all.find(l => l.id === id)
    if (!layer || !layer.binaryUrl || !layer.binaryName) continue
    const idbKey = 'layer:' + id + ':' + layer.binaryName
    let existing = await idbGet(idbKey)
    if (!existing) {
      const bytes = await extractBinaryFromTgz(layer.binaryUrl, layer.binaryName)
      await idbPut(idbKey, bytes.buffer)
      existing = bytes.buffer
    }
    const vmPath = '/opt/' + id
    extraPaths.push(vmPath)
    idbMounts.push({ vmPath, idbKey, binaryName: layer.binaryName })
  }
  return { mounts, idbMounts, extraPaths }
}
