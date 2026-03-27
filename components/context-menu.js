import { createElement, applyDiff } from "webjsx";

let menuEl = null;
let menuOpen = false;
let menuX = 0;
let menuY = 0;
let menuItems = [];

function show(e, items, el) {
  e.preventDefault();
  e.stopPropagation();
  menuEl = el;
  menuOpen = true;
  menuItems = items;
  const vw = window.innerWidth, vh = window.innerHeight;
  menuX = e.clientX;
  menuY = e.clientY;
  if (menuX + 200 > vw) menuX = vw - 210;
  if (menuY + items.length * 38 + 16 > vh) menuY = vh - items.length * 38 - 20;
  render();
}

function hide() {
  menuOpen = false;
  menuItems = [];
  render();
}

function render() {
  if (!menuEl) return;
  if (!menuOpen) {
    menuEl.innerHTML = "";
    return;
  }
  const overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;inset:0;z-index:9998";
  overlay.addEventListener("click", () => hide());
  overlay.addEventListener("contextmenu", (e) => { e.preventDefault(); hide(); });

  const menu = document.createElement("div");
  menu.className = "ui-context-menu";
  menu.style.cssText = "position:fixed;left:" + menuX + "px;top:" + menuY + "px;z-index:9999";

  menuItems.forEach(item => {
    if (item.sep) {
      const sep = document.createElement("div");
      sep.className = "ui-context-menu-sep";
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement("button");
    btn.className = "ui-context-menu-item" + (item.danger ? " danger" : "");
    if (item.icon) {
      const icon = document.createElement("span");
      icon.style.cssText = "opacity:.7;display:inline-flex;align-items:center";
      icon.innerHTML = item.icon;
      btn.appendChild(icon);
    }
    btn.appendChild(document.createTextNode(item.label));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      hide();
      if (item.action) item.action();
    });
    menu.appendChild(btn);
  });

  menuEl.innerHTML = "";
  menuEl.appendChild(overlay);
  menuEl.appendChild(menu);

  const escHandler = (e) => {
    if (e.key === "Escape") { hide(); window.removeEventListener("keydown", escHandler, true); }
  };
  window.addEventListener("keydown", escHandler, true);
}

function init(el) { menuEl = el; }

export { show, hide, init };
