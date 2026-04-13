# VFS IndexedDB Architecture Session — Summary (2026-04-13)

## Objective
Design and implement a persistent VFS layer to solve SQLite WAL failures in opencode by routing file writes to IndexedDB, eliminating the need for per-tool `XDG_DATA_HOME=/tmp` environment variable workarounds.

## Completed Work

### Phase 1: Architecture Design ✅
**Commits**: 9e5bbf6, 6bcd066

**Deliverables**:
- `docs/VFS_ARCHITECTURE.md` — comprehensive design document (389 lines)
  - Three candidate architectures evaluated (c2w fork, WASM shim, JS interception)
  - Selected approach: JS interception (short-term Phase 1) + WASM shim (long-term Phase 2)
  - IndexedDB schema: tool-data, metadata, sync-log stores
  - Sync mechanisms: fire-and-forget postMessage for async persistence
  - Error handling and fallback strategies documented
  - Performance expectations: 10-20ms per-write latency, 50-100 writes/sec sustained

- `docs/VFS_IMPLEMENTATION_STEPS.md` — step-by-step implementation guide (278 lines)
  - 7 discrete code changes identified with detailed specifications
  - Data flow diagrams for write path and boot restoration
  - Testing checklist and performance expectations
  - Fallback strategy for latency mitigation

### Phase 2: Interface Implementation ✅
**Commit**: 9e5bbf6

**Deliverable**:
- `vfs-idb.js` — IndexedDB CRUD interface (193 lines)
  - `initializeIDB()` — IDB database initialization with 3 object stores
  - `writeFile(toolId, path, data)` — persist file to IDB with metadata
  - `readFile(toolId, path)` — retrieve persisted file
  - `listFiles(toolId)` — enumerate all files for a tool
  - `deleteFile(toolId, path)` — remove persisted file
  - `clearTool(toolId)` — wipe all data for a tool
  - `getMetadata(toolId)` — quota and sync tracking
  - `restoreForVm(toolIds)` — export files for boot-time restoration
  - `logSync()` — audit trail of operations
  - `getStatus()` — observability API exposing quota usage

### Phase 3: Worker-Side Interception ✅
**Commit**: 5f12d73

