# CLAUDE.md

## Architecture

Browser app served from GH Pages. No server-side rendering. `bridge-sw.js` service worker sets COOP/COEP headers on all responses to enable `crossOriginIsolated` (required for SharedArrayBuffer/Atomics).

## Linux VM (container2wasm WASI mode)

- WASM chunks served from `/containers/nodejs*.wasm`, count from `/containers/nodejs.chunks`
- `wc.js` fetches chunk count at boot, builds worker blob dynamically with correct chunk URLs
- Stack worker (networking proxy) lives in `wc-stack-worker.js` — served as static file, fetched as text at boot, blobbed into a Worker
- Two workers: main TTY worker (runs the container WASM) + stack worker (runs `c2w-net-proxy.wasm` for HTTP proxy)
- Networking via virtual IP `192.168.127.253:80`, env vars `http_proxy`/`https_proxy`/`SSL_CERT_FILE` injected at boot
- `window.newStack`, `window.openpty`, `window.TtyServer` come from CDN UMD scripts loaded via `<script>` tags in `boot()`
- `crossOriginIsolated` is false on first visit — service worker installs, reloads page, then it's true

## Build Workflow

- `.github/workflows/build-wasm.yml` — manual trigger (`workflow_dispatch`)
- Installs c2w v0.8.4 linux-amd64, runs `c2w --net=browser node:23-alpine`, splits at 50MB, names chunks `nodejs00.wasm` etc.
- Writes chunk count integer to `containers/nodejs.chunks`
- Commits and pushes `containers/` to master (requires `contents: write` permission)
- Must be triggered manually after this workflow is pushed — chunks do not exist until the workflow runs

## Non-obvious Caveats

- `wc-stack-worker.js` uses `importScripts` (not ES modules) — must be plain global JS, no `import`/`export`
- `serveIfInitMsg` in the stack worker must gate `onmessage = null` — fires on every message otherwise
- xterm-pty `loadAddon(master)` uses duck-typing, not instanceof — compatible with `@xterm/xterm` scoped package
- `window.newStack` second argument is `IMAGE_PREFIX` (string path prefix), third is chunk count (integer) — not a full URL array
