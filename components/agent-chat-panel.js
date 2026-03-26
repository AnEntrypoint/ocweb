import { createElement, applyDiff } from "webjsx";
import { state, dispatch, getSelectedAgent } from "../store.js";
import { avatarDataUrl } from "../avatar.js";
import { sendChat, resolveApproval } from "../gateway.js";
import { show as showCtx } from "./context-menu.js";

const INTROS = ["How can I help you today?", "What should we accomplish today?", "Ready when you are.", "What are we working on?", "I'm here and ready. What's the plan?"];

function introMsg(agentId) {
  let h = 0; for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  return INTROS[h % INTROS.length];
}

function msgContextMenu(e, text, agentId, isUser) {
  const items = [
    { icon: "\u{1F4CB}", label: "Copy text", action: () => navigator.clipboard.writeText(text).catch(() => {}) },
  ];
  if (isUser) items.push({ icon: "\u{1F504}", label: "Retry message", action: () => sendChat(agentId, text) });
  showCtx(e, items, document.getElementById("oc-ctx"));
}

function renderApproval(ap) {
  return createElement("div", { class: "ui-card", style: "padding:12px 16px;box-shadow:inset 3px 0 0 var(--status-approval-bg),var(--shadow-xs)" },
    createElement("div", { style: "font-family:var(--font-mono);font-size:10px;font-weight:600;color:var(--status-approval-fg);letter-spacing:0.06em;margin-bottom:6px" }, "EXEC APPROVAL REQUIRED"),
    createElement("div", { class: "ui-command-surface", style: "padding:8px 12px;font-family:var(--font-mono);font-size:12px;margin-bottom:8px;overflow-x:auto;white-space:pre" }, ap.command),
    ap.cwd ? createElement("div", { style: "font-size:11px;color:var(--muted-foreground);margin-bottom:8px" }, "cwd: " + ap.cwd) : null,
    createElement("div", { style: "display:flex;gap:6px" },
      createElement("button", { class: "ui-btn-primary", style: "font-size:11px;padding:4px 10px;min-height:28px", onclick: () => resolveApproval(ap.id, "allow-once") }, "Allow once"),
      createElement("button", { class: "ui-btn-secondary", style: "font-size:11px;padding:4px 10px;min-height:28px", onclick: () => resolveApproval(ap.id, "allow-always") }, "Allow always"),
      createElement("button", { class: "ui-btn-ghost", style: "font-size:11px;padding:4px 10px;min-height:28px;color:var(--danger-soft-fg)", onclick: () => resolveApproval(ap.id, "deny") }, "Deny")
    )
  );
}

function renderMessage(line, agentId) {
  if (line.startsWith("user: ")) {
    const text = line.slice(6);
    return createElement("div", { style: "align-self:flex-end;max-width:65%;padding:10px 14px;border-radius:16px 16px 4px 16px;background:var(--chat-user-bg);font-size:13px;line-height:1.55;box-shadow:var(--shadow-2xs)", oncontextmenu: (e) => msgContextMenu(e, text, agentId, true) }, text);
  }
  if (line.startsWith("assistant: ")) {
    const text = line.slice(11);
    return createElement("div", { style: "max-width:68ch;padding:12px 16px;border-radius:4px 16px 16px 16px;background:var(--chat-assistant-bg);font-size:13px;line-height:1.6;white-space:pre-wrap;box-shadow:var(--shadow-2xs)", oncontextmenu: (e) => msgContextMenu(e, text, agentId, false) }, text);
  }
  if (line.startsWith("tool: ")) return createElement("div", { class: "ui-command-surface", style: "padding:8px 12px;font-family:var(--font-mono);font-size:12px" }, line.slice(6));
  return createElement("div", { style: "font-size:12px;color:var(--muted-foreground);font-family:var(--font-mono)" }, line);
}

