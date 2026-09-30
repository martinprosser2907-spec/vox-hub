// ---------------------------------------------------------------------------
// The suggestions board — a pin board, not a list.
//
// Modelled on the EGBC worship board (stickynotes.html): a cork surface with
// notes pinned to it, each one draggable, tilted a little, coloured by what it
// is about. A list of suggestions is a form to be processed; a board is
// somewhere people put things up and move them around, and that difference is
// most of why anyone uses it.
//
// Positions are shared, deliberately. Move a note and it moves for everyone,
// the way it would if you walked up and moved a real pin. That is why the
// rules let any member write x/y/z on any note while still letting only the
// author change the words.
//
// On a phone the board becomes a plain column. Dragging notes around a
// 3200-pixel canvas with a thumb is not a feature, and half the group will
// open this on a train.
// ---------------------------------------------------------------------------
import {
  db, collection, query, orderBy, onSnapshot, addDoc, doc, updateDoc, deleteDoc,
  serverTimestamp, arrayUnion, arrayRemove
} from "../fb.js";
import { esc, ago, toast, tierOf } from "../ui.js";

// The areas double as the note colours, the way the EGBC board uses category
// colour to let you read the wall before you read a single note.
const AREAS = [
  { id: "building",  label: "Building and space" },
  { id: "meeting",   label: "Meeting and event space" },
  { id: "services",  label: "Shared services" },
  { id: "location",  label: "Location and transport" },
  { id: "together",  label: "How we work together" },
  { id: "",          label: "Anything else" }
];
const AREA_LABEL = Object.fromEntries(AREAS.map(a => [a.id, a.label]));

// The cork is sized to what is actually pinned to it, not to a fixed acre.
// A board that is mostly empty space means hunting for notes that are off
// screen, which is the one thing a board is supposed to save you from.
const NOTE_W = 250;
const SEED = { x0: 34, y0: 26, dx: 272, dy: 300, cols: 4 };
const MIN_CANVAS = { w: 1100, h: 620 };

function canvasFor(count, placed) {
  const rowsNeeded = Math.max(1, Math.ceil(count / SEED.cols));
  let w = SEED.x0 + SEED.cols * SEED.dx;
  let h = SEED.y0 + rowsNeeded * SEED.dy;
  // Somebody may have dragged a note out past that, and it must not be
  // stranded off the edge of the cork.
  for (const p of placed) {
    w = Math.max(w, p.x + NOTE_W + 40);
    h = Math.max(h, p.y + 240);
  }
  return { w: Math.max(MIN_CANVAS.w, w), h: Math.max(MIN_CANVAS.h, h) };
}

// Where a note sits before anyone has moved it. Worked out from its position
// in the list rather than stored, so every person opening the board sees the
// same arrangement without anybody's browser writing to the database just by
// looking at it.
function seededSpot(i) {
  return {
    x: SEED.x0 + (i % SEED.cols) * SEED.dx + ((i * 37) % 40) - 20,
    y: SEED.y0 + Math.floor(i / SEED.cols) * SEED.dy + ((i * 23) % 34) - 17
  };
}
const tiltOf = (i) => ((i * 17) % 7) - 3.5;

