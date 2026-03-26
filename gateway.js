import { state, dispatch, uid } from "./store.js";

let ws = null;
let reconnectTimer = null;
let pendingCalls = new Map();

function connect(url, token) {
  if (ws) { ws.close(); ws = null; }
  clearTimeout(reconnectTimer);
  dispatch({ type: "setGatewayStatus", status: "connecting" });
  try {
    const wsUrl = url + (token ? "?token=" + encodeURIComponent(token) : "");
    ws = new WebSocket(wsUrl);
  } catch { dispatch({ type: "setGatewayStatus", status: "error" }); return; }
  ws.onopen = () => {
    dispatch({ type: "setGatewayStatus", status: "connected" });
    dispatch({ type: "showConnection", show: false });
    call("fleet.list", {}).then(res => {
      if (res && Array.isArray(res.agents)) {
        dispatch({ type: "hydrateAgents", agents: res.agents.map(a => ({
          agentId: a.id || a.agentId, name: a.name, sessionKey: a.sessionKey || uid(),
          model: a.model, avatarSeed: a.avatarSeed,
          sessionExecHost: a.execHost, sessionExecSecurity: a.execSecurity, sessionExecAsk: a.execAsk,
        }))});
      }
    }).catch(() => {});
  };
  ws.onmessage = (evt) => {
    let frame; try { frame = JSON.parse(evt.data); } catch { return; }
    if (frame.type === "res") {
      const cb = pendingCalls.get(frame.id);
      if (cb) { pendingCalls.delete(frame.id); frame.ok ? cb.resolve(frame.payload) : cb.reject(frame.error); }
    } else if (frame.type === "event") handleEvent(frame);
  };
  ws.onclose = () => {
    ws = null; dispatch({ type: "setGatewayStatus", status: "reconnecting" });
    reconnectTimer = setTimeout(() => connect(url, token), 3000);
  };
  ws.onerror = () => {};
}

function call(method, params) {
  return new Promise((resolve, reject) => {
    if (!ws || ws.readyState !== 1) return reject(new Error("not connected"));
    const id = uid();
    pendingCalls.set(id, { resolve, reject });
    ws.send(JSON.stringify({ type: "req", id, method, params }));
    setTimeout(() => { if (pendingCalls.has(id)) { pendingCalls.delete(id); reject(new Error("timeout")); } }, 15000);
  });
}

function handleEvent(frame) {
  const e = frame.event;
  const p = frame.payload || {};
  const agentId = p.agentId || p.agent_id;
  if (e === "agent.status") dispatch({ type: "updateAgent", agentId, patch: { status: p.status } });
  else if (e === "agent.output") { dispatch({ type: "appendOutput", agentId, line: p.line }); dispatch({ type: "markActivity", agentId }); }
  else if (e === "agent.stream") dispatch({ type: "updateAgent", agentId, patch: { streamText: p.text } });
  else if (e === "agent.thinking") dispatch({ type: "updateAgent", agentId, patch: { thinkingTrace: p.text } });
  else if (e === "agent.result") dispatch({ type: "updateAgent", agentId, patch: { lastResult: p.text, status: "idle", streamText: null, thinkingTrace: null } });
  else if (e === "exec.approval") dispatch({ type: "addApproval", approval: { id: p.id || uid(), agentId, command: p.command, cwd: p.cwd, host: p.host, security: p.security, createdAtMs: Date.now(), resolving: false, error: null } });
  else if (e === "fleet.update" && Array.isArray(p.agents)) dispatch({ type: "hydrateAgents", agents: p.agents.map(a => ({ agentId: a.id || a.agentId, name: a.name, sessionKey: a.sessionKey || uid(), model: a.model, avatarSeed: a.avatarSeed })) });
}

function disconnect() { if (ws) ws.close(); ws = null; clearTimeout(reconnectTimer); dispatch({ type: "setGatewayStatus", status: "disconnected" }); }

function testConnection(url, token) {
  return new Promise((resolve) => {
    try {
      const t = new WebSocket(url + (token ? "?token=" + encodeURIComponent(token) : ""));
      const timer = setTimeout(() => { t.close(); resolve({ kind: "error", message: "Connection timed out" }); }, 5000);
      t.onopen = () => { clearTimeout(timer); t.close(); resolve({ kind: "success", message: "Connection successful" }); };
      t.onerror = () => { clearTimeout(timer); resolve({ kind: "error", message: "Connection refused" }); };
    } catch (e) { resolve({ kind: "error", message: e.message }); }
  });
}

function sendChat(agentId, message) {
  if (state.gatewayStatus === "connected") {
    call("chat.send", { agentId, message }).catch(() => {});
    dispatch({ type: "appendOutput", agentId, line: "user: " + message });
    dispatch({ type: "updateAgent", agentId, patch: { status: "running", lastUserMessage: message } });
  } else simulateChat(agentId, message);
}

function simulateChat(agentId, message) {
  dispatch({ type: "appendOutput", agentId, line: "user: " + message });
  dispatch({ type: "updateAgent", agentId, patch: { status: "running", lastUserMessage: message } });
  dispatch({ type: "markActivity", agentId });
  setTimeout(() => {
    dispatch({ type: "updateAgent", agentId, patch: { thinkingTrace: "Analyzing request..." } });
  }, 300);
  setTimeout(() => {
    dispatch({ type: "updateAgent", agentId, patch: { thinkingTrace: null } });
    const responses = ["I've analyzed your request and here are my findings:\n\n1. The task has been completed successfully\n2. All checks passed\n3. No issues found",
      "Working on that now. I'll search the codebase and provide a detailed response.",
      "I found several relevant files. Let me analyze them and get back to you with a comprehensive answer."];
    const resp = responses[Math.floor(Math.random() * responses.length)];
    let i = 0;
    const interval = setInterval(() => {
      i += 4;
      dispatch({ type: "updateAgent", agentId, patch: { streamText: resp.slice(0, i) } });
      if (i >= resp.length) {
        clearInterval(interval);
        dispatch({ type: "appendOutput", agentId, line: "assistant: " + resp });
        dispatch({ type: "updateAgent", agentId, patch: { status: "idle", streamText: null, lastResult: resp, lastAssistantMessageAt: Date.now() } });
        dispatch({ type: "markActivity", agentId });
      }
    }, 20);
  }, 800);
}

function resolveApproval(id, decision) {
  if (state.gatewayStatus === "connected") call("exec.approval.resolve", { id, decision }).catch(() => {});
  dispatch({ type: "resolveApproval", id });
}

function saveGatewaySettings(url, token) {
  localStorage.setItem("oc-gateway", JSON.stringify({ url, token }));
  dispatch({ type: "setGatewaySettings", url, token });
}

export { connect, disconnect, call, testConnection, sendChat, resolveApproval, saveGatewaySettings, simulateChat };
