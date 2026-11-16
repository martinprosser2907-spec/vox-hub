// ---------------------------------------------------------------------------
// Updates — everyone reads them; admins write them and email them out.
//
// The body is a small, safe markdown (## heading, - bullet, **bold**,
// [text](https://link)). The same rules turn it into the hub page here and the
// email in functions/updates.js, so what you preview is what people receive.
// Sending is done by the sendUpdate function, which builds the recipient list
// on the server from the groups ticked here.
// ---------------------------------------------------------------------------
import {
  db, collection, query, orderBy, limit, onSnapshot, doc, addDoc, updateDoc, deleteDoc,
  arrayUnion, serverTimestamp, callable
} from "../fb.js";
import { esc, when, toast, tierOf } from "../ui.js";

const HUB_URL = "https://voxlondon.uk";
const GREY = "#3c3c3c", BRICK = "#f28d65", INK = "#1c1c1c", WASH = "#f6f6f6";

// ---- the shared little markdown --------------------------------------------
function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, `<a href="$2" target="_blank" rel="noopener">$1</a>`);
}
export function md(text, emailStyles = false) {
  const P  = emailStyles ? ` style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${INK};"` : "";
  const H2 = emailStyles ? ` style="margin:26px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:bold;color:${GREY};"` : ` style="font-size:17px;margin:18px 0 6px"`;
  const UL = emailStyles ? ` style="margin:0 0 16px;padding-left:22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${INK};"` : ` style="margin:0 0 12px;padding-left:22px"`;
  const blocks = String(text || "").replace(/\r/g, "").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return blocks.map(b => {
    if (b.startsWith("## ")) return `<h3${H2}>${inline(b.slice(3))}</h3>`;
    const lines = b.split("\n");
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) {
      return `<ul${UL}>${lines.map(l => `<li style="margin:0 0 6px">${inline(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p${P}>${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}

// A copy of functions/email.js wrapEmail(), for the preview only.
function emailPreview(u) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;background:${WASH};">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${WASH};"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#fff;border-collapse:collapse;">
    <tr><td style="background:${GREY};padding:26px 40px;"><span style="font-family:Arial,Helvetica,sans-serif;font-size:21px;font-weight:bold;letter-spacing:3px;color:#fff;">VOX</span><span style="font-family:Arial,Helvetica,sans-serif;font-size:14px;letter-spacing:2px;color:${BRICK};padding-left:10px;">LONDON</span></td></tr>
    <tr><td style="padding:40px 40px 8px;"><h1 style="margin:0 0 18px;font-family:Arial,Helvetica,sans-serif;font-size:25px;line-height:1.25;font-weight:normal;color:${INK};">${esc(u.title || "Your title")}</h1>${md(u.body, true)}</td></tr>
    <tr><td style="padding:12px 40px 34px;"><a href="#" style="display:inline-block;background:${BRICK};color:#fff;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:bold;text-decoration:none;padding:13px 26px;border-radius:4px;">${esc(u.ctaLabel || "Read it on the hub")}</a></td></tr>
    <tr><td style="background:${GREY};padding:20px 40px;"><p style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:rgba(255,255,255,0.6);">VOX London Hub &middot; you are receiving this because your organisation is part of the VOX London founding group. Questions: martin@voxhouses.global</p></td></tr>
  </table></td></tr></table></body></html>`;
}

const GROUPS = [
  ["members",  "Hub members", "everyone who can sign in to the hub"],
  ["signed",   "Signed charities", "main contact and Pledge signatory at each charity that has signed"],
  ["expected", "Expected to sign", "main contact at each charity expected to sign"]
];

export function render(view, ctx) {
  const isAdmin = tierOf(ctx.user.tier) >= 3;
  let rows = [];
  let editing = null;   // id being edited, or "new"

  view.innerHTML = `
    ${isAdmin ? `<div class="card" id="u-admin">
      <div class="item-h"><h2 style="margin:0">Write an update</h2>
        <button class="btn btn-sm" id="u-new">+ New update</button></div>
      <div id="u-editor" style="display:none;margin-top:14px"></div>
    </div>` : ""}
    <div class="card"><h2>Updates</h2><div id="u-list"></div></div>
    <div id="u-send"></div>`;

  // ---------- editor ----------
  function openEditor(u) {
    editing = u ? u.id : "new";
    const box = document.getElementById("u-editor");
    box.style.display = "block";
    box.innerHTML = `
      <label class="field"><span>Title</span><input id="ue-title" value="${esc(u?.title || "")}" placeholder="e.g. Ten charities signed, and our first site viewing"></label>
      <div class="grid g2" style="gap:14px">
        <label class="field" style="margin:0"><span>Label</span><input id="ue-tag" value="${esc(u?.tag || "Update")}" placeholder="Update"></label>
        <label class="field" style="margin:0"><span>Email subject (optional)</span><input id="ue-subject" value="${esc(u?.subject || "")}" placeholder="Same as the title if left blank"></label>
      </div>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin:14px 0 6px">
        <button class="vote btn-sm" data-ins="h">Heading</button>
        <button class="vote btn-sm" data-ins="b">Bold</button>
        <button class="vote btn-sm" data-ins="l">Bullet list</button>
        <button class="vote btn-sm" data-ins="a">Link</button>
        <span class="small muted" style="align-self:center">Blank line = new paragraph</span>
      </div>
      <textarea id="ue-body" style="width:100%;min-height:280px;font:inherit;font-size:14px;line-height:1.6;padding:12px;box-sizing:border-box">${esc(u?.body || "")}</textarea>
      <div class="grid g2" style="gap:14px;margin-top:10px">
        <label class="field" style="margin:0"><span>Button text</span><input id="ue-cta" value="${esc(u?.ctaLabel || "Read it on the hub")}"></label>
        <label class="field" style="margin:0"><span>Button link</span><input id="ue-href" value="${esc(u?.ctaHref || HUB_URL + "/#/updates")}"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:16px">
        <button class="btn" id="ue-publish">${u?.published ? "Save changes" : "Publish on the hub"}</button>
        <button class="vote" id="ue-draft">Save as draft</button>
        <button class="vote" id="ue-cancel">Cancel</button>
      </div>
      <h3 style="margin:22px 0 8px">Email preview</h3>
      <iframe id="ue-preview" style="width:100%;height:560px;border:1px solid #d2d2d2;border-radius:6px;background:#f6f6f6"></iframe>`;

    const ta = document.getElementById("ue-body");
    const read = () => ({
      title: document.getElementById("ue-title").value.trim(),
      tag: document.getElementById("ue-tag").value.trim(),
      subject: document.getElementById("ue-subject").value.trim(),
      body: ta.value,
      ctaLabel: document.getElementById("ue-cta").value.trim(),
      ctaHref: document.getElementById("ue-href").value.trim()
    });
    const preview = () => { document.getElementById("ue-preview").srcdoc = emailPreview(read()); };
    box.querySelectorAll("input,textarea").forEach(i => i.addEventListener("input", preview));
    preview();

    box.querySelectorAll("[data-ins]").forEach(b => b.addEventListener("click", (e) => {
      e.preventDefault();
      const s = ta.selectionStart, en = ta.selectionEnd, sel = ta.value.slice(s, en);
      const kind = b.dataset.ins;
      let ins;
      if (kind === "h") ins = `\n\n## ${sel || "Heading"}\n\n`;
      else if (kind === "b") ins = `**${sel || "bold text"}**`;
      else if (kind === "l") ins = "\n\n" + (sel ? sel.split("\n").map(x => "- " + x.replace(/^\s*[-•]\s+/, "")).join("\n") : "- First point\n- Second point") + "\n\n";
      else {
        const url = prompt("Link address (https://…)", "https://");
        if (!url || !/^https?:\/\//.test(url)) return;
        ins = `[${sel || "link text"}](${url})`;
      }
      ta.setRangeText(ins, s, en, "end");
      ta.focus();
      preview();
    }));

    const save = async (published) => {
      const v = read();
      if (!v.title || !v.body.trim()) { toast("Add a title and some text first."); return; }
      const data = { ...v, published, author: ctx.user.name || "VOX London", updatedAt: serverTimestamp() };
      try {
        if (editing === "new") await addDoc(collection(db, "updates"), { ...data, date: serverTimestamp(), readBy: [] });
        else await updateDoc(doc(db, "updates", editing), data);
        toast(published ? "Published on the hub" : "Saved as a draft");
        closeEditor();
      } catch (err) { toast("Could not save — " + (err.message || err)); }
    };
    document.getElementById("ue-publish").addEventListener("click", (e) => { e.preventDefault(); save(true); });
    document.getElementById("ue-draft").addEventListener("click", (e) => { e.preventDefault(); save(false); });
    document.getElementById("ue-cancel").addEventListener("click", (e) => { e.preventDefault(); closeEditor(); });
    document.getElementById("u-admin").scrollIntoView({ behavior: "smooth" });
  }
  function closeEditor() {
    editing = null;
    const box = document.getElementById("u-editor");
    if (box) { box.style.display = "none"; box.innerHTML = ""; }
  }
  if (isAdmin) document.getElementById("u-new").addEventListener("click", () => openEditor(null));

  // ---------- email it out ----------
  async function openSend(u) {
    const box = document.getElementById("u-send");
    box.innerHTML = `<div class="card" id="us-card">
      <h2 style="margin-top:0">Email “${esc(u.title)}”</h2>
      <p class="small muted">One email per person, from VOX London &lt;hub@voxlondon.uk&gt;. Replies come to martin@voxhouses.global.</p>
      <div id="us-groups">${GROUPS.map(([k, label, note]) => `
        <label style="display:flex;gap:8px;align-items:flex-start;margin:8px 0;font-size:14px">
          <input type="checkbox" value="${k}" ${k === "members" || k === "signed" ? "checked" : ""} style="width:auto;margin-top:4px">
          <span><strong>${label}</strong><br><span class="small muted">${note}</span></span></label>`).join("")}</div>
      <label class="field"><span>Also send to (optional, one address per line)</span>
        <textarea id="us-extra" style="width:100%;min-height:60px;font:inherit;padding:8px;box-sizing:border-box"></textarea></label>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="vote" id="us-test">Send me a test</button>
        <button class="vote" id="us-check">Check who will get it</button>
        <button class="vote" id="us-close">Close</button>
      </div>
      <div id="us-list" style="margin-top:14px"></div>
    </div>`;
    box.scrollIntoView({ behavior: "smooth" });
    const send = callable("sendUpdate");
    const opts = () => ({
      updateId: u.id,
      groups: [...box.querySelectorAll("#us-groups input:checked")].map(i => i.value),
      extra: document.getElementById("us-extra").value.split(/[\s,;]+/).map(s => s.trim()).filter(Boolean)
    });
    document.getElementById("us-close").onclick = () => { box.innerHTML = ""; };
    document.getElementById("us-test").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Sending…";
      try { const r = await send({ updateId: u.id, test: true }); toast("Test sent to " + r.data.to); }
      catch (err) { toast("Could not send — " + (err.message || err)); }
      e.target.disabled = false; e.target.textContent = "Send me a test";
    };
    document.getElementById("us-check").onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = "Checking…";
      const listBox = document.getElementById("us-list");
      try {
        const r = await send({ ...opts(), dryRun: true });
        const people = r.data.recipients || [];
        listBox.innerHTML = people.length ? `
          <p><strong>${people.length} ${people.length === 1 ? "person" : "people"}</strong> — untick anyone to leave out.</p>
          <div style="max-height:320px;overflow:auto;border:1px solid #d2d2d2;border-radius:6px;padding:6px 10px">
            ${people.map(p => `<label style="display:flex;gap:8px;align-items:center;font-size:13px;margin:4px 0">
              <input type="checkbox" checked data-email="${esc(p.email)}" style="width:auto">
              <span>${esc(p.name || p.email)} <span class="muted">· ${esc(p.email)} · ${esc(p.group)}</span></span></label>`).join("")}
          </div>
          <button class="btn" id="us-go" style="margin-top:12px">Send to these people</button>`
          : `<p class="muted">Nobody in those groups. Tick another group or add addresses.</p>`;
        const go = document.getElementById("us-go");
        if (go) go.onclick = async () => {
          const exclude = [...listBox.querySelectorAll("input[data-email]:not(:checked)")].map(i => i.dataset.email);
          const n = people.length - exclude.length;
          if (!n) { toast("Everyone is unticked."); return; }
          if (!confirm(`Send “${u.title}” to ${n} ${n === 1 ? "person" : "people"} now?\n\nThis cannot be undone.`)) return;
          go.disabled = true; go.textContent = "Sending…";
          try {
            const r2 = await send({ ...opts(), exclude });
            toast(`Sent to ${r2.data.sent} people`);
            box.innerHTML = "";
          } catch (err) { toast("Could not send — " + (err.message || err)); go.disabled = false; go.textContent = "Send to these people"; }
        };
      } catch (err) { listBox.innerHTML = `<p class="muted">Could not check: ${esc(err.message || err)}</p>`; }
      e.target.disabled = false; e.target.textContent = "Check who will get it";
    };
  }

  // ---------- the list ----------
  return onSnapshot(query(collection(db, "updates"), orderBy("date", "desc"), limit(40)), (snap) => {
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(u => isAdmin || u.published !== false);
    const box = document.getElementById("u-list");
    if (!rows.length) {
      box.innerHTML = `<div class="empty"><div class="ico">▤</div>
        <div class="t">No updates posted yet</div></div>`;
      return;
    }
    box.innerHTML = `<ul class="list">${rows.map(u => {
      const read = (u.readBy || []).includes(ctx.user.uid);
      const sends = Array.isArray(u.sends) ? u.sends : [];
      const last = sends[sends.length - 1];
      return `<li>
        <div class="item-h">
          <span class="ttl">${esc(u.title)}</span>
          ${u.published === false ? `<span class="tag">Draft</span>` : u.tag ? `<span class="tag brick">${esc(u.tag)}</span>` : ""}
          <time>${when(u.date)}</time>
        </div>
        <div style="margin-top:6px">${md(u.body)}</div>
        <div class="item-h" style="margin-top:8px">
          ${u.author ? `<span class="small muted">${esc(u.author)}${isAdmin && last ? ` · emailed to ${last.count} on ${when(last.at)}` : ""}</span>` : "<span></span>"}
          <span style="display:flex;gap:6px;flex-wrap:wrap">
            ${isAdmin ? `<button class="vote btn-sm" data-edit="${u.id}">Edit</button>
                         <button class="vote btn-sm" data-send="${u.id}">✉ Email it out</button>
                         <button class="vote btn-sm" data-del="${u.id}">Delete</button>` : ""}
            ${read ? `<span class="tag">Read</span>`
                   : `<button class="vote btn-sm" data-read="${u.id}">Mark as read</button>`}
          </span>
        </div></li>`;
    }).join("")}</ul>`;

    box.querySelectorAll("[data-read]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      try { await updateDoc(doc(db, "updates", b.dataset.read), { readBy: arrayUnion(ctx.user.uid) }); }
      catch { toast("Could not record that."); b.disabled = false; }
    }));
    box.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => openEditor(rows.find(r => r.id === b.dataset.edit))));
    box.querySelectorAll("[data-send]").forEach(b => b.addEventListener("click", () => {
      const u = rows.find(r => r.id === b.dataset.send);
      if (u.published === false) { toast("Publish it first, then email it out."); return; }
      openSend(u);
    }));
    box.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if (!confirm("Delete this update from the hub? Emails already sent are not affected.")) return;
      try { await deleteDoc(doc(db, "updates", b.dataset.del)); toast("Deleted"); }
      catch (err) { toast("Could not delete — " + (err.message || err)); }
    }));
  }, () => {
    document.getElementById("u-list").innerHTML = `<p class="muted small">Could not load updates.</p>`;
  });
}
