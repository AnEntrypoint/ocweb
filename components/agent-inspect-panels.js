import { createElement, applyDiff } from "webjsx";
import { state, dispatch, getSelectedAgent } from "../store.js";
import { call } from "../gateway.js";

const EXEC_HOSTS = ["sandbox", "gateway", "node"];
const SECURITY_LEVELS = ["deny", "allowlist", "full"];
const ASK_MODES = ["off", "on-miss", "always"];
const MODELS = ["claude-sonnet-4", "claude-opus-4", "claude-haiku-4", "gpt-4o", "gemini-pro"];

function renderSwitch(label, value, onChange) {
  return createElement("div", { style: "display:flex;align-items:center;justify-content:space-between;padding:4px 0" },
    createElement("span", { style: "font-size:12px;color:var(--foreground)" }, label),
    createElement("button", { style: "position:relative;display:inline-flex;height:28px;width:48px;align-items:center;border-radius:var(--radius-small);border:0;background:" + (value ? "var(--sidebar-control-on)" : "var(--sidebar-control-off)") + ";cursor:pointer;transition:background 180ms", onclick: onChange },
      createElement("span", { style: "height:22px;width:22px;border-radius:calc(var(--radius-small) - 2px);background:var(--primary-foreground);box-shadow:0 2px 5px rgba(0,0,0,.2);transform:translateX(" + (value ? "23px" : "3px") + ");transition:transform 180ms" })
    )
  );
}

function renderSelect(label, value, options, onChange) {
  return createElement("div", { style: "display:flex;flex-direction:column;gap:4px" },
    createElement("label", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;letter-spacing:0.05em;color:var(--muted-foreground)" }, label),
    createElement("select", { class: "ui-input", style: "padding:6px 10px", value, onchange: (e) => onChange(e.target.value) },
      ...options.map(o => createElement("option", { value: o }, o))
    )
  );
}

function renderSettings(el) {
  const agent = getSelectedAgent();
  if (!agent) return;
  const patch = (p) => { dispatch({ type: "updateAgent", agentId: agent.agentId, patch: p }); renderSettings(el); };
  const vdom = createElement("div", { style: "padding:16px;display:flex;flex-direction:column;gap:16px" },
    createElement("div", { style: "display:flex;align-items:center;justify-content:space-between;padding-bottom:10px" },
      createElement("div", null,
        createElement("div", { style: "font-family:var(--font-mono);font-size:9px;font-weight:500;color:var(--muted-foreground);opacity:.58" }, "SETTINGS"),
        createElement("div", { style: "font-size:1.1rem;font-weight:600;color:var(--foreground)" }, agent.name)
      ),
      createElement("button", { class: "ui-btn-icon", onclick: () => dispatch({ type: "showInspect", panel: null }) }, "\u2715")
    ),
    renderSelect("Model", agent.model || "claude-sonnet-4", MODELS, (v) => patch({ model: v })),
    renderSelect("Exec host", agent.sessionExecHost || "sandbox", EXEC_HOSTS, (v) => patch({ sessionExecHost: v })),
    renderSelect("Security", agent.sessionExecSecurity || "deny", SECURITY_LEVELS, (v) => patch({ sessionExecSecurity: v })),
    renderSelect("Ask mode", agent.sessionExecAsk || "on-miss", ASK_MODES, (v) => patch({ sessionExecAsk: v })),
    renderSwitch("Tool calling", agent.toolCallingEnabled, () => patch({ toolCallingEnabled: !agent.toolCallingEnabled })),
    renderSwitch("Show thinking traces", agent.showThinkingTraces, () => patch({ showThinkingTraces: !agent.showThinkingTraces })),
    createElement("div", { style: "box-shadow:0 -1px 0 color-mix(in oklch,var(--surface-3) 60%,transparent);padding-top:14px;display:flex;flex-direction:column;gap:8px" },
      createElement("button", { class: "ui-btn-secondary", style: "width:100%;font-size:12px", onclick: () => {
        dispatch({ type: "updateAgent", agentId: agent.agentId, patch: { outputLines: [], streamText: null, thinkingTrace: null, lastResult: null, draft: "", status: "idle" } });
      }}, "Reset session"),
      createElement("button", { class: "ui-btn-ghost", style: "width:100%;font-size:12px;color:var(--danger-soft-fg)", onclick: () => {
        dispatch({ type: "removeAgent", agentId: agent.agentId });
        dispatch({ type: "showInspect", panel: null });
      }}, "Delete agent")
    )
  );
  applyDiff(el, vdom);
}

function renderBrain(el) {
  const agent = getSelectedAgent();
  if (!agent) return;
  const vdom = createElement("div", { style: "padding:16px;display:flex;flex-direction:column;gap:16px" },
    createElement("div", { style: "display:flex;align-items:center;justify-content:space-between;padding-bottom:10px" },
      createElement("div", null,
        createElement("div", { style: "font-family:var(--font-mono);font-size:9px;font-weight:500;color:var(--muted-foreground);opacity:.58" }, "BRAIN"),
        createElement("div", { style: "font-size:1.1rem;font-weight:600;color:var(--foreground)" }, agent.name)
      ),
      createElement("button", { class: "ui-btn-icon", onclick: () => dispatch({ type: "showInspect", panel: null }) }, "\u2715")
    ),
    createElement("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted-foreground);letter-spacing:0.05em" }, "CRON JOBS"),
    createElement("div", { class: "ui-card", style: "padding:12px;font-size:12px;color:var(--muted-foreground)" }, "No cron jobs configured for this agent."),
    createElement("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted-foreground);letter-spacing:0.05em;margin-top:8px" }, "AGENT FILES"),
    createElement("div", { class: "ui-card", style: "padding:12px;font-size:12px;color:var(--muted-foreground)" }, "CLAUDE.md, personality.md — edit on gateway host.")
  );
  applyDiff(el, vdom);
}

function render(el) {
  if (state.showInspectPanel === "settings") renderSettings(el);
  else if (state.showInspectPanel === "brain") renderBrain(el);
  else applyDiff(el, createElement("div", null));
}

export { render };
