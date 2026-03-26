import { createElement, applyDiff } from "webjsx";
import { dispatch, uid } from "../store.js";
import { avatarDataUrl } from "../avatar.js";

let modalState = { open: false, name: "New Agent", avatarSeed: "", busy: false };

function open(el) {
  modalState = { open: true, name: "New Agent", avatarSeed: uid(), busy: false };
  render(el);
}

function close(el) {
  modalState.open = false;
  render(el);
}

function submit(el) {
  if (!modalState.name.trim() || modalState.busy) return;
  modalState.busy = true;
  render(el);
  setTimeout(() => {
    modalState.open = false;
    modalState.busy = false;
    dispatch({ type: "addAgent", seed: { agentId: uid(), name: modalState.name.trim(), avatarSeed: modalState.avatarSeed, sessionKey: uid() } });
  }, 300);
}

function render(el) {
  if (!modalState.open) { applyDiff(el, createElement("div", null)); return; }
  const avatarSrc = avatarDataUrl(modalState.avatarSeed, 64);
  const vdom = createElement("div", {
    style: "position:fixed;inset:0;z-index:120;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,0.6);padding:16px",
    onclick: (e) => { if (e.target === e.currentTarget && !modalState.busy) close(el); }
  },
    createElement("div", { class: "ui-panel", style: "width:100%;max-width:520px", onclick: (e) => e.stopPropagation() },
      createElement("div", { style: "display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid color-mix(in oklch,var(--border) 35%,transparent);padding:20px 24px" },
        createElement("div", null,
          createElement("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:0.06em;color:var(--muted-foreground)" }, "New agent"),
          createElement("div", { style: "margin-top:4px;font-size:16px;font-weight:600;color:var(--foreground)" }, "Launch agent"),
          createElement("div", { style: "margin-top:4px;font-size:12px;color:var(--muted-foreground)" }, "Name it and activate immediately.")
        ),
        createElement("button", { class: "ui-btn-ghost", style: "font-family:var(--font-mono);font-size:11px;font-weight:600", onclick: () => close(el), disabled: modalState.busy }, "Close")
      ),
      createElement("div", { style: "display:grid;gap:14px;padding:20px 24px" },
        createElement("label", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;letter-spacing:0.05em;color:var(--muted-foreground)" },
          "Name",
          createElement("input", { class: "ui-input", style: "display:block;width:100%;margin-top:4px", value: modalState.name, oninput: (e) => { modalState.name = e.target.value; } })
        ),
        createElement("div", { style: "font-size:11px;color:var(--muted-foreground);margin-top:-8px" }, "You can rename this agent from the main chat header."),
        createElement("div", { style: "display:grid;justify-items:center;gap:8px;border-top:1px solid color-mix(in oklch,var(--border) 40%,transparent);padding-top:12px" },
          createElement("div", { style: "font-family:var(--font-mono);font-size:11px;font-weight:600;color:var(--muted-foreground)" }, "Choose avatar"),
          createElement("img", { src: avatarSrc, width: "64", height: "64", style: "border-radius:var(--radius-small)" }),
          createElement("button", { class: "ui-btn-secondary", style: "font-size:12px;gap:6px;display:inline-flex;align-items:center", onclick: () => { modalState.avatarSeed = uid(); render(el); }, disabled: modalState.busy }, "\u21BB Shuffle")
        )
      ),
      createElement("div", { style: "display:flex;align-items:center;justify-content:space-between;border-top:1px solid color-mix(in oklch,var(--border) 45%,transparent);padding:16px 24px" },
        createElement("div", { style: "font-size:11px;color:var(--muted-foreground)" }, "Authority can be configured after launch."),
        createElement("button", { class: "ui-btn-primary", style: "font-size:11px", onclick: () => submit(el), disabled: !modalState.name.trim() || modalState.busy }, modalState.busy ? "Launching..." : "Launch agent")
      )
    )
  );
  applyDiff(el, vdom);
}

export { render, open, close };
