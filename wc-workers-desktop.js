export function desktopBlobSrc(mounts) {
  return `
var _desktopHandles = {};
var _desktopFiles = new Map();
async function desktopWalk(dh, vp, out) {
  out = out || {};
  var es = [];
  for await (var [n,h] of dh.entries()) es.push([n,h]);
  postMessage({type:'desktop-init', path:vp, loaded:0, total:es.length});
  for (var i=0; i<es.length; i++) {
    var n=es[i][0], h=es[i][1];
    if (h.kind === 'file') {
      var buf = new Uint8Array(await (await h.getFile()).arrayBuffer());
      var f = new File(buf); _desktopFiles.set(f, {dh:dh, name:n}); out[n] = f;
    } else { out[n] = new Directory(await desktopWalk(h, vp+'/'+n)); }
    postMessage({type:'desktop-init', path:vp, loaded:i+1, total:es.length});
  }
  return out;
}
class DesktopOpenFile extends OpenFile {
  fd_write(m, v) {
    var r = OpenFile.prototype.fd_write.call(this, m, v);
    if (r.ret === 0) {
      var info = _desktopFiles.get(this.file);
      if (info) postMessage({type:'desktop-write', dh:info.dh, name:info.name, data:Array.from(this.file.data)});
    }
    return r;
  }
}
class DesktopPreopenDir extends PreopenDirectory {
  constructor(n, c, dh) { super(n, c); this._dh = dh; }
  path_open(df,p,of,fr,fi,ff) {
    var r = PreopenDirectory.prototype.path_open.call(this,df,p,of,fr,fi,ff);
    if (r.ret === 0 && r.fd_obj instanceof OpenFile) {
      var file = r.fd_obj.file, fname = p.split('/').pop();
      if (!_desktopFiles.has(file)) _desktopFiles.set(file, {dh:this._dh, name:fname});
      var w = new DesktopOpenFile(r.fd_obj.file); w.file_pos = r.fd_obj.file_pos; return {ret:0, fd_obj:w};
    }
    return r;
  }
}
`
}
