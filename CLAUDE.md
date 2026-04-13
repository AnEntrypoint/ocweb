# CLAUDE.md

## Architecture

Browser app served from GH Pages. No server-side rendering. `bridge-sw.js` service worker sets COOP/COEP headers on all responses to enable `crossOriginIsolated` (required for SharedArrayBuffer/Atomics).

## WASM Caching Strategy

- `bridge-sw.js` intercepts all same-origin `.wasm` requests and caches them in Cache Storage API (`wasm-chunks` cache)
- Cache-first serving: SW returns cached response on hit; on miss, fetches, stores, and returns
- Version key stored under `cache-version` key: concatenation of `nodejs.chunks` + `|` + `layers.json` contents; on SW activate, fetches both manifests, deletes all cache entries if version changed
- `withCoi()` applied to all responses (cached and network) to set COOP/COEP/CORP headers
- Worker WASM fetches happen inside Web Workers — not interceptable via `page.on('request')`; verify via `page.evaluate(() => caches.open('wasm-chunks').then(c => c.keys()))`
- Validated: 64/64 WASM requests served from SW cache (0 network hits) on second page load; opencode layer chunks cached correctly
- GH Pages throttles concurrent large requests: fetching 32×50MB chunks via `Promise.all` triggers `TypeError: Failed to fetch` around chunk 19. Fix: batch fetches to 4 concurrent per batch (sequential batches). Max 4 concurrent = 200MB peak, avoids GH Pages throttling. Commit f66fde2b3c.

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
- CI push pattern (both build-wasm and build-layers write-manifest): `git fetch origin master` then `git reset --soft origin/master` then `git restore --staged .` then `git add <files>` then `git commit` then `git push origin HEAD:master`; the `restore --staged` is critical — without it, workflow files from other commits get staged and GitHub rejects the bot push with "refusing to allow a GitHub App to create or update workflow"

## Partial Clone + Local Commit Limitation

Local git commit fails when text file changes are made AFTER CI pushes WASM blobs. Root cause: repo uses `partialclonefilter=blob:none` (large WASM files ~1.5 GB not stored locally); when git writes a new tree object, it must traverse all parent blob SHAs, but remote-only blobs cause "fatal: could not fetch <blob-sha> from promisor remote" even with `GIT_NO_LAZY_FETCH=1`.

**Workaround: GitHub API direct commit**
1. `GET /repos/AnEntrypoint/opencrabs/git/ref/heads/master` → `headSha`
2. `GET /repos/AnEntrypoint/opencrabs/git/commits/<headSha>` → `treeSha`
3. `POST /git/blobs` with file content → `blobSha`
4. `POST /git/trees` with `base_tree: treeSha` + new blob entry → `newTreeSha`
5. `POST /git/commits` with message, tree, parents → `newCommitSha`
6. `PATCH /git/refs/heads/master` with `newCommitSha` → push to master
7. Locally: `git fetch origin master` + `git reset --soft origin/master` to sync

API creates commits without needing local blob objects. Auth: `gh auth token` for Bearer token. Use only for text files after WASM CI pushes; prefer local git for code-only changes.

## Non-obvious Caveats

