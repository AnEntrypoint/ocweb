import { createElement, applyDiff } from "webjsx";
import { state, dispatch } from "../store.js";

const STATUS_LABELS = { disconnected: "Disconnected", connecting: "Connecting", connected: "Connected", reconnecting: "Reconnecting", error: "Error" };
const STATUS_BADGE = { disconnected: "ui-badge-status-disconnected", connecting: "ui-badge-status-connecting", connected: "ui-badge-status-connected", reconnecting: "ui-badge-status-connecting", error: "ui-badge-status-error" };

let menuOpen = false;

function sunIcon() { return createElement("span", { style: "font-size:14px" }, "\u2600"); }
function moonIcon() { return createElement("span", { style: "font-size:14px" }, "\u263E"); }
function plugIcon() { return createElement("span", { style: "font-size:14px" }, "\u26A1"); }

function render(el) {
  const s = state.gatewayStatus;
  const vdom = createElement("div", { class: "ui-topbar", style: "position:relative;z-index:180" },
    createElement("div", { style: "display:grid;grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);align-items:center;height:40px;padding:0 16px" },
      createElement("div", null),
      createElement("p", { style: "font-size:14px;font-weight:600;color:var(--foreground);letter-spacing:0.01em" }, "OpenClaw Studio"),
      createElement("div", { style: "display:flex;align-items:center;justify-content:flex-end;gap:6px" },
        createElement("span", { class: "ui-chip " + STATUS_BADGE[s], style: "font-size:9px" }, STATUS_LABELS[s]),
        createElement("button", { class: "ui-btn-icon", onclick: () => {
          dispatch({ type: "setTheme", theme: state.theme === "dark" ? "light" : "dark" }); render(el);
        }}, state.theme === "dark" ? sunIcon() : moonIcon()),
        createElement("div", { style: "position:relative;z-index:210" },
          createElement("button", { class: "ui-btn-icon", onclick: () => { menuOpen = !menuOpen; render(el); } }, plugIcon()),
          menuOpen ? createElement("div", { class: "ui-card ui-menu-popover", style: "position:absolute;right:0;top:32px;min-width:176px;padding:4px;z-index:260" },
            createElement("button", { class: "ui-btn-ghost", style: "width:100%;justify-content:flex-start;border:0;padding:8px 12px;font-size:12px;font-weight:500" ,
              onclick: () => { menuOpen = false; dispatch({ type: "showConnection", show: true }); render(el); }
            }, "Gateway connection")
          ) : null
        )
      )
    )
  );
  applyDiff(el, vdom);
}

export { render };
