// ---------------------------------------------------------------------------
// Viewings — admin only.
//
// Sets up a property viewing and the sign-up form that goes with it. The form
// itself is NOT part of this app: it is /viewing.html, a standalone page with
// no menu, no sign-in and no hub content, because the people filling it in are
// charity contacts who have no account here.
//
// Two documents per viewing, and the split matters:
//
//   viewings/{id}                   PUBLIC. Anyone with the link reads this
//                                   whole document, so nothing confidential
//                                   may go in it.
//   viewings/{id}/private/details   the address. Admin only, and read on the
//                                   server when the confirmation email goes
//                                   out — so it reaches people who signed up
//                                   and nobody else.
//
// Firestore grants read on a whole document, never on a field. One address
// field in the public document is an address published to everyone the link
// is forwarded to.
// ---------------------------------------------------------------------------
import { db, doc, getDoc, setDoc, addDoc, deleteDoc, collection, query,
         orderBy, onSnapshot, serverTimestamp } from "../fb.js";
import { esc, toast, when } from "../ui.js";

const PUBLIC_BASE = location.origin + "/viewing.html?v=";

// Must match the cap in validSignup() in firestore.rules. Raise one and the
// other silently starts refusing sign-ups.
const MAX_QUESTIONS = 12;

const TYPES = {
  short:  "Short answer",
  long:   "Long answer",
  yesno:  "Yes / No",
  choice: "Choose one"
};

// Fields every sign-up collects, shown so it is obvious what you do not have
// to ask for yourself.
const ALWAYS = ["Name", "Email", "Organisation", "Job title", "How many people"];

let editing = null;   // viewing id being edited, or null for the list
let qs = [];          // the question rows while editing
let seq = 0;

export function render(view, ctx) {
  const rerender = () => draw(view);

  return onSnapshot(query(collection(db, "viewings"), orderBy("createdAt", "desc")),
    (snap) => {
      view._rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      draw(view);
    },
    (err) => {
      console.error("viewings", err);
      view.innerHTML = `<div class="card"><h3>Could not load viewings</h3>
        <p class="muted small">${esc(err.message || String(err))}</p></div>`;
    });
}

/* ---- list -------------------------------------------------------------- */

function draw(view) {
  const rows = view._rows || [];
  if (editing) return drawEditor(view, rows.find(r => r.id === editing));

  view.innerHTML = `
    <div class="card">
      <h2>Viewings</h2>
      <p class="small muted" style="margin-top:-8px">
        Set a viewing up here and write the questions you want asked. Nothing is
        reachable until you publish it — then you get a link to send out.
        People who open that link see the form and nothing else.</p>
      <button class="btn" id="v-new">Set up a viewing</button>
    </div>
    ${rows.length ? rows.map(card).join("") : `<div class="card"><div class="empty">
      <div class="ico">⌂</div>
      <div class="t">No viewings yet</div>
      <div class="n">Set one up and the sign-up form builds itself from the questions you write.</div>
    </div></div>`}`;

  view.querySelector("#v-new").addEventListener("click", async () => {
    const ref = await addDoc(collection(db, "viewings"), {
      title: "Property viewing",
      dateText: "", timeText: "", publicLocation: "", intro: "",
      questions: [], published: false, open: true,
      createdAt: serverTimestamp()
    });
    editing = ref.id; qs = []; draw(view);
  });

  view.querySelectorAll("[data-edit]").forEach(b => b.addEventListener("click", () => {
    editing = b.dataset.edit;
    qs = (rows.find(r => r.id === editing)?.questions || [])
           .map(q => ({ ...q, _k: "k" + (seq++) }));
    draw(view);
  }));

  view.querySelectorAll("[data-copy]").forEach(b => b.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(b.dataset.copy); toast("Link copied."); }
    catch { toast("Could not copy — select the link and copy it by hand."); }
  }));
}

function card(v) {
  const link = PUBLIC_BASE + v.id;
  const state = !v.published ? `<span class="tag">Not published</span>`
    : v.open ? `<span class="tag brick">Open for sign-ups</span>`
    : `<span class="tag">Sign-ups closed</span>`;
  return `<div class="card">
    <div class="item-h"><span class="ttl">${esc(v.title || "Untitled viewing")}</span>${state}</div>
    <p class="small muted" style="margin:6px 0 0">
      ${esc([v.dateText, v.timeText, v.publicLocation].filter(Boolean).join(" · ") || "No date set yet")}
      · ${(v.questions || []).length} question${(v.questions || []).length === 1 ? "" : "s"}</p>
    ${v.published ? `<p class="small" style="margin:12px 0 0">
      <span class="linkish" style="word-break:break-all">${esc(link)}</span></p>` : ""}
    <div style="display:flex;gap:9px;margin-top:14px;flex-wrap:wrap">
      <button class="btn btn-sm" data-edit="${esc(v.id)}">Edit</button>
      <a class="btn btn-sm btn-ghost" href="${esc(link)}" target="_blank" rel="noopener">Preview</a>
      ${v.published ? `<button class="btn btn-sm btn-ghost" data-copy="${esc(link)}">Copy the link</button>
        <a class="btn btn-sm btn-ghost" href="${esc(link)}" target="_blank" rel="noopener">Open it</a>` : ""}
    </div></div>`;
}

