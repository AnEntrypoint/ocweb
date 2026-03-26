const AGENT_DEFAULTS = {
  status: "idle", sessionCreated: false, awaitingUserInput: false, hasUnseenActivity: false,
  outputLines: [], lastResult: null, lastDiff: null, runId: null, runStartedAt: null,
  streamText: null, thinkingTrace: null, latestOverride: null, latestOverrideKind: null,
  lastAssistantMessageAt: null, lastActivityAt: null, latestPreview: null, lastUserMessage: null,
  previewItems: [], draft: "", queuedMessages: [], sessionSettingsSynced: false,
  historyLoadedAt: null, historyFetchLimit: null, historyFetchedCount: null,
  historyVisibleTurnLimit: null, historyMaybeTruncated: false, historyHasMore: false,
  toolCallingEnabled: false, showThinkingTraces: false, transcriptEntries: [], transcriptRevision: 0,
};

function createAgentState(seed) {
  return { ...AGENT_DEFAULTS, ...seed, sessionKey: seed.sessionKey || uid(),
    avatarSeed: seed.avatarSeed || seed.agentId, model: seed.model || "claude-sonnet-4",
    thinkingLevel: seed.thinkingLevel || "high", sessionExecHost: seed.sessionExecHost || "sandbox",
    sessionExecSecurity: seed.sessionExecSecurity || "deny", sessionExecAsk: seed.sessionExecAsk || "on-miss",
  };
}

const state = {
  agents: [], selectedAgentId: null, loading: false, error: null,
  gatewayStatus: "disconnected", gatewayUrl: "", gatewayToken: "",
  showConnectionScreen: true, showInspectPanel: null, focusFilter: "all",
  pendingApprovals: [], theme: localStorage.getItem("oc-theme") || "dark",
};

const listeners = new Set();
function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { listeners.forEach(fn => fn(state)); }

function dispatch(action) {
  switch (action.type) {
    case "hydrateAgents": {
      const byId = new Map(state.agents.map(a => [a.agentId, a]));
      state.agents = action.agents.map(seed => {
        const existing = byId.get(seed.agentId);
        return existing ? { ...existing, ...seed } : createAgentState(seed);
      });
      if (!state.selectedAgentId || !state.agents.find(a => a.agentId === state.selectedAgentId))
        state.selectedAgentId = state.agents[0]?.agentId || null;
      state.loading = false; break;
    }
    case "selectAgent": state.selectedAgentId = action.agentId; state.showConnectionScreen = false;
      state.agents = state.agents.map(a => a.agentId === action.agentId ? { ...a, hasUnseenActivity: false } : a); break;
    case "updateAgent": state.agents = state.agents.map(a => a.agentId === action.agentId ? { ...a, ...action.patch } : a); break;
    case "appendOutput": state.agents = state.agents.map(a => {
      if (a.agentId !== action.agentId) return a;
      return { ...a, outputLines: [...a.outputLines, action.line], transcriptRevision: (a.transcriptRevision || 0) + 1 };
    }); break;
    case "markActivity": state.agents = state.agents.map(a => {
      if (a.agentId !== action.agentId) return a;
      const isSelected = state.selectedAgentId === action.agentId;
      return { ...a, lastActivityAt: Date.now(), hasUnseenActivity: !isSelected };
    }); break;
    case "enqueueMessage": state.agents = state.agents.map(a => {
      if (a.agentId !== action.agentId) return a;
      return { ...a, queuedMessages: [...(a.queuedMessages || []), action.message] };
    }); break;
    case "shiftQueue": state.agents = state.agents.map(a => {
      if (a.agentId !== action.agentId) return a;
      return { ...a, queuedMessages: (a.queuedMessages || []).slice(1) };
    }); break;
    case "setGatewayStatus": state.gatewayStatus = action.status; break;
    case "setGatewaySettings": state.gatewayUrl = action.url; state.gatewayToken = action.token; break;
    case "showConnection": state.showConnectionScreen = action.show; break;
    case "showInspect": state.showInspectPanel = action.panel; break;
    case "setFilter": state.focusFilter = action.filter; break;
    case "setTheme": state.theme = action.theme; localStorage.setItem("oc-theme", action.theme);
      document.documentElement.classList.toggle("dark", action.theme === "dark"); break;
    case "addApproval": state.pendingApprovals = [...state.pendingApprovals, action.approval]; break;
    case "resolveApproval": state.pendingApprovals = state.pendingApprovals.filter(a => a.id !== action.id); break;
    case "removeAgent": state.agents = state.agents.filter(a => a.agentId !== action.agentId);
      if (state.selectedAgentId === action.agentId) state.selectedAgentId = state.agents[0]?.agentId || null; break;
    case "addAgent": state.agents = [...state.agents, createAgentState(action.seed)];
      state.selectedAgentId = action.seed.agentId; break;
  }
  notify();
}

function uid() { return Math.random().toString(36).slice(2, 10); }

function getSelectedAgent() { return state.agents.find(a => a.agentId === state.selectedAgentId) || null; }

function getFilteredAgents() {
  const pri = { running: 0, idle: 1, error: 2 };
  let list = state.agents;
  if (state.focusFilter === "running") list = list.filter(a => a.status === "running");
  else if (state.focusFilter === "approvals") list = list.filter(a => a.awaitingUserInput);
  return [...list].sort((a, b) => {
    const sd = (pri[a.status] || 1) - (pri[b.status] || 1);
    if (sd !== 0) return sd;
    return (b.lastActivityAt || 0) - (a.lastActivityAt || 0);
  });
}

const saved = JSON.parse(localStorage.getItem("oc-gateway") || "{}");
if (saved.url) { state.gatewayUrl = saved.url; state.gatewayToken = saved.token || ""; }

export { state, dispatch, subscribe, notify, uid, getSelectedAgent, getFilteredAgents, createAgentState };
