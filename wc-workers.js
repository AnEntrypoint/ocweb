import { desktopBlobSrc } from './wc-workers-desktop.js'

export function makeWorkerBlob(env, scripts, cmd = ['-i'], mounts = [], idbMounts = []) {
  const preamble = scripts.join('\n')
  const src = preamble + desktopBlobSrc(mounts) + `
var ERRNO_INVAL = 28;
var ERRNO_AGAIN = 6;
var _opfsSyncHandles = new Map();
var _opfsPendingHandles = new Map();
async function opfsNavigate(p) {
  if (!navigator.storage) throw new Error('OPFS unavailable');
  var r = await navigator.storage.getDirectory();
  for (var s of p.split('/').filter(Boolean)) r = await r.getDirectoryHandle(s, {create:true});
  return r;
}
async function opfsWalk(dh, vp, out) {
  out = out || {};
  var es = [];
  for await (var [n,h] of dh.entries()) es.push([n,h]);
  postMessage({type:'opfs-init', path:vp, loaded:0, total:es.length});
  for (var i=0; i<es.length; i++) {
    var n=es[i][0], h=es[i][1];
    if (h.kind === 'file') {
      var fh = await dh.getFileHandle(n);
      var sh = null;
      try { sh = await fh.createSyncAccessHandle(); } catch(e) {}
      if (sh) {
        (function(sh) {
          var _sz = sh.getSize();
          var f = new File(new ArrayBuffer(0));
          Object.defineProperty(f, 'size', { get: function() { return _sz; } });
          f.data = { byteLength: _sz, slice: function(s,e) { var b=new Uint8Array(e-s); sh.read(b,{at:s}); return b; } };
          _opfsSyncHandles.set(f, sh); out[n] = f;
        })(sh);
      } else {
        var data = new Uint8Array(await (await fh.getFile()).arrayBuffer());
        out[n] = new File(data);
      }
    } else { out[n] = new Directory(await opfsWalk(h, vp+'/'+n)); }
    postMessage({type:'opfs-init', path:vp, loaded:i+1, total:es.length});
  }
  return out;
}
class OPFSOpenFile extends OpenFile {
  constructor(file, vmPath, relPath) {
    super(file);
    this._vmPath = vmPath;
    this._relPath = relPath;
    this._fullPath = vmPath && relPath ? vmPath + '/' + relPath.split('/').filter(Boolean).join('/') : null;
  }
  _getCachedBuf() {
    if (!this._cachedBuf) {
      var sh = _opfsSyncHandles.get(this.file);
      if (sh) {
        var sz = sh.getSize();
        var buf = new Uint8Array(sz);
        var off = 0;
        while (off < sz) { var n = sh.read(buf.subarray(off), {at: off}); if (n === 0) break; off += n; }
        this._cachedBuf = buf;
      } else {
        this._cachedBuf = this.file.data instanceof Uint8Array ? this.file.data : new Uint8Array(this.file.data);
      }
    }
    return this._cachedBuf;
  }
  fd_fdstat_get() { var d = new Fdstat(FILETYPE_REGULAR_FILE, 0); d.fs_rights_base = 0x1FFFFFFFFFFFFFFFn; d.fs_rights_inherited = 0x1FFFFFFFFFFFFFFFn; return {ret:0, fdstat:d}; }
  fd_pread(mem, vecs, offset) {
    var data = this._getCachedBuf();
    var nread = 0;
    for (var v of vecs) {
      var pos = Number(offset) + nread;
      if (pos >= data.byteLength) break;
      var got = Math.min(v.buf_len, data.byteLength - pos);
      if (got === 0) break;
      mem.set(data.subarray(pos, pos + got), v.buf);
      nread += got;
    }
    return {ret: 0, nread};
  }
  fd_read(mem, vecs) {
    var sh = _opfsSyncHandles.get(this.file);
    if (!sh) return OpenFile.prototype.fd_read.call(this, mem, vecs);
    var nread = 0;
    for (var v of vecs) {
      var pos = Number(this.file_pos);
      var len = v.buf_len;
      if (len === 0) continue;
      var buf = new Uint8Array(len);
      var got;
      try { got = sh.read(buf, {at: pos}); } catch(e4) { console.log('[opfs-read-err]', e4.message, 'pos='+pos, 'len='+len); return {ret: 28, nread: 0}; }
      if (got === 0) break;
      mem.set(buf.subarray(0, got), v.buf);
      this.file_pos += BigInt(got);
      nread += got;
    }
    return {ret: 0, nread};
  }
  fd_seek(off, whence) {
    var sh = _opfsSyncHandles.get(this.file);
    var size = sh ? sh.getSize() : 0;
    var s;
    if (whence === 0) s = off;
    else if (whence === 1) s = this.file_pos + off;
    else if (whence === 2) s = BigInt(size) + off;
    else return {ret: 28, offset: 0};
    if (s < 0) return {ret: 28, offset: 0};
    this.file_pos = BigInt(s);
    return {ret: 0, offset: s};
  }
  fd_write(m, v) {
    var r = OpenFile.prototype.fd_write.call(this, m, v);
    if (r.ret === 0) {
      var sh = _opfsSyncHandles.get(this.file);
      if (sh) { sh.truncate(0); sh.write(this.file.data, {at:0}); sh.flush(); }
      else {
        var file = this.file;
        var p = _opfsPendingHandles.get(file);
        if (p) p.then(function(s) { if (s) { s.truncate(0); s.write(file.data, {at:0}); s.flush(); } });
      }
      if (this._fullPath && typeof postMessage === 'function') {
        var toolId = this._fullPath.match(/\/.local\/share\/([^\/]+)/) ? RegExp.$1 : (this._fullPath.match(/\/.config\/([^\/]+)/) ? RegExp.$1 : null);
        if (toolId) {
          var data = this.file.data instanceof Uint8Array ? this.file.data : new Uint8Array(this.file.data);
          postMessage({type:'vfs-write', toolId:toolId, path:this._fullPath, data:data});
        }
      }
    }
    return r;
  }
  fd_pwrite(mem, vecs, offset) {
    var sh = _opfsSyncHandles.get(this.file);
    var nwritten = 0;
    var pos = Number(offset);
    for (var v of vecs) {
      var buf = mem.subarray(v.buf, v.buf + v.buf_len);
      if (buf.length === 0) continue;
      if (sh) {
        sh.write(buf, {at: pos});
        sh.flush();
      }
      // Also update in-memory file data
      var curData = this.file.data instanceof Uint8Array ? this.file.data : new Uint8Array(this.file.data);
      var end = pos + buf.length;
      if (end > curData.byteLength) {
        var newBuf = new Uint8Array(end);
        newBuf.set(curData);
        this.file.data = newBuf;
        curData = newBuf;
      }
      curData.set(buf, pos);
      this._cachedBuf = null;
      pos += buf.length;
      nwritten += buf.length;
    }
    if (!sh) {
      var file3 = this.file;
      var p3 = _opfsPendingHandles.get(file3);
      if (p3) p3.then(function(s) { if (s) { s.truncate(0); s.write(file3.data, {at:0}); s.flush(); } });
    }
    return {ret: 0, nwritten};
  }
  fd_filestat_set_size(size) {
    // Truncate/extend the file to the given size
    var targetSize = Number(size);
    var sh = _opfsSyncHandles.get(this.file);
    if (sh) {
      sh.truncate(targetSize);
      sh.flush();
      // Update in-memory representation
      var cur = this.file.data instanceof Uint8Array ? this.file.data : new Uint8Array(this.file.data);
      if (targetSize <= cur.byteLength) {
        this.file.data = cur.slice(0, targetSize);
      } else {
        var newBuf = new Uint8Array(targetSize);
        newBuf.set(cur);
        this.file.data = newBuf;
      }
      this._cachedBuf = null;
    } else {
      var cur2 = this.file.data instanceof Uint8Array ? this.file.data : new Uint8Array(this.file.data);
      if (targetSize <= cur2.byteLength) {
        this.file.data = cur2.slice(0, targetSize);
      } else {
        var newBuf2 = new Uint8Array(targetSize);
        newBuf2.set(cur2);
        this.file.data = newBuf2;
      }
      this._cachedBuf = null;
      var file2 = this.file;
      var p2 = _opfsPendingHandles.get(file2);
      if (p2) p2.then(function(s) { if (s) { s.truncate(targetSize); s.flush(); } });
    }
    return 0;
  }
}
function opfsGetEntry(dir, p) {
  var e = dir;
  for (var s of p.split('/')) {
    if (s === '' || s === '.') continue;
    if (!e || !e.contents || null == e.contents[s]) return null;
    e = e.contents[s];
  }
  return e;
}
class OPFSPreopenDir extends PreopenDirectory {
  constructor(n, c, dh) { super(n, c); this._dh = dh; }
  path_filestat_get(df, p) {
    if (p === '.' || p === '') return {ret:0, filestat: this.dir.stat()};
    var e = opfsGetEntry(this.dir, p);
    return e ? {ret:0, filestat: e.stat()} : {ret:-1, filestat:null};
  }
  path_create_directory(p) {
    var parts = p.split('/').filter(function(s){return s && s !== '.';});
    if (parts.length === 0) return 0;
    // Walk/create in-memory tree, creating Directory nodes as needed
    var node = this.dir;
    for (var i = 0; i < parts.length; i++) {
      var seg = parts[i];
      if (!node.contents[seg]) {
        node.contents[seg] = new Directory({});
      } else if (!(node.contents[seg] instanceof Directory)) {
        return -1; // exists as file
      }
      node = node.contents[seg];
    }
    // Async: create the OPFS directory hierarchy
    var rootDh = this._dh;
    parts.reduce(function(p, seg) {
      return p.then(function(dh) { return dh.getDirectoryHandle(seg, {create:true}); });
    }, Promise.resolve(rootDh)).catch(function(e) { console.log('[opfs-mkdir-err]', p, e.message); });
    return 0;
  }
  path_open(df,p,of,fr,fi,ff) {
    if (p === '.' || p === '') { var od = new OpenDirectory(this.dir); return {ret:0, fd_obj:od}; }
    var e = opfsGetEntry(this.dir, p);
    var OFLAGS_CREAT = 1, OFLAGS_DIRECTORY = 2, OFLAGS_TRUNC = 8;
    if (e === null) {
      if ((of & OFLAGS_CREAT) !== OFLAGS_CREAT) return {ret:-1, fd_obj:null};
      // Create new in-memory file entry and schedule OPFS file creation
      var newFile = new File(new ArrayBuffer(0));
      var parts2 = p.split('/').filter(function(s){return s && s!=='.';}), fname2 = parts2.pop(), rootDh2 = this._dh;
      // Insert into in-memory tree
      var parent2 = this.dir;
      for (var i2 = 0; i2 < parts2.length; i2++) {
        var seg2 = parts2[i2];
        if (!parent2.contents[seg2]) parent2.contents[seg2] = new Directory({});
        parent2 = parent2.contents[seg2];
      }
      parent2.contents[fname2] = newFile;
      var parentPromise2 = parts2.reduce(function(pp, seg) { return pp.then(function(dh) { return dh.getDirectoryHandle(seg, {create:true}); }); }, Promise.resolve(rootDh2));
      var shPromise2 = parentPromise2.then(function(parentDh) { return parentDh.getFileHandle(fname2, {create:true}); }).then(function(fh) { return fh.createSyncAccessHandle(); }).then(function(sh) { _opfsSyncHandles.set(newFile, sh); _opfsPendingHandles.delete(newFile); return sh; });
      _opfsPendingHandles.set(newFile, shPromise2);
      e = newFile;
    }
    if (e instanceof Directory) return {ret:0, fd_obj: new OpenDirectory(e)};
    if ((of & OFLAGS_TRUNC) === OFLAGS_TRUNC) e.truncate && e.truncate();
    if (!_opfsSyncHandles.has(e)) {
      var file = e, parts = p.split('/').filter(function(s){return s && s!=='.';}), fname = parts.pop(), rootDh = this._dh;
      var parentPromise = parts.reduce(function(p, seg) { return p.then(function(dh) { return dh.getDirectoryHandle(seg); }); }, Promise.resolve(rootDh));
      var shPromise = parentPromise.then(function(parentDh) { return parentDh.getFileHandle(fname, {create:true}); }).then(function(fh) { return fh.createSyncAccessHandle(); }).then(function(sh) { _opfsSyncHandles.set(file, sh); _opfsPendingHandles.delete(file); return sh; });
      _opfsPendingHandles.set(file, shPromise);
    }
    var w = new OPFSOpenFile(e, this.name, p); return {ret:0, fd_obj:w};
  }
}
async function opfsMounts(ms) {
  var dirs = [];
  for (var m of ms) {
    if (m.type === 'desktop') {
      var dh = _desktopHandles[m.vmPath]; if (!dh) throw new Error('no desktop handle for ' + m.vmPath);
      dirs.push(new DesktopPreopenDir(m.vmPath, await desktopWalk(dh, m.vmPath), dh));
    } else {
      var dh = await opfsNavigate(m.opfsPath || 'home/root'); dirs.push(new OPFSPreopenDir(m.vmPath, await opfsWalk(dh, m.vmPath), dh));
    }
  }
  return dirs;
}
function idbReadMounts(idbMountsData, layerBuffers) {
  var byPath = {};
  for (var i = 0; i < idbMountsData.length; i++) {
    var m = idbMountsData[i];
    var buf = layerBuffers && layerBuffers[i];
    if (buf) {
      if (!byPath[m.vmPath]) byPath[m.vmPath] = {};
      byPath[m.vmPath][m.binaryName] = new File(new Uint8Array(buf));
    }
  }
  var dirs = [];
  for (var vmPath in byPath) dirs.push(new PreopenDirectory(vmPath, byPath[vmPath]));
  return dirs;
}
(async function() {
var _pending = [];
var _init = await new Promise(function(res) { onmessage = function(e) { if (e.data && e.data.type === 'desktop-handles') { onmessage = function(e2) { _pending.push(e2); }; res(e.data); } }; });
var _wasmBuffers = _init.wasmBuffers || [];
var _dh = _init.handles || [];
for (var i=0; i<_dh.length; i++) _desktopHandles[_dh[i].vmPath] = _dh[i].handle;
var _mounts = (await opfsMounts(${JSON.stringify(mounts)})).concat(idbReadMounts(${JSON.stringify(idbMounts)}, _init.layerBuffers));
function _realHandler(msg) {
  if (serveIfInitMsg(msg)) return;
  var ttyClient = new TtyClient(msg.data);
  recvCert().then(function(cert) {
    var certDir = getCertDir(cert);
    var _preopens = [certDir].concat(_mounts);
    var _listenFd = 3 + _preopens.length;
    var _connFd = _listenFd + 1;
    var fds = [undefined, undefined, undefined].concat(_preopens).concat([undefined, undefined]);
    var args = ['arg0', '--net=socket=listenfd=' + _listenFd, '--mac', genmac(), '-entrypoint', '/bin/sh', '--'].concat(${JSON.stringify(cmd)});
    var env = ${JSON.stringify(env)};
    var bufsPromise = Promise.resolve(_wasmBuffers);
    bufsPromise.then(function(bufs) {
      var total = bufs.reduce(function(n, b) { return n + b.byteLength; }, 0);
      var merged = new Uint8Array(total); var off = 0;
      for (var b of bufs) { merged.set(new Uint8Array(b), off); off += b.byteLength; }
      var wasi = new WASI(args, env, fds);
      wasiHack(wasi, ttyClient, _listenFd, _connFd);
      wasiHackSocket(wasi, _listenFd, _connFd);
      var _origPathOpen = wasi.wasiImport.path_open;
      wasi.wasiImport.path_open = function() {
        var ret = _origPathOpen.apply(wasi.wasiImport, arguments);
        try {
          var mem8 = new Uint8Array(wasi.inst.exports.memory.buffer);
          var path = new TextDecoder().decode(mem8.slice(arguments[2], arguments[2]+arguments[3]));
          console.log('[wasi-trace] path_open fd=' + arguments[0] + ' path=' + path + ' oflags=' + arguments[4] + ' ret=' + ret);
        } catch(e2) {}
        return ret;
      };
      var _origFdPread = wasi.wasiImport.fd_pread;
      if (_origFdPread) {
        wasi.wasiImport.fd_pread = function() {
          try {
            var ret = _origFdPread.apply(wasi.wasiImport, arguments);
            if (ret !== 0) console.log('[wasi-trace] fd_pread fd=' + arguments[0] + ' ret=' + ret);
            return ret;
          } catch(e5) { console.log('[wasi-trace] fd_pread THROW fd=' + arguments[0] + ' err=' + e5.message); return 28; }
        };
      }
      var _origFdReaddir = wasi.wasiImport.fd_readdir;
      wasi.wasiImport.fd_readdir = function() {
        var ret = _origFdReaddir.apply(wasi.wasiImport, arguments);
        console.log('[wasi-trace] fd_readdir fd=' + arguments[0] + ' ret=' + ret);
        return ret;
      };
      var _origFdRead = wasi.wasiImport.fd_read;
      wasi.wasiImport.fd_read = function() {
        try {
          var ret = _origFdRead.apply(wasi.wasiImport, arguments);
          console.log('[wasi-trace] fd_read fd=' + arguments[0] + ' ret=' + ret);
          return ret;
        } catch(e3) {
          console.log('[wasi-trace] fd_read THROW fd=' + arguments[0] + ' err=' + e3.message);
          return 28;
        }
      };
      var _origPathStat = wasi.wasiImport.path_filestat_get;
      wasi.wasiImport.path_filestat_get = function() {
        var ret = _origPathStat.apply(wasi.wasiImport, arguments);
        try {
          var mem8 = new Uint8Array(wasi.inst.exports.memory.buffer);
          var path = new TextDecoder().decode(mem8.slice(arguments[2], arguments[2]+arguments[3]));
          console.log('[wasi-trace] path_filestat_get fd=' + arguments[0] + ' path=' + path + ' ret=' + ret);
        } catch(e2) {}
        return ret;
      };
      var _origFdStat = wasi.wasiImport.fd_fdstat_get;
      wasi.wasiImport.fd_fdstat_get = function() {
        var ret = _origFdStat.apply(wasi.wasiImport, arguments);
        console.log('[wasi-trace] fd_fdstat_get fd=' + arguments[0] + ' ret=' + ret);
        return ret;
      };
      var _origFdWrite = wasi.wasiImport.fd_write;
      wasi.wasiImport.fd_write = function() {
        var ret = _origFdWrite.apply(wasi.wasiImport, arguments);
        console.log('[wasi-trace] fd_write fd=' + arguments[0] + ' ret=' + ret);
        return ret;
      };
      var _origFdClose = wasi.wasiImport.fd_close;
      wasi.wasiImport.fd_close = function() {
        var ret = _origFdClose.apply(wasi.wasiImport, arguments);
        if (ret !== 0) console.log('[wasi-trace] fd_close fd=' + arguments[0] + ' ret=' + ret);
        return ret;
      };
      var _origFdFilestatSetSize = wasi.wasiImport.fd_filestat_set_size;
      if (_origFdFilestatSetSize) {
        wasi.wasiImport.fd_filestat_set_size = function() {
          var ret = _origFdFilestatSetSize.apply(wasi.wasiImport, arguments);
          console.log('[wasi-trace] fd_filestat_set_size fd=' + arguments[0] + ' size=' + arguments[1] + ' ret=' + ret);
          return ret;
        };
      }
      var _origFdPwrite = wasi.wasiImport.fd_pwrite;
      if (_origFdPwrite) {
        wasi.wasiImport.fd_pwrite = function(fd, iovs_ptr, iovs_len, offset, nwritten_ptr) {
          var mem8 = new Uint8Array(wasi.inst.exports.memory.buffer);
          var buf = new DataView(wasi.inst.exports.memory.buffer);
          // Read iovs to get data
          var data = [];
          for (var i2 = 0; i2 < iovs_len; i2++) {
            var ptr = buf.getUint32(iovs_ptr + i2 * 8, true);
            var len = buf.getUint32(iovs_ptr + i2 * 8 + 4, true);
            var slice = mem8.slice(ptr, ptr + Math.min(len, 64));
            data.push(new TextDecoder().decode(slice));
          }
          var ret = _origFdPwrite.apply(wasi.wasiImport, arguments);
          console.log('[wasi-trace] fd_pwrite fd=' + fd + ' offset=' + offset + ' data=' + JSON.stringify(data.join('')) + ' ret=' + ret);
          return ret;
        };
      }
      var _origFdSeek = wasi.wasiImport.fd_seek;
      if (_origFdSeek) {
        wasi.wasiImport.fd_seek = function() {
          var ret = _origFdSeek.apply(wasi.wasiImport, arguments);
          if (ret !== 0) console.log('[wasi-trace] fd_seek fd=' + arguments[0] + ' ret=' + ret);
          return ret;
        };
      }
      var wasmBlob = new Blob([merged], { type: 'application/wasm' });
      var wasmUrl = URL.createObjectURL(wasmBlob);
      WebAssembly.compileStreaming(fetch(wasmUrl))
        .then(function(mod) { URL.revokeObjectURL(wasmUrl); return WebAssembly.instantiate(mod, { 'wasi_snapshot_preview1': wasi.wasiImport }); })
        .then(function(inst) { wasi.start(inst); })
        .catch(function(e) { console.error('wasm error', e); });
    });
  });
}
onmessage = _realHandler;
_pending.forEach(function(m) { _realHandler(m); });
_pending = null;
})();
function genmac() {
  return '02:XX:XX:XX:XX:XX'.replace(/X/g, function() {
    return '0123456789ABCDEF'.charAt(Math.floor(Math.random() * 16));
  });
}
function wasiHack(wasi, ttyClient, listenfd, connfd) {
  var _fd_read = wasi.wasiImport.fd_read;
  wasi.wasiImport.fd_read = function(fd, iovs_ptr, iovs_len, nread_ptr) {
    if (fd == 0) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer);
      var iovecs = Iovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
      var nread = 0;
      for (var i = 0; i < iovecs.length; i++) {
        var iovec = iovecs[i];
        if (iovec.buf_len == 0) continue;
        var data = ttyClient.onRead(iovec.buf_len);
        buffer8.set(data, iovec.buf);
        nread += data.length;
      }
      buffer.setUint32(nread_ptr, nread, true);
      return 0;
    }
    return _fd_read.apply(wasi.wasiImport, [fd, iovs_ptr, iovs_len, nread_ptr]);
  };
  var _fd_write = wasi.wasiImport.fd_write;
  wasi.wasiImport.fd_write = function(fd, iovs_ptr, iovs_len, nwritten_ptr) {
    if (fd == 1 || fd == 2) {
      var buffer = new DataView(wasi.inst.exports.memory.buffer);
      var buffer8 = new Uint8Array(wasi.inst.exports.memory.buffer);
      var iovecs = Ciovec.read_bytes_array(buffer, iovs_ptr, iovs_len);
      var wtotal = 0;
      for (var i = 0; i < iovecs.length; i++) {
        var iovec = iovecs[i];
        var buf = buffer8.slice(iovec.buf, iovec.buf + iovec.buf_len);
        if (buf.length == 0) continue;
        ttyClient.onWrite(Array.from(buf));
        wtotal += buf.length;
      }
      buffer.setUint32(nwritten_ptr, wtotal, true);
      return 0;
    }
    return _fd_write.apply(wasi.wasiImport, [fd, iovs_ptr, iovs_len, nwritten_ptr]);
  };
  wasi.wasiImport.poll_oneoff = function(in_ptr, out_ptr, nsubscriptions, nevents_ptr) {
    if (nsubscriptions == 0) return ERRNO_INVAL;
    var buffer = new DataView(wasi.inst.exports.memory.buffer);
    var in_ = Subscription.read_bytes_array(buffer, in_ptr, nsubscriptions);
    var isReadPollStdin = false, isReadPollConn = false, isClockPoll = false;
    var pollSubStdin, pollSubConn, clockSub;
    var timeout = Number.MAX_VALUE;
    var events = [];
    for (var sub of in_) {
      if (sub.u.tag.variant == 'fd_read') {
        if (sub.u.data.fd == 0) { isReadPollStdin = true; pollSubStdin = sub; }
        else if (sub.u.data.fd == connfd || sub.u.data.fd == listenfd) { isReadPollConn = true; pollSubConn = sub; }
        else { console.log('[wasi-trace] poll_oneoff fd_read unknown fd=' + sub.u.data.fd + ' connfd=' + connfd + ' listenfd=' + listenfd); return ERRNO_INVAL; }
      } else if (sub.u.tag.variant == 'clock') {
        if (sub.u.data.timeout < timeout) { timeout = sub.u.data.timeout; isClockPoll = true; clockSub = sub; }
      } else if (sub.u.tag.variant == 'fd_write') {
        // fd_write subscriptions: treat as always writable (OPFS files are synchronous)
        var ev = new Event(); ev.userdata = sub.userdata; ev.error = 0; ev.type = new EventType('fd_write'); events.push(ev);
      } else return ERRNO_INVAL;
    }
    if (isReadPollStdin || isReadPollConn || isClockPoll) {
      var readable = false;
      if (isReadPollStdin || (isClockPoll && timeout > 0)) {
        readable = ttyClient.onWaitForReadable(timeout / 1000000000);
      }
      if (readable && isReadPollStdin) {
        var ev = new Event(); ev.userdata = pollSubStdin.userdata; ev.error = 0; ev.type = new EventType('fd_read'); events.push(ev);
      }
      if (isReadPollConn) {
        var sockreadable = sockWaitForReadable();
        if (sockreadable === errStatus) return ERRNO_INVAL;
        if (sockreadable === true) {
          var ev = new Event(); ev.userdata = pollSubConn.userdata; ev.error = 0; ev.type = new EventType('fd_read'); events.push(ev);
        }
      }
      if (isClockPoll) {
        var ev = new Event(); ev.userdata = clockSub.userdata; ev.error = 0; ev.type = new EventType('clock'); events.push(ev);
      }
    }
    Event.write_bytes_array(buffer, out_ptr, events);
    buffer.setUint32(nevents_ptr, events.length, true);
    return 0;
  };
}
`
  return URL.createObjectURL(new Blob([src], { type: 'application/javascript' }))
}

export function makeStackWorkerBlob(stackSrc, sharedScripts) {
  const preamble = sharedScripts.join('\n')
  return URL.createObjectURL(new Blob([preamble + '\n' + stackSrc], { type: 'application/javascript' }))
}
