// ---------------------------------------------------------------------------
// The public viewing sign-up form. Served from /viewing.html.
//
// This is the only page of the hub somebody can reach without an account, and
// it deliberately carries nothing else: no menu, no links back into the hub,
// no service worker, no sign-in. A charity contact opens it, fills it in, and
// that is the whole experience.
//
// It reads ONE document — viewings/{id} — which the rules allow only once
// Martin has published it. The address is not in that document and never
// reaches this page; it goes out in the confirmation email instead.
// ---------------------------------------------------------------------------
import { db, doc, getDoc, addDoc, collection, serverTimestamp } from "./fb.js";
import { esc } from "./ui.js";

const card = document.getElementById("v-card");
const LOGO = `<img class="v-logo" src="/assets/logo.png" alt="VOX">`;

// A bot fills every field it can see, including the one nobody can see, and it
// does it instantly. Neither test is a wall — the security rules are the wall —
// but together they stop the drive-by form spam that finds any open endpoint.
const MIN_SECONDS = 3;
const openedAt = Date.now();

const params = new URLSearchParams(location.search);
const viewingId = (params.get("v") || "").trim();

function panel(title, note) {
  card.innerHTML = `${LOGO}<h1 style="margin-top:0">${esc(title)}</h1>
    <p class="lede" style="margin-bottom:0">${esc(note)}</p>`;
}

function metaLine(v) {
  return [v.dateText, v.timeText, v.publicLocation].filter(Boolean).join(" · ");
}

/* ---- load -------------------------------------------------------------- */

if (!viewingId) {
  panel("Something is missing from that link",
    "Please use the full link from your invitation, or reply to the email and we will send it again.");
} else {
  getDoc(doc(db, "viewings", viewingId)).then(snap => {
    if (!snap.exists()) {
      panel("We could not find that viewing",
        "The link may have been typed by hand, or the viewing may have been taken down. Reply to your invitation and we will sort it out.");
      return;
    }
    const v = { id: snap.id, ...snap.data() };
    if (v.open === false) {
      card.innerHTML = `${LOGO}
        <p class="v-meta">${esc(metaLine(v))}</p>
        <h1 style="margin-top:0">${esc(v.title || "Property viewing")}</h1>
        <div class="note note-info" style="margin-top:20px">
          Sign-ups for this viewing have closed. If you would still like to come,
          reply to your invitation and we will see what we can do.</div>`;
      return;
    }
    form(v);
  }).catch(() => {
    // A permission error and an unpublished viewing look identical from out
    // here, which is the point — a draft must not announce that it exists.
    panel("This link is not live yet",
      "If you were expecting a sign-up form, give it a little while and try again, or reply to your invitation.");
  });
}

/* ---- the form ---------------------------------------------------------- */

function form(v) {
  const qs = Array.isArray(v.questions) ? v.questions : [];

  card.innerHTML = `${LOGO}
    ${metaLine(v) ? `<p class="v-meta">${esc(metaLine(v))}</p>` : ""}
    <h1 style="margin-top:0">${esc(v.title || "Property viewing")}</h1>
    ${v.intro ? `<p class="lede">${esc(v.intro)}</p>` : ""}

    <form id="v-form" novalidate style="margin-top:26px">
      <label class="field"><span>Your name</span>
        <input id="f-name" maxlength="120" autocomplete="name" required></label>
      <label class="field"><span>Email address</span>
        <input id="f-email" type="email" maxlength="254" inputmode="email"
               autocomplete="email" required></label>
      <label class="field"><span>Organisation</span>
        <input id="f-org" maxlength="160" autocomplete="organization"></label>
      <label class="field"><span>Job title</span>
        <input id="f-role" maxlength="160" autocomplete="organization-title"></label>
      <label class="field"><span>How many of you are coming, including yourself</span>
        <input id="f-guests" type="number" min="1" max="20" step="1" value="1"></label>

      ${qs.map((q, i) => questionField(q, i)).join("")}

      <label class="v-hp" aria-hidden="true">
        Leave this blank<input id="f-hp" tabindex="-1" autocomplete="off"></label>

      <div id="f-msg" class="note note-bad" hidden></div>
      <button class="btn btn-wide" id="f-send" style="margin-top:10px">Sign me up</button>
    </form>

    <p class="v-foot">VOX London holds what you enter here so we can run the viewing and
      send you the joining details. We will not pass it to anyone else. Ask us at any time
      and we will remove it.</p>`;

  document.getElementById("v-form").addEventListener("submit", (e) => submit(e, v, qs));
}