/* ---- editor ------------------------------------------------------------ */

function drawEditor(view, v) {
  if (!v) { editing = null; return draw(view); }
  const link = PUBLIC_BASE + v.id;

  view.innerHTML = `
    <div class="card">
      <div class="item-h"><span class="ttl">Editing a viewing</span>
        <button class="btn btn-sm btn-ghost" id="v-back" style="margin-left:auto">Back to the list</button></div>
    </div>

    <div class="card">
      <h2>The viewing</h2>
      <label class="field"><span>Title</span>
        <input id="f-title" maxlength="120" value="${esc(v.title || "")}"
               placeholder="VOX London — property viewing"></label>
      <div class="grid g3">
        <label class="field"><span>Date</span>
          <input id="f-date" maxlength="60" value="${esc(v.dateText || "")}"
                 placeholder="Thursday 13 November 2026"></label>
        <label class="field"><span>Time</span>
          <input id="f-time" maxlength="60" value="${esc(v.timeText || "")}"
                 placeholder="10:30am, allow an hour"></label>
        <label class="field"><span>Where — what the form may say</span>
          <input id="f-loc" maxlength="120" value="${esc(v.publicLocation || "")}"
                 placeholder="Central London"></label>
      </div>
      <label class="field"><span>Opening paragraph</span>
        <textarea id="f-intro" maxlength="900"
          placeholder="A short welcome. What they are coming to see and why it matters.">${esc(v.intro || "")}</textarea></label>
    </div>

    <div class="card">
      <h2>The address</h2>
      <p class="small muted" style="margin-top:-8px">
        This is <b>not</b> on the form. It goes in the confirmation email, so only
        people who have actually signed up — and given you their name and
        organisation — get it. A forwarded link does not carry it.</p>
      <label class="field"><span>Full address</span>
        <textarea id="f-addr" maxlength="400" placeholder="Loading…"></textarea></label>
      <label class="field"><span>Arrival notes</span>
        <textarea id="f-arrive" maxlength="400"
          placeholder="Which entrance, who to ask for, nearest station."></textarea></label>
    </div>

    <div class="card">
      <h2>Your questions</h2>
      <p class="small muted" style="margin-top:-8px">
        Every sign-up already collects ${ALWAYS.join(", ").replace(/, ([^,]*)$/, " and $1").toLowerCase()}.
        Add anything else you want to ask.</p>
      <div id="v-qs"></div>
      <button class="btn btn-sm btn-ghost" id="q-add">Add a question</button>
      <p class="small muted" style="margin:10px 0 0">Up to ${MAX_QUESTIONS}.</p>
    </div>

    <div class="card">
      <h2>Publishing</h2>
      <label style="display:flex;gap:9px;align-items:center;font-size:14px;margin-bottom:10px">
        <input type="checkbox" id="f-pub" style="width:auto" ${v.published ? "checked" : ""}>
        Published — the link works</label>
      <label style="display:flex;gap:9px;align-items:center;font-size:14px;margin-bottom:4px">
        <input type="checkbox" id="f-open" style="width:auto" ${v.open !== false ? "checked" : ""}>
        Open — still accepting sign-ups</label>
      <p class="small muted">Untick <b>Open</b> after the viewing and the page says sign-ups have
        closed rather than going dead.</p>
      <p class="small muted"><b>Preview it</b> opens the form the way your invitees will see it.
        It works before you publish because you are signed in as admin — to anyone else an
        unpublished viewing does not exist. Save first, or you will preview the last save.</p>
      <div class="note note-info" style="word-break:break-all">${esc(link)}</div>
      <div style="display:flex;gap:9px;margin-top:18px;flex-wrap:wrap">
        <button class="btn" id="v-save">Save</button>
        <a class="btn btn-sm btn-ghost" href="${esc(link)}" target="_blank" rel="noopener">Preview it</a>
        <button class="btn btn-sm btn-ghost" id="v-del">Delete this viewing</button>
      </div>
    </div>`;

  // The address lives in a second document, so it arrives a moment later.
  getDoc(doc(db, "viewings", v.id, "private", "details")).then(s => {
    const d = s.exists() ? s.data() : {};
    const a = view.querySelector("#f-addr"), r = view.querySelector("#f-arrive");
    a.placeholder = "1 Example Street, London EC1";
    if (!a.value) a.value = d.address || "";
    if (!r.value) r.value = d.arrivalNotes || "";
  }).catch(() => { view.querySelector("#f-addr").placeholder = "Could not load the address."; });

  drawQuestions(view);

  view.querySelector("#v-back").addEventListener("click", () => { editing = null; draw(view); });

  view.querySelector("#q-add").addEventListener("click", () => {
    readQuestions(view);
    qs.push({ _k: "k" + (seq++), label: "", type: "short", options: [], required: false });
    drawQuestions(view);
  });

  view.querySelector("#v-save").addEventListener("click", async () => {
    const btn = view.querySelector("#v-save");
    readQuestions(view);
    const clean = qs.map(q => ({
      // A key generated once and kept. Answers are filed under it, so renaming
      // a question later does not orphan the answers already collected.
      key: q.key || ("q" + Math.random().toString(36).slice(2, 8)),
      label: (q.label || "").trim(),
      type: TYPES[q.type] ? q.type : "short",
      options: q.type === "choice"
        ? (q.options || []).map(o => String(o).trim()).filter(Boolean).slice(0, 12) : [],
      required: !!q.required
    })).filter(q => q.label);

    const bad = clean.find(q => q.type === "choice" && q.options.length < 2);
    if (bad) { toast(`"${bad.label}" needs at least two choices.`); return; }

    // The security rules refuse a sign-up carrying more than 12 answers. Catch
    // it here, where it is one toast, rather than there, where it would be
    // every sign-up failing on a form that looks perfectly fine.
    if (clean.length > MAX_QUESTIONS) {
      toast(`That is ${clean.length} questions. The form takes ${MAX_QUESTIONS}.`); return;
    }

    btn.disabled = true; btn.textContent = "Saving…";
    try {
      await setDoc(doc(db, "viewings", v.id), {
        title: view.querySelector("#f-title").value.trim() || "Property viewing",
        dateText: view.querySelector("#f-date").value.trim(),
        timeText: view.querySelector("#f-time").value.trim(),
        publicLocation: view.querySelector("#f-loc").value.trim(),
        intro: view.querySelector("#f-intro").value.trim(),
        questions: clean,
        published: view.querySelector("#f-pub").checked,
        open: view.querySelector("#f-open").checked,
        updatedAt: serverTimestamp()
      }, { merge: true });

      await setDoc(doc(db, "viewings", v.id, "private", "details"), {
        address: view.querySelector("#f-addr").value.trim(),
        arrivalNotes: view.querySelector("#f-arrive").value.trim(),
        updatedAt: serverTimestamp()
      }, { merge: true });

      toast("Saved.");
    } catch (err) {
      console.error(err);
      toast("Could not save that.");
    }
    btn.disabled = false; btn.textContent = "Save";
  });

  view.querySelector("#v-del").addEventListener("click", async () => {
    if (!confirm("Delete this viewing? The link stops working. Sign-ups already made are kept.")) return;
    try {
      await deleteDoc(doc(db, "viewings", v.id, "private", "details")).catch(() => {});
      await deleteDoc(doc(db, "viewings", v.id));
      editing = null; toast("Deleted.");
    } catch { toast("Could not delete that."); }
  });
}

