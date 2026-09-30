// ---------------------------------------------------------------------------
// The menu comes out of the database, not out of this file. Add a page to the
// `pages` collection and it appears for the right people, with no deploy.
//
// The idea is lifted from EGBC's hubPages registry, collapsed from its two
// axes to one tier.
// ---------------------------------------------------------------------------
import { db, collection, query, orderBy, onSnapshot } from "./fb.js";
import { $, esc, tierOf, TIER_LABEL } from "./ui.js";

export function mountNav(user, onPages) {
  const badge = $("#tier-badge");
  const t = tierOf(user.tier);
  badge.textContent = TIER_LABEL[t] || "No access";
  badge.className = "tierbadge" + (t === 2 ? " t2" : t === 3 ? " t3" : "");

  // The rules refuse any page above this person's tier, so what comes back is
  // already filtered — the browser is not deciding anything.
  return onSnapshot(query(collection(db, "pages"), orderBy("order")), (snap) => {
    const pages = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(p => p.enabled !== false);

    const groups = [];
    for (const p of pages) {
      const name = p.group
        || (p.minTier >= 3 ? "Admin"
          : p.minTier >= 2 ? "Steering Group"
          : "The project");
      let g = groups.find(x => x.name === name);
      if (!g) groups.push(g = { name, items: [] });
      g.items.push(p);
    }

    $("#nav").innerHTML = groups.map(g => `
      <div class="nav-group">${esc(g.name)}</div>
      ${g.items.map(p => p.external
        ? `<a href="${esc(p.url)}" target="_blank" rel="noopener">
             <span class="ico" aria-hidden="true">${esc(p.icon || "□")}</span>${esc(p.title)}
             <span class="ext" aria-label="opens in a new tab">&#8599;</span></a>`
        : `<a href="#/${esc(p.id)}" data-id="${esc(p.id)}">
             <span class="ico" aria-hidden="true">${esc(p.icon || "□")}</span>${esc(p.title)}</a>`
      ).join("")}`).join("");

    onPages(pages);
  }, (err) => {
    console.error("menu", err);
    $("#nav").innerHTML = `<div class="nav-group">Menu unavailable</div>`;
    onPages([]);
  });
}
