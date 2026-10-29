// Hash routing. One file served from one address, so no server rewrites and
// no 404 dance on a static host.
import { $ } from "./ui.js";
import { esc, toast } from "./ui.js";

// Names for the handful of pages somebody can arrive at without having access
// to them. Only the taskbar shortcuts make that possible — the menu never
// shows a page you cannot open — so before they existed this never happened
// and a silent redirect was fine. It is not fine now: clicking "Document
// store" and landing on Progress with no explanation reads as a broken app.
const PAGE_NAMES = {
  documents: "The document store", tracker: "The progress tracker",
  planning: "Planning tools", people: "People and access",
  planner: "The VOX planner"
};

let ctx = null, pages = [], cleanup = null;
const cache = new Map();

export function setPages(list) { pages = list; if (ctx) go(); }

export function start(context) {
  ctx = context;
  addEventListener("hashchange", go);
}

async function go() {
  if (!pages.length) return;
  const want = (location.hash.replace(/^#\/?/, "") || "").split("?")[0];
  const page = pages.find(p => p.id === want && !p.external) || pages.find(p => !p.external);
  if (!page) return;
  if (page.id !== want) {
    if (want) {
      toast(`${PAGE_NAMES[want] || "That page"} is not part of your access.`);
    }
    location.replace("#/" + page.id);
    return;
  }

  if (cleanup) { try { cleanup(); } catch {} cleanup = null; }

  $("#page-title").textContent = page.title;
  document.title = page.title + " — VOX London Hub";
  document.querySelectorAll("#nav a[data-id]").forEach(a =>
    a.classList.toggle("on", a.dataset.id === page.id));
  $("#side")?.classList.remove("open");
  document.querySelector(".scrim")?.remove();

  const view = $("#view");
  view.innerHTML = `<div class="card"><div class="skel"></div><div class="skel" style="width:60%"></div></div>`;

  const name = page.view || page.id;
  try {
    let mod = cache.get(name);
    if (!mod) {
      // A page can exist in the database before its view exists in the code —
      // that is the whole point of keeping the menu in Firestore. Fall back to
      // the "not built yet" placeholder rather than throwing a module error at
      // somebody who only clicked a menu item.
      try {
        mod = await import(`./views/${name}.js`);
        cache.set(name, mod);
      } catch (missing) {
        // Deliberately NOT cached. A view can be missing for two very
        // different reasons: it was never built, or it was deployed a moment
        // ago and this tab asked a second too early. Caching the placeholder
        // treats the second as the first — one unlucky click and the page is
        // stuck on "next on the list" for the life of the tab, no matter what
        // is actually on the server by then. That cost half an hour on
        // 20 Oct 2026, with everything deployed and working.
        console.info(`no view for "${name}" — placeholder, will retry next time`);
        mod = await import("./views/soon.js");
      }
    }
    const stop = await mod.render(view, ctx, page);
    if (typeof stop === "function") cleanup = stop;
  } catch (err) {
    console.error(err);
    view.innerHTML = `<div class="card">
      <h3>That page would not load</h3>
      <p class="muted">${esc(err.message || String(err))}</p>
      <p class="small muted">If it keeps happening, tell Martin what you were opening.</p></div>`;
  }
  view.focus({ preventScroll: true });
}
