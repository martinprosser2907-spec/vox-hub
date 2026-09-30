import { db, collection, query, orderBy, getDocs } from "../fb.js";
import { esc, when, empty } from "../ui.js";

export async function render(view) {
  let rows = [];
  try {
    const snap = await getDocs(query(collection(db, "gallery"), orderBy("date", "desc")));
    rows = snap.docs.map(d => d.data());
  } catch {}

  view.innerHTML = rows.length
    ? `<div class="card"><h2>Photo gallery</h2><div class="gallery">${rows.map(g => `
         <figure><img src="${esc(g.url)}" alt="${esc(g.caption || "VOX")}" loading="lazy">
         <figcaption>${esc(g.caption || "")}${g.date ? " · " + when(g.date) : ""}</figcaption>
         </figure>`).join("")}</div></div>`
    : empty("▣", "No photographs yet",
            "Pictures from Copenhagen, Stockholm and our own sessions will appear here.");
}
