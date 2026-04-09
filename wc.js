const DEMO_BASE = 'https://ktock.github.io/container2wasm-demo'
const XTERM_PTY_CDN = 'https://cdn.jsdelivr.net/npm/xterm-pty@0.9.4'
const IMAGE_PREFIX = './containers/nodejs'
const CHUNKS_URL = './containers/nodejs.chunks'
const STACK_WORKER_URL = './wc-stack-worker.js'

const SHELL_ENV = [
  'HOME=/root', 'TERM=xterm-256color', 'USER=root', 'SHELL=/bin/sh',
  'LANG=en_US.UTF-8', 'LC_ALL=C',
  'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
  'https_proxy=http://192.168.127.253:80',
  'http_proxy=http://192.168.127.253:80',
  'HTTPS_PROXY=http://192.168.127.253:80',
  'HTTP_PROXY=http://192.168.127.253:80',
  'SSL_CERT_FILE=/.wasmenv/proxy.crt',
]

let _status = 'unavailable'
let _worker = null
let _stackWorker = null
let _nwStack = null
const cbs = new Set()

function setStatus(s) { _status = s; cbs.forEach(fn => fn(s)) }

export function wcStatus() { return _status }
export function onWcStatus(fn) { cbs.add(fn); fn(_status); return () => cbs.delete(fn) }
export function wcReady() { return _status === 'ready' }

async function fetchChunkCount() {
  const r = await fetch(CHUNKS_URL)
  if (!r.ok) throw new Error('chunks file fetch failed: ' + r.status)
  return parseInt((await r.text()).trim(), 10)
}

function makeWorkerBlob(chunks, env) {
  const chunkUrls = Array.from({ length: chunks }, (_, i) =>
    IMAGE_PREFIX + String(i).padStart(2, '0') + '.wasm'
  )
  const src = `
importScripts(${JSON.stringify(XTERM_PTY_CDN + '/workerTools.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/browser_wasi_shim/index.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/browser_wasi_shim/wasi_defs.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/worker-util.js')});
importScripts(${JSON.stringify(DEMO_BASE + '/src/wasi-util.js')});
onmessage = (msg) => {
  if (serveIfInitMsg(msg)) return;
  var ttyClient = new TtyClient(msg.data);
  recvCert().then((cert) => {
    var certDir = getCertDir(cert);
    var fds = [undefined, undefined, undefined, certDir, undefined, undefined];
    var args = ['arg0', '--net=socket=listenfd=4', '--mac', genmac()];
    var env = ${JSON.stringify(env)};
    var urls = ${JSON.stringify(chunkUrls)};
    Promise.all(urls.map(u => fetch(u).then(r => { if(!r.ok) throw new Error(u+' '+r.status); return r.arrayBuffer(); })))
      .then(bufs => {
        var total = bufs.reduce((n,b) => n+b.byteLength, 0);
        var merged = new Uint8Array(total); var off = 0;
        for (var b of bufs) { merged.set(new Uint8Array(b), off); off += b.byteLength; }
        var wasi = new WASI(args, env, fds);
        wasiHack(wasi, ttyClient, 5);
        wasiHackSocket(wasi, 4, 5);
        WebAssembly.instantiate(merged, { 'wasi_snapshot_preview1': wasi.wasiImport })
          .then((inst) => wasi.start(inst.instance));
      });
  });
};
function genmac() {
  return '02:XX:XX:XX:XX:XX'.replace(/X/g, () =>
    '0123456789ABCDEF'.charAt(Math.floor(Math.random() * 16)));
}
`
  return URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))
}

async function loadScript(url) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${url}"]`)) { resolve(); return }
    const s = document.createElement('script')
    s.src = url; s.onload = resolve; s.onerror = reject
    document.head.appendChild(s)
  })
}

export async function boot() {
  if (!globalThis.crossOriginIsolated) { setStatus('unavailable'); return }
  if (_worker) return
  setStatus('booting')
  try {
    const [chunks, stackSrc] = await Promise.all([
      fetchChunkCount(),
      fetch(STACK_WORKER_URL).then(r => { if (!r.ok) throw new Error('stack worker fetch: ' + r.status); return r.text() }),
    ])
    await loadScript(XTERM_PTY_CDN + '/index.js')
    await loadScript(DEMO_BASE + '/src/stack.js')
    _worker = new Worker(makeWorkerBlob(chunks, SHELL_ENV))
    _stackWorker = new Worker(URL.createObjectURL(new Blob([stackSrc], { type: 'application/javascript' })))
    _nwStack = window.newStack(_worker, IMAGE_PREFIX, chunks, _stackWorker, DEMO_BASE + '/src/c2w-net-proxy.wasm')
    setStatus('ready')
  } catch(e) {
    console.error('boot failed:', e)
    setStatus('unavailable')
  }
}

export async function spawnShell(onData) {
  if (!_worker || _status !== 'ready') return null
  const { master, slave } = window.openpty()
  new window.TtyServer(slave).start(_worker, _nwStack)
  onData({ xtermAddon: master })
  return { input: new WritableStream({ write() {} }), exit: new Promise(() => {}), resize: () => {}, master }
}

export async function runCli(agent, prompt, onLine) {
  onLine({ type: 'info', text: 'Use the Terminal tab to interact with the container.' })
}

export async function wcExec() { return null }
export async function wcFsRead() { return null }
export async function wcFsWrite() { return null }
export async function wcFsList() { return null }
export async function wcGit() { return null }

window.__debug = window.__debug || {}
window.__debug.wc = { get status() { return _status }, get worker() { return _worker } }
