# VFS Implementation Steps — Phase 1 (JS Interception)

## Overview

Implement JavaScript interception of file writes to tool data directories (~/.local/share/*, ~/.config/*) and route them through IndexedDB while keeping OPFS operational for other paths.

## Code Changes Required

### 1. wc-workers.js: Add path tracking to OPFSOpenFile

**Location**: Line 44, OPFSOpenFile class definition

**Change**: Store full path on File objects when they're created, so fd_write can identify which tool's data is being written.

**Problem**: File objects don't carry path information; paths are only available in PreopenDirectory context.

**Solution**: When OPFSPreopenDir.path_open creates an OPFSOpenFile, pass the vmPath to the constructor.

```javascript
// Before (line 250 in OPFSPreopenDir.path_open):
var w = new OPFSOpenFile(e); return {ret:0, fd_obj:w};

// After:
var w = new OPFSOpenFile(e);
w._vmPath = this.name; w._relPath = p; w._fullPath = this.name + '/' + p;
return {ret:0, fd_obj:w};
```

### 2. wc-workers.js: Modify OPFSOpenFile.fd_write to detect idbMounts

**Location**: Line 104-116, OPFSOpenFile.fd_write method

**Current behavior**: Always write to OPFS via SyncAccessHandle

**New behavior**: 
- Check if _fullPath matches any idbMounts pattern
- If match: postMessage {type:'vfs-write', toolId, path, data} and wait for ack
- If no match: Use existing OPFS path

**Problem**: fd_write is synchronous but IDB writes are async; needs handling.

**Solution**: Use a blocking queue or buffer; don't return until IDB postMessage is acknowledged.

```javascript
fd_write(m, v) {
  var r = OpenFile.prototype.fd_write.call(this, m, v);
  if (r.ret === 0) {
    // Check if this path should go to IDB
    var toolId = this._detectToolId(this._fullPath);
    if (toolId) {
      // Send to IDB via postMessage (main thread handles)
      var data = this.file.data instanceof Uint8Array ? this.file.data : new Uint8Array(this.file.data);
      postMessage({type:'vfs-write', toolId, path:this._fullPath, data});
      // Note: IDB write is async; data is updated in-memory immediately
      // Full persistence happens in background via main thread
    } else {
      // Use existing OPFS path for non-tool directories
      var sh = _opfsSyncHandles.get(this.file);
      if (sh) { sh.truncate(0); sh.write(this.file.data, {at:0}); sh.flush(); }
      else {
        var file = this.file;
        var p = _opfsPendingHandles.get(file);
        if (p) p.then(function(s) { if (s) { s.truncate(0); s.write(file.data, {at:0}); s.flush(); } });
      }
    }
  }
  return r;
}

_detectToolId(fullPath) {
  // Match patterns like /root/.local/share/opencode -> toolId 'opencode'
  var m = fullPath.match(/\/.local\/share\/([^\/]+)/);
  if (m) return m[1];
  m = fullPath.match(/\/.config\/([^\/]+)/);
  if (m) return m[1];
  return null;
}
```

### 3. wc-workers.js: Add boot-time vfs-restore postMessage

**Location**: After opfsWalk completes but before TtyServer.start, add restoration logic.

**Current flow** (wc.js line 143-144):
```javascript
onData({ xtermAddon: master })
await new Promise(r => setTimeout(r, 500))
new window.TtyServer(slave).start(worker, nwStack)
```

**New flow**:
1. Before starting shell, postMessage {type:'vfs-restore', toolIds}
2. Main thread queries IDB and returns file list
3. Worker populates in-memory filesystem from IDB data
4. Then start shell

**Implementation**: In worker blob source (wc-workers.js blob generation), add:
```javascript
// Before shell launch, restore IDB data
function restoreToolData() {
  return new Promise(function(resolve) {
    postMessage({type:'vfs-restore', toolIds:['opencode', 'claude', 'kilo', 'codex']});
    onmessage = function(e) {
      if (e.data && e.data.type === 'vfs-restore-ack') {
        // Populate in-memory filesystem with IDB data
        for (var file of (e.data.files || [])) {
          var parts = file.path.split('/').filter(function(s){return s;});
          var fname = parts.pop();
          // Insert into in-memory tree
          // ... (similar to opfsWalk logic)
        }
        resolve();
      }
    };
  });
}
```

### 4. wc.js: Handle vfs-write and vfs-restore postMessages

**Location**: Worker.onmessage handler (line 116-121)

**Add new message types**:
```javascript
worker.onmessage = function(e) {
  const d = e.data; if (!d) return
  if (d.type === 'opfs-init' || d.type === 'desktop-init' || d.type === 'wasm-progress') { ... }
  if (d.type === 'wc-debug') { ... }
  if (d.type === 'desktop-write') { ... }
  
  // NEW: Handle VFS writes
  if (d.type === 'vfs-write') {
    vfsIDB.writeFile(d.toolId, d.path, d.data).catch(e => {
      console.error('[vfs-write] failed:', d.path, e.message);
      worker.postMessage({type:'vfs-write-ack', path:d.path, error:e.message});
    }).then(() => {
      worker.postMessage({type:'vfs-write-ack', path:d.path, error:null});
    });
    return;
  }
  
  // NEW: Handle VFS restores
  if (d.type === 'vfs-restore') {
    vfsIDB.restoreForVm(d.toolIds).then(files => {
      worker.postMessage({type:'vfs-restore-ack', files});
    }).catch(e => {
      console.error('[vfs-restore] failed:', e.message);
      worker.postMessage({type:'vfs-restore-ack', files:[], error:e.message});
    });
    return;
  }
}
```

### 5. wc.js: Import vfs-idb and initialize at boot

**Location**: Top of wc.js or in bootAssets()

```javascript
import { initializeIDB } from './vfs-idb.js'

export function bootAssets() {
  if (!_assetsPromise) _assetsPromise = (async () => {
    await initializeIDB(); // Initialize IDB on first boot
    const [...] = await Promise.all([...])
    return [...]
  })()
  return _assetsPromise
}
```

### 6. containers/layers.json: Add idbMounts field

**Location**: opencode layer entry (around line 3-8)

**Add**:
```json
{
  "id": "opencode",
  "label": "OpenCode AI",
  "mountPath": "/root/.config/opencode",
  "idbMounts": ["/root/.local/share/opencode", "/root/.config/opencode"],
  "binaryUrl": "...",
  ...
}
```

### 7. wc.js: Pass idbMounts to makeWorkerBlob

**Location**: Boot sequence (line ~113 where makeWorkerBlob is called)

**Before**: `worker = new Worker(makeWorkerBlob(_env, [workerTools, ...sharedScripts], _cmd, blobMounts, []))`

**After**:
```javascript
const _idbMounts = (opts.layers || []).flatMap(layerId => {
  const layer = _allLayers.find(l => l.id === layerId);
  return (layer?.idbMounts || []).map(vmPath => ({vmPath}));
});
worker = new Worker(makeWorkerBlob(_env, [workerTools, ...sharedScripts], _cmd, blobMounts, _idbMounts))
```

## Data Flow Diagram

```
VM (WASM):
  opencode calls write(fd, data) → fd_write(fd, vecs)
  ↓
Worker (wc-workers.js):
  OPFSOpenFile.fd_write:
    - _detectToolId(fullPath) = 'opencode'
    - postMessage {type:'vfs-write', toolId:'opencode', path, data}
    - (in-memory File updated immediately)
  ↓
Main Thread (wc.js):
  worker.onmessage:
    - if d.type === 'vfs-write':
      - vfsIDB.writeFile('opencode', path, data)
      - (IDB transaction: tool-data store + metadata update)
      - postMessage {type:'vfs-write-ack', ...}
  ↓
IndexedDB:
  tool-data: key='opencode:/root/.local/share/opencode/db.sqlite'
  metadata: toolId='opencode', totalSize+=data.byteLength
```

## Boot Restoration Flow

```
VM starts → opfsWalk completes → spawnShell() called
  ↓
Worker:
  restoreToolData():
    - postMessage {type:'vfs-restore', toolIds:['opencode']}
  ↓
Main Thread (wc.js):
  worker.onmessage:
    - if d.type === 'vfs-restore':
      - vfsIDB.restoreForVm(['opencode'])
      - returns [{path, data}, ...]
      - postMessage {type:'vfs-restore-ack', files}
  ↓
Worker:
  Receives ack, populates in-memory filesystem with IDB data
  Now opencode database is loaded from IDB into memory
  Shell launches → opencode TUI runs → database queries work (no WAL failure)
```

## Error Handling Strategy

1. **IDB Write Fails**: postMessage error back, log, continue (tool handles write error)
2. **IDB Restore Fails**: Empty tool data, start fresh, log error
3. **Path Detection Fails**: Fall back to OPFS (conservative default)
4. **Quota Exceeded**: Return ENOSPC error to tool

## Testing Checklist (Post-Implementation)

- [ ] opencode launches without XDG_DATA_HOME env var
- [ ] opencode database persists to IDB
- [ ] Stopping worker and restarting: database restored from IDB
- [ ] canvas pixel analysis shows TUI rendering (no database init errors)
- [ ] boot time increase <500ms measured
- [ ] window.__debug.vfs.status() shows files in opencode store
- [ ] Large writes (>5MB) handled without quota errors (opencode DB ~50MB)

## Performance Expectations

- Per-write latency: ~10-20ms (postMessage + IDB transaction)
- SQLite checkpoint (full write): ~100-500ms (visible but acceptable)
- Boot-time overhead: ~200-300ms (opfsWalk + restore)
- Throughput: 50-100 writes/sec sustained (opencode typical: 10-20 writes/sec)

## Fallback Strategy (If postMessage Latency Too High)

If tail latency >50ms observed:
1. Implement batching: accumulate writes in 10ms window, flush in single IDB transaction
2. Metrics: sys.perf measure between fd_write entry and return
3. Evaluate WASM shim as alternative (Phase 2)
