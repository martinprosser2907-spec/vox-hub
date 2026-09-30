import { db, collection, query, orderBy, limit, onSnapshot, doc, updateDoc, arrayUnion } from "../fb.js";
import { esc, paras, when, toast } from "../ui.js";

export function render(view, ctx) {
  view.innerHTML = `<div class="card"><h2>Updates</h2><div id="u-list"></div></div>`;

  return onSnapshot(query(collection(db, "updates"), orderBy("date", "desc"), limit(40)), (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => u.published !== false);
    const box = document.getElementById("u-list");
    if (!rows.length) {
      box.innerHTML = `<div class="empty"><div class="ico">▤</div>
        <div class="t">No updates posted yet</div></div>`;
      return;
    }
    box.innerHTML = `<ul class="list">${rows.map(u => {
      const read = (u.readBy || []).includes(ctx.user.uid);
      return `<li>
        <div class="item-h">
          <span class="ttl">${esc(u.title)}</span>
          ${u.tag ? `<span class="tag brick">${esc(u.tag)}</span>` : ""}
          <time>${when(u.date)}</time>
        </div>
        <div style="margin-top:6px">${paras(u.body)}</div>
        <div class="item-h" style="margin-top:8px">
          ${u.author ? `<span class="small muted">${esc(u.author)}</span>` : "<span></span>"}
          ${read ? `<span class="tag">Read</span>`
                 : `<button class="vote btn-sm" data-read="${u.id}">Mark as read</button>`}
        </div></li>`;
    }).join("")}</ul>`;

    box.querySelectorAll("[data-read]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await updateDoc(doc(db, "updates", b.dataset.read), { readBy: arrayUnion(ctx.user.uid) }); }
      catch { toast("Could not record that."); b.disabled = false; }
    }));
  }, () => {
    document.getElementById("u-list").innerHTML = `<p class="muted small">Could not load updates.</p>`;
  });
}