function questionField(q, i) {
  const key = fieldId(q, i);
  const label = esc(q.label || `Question ${i + 1}`);
  const req = q.required ? " required" : "";
  const star = q.required ? "" : ` <span class="muted" style="font-weight:400">(optional)</span>`;

  if (q.type === "long") {
    return `<label class="field"><span>${label}${star}</span>
      <textarea id="${key}" maxlength="900"${req}></textarea></label>`;
  }
  if (q.type === "yesno") {
    return `<label class="field"><span>${label}${star}</span>
      <select id="${key}"${req}>
        <option value="">Please choose</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option></select></label>`;
  }
  if (q.type === "choice") {
    const opts = (q.options || []).map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join("");
    return `<label class="field"><span>${label}${star}</span>
      <select id="${key}"${req}><option value="">Please choose</option>${opts}</select></label>`;
  }
  return `<label class="field"><span>${label}${star}</span>
    <input id="${key}" maxlength="300"${req}></label>`;
}

// Each question carries a key generated when it was first saved, so renaming a
// question later does not orphan the answers already collected. Older
// questions saved before that existed fall back to their position.
function fieldId(q, i) { return "fq-" + (q.key || ("q" + (i + 1))); }
function answerKey(q, i) { return q.key || ("q" + (i + 1)); }

/* ---- submit ------------------------------------------------------------ */

async function submit(e, v, qs) {
  e.preventDefault();
  const btn = document.getElementById("f-send");
  const msg = document.getElementById("f-msg");
  const fail = (text) => { msg.textContent = text; msg.hidden = false; btn.disabled = false;
                           btn.textContent = "Sign me up"; };

  msg.hidden = true;
  btn.disabled = true; btn.textContent = "Sending…";

  if (document.getElementById("f-hp").value.trim() !== "") return;              // a bot
  if ((Date.now() - openedAt) / 1000 < MIN_SECONDS) return fail("Give it a moment and try again.");

  const val = (id) => (document.getElementById(id)?.value || "").trim();
  const name = val("f-name"), email = val("f-email");

  if (!name) return fail("Please give us your name.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return fail("That email address does not look right.");

  const answers = {};
  for (let i = 0; i < qs.length; i++) {
    const q = qs[i];
    const text = val(fieldId(q, i));
    if (q.required && !text) return fail(`Please answer: ${q.label || "question " + (i + 1)}`);
    if (text) answers[answerKey(q, i)] = text.slice(0, 900);
  }

  let guests = parseInt(val("f-guests"), 10);
  if (!Number.isFinite(guests)) guests = 1;
  guests = Math.max(0, Math.min(20, guests));

  try {
    await addDoc(collection(db, "viewing_signups"), {
      viewingId: v.id,
      name, email,
      org: val("f-org"),
      role: val("f-role"),
      guests,
      answers,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error(err);
    return fail("That did not go through. Please try once more, or reply to your invitation and we will add you by hand.");
  }

  card.innerHTML = `${LOGO}
    <h1 style="margin-top:0">Thank you — you are on the list</h1>
    <p class="lede">We have you down for ${esc(v.title || "the viewing")}${
      metaLine(v) ? `, ${esc(metaLine(v))}` : ""}.</p>
    <div class="note note-ok" style="margin-top:20px">
      We will email <b>${esc(email)}</b> with the address and how to find us.
      If it has not arrived in a day or so, check your junk folder and then reply
      to your invitation.</div>`;
  window.scrollTo({ top: 0, behavior: "smooth" });
}
