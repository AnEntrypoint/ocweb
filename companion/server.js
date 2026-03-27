#!/usr/bin/env node
const { WebSocketServer } = require("ws");
const { exec, spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.env.PORT || "9377", 10);
const CWD = process.env.CWD || process.cwd();

const wss = new WebSocketServer({ port: PORT });
let connections = 0;

wss.on("connection", (ws) => {
  connections++;
  console.log("[companion] client connected (" + connections + " active)");

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { ws.send(JSON.stringify({ id: null, error: "invalid json" })); return; }
    const { id, method, params } = msg;
    try {
      const result = await handleMethod(method, params || {});
      ws.send(JSON.stringify({ id, result }));
    } catch (e) {
      ws.send(JSON.stringify({ id, error: e.message }));
    }
  });

  ws.on("close", () => { connections--; console.log("[companion] client disconnected (" + connections + " active)"); });
});

async function handleMethod(method, params) {
  switch (method) {
    case "ping": return { ok: true, cwd: CWD, version: "1.0.0" };

    case "shell.exec": {
      const cmd = params.command;
      if (!cmd) throw new Error("command required");
      const cwd = params.cwd || CWD;
      return new Promise((resolve, reject) => {
        exec(cmd, { cwd, timeout: 30000, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
          resolve({ exitCode: err ? err.code || 1 : 0, stdout, stderr });
        });
      });
    }

    case "fs.read": {
      const p = resolvePath(params.path);
      const content = fs.readFileSync(p, "utf-8");
      return { content, size: content.length };
    }

    case "fs.write": {
      const p = resolvePath(params.path);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, params.content, "utf-8");
      return { written: params.content.length };
    }

    case "fs.list": {
      const p = resolvePath(params.path || ".");
      const entries = fs.readdirSync(p, { withFileTypes: true });
      return entries.map(e => ({ name: e.name, type: e.isDirectory() ? "dir" : "file" }));
    }

    case "fs.exists": {
      const p = resolvePath(params.path);
      return { exists: fs.existsSync(p) };
    }

    case "fs.delete": {
      const p = resolvePath(params.path);
      fs.rmSync(p, { recursive: true, force: true });
      return { deleted: true };
    }

    case "fs.stat": {
      const p = resolvePath(params.path);
      const s = fs.statSync(p);
      return { size: s.size, isDir: s.isDirectory(), modified: s.mtime.toISOString() };
    }

    case "git.status": return shellSync("git status --porcelain", params.cwd);
    case "git.log": return shellSync("git log --oneline -20", params.cwd);
    case "git.diff": return shellSync("git diff", params.cwd);
    case "git.branch": return shellSync("git branch", params.cwd);

    case "process.spawn": {
      const cmd = params.command;
      if (!cmd) throw new Error("command required");
      const cwd = params.cwd || CWD;
      const child = spawn(cmd, { shell: true, cwd });
      let output = "";
      return new Promise((resolve) => {
        child.stdout.on("data", (d) => { output += d.toString(); });
        child.stderr.on("data", (d) => { output += d.toString(); });
        child.on("close", (code) => resolve({ exitCode: code, output }));
        setTimeout(() => { child.kill(); resolve({ exitCode: -1, output: output + "\n[killed after 30s]" }); }, 30000);
      });
    }

    default: throw new Error("unknown method: " + method);
  }
}

function resolvePath(p) {
  if (path.isAbsolute(p)) return p;
  return path.resolve(CWD, p);
}

function shellSync(cmd, cwd) {
  return new Promise((resolve) => {
    exec(cmd, { cwd: cwd || CWD, timeout: 10000 }, (err, stdout, stderr) => {
      resolve({ exitCode: err ? 1 : 0, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

console.log("[companion] OpenCrabs companion server on ws://localhost:" + PORT);
console.log("[companion] CWD: " + CWD);
console.log("[companion] Methods: ping, shell.exec, fs.read/write/list/exists/delete/stat, git.status/log/diff/branch, process.spawn");
