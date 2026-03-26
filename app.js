import { createElement, applyDiff } from "webjsx";
import { state, dispatch, subscribe, uid } from "./store.js";
import { render as renderHeader } from "./components/header-bar.js";
import { render as renderSidebar } from "./components/fleet-sidebar.js";
import { render as renderChat } from "./components/agent-chat-panel.js";
import { render as renderInspect } from "./components/agent-inspect-panels.js";
import { render as renderGateway, init as initGateway } from "./components/gateway-connect.js";
import { render as renderModal, open as openModal } from "./components/agent-create-modal.js";

const DEMO_AGENTS = [
  { agentId: "agent-research", name: "research-bot", sessionKey: uid(), avatarSeed: "research-bot", model: "claude-sonnet-4", sessionExecHost: "sandbox", sessionExecSecurity: "deny", sessionExecAsk: "on-miss" },
  { agentId: "agent-deploy", name: "deploy-agent", sessionKey: uid(), avatarSeed: "deploy-agent", model: "claude-opus-4", sessionExecHost: "gateway", sessionExecSecurity: "allowlist", sessionExecAsk: "always" },
  { agentId: "agent-data", name: "data-pipeline", sessionKey: uid(), avatarSeed: "data-pipeline", model: "claude-haiku-4", sessionExecHost: "node", sessionExecSecurity: "full", sessionExecAsk: "off" },
];

let els = {};

function mount() {
  const app = document.getElementById("app");
  const vdom = createElement("div", null,
    createElement("div", { id: "oc-header" }),
    createElement("div", { class: "app-layout", style: "height:calc(100vh - 41px)" },
      createElement("div", { class: "sidebar-area", id: "oc-sidebar" }),
      createElement("div", { class: "main-area", id: "oc-main" },
        createElement("div", { class: "chat-area", id: "oc-chat", style: "display:none" }),
        createElement("div", { id: "oc-gateway", style: "display:none;flex:1;overflow-y:auto" })
      ),
      createElement("div", { class: "inspect-area", id: "oc-inspect", style: "display:none" })
    ),
    createElement("div", { id: "oc-modal" })
  );
  applyDiff(app, vdom);
  els = {
    header: document.getElementById("oc-header"),
    sidebar: document.getElementById("oc-sidebar"),
    main: document.getElementById("oc-main"),
    chat: document.getElementById("oc-chat"),
    gateway: document.getElementById("oc-gateway"),
    inspect: document.getElementById("oc-inspect"),
    modal: document.getElementById("oc-modal"),
  };
}

function renderAll() {
  renderHeader(els.header);
  renderSidebar(els.sidebar, () => openModal(els.modal));
  if (state.showConnectionScreen && state.gatewayStatus !== "connected") {
    els.chat.style.display = "none";
    els.gateway.style.display = "flex";
    renderGateway(els.gateway);
  } else {
    els.chat.style.display = "flex";
    els.gateway.style.display = "none";
    renderChat(els.chat);
  }
  if (state.showInspectPanel) {
    els.inspect.style.display = "block";
    renderInspect(els.inspect);
  } else {
    els.inspect.style.display = "none";
  }
  renderModal(els.modal);
}

document.documentElement.classList.toggle("dark", state.theme === "dark");
mount();
dispatch({ type: "hydrateAgents", agents: DEMO_AGENTS });
initGateway();
subscribe(renderAll);
renderAll();
