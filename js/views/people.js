// ---------------------------------------------------------------------------
// People and access — admin only.
//
// This is the screen that replaces running seed-members.js by hand. Adding a
// charity here is what lets them sign in; nothing else grants access.
//
// The one thing worth understanding before changing anything: signInEmails is
// an ARRAY, and it is what requestSignInCode searches
// (where("signInEmails", "array-contains", email)). People sign in with
// whatever account is on their phone, which is often not the address you hold
// for them — so a second address added here is the difference between someone
// getting in and being permanently stuck on "we do not recognise that address".
// ---------------------------------------------------------------------------
import {
  db, collection, query, orderBy, onSnapshot, addDoc, doc, updateDoc,
  deleteDoc, serverTimestamp, arrayUnion, arrayRemove
} from "../fb.js";
import { esc, when, ago, toast, TIER_LABEL, tierOf } from "../ui.js";

const TIERS = [
  ["general",  "General",        "The founding group — progress, concept, updates, suggestions, questions"],
  ["steering", "Steering Group", "All of the above, plus the tracker, documents and planning tools"],
  ["admin",    "Admin",          "All of the above, plus the planner and this screen"]
];

const clean = (s) => String(s || "").trim().toLowerCase();
const okEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);

export function render(view, ctx) {
  view.innerHTML = `
    <div class="card">
      <h2>Add someone</h2>
      <p class="small muted" style="margin-top:-8px">
        They can sign in as soon as you add them. No invitation email is sent &mdash;
        tell them the hub address and they ask for a code themselves.
      </p>
      <!-- novalidate so the wording below is what people see. The browser's
           own "Please enter an email address" bubble cannot be changed, does
           not match anything else on this screen, and on a phone it can appear
           off the top of a scrolled form where nobody finds it. -->
      <form id="p-form" novalidate>
        <div class="grid g2" style="gap:14px">
          <label class="field" style="margin:0"><span>Email address</span>
            <input type="email" id="p-email" placeholder="someone@charity.org"></label>
          <label class="field" style="margin:0"><span>Access level</span>
            <select id="p-tier">
              ${TIERS.map(([v, label]) => `<option value="${v}">${label}</option>`).join("")}
            </select></label>
          <label class="field" style="margin:0"><span>Name</span>
            <input type="text" id="p-name" placeholder="Jane Doughty"></label>
          <label class="field" style="margin:0"><span>Organisation</span>
            <input type="text" id="p-org" placeholder="Farm Africa"></label>
        </div>
        <p class="small muted" id="p-tier-note" style="margin:4px 0 14px"></p>
        <button class="btn" id="p-add">Add them</button>
      </form>
      <div id="p-msg" hidden></div>
    </div>

    <div class="card"><h2>Everyone with access</h2><div id="p-list"></div></div>`;

  const tierSel = document.getElementById("p-tier");
  const note = () => {
    const found = TIERS.find(t => t[0] === tierSel.value);
    document.getElementById("p-tier-note").textContent = found ? found[2] : "";
  };
  tierSel.addEventListener("change", note);
  note();

  document.getElementById("p-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("p-add");
    const msg = document.getElementById("p-msg");
    const email = clean(document.getElementById("p-email").value);
    msg.hidden = true;

    if (!okEmail(email)) {
      msg.className = "note note-bad";
      msg.textContent = "That does not look like an email address.";
      msg.hidden = false;
      return;
    }
    btn.disabled = true;
    try {
      await addDoc(collection(db, "members"), {
        email,
        signInEmails: [email],
        name: document.getElementById("p-name").value.trim(),
        org:  document.getElementById("p-org").value.trim(),
        tier: tierSel.value,
        addedBy: ctx.user.uid,
        createdAt: serverTimestamp()
      });
      document.getElementById("p-form").reset();
      note();
      toast("Added. They can sign in now.");
    } catch (err) {
      msg.className = "note note-bad";
      msg.textContent = "Could not add them. " + (err.message || "");
      msg.hidden = false;
      console.error(err);
    }
    btn.disabled = false;
  });

  return onSnapshot(query(collection(db, "members"), orderBy("email")), (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const list = document.getElementById("p-list");

    if (!rows.length) {
      list.innerHTML = `<div class="empty"><div class="ico">◍</div>
        <div class="t">Nobody yet</div></div>`;
      return;
    }

    // Duplicate sign-in addresses would make the lookup non-deterministic —
    // it takes the first match. Worth surfacing rather than debugging later.
    const seen = new Map();
    for (const m of rows) for (const a of (m.signInEmails || [])) {
      seen.set(a, (seen.get(a) || 0) + 1);
    }
    const clashes = [...seen.entries()].filter(([, n]) => n > 1).map(([a]) => a);

    list.innerHTML = `
      ${clashes.length ? `<div class="note note-bad" style="margin:0 0 16px">
        The same sign-in address is on more than one record:
        ${clashes.map(esc).join(", ")}. Sign-in takes the first match, so remove
        the duplicate before anyone uses it.</div>` : ""}
      <ul class="list">${rows.map(m => {
        const t = tierOf(m.tier);
        const extras = (m.signInEmails || []).filter(a => a !== m.email);
        return `<li>
          <div class="item-h">
            <span class="ttl">${esc(m.name || m.email)}</span>
            <span class="tag ${t === 3 ? "brick" : ""}">${esc(TIER_LABEL[t] || m.tier || "no access")}</span>
            <time>${m.lastSeen ? "seen " + ago(m.lastSeen)
                   : m.uid ? "signed in" : "never signed in"}</time>
          </div>
          <div class="small muted" style="margin-top:3px">
            ${esc(m.email)}${m.org ? " · " + esc(m.org) : ""}
            ${m.createdAt ? " · added " + when(m.createdAt) : ""}
          </div>
          ${extras.length ? `<div class="small muted" style="margin-top:5px">
            Also signs in as: ${extras.map(a => `<span class="tag">${esc(a)}</span>
              <button class="linkish" data-drop="${m.id}" data-addr="${esc(a)}"
                style="font-size:12px">remove</button>`).join(" ")}
          </div>` : ""}
          <div class="item-h" style="margin-top:10px;gap:8px">
            <select class="tier-pick" data-id="${m.id}" data-was="${esc(m.tier || "")}"
                    style="width:auto;padding:5px 9px;font-size:13.5px">
              ${TIERS.map(([v, label]) =>
                `<option value="${v}"${m.tier === v ? " selected" : ""}>${label}</option>`).join("")}
            </select>
            <button class="vote btn-sm" data-addr-for="${m.id}">Add another sign-in address</button>
            ${m.id === ctx.user.memberId
              ? `<span class="small muted" style="margin-left:auto">This is you</span>`
              : `<button class="linkish" data-remove="${m.id}"
                   data-name="${esc(m.name || m.email)}" style="margin-left:auto">Remove</button>`}
          </div>
        </li>`;
      }).join("")}</ul>`;

    wire(list, ctx);
  }, (err) => {
    document.getElementById("p-list").innerHTML =
      `<p class="muted small">Could not load. ${esc(err.message || "")}</p>`;
  });
}

