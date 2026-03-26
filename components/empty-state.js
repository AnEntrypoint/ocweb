import { createElement } from "webjsx";

function renderEmptyState(title, compact) {
  return createElement("div", { style: "display:flex;flex-direction:column;align-items:center;justify-content:center;padding:" + (compact ? "12px" : "48px 20px") + ";color:var(--muted-foreground)" },
    createElement("p", { style: "font-size:" + (compact ? "12px" : "14px") }, title || "Nothing here yet.")
  );
}

export { renderEmptyState };
