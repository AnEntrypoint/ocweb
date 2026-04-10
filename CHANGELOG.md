## [unreleased] - 2026-04-10
- refactor: makeWorkerBlob accepts 5th param cmd (default ['-i']); cmd replaces args after '--' separator in blob source
- refactor: wc.js singleton replaced with multi-system factory; createSystem(id,opts), getSystem(id), bootAssets() exported; backward-compat boot/spawnShell/wcStatus/onWcStatus delegate to default system

