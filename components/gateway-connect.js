import { createElement, applyDiff } from "webjsx";
import { state, dispatch } from "../store.js";
import { connect, disconnect, testConnection, saveGatewaySettings } from "../gateway.js";

const STATUS_LABELS = { disconnected: "Disconnected", connecting: "Connecting", connected: "Connected", reconnecting: "Reconnecting", error: "Error" };
const STATUS_BADGE = { disconnected: "ui-badge-status-disconnected", connecting: "ui-badge-status-connecting", connected: "ui-badge-status-connected", reconnecting: "ui-badge-status-connecting", error: "ui-badge-status-error" };
const SCENARIOS = [
  { id: "same-computer", title: "Everything on this computer", desc: "Studio and OpenClaw both run on the same machine." },
  { id: "remote-gateway", title: "Studio here, OpenClaw in the cloud", desc: "Keep Studio on your laptop and point it at a remote gateway." },
  { id: "same-cloud-host", title: "Both on same cloud machine", desc: "Use localhost for the upstream, then solve how you open Studio." }
];

let draftUrl = "", draftToken = "", selectedScenario = "same-computer", testResult = null, testing = false, saving = false;

function init() { draftUrl = state.gatewayUrl || "ws://localhost:18789"; draftToken = ""; }

function commandField(label, value) {
  return createElement("div", { style: "margin-top:10px" },
    createElement("div", { style: "display:flex;align-items:center;justify-content:space-between;gap:8px" },
      createElement("p", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground)" }, label),
      createElement("button", { class: "ui-btn-ghost", style: "height:28px;padding:0 8px;font-size:11px", onclick: () => navigator.clipboard.writeText(value).catch(() => {}) }, "Copy")
    ),
    createElement("div", { class: "ui-command-surface", style: "display:flex;align-items:center;gap:8px;padding:8px 12px;margin-top:4px" },
      createElement("code", { style: "flex:1;overflow-x:auto;white-space:nowrap;font-family:var(--font-mono);font-size:12px" }, value)
    )
  );
}

function render(el) {
  if (!draftUrl) init();
  const s = state.gatewayStatus;
  const dotClass = s === "connected" ? "ui-dot-status-connected" : s === "connecting" || s === "reconnecting" ? "ui-dot-status-connecting" : "ui-dot-status-disconnected";
  const statusText = s === "connected" ? "Studio is connected to OpenClaw." : s === "connecting" ? "Connecting..." : s === "reconnecting" ? "Reconnecting..." : s === "error" ? "Could not connect." : "Choose how this Studio should reach OpenClaw.";

  const vdom = createElement("div", { style: "max-width:820px;margin:0 auto;display:flex;flex-direction:column;gap:16px;padding:24px 16px;overflow-y:auto;flex:1" },
    createElement("div", { class: "ui-card", style: "padding:10px 16px" },
      createElement("div", { style: "display:flex;align-items:start;gap:10px" },
        createElement("span", { class: dotClass, style: "margin-top:4px;flex-shrink:0" }),
        createElement("div", null,
          createElement("p", { style: "font-size:14px;font-weight:600;color:var(--foreground)" }, statusText),
          createElement("p", { style: "font-size:13px;color:var(--muted-foreground);margin-top:2px" }, selectedScenario === "remote-gateway" ? "Only the upstream changes. Studio itself stays local." : "When Studio and OpenClaw share a host, upstream stays on localhost.")
        )
      )
    ),
    createElement("div", { style: "display:grid;gap:10px;grid-template-columns:repeat(3,1fr)" },
      ...SCENARIOS.map(sc => createElement("button", {
        class: "ui-card", style: "text-align:left;padding:12px 16px;cursor:pointer;transition:border-color 150ms" + (selectedScenario === sc.id ? ";border-color:color-mix(in oklch,var(--primary) 60%,transparent)" : ""),
        onclick: () => { selectedScenario = sc.id; render(el); }
      },
        createElement("p", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground)" }, sc.title),
        createElement("p", { style: "font-size:13px;color:var(--foreground);opacity:.85;margin-top:6px" }, sc.desc)
      ))
    ),
    createElement("div", { style: "display:grid;gap:14px;grid-template-columns:1fr 1fr" },
      createElement("div", { class: "ui-card", style: "padding:16px 20px" },
        createElement("p", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground)" }, "How you open Studio"),
        createElement("p", { style: "font-size:13px;color:var(--foreground);opacity:.85;margin-top:10px" }, "Open this page in your browser."),
        commandField("Current URL", location.origin)
      ),
      createElement("div", { class: "ui-card", style: "padding:16px 20px" },
        createElement("p", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground)" }, "How Studio reaches OpenClaw"),
        commandField("Start gateway", "openclaw gateway --port 18789")
      )
    ),
    createElement("div", { class: "ui-card", style: "padding:16px 20px" },
      createElement("div", { style: "display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px" },
        createElement("div", null,
          createElement("p", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground)" }, "Studio to OpenClaw"),
          createElement("p", { style: "font-size:13px;color:var(--foreground);opacity:.85;margin-top:4px" }, "Save a gateway URL and token.")
        ),
        createElement("span", { class: "ui-chip " + STATUS_BADGE[s], style: "font-size:10px" }, STATUS_LABELS[s])
      ),
      createElement("div", { style: "margin-top:14px;display:grid;gap:10px;grid-template-columns:1.35fr 1fr" },
        createElement("label", { style: "display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:500;color:var(--foreground);opacity:.8" }, "Upstream URL",
          createElement("input", { class: "ui-input", style: "height:38px;padding:0 14px;font-size:13px", value: draftUrl, oninput: (e) => { draftUrl = e.target.value; },
            placeholder: selectedScenario === "remote-gateway" ? "wss://your-gateway.ts.net" : "ws://localhost:18789" })
        ),
        createElement("label", { style: "display:flex;flex-direction:column;gap:4px;font-size:11px;font-weight:500;color:var(--foreground);opacity:.8" }, "Upstream token",
          createElement("input", { class: "ui-input", type: "password", style: "height:38px;padding:0 14px;font-size:13px", value: draftToken, oninput: (e) => { draftToken = e.target.value; }, placeholder: "gateway token" })
        )
      ),
      createElement("div", { style: "margin-top:14px;display:flex;flex-wrap:wrap;gap:8px" },
        createElement("button", { class: "ui-btn-primary", style: "height:38px;padding:0 16px;font-size:12px", disabled: saving || !draftUrl.trim(), onclick: () => {
          saving = true; render(el); saveGatewaySettings(draftUrl.trim(), draftToken); connect(draftUrl.trim(), draftToken);
          setTimeout(() => { saving = false; render(el); }, 500);
        }}, saving ? "Saving..." : "Save settings"),
        createElement("button", { class: "ui-btn-secondary", style: "height:38px;padding:0 16px;font-size:12px", disabled: testing || !draftUrl.trim(), onclick: async () => {
          testing = true; render(el); testResult = await testConnection(draftUrl.trim(), draftToken); testing = false; render(el);
          setTimeout(() => { testResult = null; render(el); }, 4000);
        }}, testing ? "Testing..." : "Test connection"),
        s === "connected" ? createElement("button", { class: "ui-btn-ghost", style: "height:38px;padding:0 16px;font-size:12px", onclick: () => { disconnect(); render(el); } }, "Disconnect") : null
      )
    ),
    testResult ? createElement("div", { class: testResult.kind === "error" ? "ui-alert-danger" : "ui-card", style: "padding:10px 16px;font-size:13px" }, testResult.message) : null
  );
  applyDiff(el, vdom);
}

export { render, init };