/* ---- the question rows ------------------------------------------------- */

// Read what is on screen back into `qs` before any re-render, or typing is
// lost the moment somebody adds or removes a row.
function readQuestions(view) {
  qs = [...view.querySelectorAll("[data-q]")].map(row => ({
    _k: row.dataset.q,
    key: row.dataset.key || "",
    label: row.querySelector(".q-label").value,
    type: row.querySelector(".q-type").value,
    options: row.querySelector(".q-opts")
      ? row.querySelector(".q-opts").value.split("\n").filter(s => s.trim()) : [],
    required: row.querySelector(".q-req").checked
  }));
}

function drawQuestions(view) {
  const box = view.querySelector("#v-qs");
  box.innerHTML = qs.length ? qs.map((q, i) => `
    <div class="card" data-q="${esc(q._k)}" data-key="${esc(q.key || "")}" style="box-shadow:none;border:var(--vox-border);margin-bottom:14px">
      <div class="item-h"><span class="small muted">Question ${i + 1}</span>
        <button class="btn btn-sm btn-ghost q-del" style="margin-left:auto">Remove</button></div>
      <label class="field" style="margin-top:12px"><span>What you are asking</span>
        <input class="q-label" maxlength="200" value="${esc(q.label || "")}"
               placeholder="Roughly how much space are you looking for?"></label>
      <label class="field"><span>Answer type</span>
        <select class="q-type">${Object.entries(TYPES).map(([k, label]) =>
          `<option value="${k}"${q.type === k ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label>
      ${q.type === "choice" ? `<label class="field"><span>The choices — one per line</span>
        <textarea class="q-opts" maxlength="600" placeholder="Under 5,000 sq ft&#10;5,000–15,000 sq ft&#10;More than 15,000 sq ft">${esc((q.options || []).join("\n"))}</textarea></label>` : ""}
      <label style="display:flex;gap:9px;align-items:center;font-size:14px">
        <input type="checkbox" class="q-req" style="width:auto" ${q.required ? "checked" : ""}>
        They have to answer this</label>
    </div>`).join("")
    : `<p class="muted small">No extra questions yet.</p>`;

  box.querySelectorAll("[data-q]").forEach(row => {
    row.querySelector(".q-del").addEventListener("click", () => {
      readQuestions(view);
      qs = qs.filter(q => q._k !== row.dataset.q);
      drawQuestions(view);
    });
    // Switching to "Choose one" has to redraw, to show the choices box.
    row.querySelector(".q-type").addEventListener("change", () => {
      readQuestions(view);
      drawQuestions(view);
    });
  });
}