export function render(view, ctx) {
  const isAdmin = tierOf(ctx.user.tier) >= 3;
  let rows = [];
  let filter = "all";

  view.innerHTML = `
    <div class="card" style="margin-bottom:var(--vox-gap)">
      <div class="item-h" style="gap:10px">
        <h2 style="margin:0">Suggestions board</h2>
        <button class="btn btn-sm" id="sb-add" style="margin-left:auto">Pin a note</button>
      </div>
      <div class="board-filters" id="sb-filters"></div>
    </div>

    <div class="board-frame">
      <div class="board-cork" id="sb-cork">
        <div class="board-empty" id="sb-empty" hidden>
          <div class="ico">&#128204;</div>
          <div class="t">Nothing on the board yet</div>
          <div class="n">Pin the first note.</div>
        </div>
      </div>
      <div class="board-hint" id="sb-hint">Drag a note by its pin to move it</div>
    </div>

    <div class="modal-back" id="sb-modal" hidden>
      <div class="modal-card">
        <div class="item-h"><h2 style="margin:0">Pin a note</h2>
          <button class="linkish" id="sb-close" style="margin-left:auto">close</button></div>
        <form id="sb-form">
          <label class="field"><span>Your suggestion</span>
            <textarea id="sb-text" maxlength="900" rows="4"
              placeholder="For example: a bookable green-screen room would save several of us a lot of money."></textarea></label>
          <label class="field"><span>What is it about?</span>
            <select id="sb-area">${AREAS.map(a =>
              `<option value="${a.id}">${esc(a.label)}</option>`).join("")}</select></label>
          <div id="sb-msg" hidden></div>
          <button class="btn" id="sb-post">Pin it</button>
        </form>
      </div>
    </div>`;

  const $ = (id) => document.getElementById(id);
  const cork = $("sb-cork");
  let canvas = { ...MIN_CANVAS };

  /* -- filters ----------------------------------------------------------- */
  function drawFilters() {
    const counts = {};
    for (const r of rows) counts[r.area || ""] = (counts[r.area || ""] || 0) + 1;
    $("sb-filters").innerHTML =
      [{ id: "all", label: "Everything" }, ...AREAS]
        .filter(a => a.id === "all" || counts[a.id])
        .map(a => `<button class="chip ${filter === a.id ? "on" : ""}" data-filter="${a.id}">
            ${esc(a.label)}${a.id !== "all" ? ` <span>${counts[a.id]}</span>` : ""}</button>`)
        .join("");
    $("sb-filters").querySelectorAll("[data-filter]").forEach(b =>
      b.addEventListener("click", () => { filter = b.dataset.filter; drawFilters(); drawBoard(); }));
  }

  /* -- the board --------------------------------------------------------- */
  function drawBoard() {
    cork.querySelectorAll(".note").forEach(n => n.remove());
    const shown = rows.filter(r => filter === "all" || (r.area || "") === filter);
    $("sb-empty").hidden = shown.length > 0;

    canvas = canvasFor(shown.length, rows.filter(r => Number.isFinite(r.x)));
    cork.style.width = canvas.w + "px";
    cork.style.height = canvas.h + "px";

    shown.forEach((s, i) => {
      const seat = seededSpot(rows.indexOf(s));
      const x = Number.isFinite(s.x) ? s.x : seat.x;
      const y = Number.isFinite(s.y) ? s.y : seat.y;
      const tilt = Number.isFinite(s.rot) ? s.rot : tiltOf(rows.indexOf(s));
      const backers = s.backers || [];
      const backing = backers.includes(ctx.user.uid);
      const mine = s.authorId === ctx.user.uid;

      const el = document.createElement("article");
      el.className = `pin-note pin-note-${s.area || "other"}`;
      el.dataset.id = s.id;
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.zIndex = String(s.z || 1);
      el.style.transform = `rotate(${tilt}deg)`;
      el.innerHTML = `
        <div class="pin-note-pin" title="Drag to move"></div>
        <div class="pin-note-cat">${esc(AREA_LABEL[s.area || ""] || "Anything else")}</div>
        <div class="pin-note-text">${esc(s.text || "")}</div>
        <div class="pin-note-foot">
          <span>${esc(s.authorName || "someone")}${s.authorOrg ? " · " + esc(s.authorOrg) : ""}</span>
          <time>${ago(s.createdAt)}</time>
        </div>
        <div class="pin-note-acts">
          <button class="back ${backing ? "on" : ""}" data-back="${s.id}" data-on="${backing}">
            ${backing ? "&#9679;" : "&#9675;"} ${backers.length || 0}
          </button>
          ${(isAdmin || mine) ? `<button class="linkish" data-del="${s.id}">remove</button>` : ""}
        </div>`;
      cork.appendChild(el);
      wireNote(el, s);
    });

    cork.querySelectorAll("[data-back]").forEach(b => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      b.disabled = true;
      try {
        await updateDoc(doc(db, "suggestions", b.dataset.back), {
          backers: b.dataset.on === "true" ? arrayRemove(ctx.user.uid) : arrayUnion(ctx.user.uid)
        });
      } catch { toast("Could not register that."); b.disabled = false; }
    }));

    cork.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!window.confirm("Take this note off the board?")) return;
      try { await deleteDoc(doc(db, "suggestions", b.dataset.del)); }
      catch { toast("Could not remove it."); }
    }));
  }

  /* -- dragging ----------------------------------------------------------
     By the pin only. Dragging by the whole note makes it impossible to select
     the words, and people do want to copy a suggestion into an email. */
  let topZ = 1;
  function wireNote(el, s) {
    topZ = Math.max(topZ, s.z || 1);
    const pin = el.querySelector(".pin-note-pin");
    let start = null;

    const down = (ev) => {
      if (window.matchMedia("(max-width: 780px)").matches) return;   // phone: no dragging
      ev.preventDefault();
      const p = ev.touches ? ev.touches[0] : ev;
      start = { px: p.clientX, py: p.clientY, x: parseFloat(el.style.left), y: parseFloat(el.style.top) };
      el.classList.add("dragging");
      el.style.zIndex = String(++topZ);
      addEventListener("mousemove", move); addEventListener("mouseup", up);
      addEventListener("touchmove", move, { passive: false }); addEventListener("touchend", up);
    };
    const move = (ev) => {
      if (!start) return;
      ev.preventDefault();
      const p = ev.touches ? ev.touches[0] : ev;
      // Clamped so a note can never be dragged off the cork and lost.
      el.style.left = Math.max(0, Math.min(canvas.w - NOTE_W, start.x + p.clientX - start.px)) + "px";
      el.style.top  = Math.max(0, Math.min(canvas.h - 120, start.y + p.clientY - start.py)) + "px";
    };
    const up = async () => {
      removeEventListener("mousemove", move); removeEventListener("mouseup", up);
      removeEventListener("touchmove", move); removeEventListener("touchend", up);
      if (!start) return;
      const moved = Math.abs(parseFloat(el.style.left) - start.x) > 2
                 || Math.abs(parseFloat(el.style.top) - start.y) > 2;
      start = null;
      el.classList.remove("dragging");
      if (!moved) return;
      try {
        await updateDoc(doc(db, "suggestions", el.dataset.id), {
          x: Math.round(parseFloat(el.style.left)),
          y: Math.round(parseFloat(el.style.top)),
          z: topZ
        });
      } catch (err) {
        console.error(err);
        toast("Could not save where you moved that to.");
      }
    };
    pin.addEventListener("mousedown", down);
    pin.addEventListener("touchstart", down, { passive: false });
  }

  /* -- posting ----------------------------------------------------------- */
  const modal = $("sb-modal");
  const openModal = () => { modal.hidden = false; $("sb-text").focus(); };
  const shutModal = () => { modal.hidden = true; $("sb-msg").hidden = true; };
  $("sb-add").addEventListener("click", openModal);
  $("sb-close").addEventListener("click", shutModal);
  modal.addEventListener("click", (e) => { if (e.target === modal) shutModal(); });

  $("sb-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = $("sb-post"), msg = $("sb-msg");
    const text = $("sb-text").value.trim();
    msg.hidden = true;
    if (!text) {
      msg.className = "note note-bad"; msg.textContent = "Write something first."; msg.hidden = false; return;
    }
    btn.disabled = true;
    try {
      await addDoc(collection(db, "suggestions"), {
        text,
        area: $("sb-area").value || "",
        authorName: ctx.user.name || ctx.user.email,
        authorOrg:  ctx.user.org || "",
        authorId:   ctx.user.uid,
        backers: [],
        createdAt: serverTimestamp()
      });
      $("sb-text").value = "";
      shutModal();
      toast("Pinned — thank you.");
    } catch (err) {
      console.error(err);
      msg.className = "note note-bad"; msg.textContent = "Could not pin that."; msg.hidden = false;
    }
    btn.disabled = false;
  });

  setTimeout(() => $("sb-hint")?.classList.add("gone"), 5000);

  /* -- live -------------------------------------------------------------- */
  return onSnapshot(query(collection(db, "suggestions"), orderBy("createdAt", "desc")), (snap) => {
    rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    drawFilters();
    drawBoard();
  }, (err) => {
    cork.innerHTML = `<p class="muted small" style="padding:24px">Could not load the board. ${esc(err.message || "")}</p>`;
  });
}