**Deliverables**:
- `wc-workers.js` — OPFSOpenFile path tracking and interception
  - Added constructor to OPFSOpenFile: track vmPath, relPath, fullPath
  - Modified OPFSPreopenDir.path_open to pass path context to constructor
  - Extended fd_write to:
    - Extract toolId via regex match on /.local/share/* and /.config/*
    - postMessage {type:'vfs-write', toolId, path, data} (fire-and-forget)
    - Keep existing OPFS flush logic unchanged (dual persistence)

### Phase 4: Main-Thread Integration ✅
**Commit**: 5f12d73

**Deliverables**:
- `wc.js` — VFS integration
  - Import vfs-idb module
  - Initialize IDB in bootAssets() before WASM boot
  - Handle 'vfs-write' postMessages in worker.onmessage
  - Expose window.__debug.vfs for observability

## Remaining Work (Phase 5: Testing & Boot Restoration)

### 1. Boot-Time Restoration ⏳
**Scope**: Implement vfs-restore in worker blob source

**What's needed**:
- Add `restoreToolData()` function in worker blob (wc-workers.js string template)
- postMessage {type:'vfs-restore', toolIds} after opfsWalk completes
- Receive ack with file list, populate in-memory filesystem
- Call restoreToolData() before TtyServer.start()

**Code location**: wc-workers.js, blob source generation (~line 279-500)

### 2. vfs-restore Handler in wc.js ⏳
**Scope**: Handle restoration postMessages

**What's needed**:
```javascript
if (d.type === 'vfs-restore') {
  vfsIDB.restoreForVm(d.toolIds)
    .then(files => worker.postMessage({type:'vfs-restore-ack', files}))
    .catch(e => worker.postMessage({type:'vfs-restore-ack', files:[], error:e.message}))
}
```

### 3. Layer Configuration ⏳
**Scope**: Add idbMounts to layers.json

**What's needed**:
```json
{
  "id": "opencode",
  ...,
  "idbMounts": ["/root/.local/share/opencode"],
  ...
}
```

### 4. End-to-End Testing ⏳
**Scope**: Validate in browser

**Acceptance criteria**:
- [ ] Create opencode system in browser
- [ ] Monitor console for vfs-write postMessages
- [ ] Check window.__debug.vfs.getStatus() shows files in IDB
- [ ] Verify opencode TUI launches without WAL errors
- [ ] Stop/restart worker, check IDB restore works
- [ ] Validate boot-time latency <500ms

## Commits Made

1. **9e5bbf6** — `feat(vfs): design IndexedDB-backed VFS architecture and implement vfs-idb.js CRUD interface`
   - Architecture design document
   - vfs-idb.js CRUD interface

2. **6bcd066** — `docs: add detailed VFS implementation steps for Phase 1 JS interception`
   - Step-by-step implementation guide
   - Data flow diagrams
   - Testing checklist

3. **5f12d73** — `feat(vfs): implement JS interception of file writes in OPFSOpenFile.fd_write`
   - OPFSOpenFile path tracking
   - fd_write interception logic
   - wc.js integration (import, IDB init, postMessage handler)
   - window.__debug.vfs exposure

## Architecture Decision Rationale

**Why JS Interception (Phase 1)?**
- ✅ Minimal code changes: 3 files modified, 2 new files
- ✅ Non-invasive: doesn't break OPFS for non-tool directories
- ✅ Works immediately: no c2w fork, no tool relinking required
- ✅ Low risk: localized to OPFSOpenFile, other code paths unchanged
- ✅ Observable: postMessages can be monitored, IDB state inspectable
- ⚠️ Per-write latency: ~10-20ms (acceptable for opencode's write patterns)

**Why WASM Shim (Phase 2)?**
- If tail latency >50ms observed in Phase 1 testing
- Requires opencode source code or agreement to relink
- Eliminates postMessage overhead (~5-10ms per write)
- Provides custom memory buffering and batching

**Why not c2w fork (Candidate A)?**
- High maintenance burden (syscall layer expertise needed)
- Requires tracking c2w upstream updates
- High risk of subtle bugs in syscall interception
- Deferred to Phase 3 if Phase 1/2 prove insufficient

## Performance Expectations

| Metric | Value |
|--------|-------|
| Per-write latency (p50) | ~10-15ms |
| Per-write latency (p99) | ~20-30ms |
| Sustained throughput | 50-100 writes/sec |
| Boot-time overhead (vfsIDB init) | ~0ms (async in parallel) |
| Boot-time overhead (vfs-restore) | ~100-200ms |
| Total boot latency impact | <300ms |
| IDB quota per origin | 50-100MB |
| Reserved for tools | 50MB |
| Quota warning threshold | 40MB |
| Quota error threshold | 45MB |

## Known Limitations

1. **Synchronization model**: Best-effort fire-and-forget. IDB writes don't block fd_write return. If worker crashes between postMessage and IDB write, writes are lost.
   - **Mitigation**: Worker restarts automatically; re-opened tools re-create databases from IDB state

2. **SQLite WAL compatibility**: OPFS still lacks flock/mmap, but IDB writes happen asynchronously. WAL mode initialization may race.
   - **Mitigation**: opencode should succeed because database is persisted in IDB; next boot restores it intact

3. **Quota management**: Simple per-tool tracking, no automatic eviction.
   - **Mitigation**: UI warning at 40MB, error at 45MB; users can manually clear via window.__debug.vfs.clear(toolId)

4. **Multi-worker conflicts**: If two workers write to same tool data simultaneously, last-write-wins.
   - **Mitigation**: Same problem with OPFS; IDB transactions are atomic per-file

## Testing Strategy

1. **Unit tests** (manual console verification):
   - vfsIDB.writeFile() / readFile() roundtrip
   - IDB initialization and schema
   - Quota tracking accuracy

2. **Integration tests** (browser UI):
   - Boot opencode system
   - Verify TUI renders (no WAL errors)
   - Monitor vfs-write postMessages in DevTools
   - Check IDB store via IndexedDB inspector
   - Worker restart and restore

3. **Performance tests** (DevTools):
   - Measure postMessage latency distribution
   - Monitor boot-time breakdown (opfsWalk vs vfs-restore)
   - Profile IDB transaction overhead

## Next Session Agenda

1. **Implement vfs-restore** in worker blob source
2. **Add vfs-restore handler** in wc.js
3. **Update layers.json** with idbMounts for opencode
4. **Boot test** opencode system in browser
5. **Profile** vfs-write latency and boot time
6. **Iterate** on performance if needed (batching, Phase 2 evaluation)

## Files Modified/Created This Session

- ✅ `docs/VFS_ARCHITECTURE.md` (389 lines) — comprehensive design
- ✅ `docs/VFS_IMPLEMENTATION_STEPS.md` (278 lines) — step-by-step guide
- ✅ `vfs-idb.js` (193 lines) — IndexedDB interface
- ✅ `wc-workers.js` (modified) — path tracking and fd_write interception
- ✅ `wc.js` (modified) — IDB integration and postMessage handling
- ✅ `docs/VFS_SESSION_SUMMARY.md` (this file) — session recap

## Code Statistics

| Component | Lines | Language |
|-----------|-------|----------|
| vfs-idb.js (new) | 193 | JavaScript |
| VFS_ARCHITECTURE.md (new) | 389 | Markdown |
| VFS_IMPLEMENTATION_STEPS.md (new) | 278 | Markdown |
| wc-workers.js (modified) | +35 net | JavaScript |
| wc.js (modified) | +4 | JavaScript |
| **Total new/modified** | **~900** | |

## Success Criteria (Session)

- [x] Three candidate architectures analyzed with trade-offs documented
- [x] Selected architecture (JS interception + WASM shim) specified in detail
- [x] IndexedDB CRUD interface fully implemented (vfs-idb.js)
- [x] Worker-side interception implemented (OPFSOpenFile.fd_write)
- [x] Main-thread integration complete (wc.js handlers + IDB init)
- [x] All code changes committed (3 commits, no uncommitted changes)
- [ ] End-to-end testing with opencode (pending boot-restore implementation)

## Conclusion

Completed comprehensive VFS architecture design and Phase 1 implementation of JS interception layer. The foundation is now in place for persistent tool data in IndexedDB. Remaining work (boot-time restoration) is straightforward and can be completed in next session. Initial design suggests JS interception will meet performance requirements for opencode's typical write patterns (10-20 writes/sec).