function render(el) {
  const agent = getSelectedAgent();
  if (!agent) { applyDiff(el, createElement("div", { style: "display:flex;align-items:center;justify-content:center;height:100%;color:var(--muted-foreground)" }, "Select an agent to begin.")); return; }
  const approvals = state.pendingApprovals.filter(a => a.agentId === agent.agentId);
  const avatarSrc = avatarDataUrl(agent.avatarSeed || agent.agentId, 32);
  const hasOutput = agent.outputLines.length > 0 || agent.streamText || agent.thinkingTrace;

  const header = createElement("div", { style: "display:flex;align-items:center;gap:10px;padding:12px 16px;background:color-mix(in oklch,var(--surface-1) 92%,var(--surface-0));box-shadow:var(--shadow-2xs)" },
    createElement("img", { src: avatarSrc, width: "32", height: "32", style: "border-radius:var(--radius-small)" }),
    createElement("div", { style: "flex:1;min-width:0" },
      createElement("p", { style: "font-size:14px;font-weight:600;color:var(--foreground)" }, agent.name),
      createElement("p", { style: "font-size:11px;color:var(--muted-foreground)" }, agent.model || "claude-sonnet-4")
    ),
    createElement("div", { style: "display:flex;gap:4px" },
      createElement("button", { class: "ui-btn-icon", style: "font-size:12px", onclick: () => dispatch({ type: "showInspect", panel: "settings" }) }, "\u2699"),
      createElement("button", { class: "ui-btn-icon", style: "font-size:12px", onclick: () => dispatch({ type: "showInspect", panel: "brain" }) }, "\u{1F9E0}")
    )
  );

  const messages = createElement("div", { id: "oc-chat-scroll", style: "flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:10px" },
    !hasOutput ? createElement("div", { style: "display:flex;flex-direction:column;align-items:center;justify-content:center;flex:1;gap:12px" },
      createElement("img", { src: avatarSrc, width: "48", height: "48", style: "border-radius:var(--radius-small);opacity:0.7" }),
      createElement("p", { style: "font-size:14px;color:var(--muted-foreground)" }, introMsg(agent.agentId))
    ) : null,
    ...agent.outputLines.map(l => renderMessage(l, agent.agentId)),
    ...approvals.map(renderApproval),
    agent.thinkingTrace ? createElement("div", { style: "max-width:68ch;padding:10px 14px;border-radius:12px;background:color-mix(in oklch,var(--primary) 8%,transparent);font-size:12px;font-style:italic;color:var(--muted-foreground);box-shadow:var(--shadow-2xs)" }, "\u{1F4AD} " + agent.thinkingTrace) : null,
    agent.streamText ? createElement("div", { style: "max-width:68ch;padding:12px 16px;border-radius:4px 16px 16px 16px;background:var(--chat-assistant-bg);font-size:13px;line-height:1.6;white-space:pre-wrap;box-shadow:var(--shadow-2xs)" }, agent.streamText + "\u258C") : null
  );

  const input = createElement("div", { style: "display:flex;gap:8px;padding:12px 16px;background:color-mix(in oklch,var(--surface-1) 94%,var(--surface-0));box-shadow:0 -2px 8px rgba(0,0,0,.04)" },
    createElement("input", { class: "ui-input", style: "flex:1", placeholder: "Message " + agent.name + "...", value: agent.draft || "",
      oninput: (e) => dispatch({ type: "updateAgent", agentId: agent.agentId, patch: { draft: e.target.value } }),
      onkeydown: (e) => { if (e.key === "Enter" && agent.draft?.trim()) { sendChat(agent.agentId, agent.draft.trim()); dispatch({ type: "updateAgent", agentId: agent.agentId, patch: { draft: "" } }); } }
    }),
    agent.status === "running"
      ? createElement("button", { class: "ui-btn-ghost", style: "color:var(--danger-soft-fg);font-size:12px", onclick: () => dispatch({ type: "updateAgent", agentId: agent.agentId, patch: { status: "idle", streamText: null, thinkingTrace: null } }) }, "\u25A0 Stop")
      : createElement("button", { class: "ui-btn-primary", style: "font-size:12px", onclick: () => { if (agent.draft?.trim()) { sendChat(agent.agentId, agent.draft.trim()); dispatch({ type: "updateAgent", agentId: agent.agentId, patch: { draft: "" } }); } } }, "Send")
  );

  applyDiff(el, createElement("div", { style: "display:flex;flex-direction:column;height:100%" }, header, messages, input));
  const scroll = document.getElementById("oc-chat-scroll");
  if (scroll) scroll.scrollTop = scroll.scrollHeight;
}

export { render };
