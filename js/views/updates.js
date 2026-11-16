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
  arrayUnion, serverTimestamp, callable, storage, storageRef, uploadBytesResumable, getDownloadURL
} from "../fb.js";
import { esc, when, toast, tierOf } from "../ui.js";

const HUB_URL = "https://voxlondon.uk";

// The email template, shared with functions/updateEmail.js (identical copy),
// so the preview and the hub page match what people receive.
import { renderUpdateEmail, mdToHtml } from "../updateEmail.js";
const md = (text) => mdToHtml(text);
const longDate = (ts) => {
  const d = ts && ts.toDate ? ts.toDate() : new Date();
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};

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
        <button class="vote btn-sm" id="ue-photo">📷 Add photos</button>
        <button class="vote btn-sm" id="ue-file">📎 Attach a file</button>
        <input type="file" id="ue-photo-in" accept="image/*" multiple hidden>
        <input type="file" id="ue-file-in" multiple hidden>
        <span class="small muted" id="ue-up" style="align-self:center"></span>
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
    const preview = () => { const v = read(); document.getElementById("ue-preview").srcdoc = renderUpdateEmail({ ...v, dateText: longDate(u?.date), ctaHref: v.ctaHref || HUB_URL + "/#/updates" }); };
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

    // ---- photos and files ----
    // Photos are shrunk to 1600px wide before upload, so emails stay light.
    const shrink = (file) => new Promise((resolve) => {
      if (!/^image\/(jpeg|png|webp)$/.test(file.type)) return resolve(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1600 / img.width);
        if (scale === 1 && file.size < 1.5 * 1024 * 1024) return resolve(file);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(b => resolve(b ? new File([b], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" }) : file), "image/jpeg", 0.85);
      };
      img.onerror = () => resolve(file);
      img.src = URL.createObjectURL(file);
    });
    const upload = async (file) => {
      const safe = file.name.replace(/[^\w.\-]+/g, "_").slice(-80);
      const ref = storageRef(storage, `updates/${Date.now()}-${safe}`);
      const task = uploadBytesResumable(ref, file, { contentType: file.type || "application/octet-stream" });
      await new Promise((ok, fail) => task.on("state_changed",
        s => { document.getElementById("ue-up").textContent = `Uploading ${file.name}… ${Math.round(s.bytesTransferred / s.totalBytes * 100)}%`; },
        fail, ok));
      return getDownloadURL(task.snapshot.ref);
    };
    const insertBlock = (text) => {
      const pos = ta.selectionEnd;
      ta.setRangeText(`\n\n${text}\n\n`, pos, pos, "end");
      ta.focus(); preview();
    };
    document.getElementById("ue-photo").onclick = (e) => { e.preventDefault(); document.getElementById("ue-photo-in").click(); };
    document.getElementById("ue-file").onclick = (e) => { e.preventDefault(); document.getElementById("ue-file-in").click(); };
    document.getElementById("ue-photo-in").onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = "";
      const lines = [];
      for (const f of files) {
        if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB`); continue; }
        try {
          const url = await upload(await shrink(f));
          const cap = prompt(`Caption for ${f.name} (optional)`, "") || "";
          lines.push(`![${cap.replace(/[\[\]]/g, "")}](${url})`);
        } catch (err) { toast("Upload failed — " + (err.message || err)); }
      }
      document.getElementById("ue-up").textContent = "";
      if (lines.length) insertBlock(lines.join("\n"));
    };
    document.getElementById("ue-file-in").onchange = async (e) => {
      const files = [...e.target.files]; e.target.value = "";
      const lines = [];
      for (const f of files) {
        if (f.size > 20 * 1024 * 1024) { toast(`${f.name} is over 20 MB`); continue; }
        try { lines.push(`- [📎 ${f.name.replace(/[\[\]]/g, "")}](${await upload(f)})`); }
        catch (err) { toast("Upload failed — " + (err.message || err)); }
      }
      document.getElementById("ue-up").textContent = "";
      if (lines.length) insertBlock(lines.join("\n"));
    };

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