- `wc-stack-worker.js` uses `importScripts` (not ES modules) — must be plain global JS, no `import`/`export`
- `serveIfInitMsg` in the stack worker must gate `onmessage = null` — fires on every message otherwise
- xterm-pty `loadAddon(master)` uses duck-typing, not instanceof — compatible with `@xterm/xterm` scoped package
- `window.newStack` second argument is `IMAGE_PREFIX` (string path prefix), third is chunk count (integer) — not a full URL array
- Blob workers have no base URL — `IMAGE_PREFIX` must be resolved to absolute URL (`new URL(IMAGE_PREFIX, location.href).href`) before passing to `makeWorkerBlob`
- VM boots to `/bin/sh` (busybox) via `-entrypoint /bin/sh -- -i`; the `--` separator overrides the container's baked-in CMD (`node`); `-i` makes sh interactive; `makeWorkerBlob` 5th param `cmd` (default `['-i']`) replaces what follows `--` — pass `['sh','-c','exec myapp']` to launch a specific process; `cmd` is `JSON.stringify`'d into the blob template string at call time, not at worker eval time
- `wasiHack` (TTY fd_read/fd_write/poll_oneoff patches) is defined inline in the `makeWorkerBlob` blob source in `wc-workers.js` — it is NOT in the shared CDN scripts
- Worker blob source lives in `wc-workers.js` (exported); `wc.js` handles boot orchestration only
- `appMachine` context field is `showSystems` (not `showShell`); `SHOW_SHELL` event is a kept alias that sets `showSystems` — reading `ctx.showShell` will be `undefined`, always read `ctx.showSystems`
- `appMachine` context `systems[]` shape: `{id, name, mode:'ephemeral'|'persistent'|'resumable', status, layers:[], terminals:[{id,label,cmd,wcId}], selectedTerminalId}`; `createAgentConfig` gains `systemMode` (default `'ephemeral'`)
- `components/systems-panel.js` exports `mount(el, actor)` — replaces `shell-panel.js`; left sidebar = systems list, right = terminal tabs + xterm; each terminal gets its own independent WASM worker (keyed by `wcId` in terminal record)
- `components/term-view.js` exports `mount(el, sys)` — mounts a single xterm Terminal with CanvasAddon + FitAddon into `el`, connects via `sys.spawnShell()`; returns `{dispose()}`
- `sys._onProgress` callback: set by callers (e.g. term-view.js) before boot completes; wc.js forwards `{type:'wasm-progress',loaded,total}` (per-chunk WASM fetch via `_pi` counter in worker `Promise.all`), `{type:'opfs-init',path,loaded,total}`, and `{type:'desktop-init',path,loaded,total}`; callers clear it after boot; term-view.js renders cyan `Loading WASM N/M` for wasm-progress, yellow `<path>: N/M` for opfs/desktop-init, then clears the line when shell is ready; no progress posted on cache hit — handler must tolerate zero calls
- Terminal `wcId` field: each terminal spawns its own `createSystem(wcId, { mode, layers })` worker (layers from parent system record) so multiple terminals = multiple independent workers with the correct layer WASM loaded; `_termSystems` Map in systems-panel tracks wcId→system; `window.__debug.systems` exposes it
- Ephemeral mode: when last terminal of a system is closed, all wcId workers for that system are destroyed
- `createSystem(id, {layers:['opencode','claude']})` passes layer ids; `layers.json` is source of truth for each layer's `mountPath` and `tools`; layers are OPFS mount descriptors, not WASM chunk lists
- `makeWorkerBlob(chunks, env, scripts, imagePrefix, cmd, extraUrls=[], mounts=[])` — 6th param extraUrls appended to chunk URL array; 7th param mounts=[] is array of `{vmPath, opfsPath}` (OPFS) or `{vmPath, type:'desktop'}` (desktop) mount descriptors baked into blob
- `wc-workers-desktop.js` exports `desktopBlobSrc(mounts)` — returns blob template string for desktop FS support (desktopWalk, DesktopOpenFile, DesktopPreopenDir, _desktopHandles, _desktopFiles); imported by wc-workers.js and inlined into blob source before the OPFS code
- Desktop mount flow: `opts.mounts` entries with `desktopHandle:FileSystemDirectoryHandle` are stripped to `{vmPath,type:'desktop'}` for the blob (not JSON-serializable); handles posted via `worker.postMessage({type:'desktop-handles',handles:[{vmPath,handle}]})` immediately after `new Worker()`; worker IIFE awaits this message before setting `onmessage`; write-back via `{type:'desktop-write',dh,name,data:[]}` flushed in wc.js via `dh.getFileHandle(name,{create:true}).then(fh=>fh.createWritable())`
- `_desktopHandles` Map in `systems-panel.js` (sysId→mounts[]) persists FileSystemDirectoryHandle across terminal spawns; `window.__debug.systems.desktopHandles` exposes it; showDirectoryPicker UI rendered only when `window.showDirectoryPicker` exists (Chrome/Edge); AbortError on cancel swallowed, other errors re-thrown
- Worker pre-init rendezvous always fires: even with zero desktop mounts wc.js posts `{type:'desktop-handles',handles:[]}` so worker never deadlocks waiting for the message
- `containers/layers.json` format: `{id, label, mountPath, tools:[{name, url, installCmd}]}` — mount descriptors for OPFS-backed tool storage; no chunk counts; source of truth for layer config
- Shell heredocs (`<<EOF`) inside YAML `run:` blocks break GitHub Actions YAML parsing — the unquoted content lines become bare YAML tokens; use `printf 'line1\nline2\n' > file` instead of heredocs in any `run:` step
- xterm CPR escape code pollution: xterm sends ESC[6n (cursor position request) during initialization; the response (ESC[row;colR) flows PTY master→ldisc→slave→WASM stdin before the shell is ready, causing `^[[1;5R` to appear as visible text in the terminal. Fix: in `wc.js` `spawnShell()`, call `onData({xtermAddon:master})` FIRST to load the PTY addon and flush xterm's init sequences, await 50ms, then call `new window.TtyServer(slave).start(worker, nwStack)`
- xterm canvas text validation: pixel counting on `.xterm-text-layer` canvas (via `getImageData`) works ONLY when CanvasAddon is NOT active; when CanvasAddon is active, text renders via WebGL offscreen and 2D canvas remains empty. Count pixels with r/g/b > 60 to detect rendered output. Do NOT use `page.screenshot()` for terminal validation — WebGL compositing is not captured by CDP. Tab switches destroy terminal state: `systems-panel.js` `mountTerminal()` calls `el.innerHTML = ''` recreating xterm, so historical output is lost; WASM worker continues running but new xterm starts blank. Validate on ONE tab only.
- Worker `recv-is-readable` message type: high-frequency signals (300/s) from xterm-pty TtyServer to WASM worker indicating stdin availability. Data flows via SharedArrayBuffer/Atomics, NOT postMessage. Worker silence (no postMessage output) is NORMAL for TTY workers; do not interpret lack of messages as a hung worker.
- `.github/workflows/build-layers.yml` — matrix workflow building layer WASMs (opencode, claude, kilo, codex); each job: checkout → install c2w v0.8.4 → write Dockerfile (node:23-alpine + bun + layer npm package) → docker build → c2w build → split at 50MB → commit layer-{id}*.wasm + layer-{id}.chunks; uses same 3-step CI push pattern as build-wasm.yml; each job has `continue-on-error: true` and skips if actor is github-actions[bot]
- AI coding tool npm packages (opencode-ai, @kilocode/cli, @anthropic-ai/claude-code, @openai/codex) ship prebuilt platform binaries as optional dependencies with bun-optional postinstall scripts (e.g., `"bun ./postinstall.mjs || node ./postinstall.mjs"`); this means `npm install -g <pkg>` works WITHOUT bun on Alpine. Remove bun from build-layers.yml Dockerfile to save ~300 MB per WASM image (opencode: 1.511 GB → ~855 MB). This is critical for staying under Chrome's 1 GB WebAssembly module size hard limit (1,073,741,824 bytes). Chrome enforces this limit on both `WebAssembly.instantiate()` and `WebAssembly.compileStreaming()` — modules exceeding it fail with `"size > maximum module size (1073741824)"` regardless of API used.
- opencode WASM memory sizing: c2w default linear memory is 200MB; opencode musl binary is ~155MB → OOM on boot. Fix: add `--build-arg=WASM_MEM_SIZE=536870912` (512MB) to c2w invocation in build-layers.yml opencode job only. This allocates memory at runtime, not in the binary. Other layers have smaller binaries and don't need this flag.
- opencode binary selection on Alpine: npm install -g opencode-ai creates wrapper at `/usr/local/bin/opencode` that caches binary path in `.opencode`. It finds glibc binary (167MB) instead of musl binary (162MB) and fails with "/bin/sh: not found" (missing /lib64/ld-linux-x86-64.so.2). Fix: after npm install in Dockerfile, run `cp /usr/local/lib/node_modules/opencode-ai/node_modules/opencode-linux-x64-musl/bin/opencode /usr/local/lib/node_modules/opencode-ai/bin/.opencode` to replace glibc with musl binary. This ensures the wrapper selects the correct binary at runtime.
- opencode TUI behavior in WASM terminal: opencode is a full TUI app — `opencode --version` does NOT print a version string and exit like traditional CLI tools; instead it initializes a terminal TUI (alternate screen buffer), waits for network/config, and runs until explicitly exited. `timeout N opencode` returns Terminated after N seconds. Validation: use `which opencode` (returns /root/.local/bin/opencode) and `od -c /root/.local/bin/opencode | head -1` (shows ELF magic `177 E L F`) to confirm binary is present and is a valid ELF executable. Validated: binary executes in browser WASM Alpine terminal via OPFS install (wc-layer-install.js), GCC 15 libs baked into WASM base image, 5 OPFS execute permission patches applied.