function wire(list, ctx) {
  // Changing a tier re-stamps the claim and revokes their tokens, so say so.
  list.querySelectorAll(".tier-pick").forEach(sel => {
    sel.addEventListener("change", async () => {
      const was = sel.dataset.was;
      if (sel.value === was) return;
      sel.disabled = true;
      try {
        await updateDoc(doc(db, "members", sel.dataset.id), { tier: sel.value });
        toast("Access changed. It takes effect on their screen within a few seconds.");
      } catch (err) {
        toast("Could not change that.");
        sel.value = was;
        console.error(err);
      }
      sel.disabled = false;
    });
  });

  list.querySelectorAll("[data-addr-for]").forEach(b => {
    b.addEventListener("click", async () => {
      const extra = clean(window.prompt(
        "Which other address do they sign in with?\n\n" +
        "This is for someone whose work account is not the address you hold — " +
        "adding it here lets them in without changing anything else."));
      if (!extra) return;
      if (!okEmail(extra)) { toast("That does not look like an email address."); return; }
      b.disabled = true;
      try {
        await updateDoc(doc(db, "members", b.dataset.addrFor), { signInEmails: arrayUnion(extra) });
        toast("Added. They can sign in with either address.");
      } catch { toast("Could not add that address."); }
      b.disabled = false;
    });
  });

  list.querySelectorAll("[data-drop]").forEach(b => {
    b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await updateDoc(doc(db, "members", b.dataset.drop), { signInEmails: arrayRemove(b.dataset.addr) });
        toast("Removed.");
      } catch { toast("Could not remove that address."); }
      b.disabled = false;
    });
  });

  list.querySelectorAll("[data-remove]").forEach(b => {
    b.addEventListener("click", async () => {
      if (!window.confirm(
        `Remove ${b.dataset.name}?\n\n` +
        "They lose access at once. Their sign-in account itself is not deleted, " +
        "so adding them again later restores them.")) return;
      b.disabled = true;
      try {
        await deleteDoc(doc(db, "members", b.dataset.remove));
        toast("Removed.");
      } catch { toast("Could not remove them."); b.disabled = false; }
    });
  });
}
