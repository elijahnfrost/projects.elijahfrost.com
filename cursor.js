/**
 * Custom cursor — ported from elijahfrost.com production bundle
 * (_next/static/chunks/0h-opkp2ru_r0.js): same smoothing (0.45), scale L(),
 * centroid transform-origin, pointer/interactive detection, and visibility rules.
 */
(function bootstrapCustomCursor() {
  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const coarsePointer =
    typeof window !== "undefined" &&
    window.matchMedia("(pointer: coarse)").matches;

  if (prefersReduced || coarsePointer) return;

  /* Hold the tracer behind the loading screen so the custom cursor only takes
     over the page once the real directory is rendered. script.js sets
     `data-loaded` on <html> and fires `page:loaded` when that happens. */
  if (document.documentElement.hasAttribute("data-loaded")) {
    initCustomCursor();
    return;
  }
  document.addEventListener("page:loaded", initCustomCursor, { once: true });
})();

function initCustomCursor() {
  const p65 = (65 * Math.PI) / 180;
  function g(n) {
    return Math.round(n * 1e3) / 1e3;
  }
  const cos = Math.cos(p65);
  const sin = Math.sin(p65);
  const n = -sin;
  const s = cos;
  const i = 20.5 * cos;
  const o = 20.5 * sin;
  const a = g(i + 7.25 * n);
  const l = g(o + 7.25 * s);
  const c = g(i - 7.25 * n);
  const u = g(o - 7.25 * s);
  const m = g(i - 2.75 * cos);
  const d = g(o - 2.75 * sin);
  const PATH = `M0 0 L${a} ${l} L${m} ${d} L${c} ${u} Z`;
  const verts = [
    [0, 0],
    [a, l],
    [m, d],
    [c, u],
  ];
  const E =
    verts.reduce((acc, v) => acc + v[0], 0) / verts.length;
  const X_ORIG =
    verts.reduce((acc, v) => acc + v[1], 0) / verts.length;

  function Lscale(interactive, extra) {
    return 1.12 * (interactive ? 1.14 : 1) * (extra ? 1.08 : 1);
  }

  function inViewport(cx, cy) {
    return (
      cx >= 0 &&
      cy >= 0 &&
      cx < window.innerWidth &&
      cy < window.innerHeight
    );
  }

  function isInteractiveTarget(el) {
    let t = el;
    while (t && t !== document.documentElement) {
      const parts = getComputedStyle(t).cursor
        .split(",")
        .map((p) =>
          p
            .trim()
            .replace(/url\([^)]+\)\s*(\d+\s*(,\s*\d+)?\s*)?/gi, "")
            .trim()
            .split(/\s+/)[0] ?? ""
        );
      for (let idx = parts.length - 1; idx >= 0; idx--) {
        const r = parts[idx];
        if (
          r &&
          r !== "auto" &&
          [
            "pointer",
            "grab",
            "grabbing",
            "zoom-in",
            "zoom-out",
            "alias",
            "copy",
            "cell",
            "context-menu",
            "help",
            "move",
            "col-resize",
            "row-resize",
            "ew-resize",
            "ns-resize",
            "nesw-resize",
            "nwse-resize",
            "n-resize",
            "e-resize",
            "s-resize",
            "w-resize",
            "ne-resize",
            "nw-resize",
            "se-resize",
            "sw-resize",
          ].includes(r)
        ) {
          return true;
        }
      }
      const tag = t.tagName;
      if (tag === "A" && t.href) return true;
      if (tag === "BUTTON" || tag === "SUMMARY" || tag === "SELECT")
        return true;
      if (tag === "INPUT") {
        const ty = (t.type || "text").toLowerCase();
        if (
          [
            "submit",
            "button",
            "reset",
            "checkbox",
            "radio",
            "file",
            "color",
            "range",
            "date",
          ].includes(ty)
        )
          return true;
      }
      if (
        t.getAttribute("role") === "button" ||
        t.getAttribute("role") === "link" ||
        t.getAttribute("role") === "tab" ||
        (t.getAttribute("tabindex") === "0" &&
          t.getAttribute("role") !== "presentation")
      ) {
        return true;
      }
      t = t.parentElement;
    }
    return false;
  }

  function hasTextSelection() {
    const sel = document.getSelection();
    return !!(sel && sel.rangeCount > 0 && !sel.isCollapsed);
  }

  const rootEl = document.documentElement;
  rootEl.dataset.cursorCustom = "";

  const wrapper = document.createElement("div");
  wrapper.dataset.cursorRoot = "";
  wrapper.className = "cursor-root";
  wrapper.setAttribute("aria-hidden", "true");

  const inner = document.createElement("div");
  inner.className = "cursor-inner";

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("width", "30");
  svg.setAttribute("height", "30");
  svg.setAttribute("viewBox", "0 0 30 30");
  svg.setAttribute("fill", "none");
  svg.setAttribute("shape-rendering", "geometricPrecision");
  const pathFill = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  pathFill.setAttribute("d", PATH);
  pathFill.setAttribute("fill", "var(--cursor-arrow-fill)");
  pathFill.setAttribute("stroke", "none");
  const pathStroke = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "path"
  );
  pathStroke.setAttribute("d", PATH);
  pathStroke.setAttribute("fill", "none");
  pathStroke.setAttribute("stroke", "var(--color-bg-page)");
  pathStroke.setAttribute("stroke-width", "1.35");
  pathStroke.setAttribute("stroke-linejoin", "miter");
  pathStroke.setAttribute("stroke-miterlimit", "2.75");
  svg.append(pathFill, pathStroke);
  inner.appendChild(svg);
  wrapper.appendChild(inner);
  document.body.appendChild(wrapper);

  const target = { x: 0, y: 0 };
  const smooth = { x: 0, y: 0 };
  let mouseButtons = 0;
  let interactive = false;
  let firstMove = false;
  let raf = 0;

  const applyScale = () => {
    const extra =
      mouseButtons !== 0 || hasTextSelection();
    const sc = Lscale(interactive, extra);
    inner.style.transform = `scale(${sc})`;
    inner.style.transformOrigin = `${E}px ${X_ORIG}px`;
  };

  const tick = () => {
    smooth.x += (target.x - smooth.x) * 0.45;
    smooth.y += (target.y - smooth.y) * 0.45;
    wrapper.style.transform = `translate3d(${smooth.x}px, ${smooth.y}px, 0)`;
    raf = requestAnimationFrame(tick);
  };

  const setVisibility = (v) => {
    const vis = v ? "visible" : "hidden";
    const op = v ? 1 : 0;
    wrapper.style.visibility = vis;
    wrapper.style.opacity = String(op);
  };

  const onMouseMove = (e) => {
    if (!inViewport(e.clientX, e.clientY)) {
      setVisibility(false);
      return;
    }
    const x = e.clientX;
    const y = e.clientY;
    if (!firstMove) {
      firstMove = true;
      smooth.x = x;
      smooth.y = y;
      target.x = x;
      target.y = y;
      wrapper.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
    mouseButtons = e.buttons;
    const hit = document.elementFromPoint(x, y);
    interactive = hit ? isInteractiveTarget(hit) : false;
    applyScale();
    target.x = x;
    target.y = y;
    setVisibility(true);
  };

  const onMouseButton = (e) => {
    mouseButtons = e.buttons;
    applyScale();
  };

  const onSelectionChange = () => {
    applyScale();
  };

  const hide = () => setVisibility(false);

  raf = requestAnimationFrame(tick);

  window.addEventListener("mousemove", onMouseMove, { passive: true });
  window.addEventListener("mousedown", onMouseButton, { passive: true });
  window.addEventListener("mouseup", onMouseButton, { passive: true });
  window.addEventListener("blur", hide);
  document.addEventListener("selectionchange", onSelectionChange);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") hide();
  });
  rootEl.addEventListener("mouseleave", hide);

  inner.style.transformOrigin = `${E}px ${X_ORIG}px`;
  inner.style.transition =
    "transform 0.1s cubic-bezier(0.22, 1, 0.36, 1)";
  wrapper.style.transition = "opacity 0.06s ease-out";
  wrapper.style.opacity = "0";
  wrapper.style.visibility = "hidden";

  window.addEventListener(
    "beforeunload",
    () => {
      cancelAnimationFrame(raf);
      delete rootEl.dataset.cursorCustom;
    },
    { once: true }
  );
}
