// ---------------------------------------------------------------------------
// Document store — Steering Group and above.
//
// Papers, minutes and drafts. Files live in Firebase Storage under
// documents/<uid>/<timestamp>-<name>; the record of each one lives in the
// `documents` collection. Two places, deliberately: Storage holds the bytes,
// Firestore holds everything you want to search, order and show without
// downloading anything.
//
// Links are stored in the same collection with kind:"link" and no storagePath,
// so a Google Doc and a PDF sit side by side in one list. Lifted from the
// shape of EGBC's resources.html, which has been carrying this for a year.
//
// Who can do what — enforced in firestore.rules and storage.rules, not here:
//   read    steering and above
//   add     steering and above
//   delete  only VOX, or the person who added it
//
// Drag and drop: this is the closest the hub gets to a shared folder, and it
// is deliberately the cheap version of one. Drop files anywhere on the page
// and they go in, several at a time, each titled from its own filename.
// ---------------------------------------------------------------------------
import {
  db, storage, collection, query, orderBy, onSnapshot, addDoc, doc, deleteDoc,
  serverTimestamp, storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "../fb.js";
import { esc, when, toast, tierOf } from "../ui.js";

const FOLDERS = ["Steering Group", "Property", "Legal", "Finance", "The Pledge", "Other"];
const MAX_MB = 25;

const sizeOf = (b) => !b ? "" :
  b < 1024 ? b + " B" :
  b < 1048576 ? (b / 1024).toFixed(0) + " KB" :
  (b / 1048576).toFixed(1) + " MB";

const safeName = (n) => String(n).replace(/[^\w.\-]/g, "-").slice(0, 120);

// "Heads of terms v3.pdf" -> "Heads of terms v3". Dropping twenty files is no
// use if each one arrives called "Untitled", and nobody is going to type a
// title twenty times — so the filename becomes the title and they can rename
// later if they care.
const titleFromName = (n) => String(n).replace(/\.[^.]{1,8}$/, "").replace(/[_-]+/g, " ").trim() || n;

export function render(view, ctx) {
  const isAdmin = tierOf(ctx.user.tier) >= 3;

  view.innerHTML = `
    <div class="card">
      <h2>Add a document</h2>
      <p class="small muted" style="margin-top:-8px">
        Visible to the Steering Group only. Up to ${MAX_MB}&nbsp;MB a file.
        You can also drag files straight onto this page.
      </p>

      <div class="item-h" style="gap:8px;margin-bottom:16px">
        <button class="vote on" id="tab-file" type="button">Upload a file</button>
        <button class="vote" id="tab-link" type="button">Add a link</button>
      </div>

      <!-- novalidate: the browser's own validation cannot be used on this form.
           The link field and the file field swap in and out, and a hidden field
           holding an invalid value blocks submit with NO message on screen and
           "not focusable" in the console — so someone who typed a bad address,
           then switched to Upload a file, could never submit anything again and
           was told nothing. Every check below is done in the handler instead,
           in words a person can act on. -->
      <form id="d-form" novalidate>
        <div class="grid g2" style="gap:14px">
          <label class="field" style="margin:0"><span>Title</span>
            <input type="text" id="d-title" placeholder="Heads of terms, draft 3"></label>
          <label class="field" style="margin:0"><span>Folder</span>
            <select id="d-folder">${FOLDERS.map(f => `<option>${f}</option>`).join("")}</select></label>
        </div>
        <label class="field"><span>Note (optional)</span>
          <input type="text" id="d-note" placeholder="What it is, or what changed"></label>

        <label class="field" id="d-file-row"><span>File</span>
          <input type="file" id="d-file" multiple></label>
        <label class="field" id="d-link-row" hidden><span>Address</span>
          <input type="url" id="d-url" placeholder="https://..."></label>

        <button class="btn" id="d-add">Add it</button>
      </form>
      <div id="d-msg" hidden></div>
      <div id="d-queue" hidden style="margin-top:16px"></div>
    </div>

    <div class="card"><h2>The store</h2><div id="d-list"></div></div>

    <div class="dropzone" id="d-drop" hidden aria-hidden="true">
      <div class="dropzone-inner">
        <svg class="ico" viewBox="0 0 48 48" width="52" height="52" aria-hidden="true">
          <path d="M24 4v24M24 30l-8-8M24 30l8-8" fill="none" stroke="currentColor"
                stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M8 32v6a4 4 0 0 0 4 4h24a4 4 0 0 0 4-4v-6" fill="none" stroke="currentColor"
                stroke-width="3.5" stroke-linecap="round"/>
        </svg>
        <div class="t">Drop them here</div>
        <div class="n" id="d-drop-note"></div>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const folderNow = () => $("d-folder").value;

  /* -- file or link ------------------------------------------------------ */
  let mode = "file";
  const setMode = (m) => {
    mode = m;
    $("tab-file").classList.toggle("on", m === "file");
    $("tab-link").classList.toggle("on", m === "link");
    $("d-file-row").hidden = m !== "file";
    $("d-link-row").hidden = m !== "link";
    // Disabled, not just hidden: a hidden control is still submitted and still
    // validated, and it is the one you cannot see that causes the trouble.
    $("d-file").disabled = m !== "file";
    $("d-url").disabled  = m !== "link";
  };
  $("tab-file").addEventListener("click", () => setMode("file"));
  $("tab-link").addEventListener("click", () => setMode("link"));

  /* -- the upload queue --------------------------------------------------
     One file at a time, on purpose. Twenty parallel uploads on a village
     broadband connection is how you get twenty that all fail at 90%. */
  const queue = [];
  let working = false;

  function drawQueue() {
    const box = $("d-queue");
    if (!queue.length) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = `
      <div class="label" style="margin-bottom:8px">Uploading</div>
      ${queue.map((q, i) => `
        <div style="margin-bottom:10px">
          <div class="item-h" style="gap:8px">
            <span class="small" style="font-weight:600">${esc(q.file.name)}</span>
            <span class="small muted">${esc(sizeOf(q.file.size))}</span>
            <span class="small ${q.state === "failed" ? "" : "muted"}"
                  style="margin-left:auto${q.state === "failed" ? ";color:var(--vox-bad)" : ""}">
              ${q.state === "waiting" ? "waiting"
                : q.state === "done"   ? "done"
                : q.state === "failed" ? esc(q.why || "would not upload")
                : q.pct + "%"}</span>
          </div>
          <div class="bar" style="margin-top:5px;height:8px">
            <i style="width:${q.state === "done" ? 100 : q.pct}%${
                 q.state === "failed" ? ";background:var(--vox-bad)" : ""}"></i>
          </div>
        </div>`).join("")}
      ${queue.every(q => q.state === "done" || q.state === "failed")
        ? `<button class="linkish" id="d-queue-clear" style="font-size:13px">clear this list</button>` : ""}`;
    const clear = $("d-queue-clear");
    if (clear) clear.addEventListener("click", () => { queue.length = 0; drawQueue(); });
  }

  async function putOne(item) {
    const { file, folder, note } = item;
    // The uid is in the PATH, not the folder name, because storage rules cannot
    // read Firestore. firestore.rules lets the person who added a document
    // delete it; storage.rules can only agree with that if it can see whose
    // file it is, and the path is the only thing it gets to look at. With the
    // folder there instead, a Steering member deleting their own paper removed
    // the listing and left the file behind. The folder is display only, and it
    // is read from Firestore, so nothing is lost by moving it out of the path.
    const path = `documents/${ctx.user.uid}/${Date.now()}-${safeName(file.name)}`;

    const task = uploadBytesResumable(storageRef(storage, path), file, {
      contentType: file.type || "application/octet-stream",
      cacheControl: "private, max-age=0"
    });
    await new Promise((resolve, reject) => {
      task.on("state_changed",
        s => { item.pct = Math.round((s.bytesTransferred / s.totalBytes) * 100); drawQueue(); },
        reject, resolve);
    });
    const url = await getDownloadURL(task.snapshot.ref);

    // Upload first, record second. A record pointing at a file that failed to
    // arrive is worse than no record: it looks available and is not.
    await addDoc(collection(db, "documents"), {
      kind: "file", title: item.title, note: note || "", folder, url,
      storagePath: path,
      fileName: file.name,
      size: file.size,
      contentType: file.type || "",
      uploadedBy: ctx.user.uid,
      uploadedByName: ctx.user.name || ctx.user.email,
      uploadedAt: serverTimestamp()
    });
  }

  async function runQueue() {
    if (working) return;
    working = true;
    // Count only what THIS run handled. Counting the whole queue told someone
    // who dropped a single file "4 uploaded, 1 would not" because four earlier
    // ones were still sitting in the list, which is worse than saying nothing.
    const mine = [];
    for (const item of queue) {
      if (item.state !== "waiting") continue;
      mine.push(item);
      item.state = "going"; item.pct = 0; drawQueue();
      try {
        await putOne(item);
        item.state = "done"; drawQueue();
      } catch (err) {
        console.error("upload failed:", item.file.name, err);
        item.state = "failed";
        item.why = err?.code === "storage/unauthorized"
          ? "storage refused it" : (err?.message || "would not upload");
        drawQueue();
      }
    }
    working = false;
    const done = mine.filter(q => q.state === "done").length;
    const bad  = mine.filter(q => q.state === "failed").length;
    if (done && !bad) toast(done === 1 ? "Uploaded." : `${done} files uploaded.`);
    else if (done && bad) toast(`${done} uploaded, ${bad} would not.`);
    else if (bad) toast(bad === 1 ? "That file would not upload." : `${bad} files would not upload.`);
  }

  // Everything that adds files — the Choose File button and the drop — comes
  // through here, so the size check and the directory check exist once.
  function accept(files, { folder, note = "", title = null }) {
    // Between batches, clear out what finished. Failures stay on screen —
    // they are the ones somebody still has to do something about.
    if (!working) {
      for (let i = queue.length - 1; i >= 0; i--) if (queue[i].state === "done") queue.splice(i, 1);
    }
    const tooBig = [], ok = [];
    for (const f of files) {
      if (f.size > MAX_MB * 1024 * 1024) { tooBig.push(f); continue; }
      ok.push(f);
    }
    for (const f of ok) {
      queue.push({ file: f, folder, note,
                   title: title || titleFromName(f.name), state: "waiting", pct: 0 });
    }
    drawQueue();
    if (ok.length) runQueue();
    return { added: ok.length, tooBig };
  }

  /* -- adding through the form ------------------------------------------- */
  $("d-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("d-add"), msg = $("d-msg");
    const title = $("d-title").value.trim();
    const folder = folderNow();
    const note = $("d-note").value.trim();
    msg.hidden = true;

    const fail = (text) => {
      msg.className = "note note-bad"; msg.textContent = text; msg.hidden = false;
      btn.disabled = false;
    };

    if (mode === "link") {
      if (!title) return fail("Give it a title.");
      const url = $("d-url").value.trim();
      if (!/^https?:\/\//i.test(url)) return fail("A link needs to start with http:// or https://");
      btn.disabled = true;
      try {
        await addDoc(collection(db, "documents"), {
          kind: "link", title, note, folder, url,
          uploadedBy: ctx.user.uid,
          uploadedByName: ctx.user.name || ctx.user.email,
          uploadedAt: serverTimestamp()
        });
        $("d-form").reset(); setMode("link");
        toast("Added.");
      } catch (err) { console.error(err); return fail("Could not save that. " + (err.message || "")); }
      btn.disabled = false;
      return;
    }

    const chosen = [...$("d-file").files];
    if (!chosen.length) return fail("Choose a file.");
    // One file and a title typed in: use it. Several files: each is titled from
    // its own name, because one title across twenty documents is worse than none.
    if (chosen.length === 1 && !title) return fail("Give it a title.");
    const { tooBig } = accept(chosen, {
      folder, note, title: chosen.length === 1 ? title : null
    });
    $("d-form").reset(); setMode("file");
    if (tooBig.length) {
      return fail(tooBig.length === 1
        ? `${tooBig[0].name} is ${sizeOf(tooBig[0].size)}. The limit is ${MAX_MB} MB.`
        : `${tooBig.length} files were over ${MAX_MB} MB and were left out.`);
    }
  });

  /* -- drag and drop ------------------------------------------------------
     The window listeners are not optional. Without them, a file dropped one
     pixel outside the target makes the browser NAVIGATE to that file — the hub
     disappears and is replaced by a PDF. They are removed on the way out. */
  const zone = $("d-drop"), note = $("d-drop-note");
  let depth = 0;

  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

  const onDragEnter = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth++;
    note.textContent = `They will go in the ${folderNow()} folder.`;
    zone.hidden = false;
  };
  const onDragOver = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  };
  const onDragLeave = (e) => {
    if (!hasFiles(e)) return;
    depth = Math.max(0, depth - 1);
    if (!depth) zone.hidden = true;
  };
  const onDrop = (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    depth = 0; zone.hidden = true;

    // A dropped FOLDER arrives as a File with no type and a size of 0, and
    // uploading it produces an empty object with a folder's name that nobody
    // can open. Anyone who thinks of this as a shared drive will try it, so it
    // has to be caught and explained rather than silently half-working.
    const items = [...(e.dataTransfer.items || [])];
    const dirs = items.filter(i => i.kind === "file" && i.webkitGetAsEntry?.()?.isDirectory);

    const files = [...e.dataTransfer.files].filter(f => !dirs.some(d =>
      d.webkitGetAsEntry().name === f.name));

    if (!files.length && !dirs.length) { toast("Nothing came through in that drop."); return; }
    const { added, tooBig } = accept(files, { folder: folderNow() });

    // One note, not a stack of toasts. What was left out is something to read
    // and act on, so it stays on the page rather than fading after three
    // seconds; the toast is kept for how the upload itself went.
    const say = [];
    if (dirs.length) say.push(dirs.length === 1
      ? `The folder "${dirs[0].webkitGetAsEntry().name}" was skipped — open it and drop the files inside.`
      : `${dirs.length} folders were skipped — open them and drop the files inside.`);
    if (tooBig.length) say.push(tooBig.length === 1
      ? `${tooBig[0].name} is ${sizeOf(tooBig[0].size)}, over the ${MAX_MB} MB limit.`
      : `${tooBig.length} files were over ${MAX_MB} MB and were left out.`);

    const msg = $("d-msg");
    if (say.length) { msg.className = "note note-bad"; msg.textContent = say.join(" "); msg.hidden = false; }
    else msg.hidden = true;

    if (!added && !say.length) toast("Nothing came through in that drop.");
  };

  addEventListener("dragenter", onDragEnter);
  addEventListener("dragover",  onDragOver);
  addEventListener("dragleave", onDragLeave);
  addEventListener("drop",      onDrop);

  const stopDrop = () => {
    removeEventListener("dragenter", onDragEnter);
    removeEventListener("dragover",  onDragOver);
    removeEventListener("dragleave", onDragLeave);
    removeEventListener("drop",      onDrop);
  };

  /* -- the list ---------------------------------------------------------- */
  const stopSnap = onSnapshot(query(collection(db, "documents"), orderBy("uploadedAt", "desc")), (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const list = $("d-list");

    if (!rows.length) {
      list.innerHTML = `<div class="empty"><div class="ico">&#9637;</div>
        <div class="t">Nothing filed yet</div>
        <div class="n">Papers, minutes and drafts go here. Drag them onto the page.</div></div>`;
      return;
    }

    // Grouped in the order the folders are listed above, not in the order
    // things happened to be uploaded — so the store reads the same way every
    // time somebody opens it. A folder nobody has used does not appear.
    const bag = new Map();
    for (const r of rows) {
      const name = FOLDERS.includes(r.folder) ? r.folder : "Other";
      if (!bag.has(name)) bag.set(name, []);
      bag.get(name).push(r);
    }
    const groups = FOLDERS.filter(f => bag.has(f)).map(f => ({ name: f, items: bag.get(f) }));

    list.innerHTML = groups.map(g => `
      <div style="margin-bottom:22px">
        <div class="label" style="margin-bottom:8px">${esc(g.name)}</div>
        <ul class="list">${g.items.map(r => {
          const mine = r.uploadedBy === ctx.user.uid;
          return `<li>
            <div class="item-h">
              <a class="ttl" href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>
              <span class="tag">${r.kind === "link" ? "Link" : esc(sizeOf(r.size) || "File")}</span>
              <time>${when(r.uploadedAt)}</time>
            </div>
            ${r.note ? `<div class="small muted" style="margin-top:4px">${esc(r.note)}</div>` : ""}
            <div class="small muted" style="margin-top:4px">
              ${r.kind === "file" && r.fileName ? esc(r.fileName) + " · " : ""}
              added by ${esc(r.uploadedByName || "someone")}
              ${(isAdmin || mine)
                ? ` · <button class="linkish" data-del="${r.id}"
                      data-path="${esc(r.storagePath || "")}"
                      data-title="${esc(r.title)}" style="font-size:13px">delete</button>`
                : ""}
            </div>
          </li>`;
        }).join("")}</ul>
      </div>`).join("");

    list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async () => {
      if (!window.confirm(`Delete "${b.dataset.title}"? This cannot be undone.`)) return;
      b.disabled = true;
      try {
        await deleteDoc(doc(db, "documents", b.dataset.del));
        // The record is what people see, so it goes first. If the file itself
        // will not delete, say so rather than leaving a listing that lies.
        if (b.dataset.path) {
          try { await deleteObject(storageRef(storage, b.dataset.path)); }
          catch (err) {
            console.warn("file left in storage:", b.dataset.path, err?.code);
            toast("Removed from the list, but the file itself would not delete.");
            return;
          }
        }
        toast("Deleted.");
      } catch (err) { console.error(err); toast("Could not delete that."); b.disabled = false; }
    }));
  }, (err) => {
    $("d-list").innerHTML =
      `<p class="muted small">Could not load. ${esc(err.message || "")}</p>`;
  });

  return () => { stopDrop(); stopSnap(); };
}
