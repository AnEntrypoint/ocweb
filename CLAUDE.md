# CLAUDE.md

## Architecture

Browser app served from GH Pages. No server-side rendering. `bridge-sw.js` service worker sets COOP/COEP headers on all responses to enable `crossOriginIsolated` (required for SharedArrayBuffer/Atomics).

## Linux VM (container2wasm WASI mode)

- WASM chunks served from `/containers/nodejs*.wasm`, count from `/containers/nodejs.chunks`
- `wc.js` exports `createSystem(id, opts)` returning `{id, status, boot(), spawnShell(), destroy(), onStatus()}`; `getSystem(id)` retrieves from registry or returns null; `bootAssets()` caches CDN fetches once across all systems
- Each system owns its own `worker`, `stackWorker`, `nwStack`, `status`, and `cbs` Set — two `createSystem` calls produce two independent WASM workers
- `_registry` (Map) keyed by id; `createSystem` re-uses existing entry if id already present (resumable pattern)
- `opts.mode`: `'ephemeral'|'persistent'|'resumable'` — stored on the system object for lifecycle management by callers
- Backward-compat `boot()`, `spawnShell()`, `wcStatus()`, `onWcStatus()` delegate to the `'default'` system created at module init
- Stack worker (networking proxy) lives in `wc-stack-worker.js` — served as static file, fetched as text at boot, blobbed into a Worker
- Two workers per system: main TTY worker (runs the container WASM) + stack worker (runs `c2w-net-proxy.wasm` for HTTP proxy)
- Networking via virtual IP `192.168.127.253:80`, env vars `http_proxy`/`https_proxy`/`SSL_CERT_FILE` injected at boot
- `window.newStack`, `window.openpty`, `window.TtyServer` come from CDN UMD scripts loaded once via `bootAssets()`
- `crossOriginIsolated` is false on first visit — service worker installs, reloads page, then it's true

## Build Workflow

- `.github/workflows/build-wasm.yml` — triggers on every push to master (skips if actor is github-actions bot to avoid loops)
- Installs c2w v0.8.4 linux-amd64, runs `c2w --net=browser node:23-alpine`, splits at 50MB, names chunks `nodejs00.wasm` etc.
- Writes chunk count integer to `containers/nodejs.chunks`
- Commits and pushes `containers/` to master (requires `contents: write` permission)

## Non-obvious Caveats

- `wc-stack-worker.js` uses `importScripts` (not ES modules) — must be plain global JS, no `import`/`export`
- `serveIfInitMsg` in the stack worker must gate `onmessage = null` — fires on every message otherwise
- xterm-pty `loadAddon(master)` uses duck-typing, not instanceof — compatible with `@xterm/xterm` scoped package
- `window.newStack` second argument is `IMAGE_PREFIX` (string path prefix), third is chunk count (integer) — not a full URL array
- Blob workers have no base URL — `IMAGE_PREFIX` must be resolved to absolute URL (`new URL(IMAGE_PREFIX, location.href).href`) before passing to `makeWorkerBlob`
- VM boots to `/bin/sh` (busybox) via `-entrypoint /bin/sh -- -i`; the `--` separator overrides the container's baked-in CMD (`node`); `-i` makes sh interactive; `makeWorkerBlob` 5th param `cmd` (default `['-i']`) replaces what follows `--` — pass `['sh','-c','exec myapp']` to launch a specific process; `cmd` is `JSON.stringify`'d into the blob template string at call time, not at worker eval time
- `wasiHack` (TTY fd_read/fd_write/poll_oneoff patches) is defined inline in the `makeWorkerBlob` blob source in `wc-workers.js` — it is NOT in the shared CDN scripts
- Worker blob source lives in `wc-workers.js` (exported); `wc.js` handles boot orchestration only
- Companion WebSocket (`getCompanion()`) connects on-demand from `runCli()` only — never eagerly at mount; no auto-reconnect loop
- `appMachine` context field is `showSystems` (not `showShell`); `SHOW_SHELL` event is a kept alias that sets `showSystems` — reading `ctx.showShell` will be `undefined`, always read `ctx.showSystems`
- `appMachine` context `systems[]` shape: `{id, name, mode:'ephemeral'|'persistent'|'resumable', status, layers:[], terminals:[{id,label,cmd}], selectedTerminalId}`; `createAgentConfig` gains `systemMode` (default `'ephemeral'`)
