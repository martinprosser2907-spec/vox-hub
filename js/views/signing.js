// ---------------------------------------------------------------------------
// Signing — any document, not just the Pledge.
//
// The hub does not sign anything itself. VOX eSign does, and this page is the
// way in: pick a document, say who it goes to, send. One list underneath shows
// everything out for signature and how far it has got.
//
// Where documents come from: you send one from eSign first, placing the
// signature boxes in the viewer that already exists, then press "Save as
// template" there. After that it appears in the picker here and can go to
// anybody — same PDF, same boxes, filled in for whoever is signing. Nothing
// places boxes twice, which is the whole point.
//
// Who can do what — enforced in the functions, not here:
//   see the list   steering and above (without addresses)
//   send and chase VOX only
// ---------------------------------------------------------------------------
import { callable } from "../fb.js";
import { ESIGN_URL } from "../config.js";
import { esc, when, ago, toast, tierOf } from "../ui.js";

const STATUS = {
  pending:  "Not opened",
  viewed:   "Opened",
  signed:   "Signed",
  declined: "Declined",
  expired:  "Expired"
};

export function render(view, ctx) {
  const isAdmin = tierOf(ctx.user.tier) >= 3;
  let templates = [];
  let rows = [];

  view.innerHTML = `
    ${isAdmin ? `<div class="card" id="s-send">
      <!-- The link to eSign used to appear only when there were no templates
           yet. That is the one moment you least need it: it vanished the
           instant the first template existed, so making a SECOND one had no
           way in from the hub at all. It sits in the heading now, where it is
           there whether the picker is empty or full. -->
      <div class="item-h" style="margin-bottom:16px">
        <h2 style="margin:0">Send a document</h2>
        <a href="${ESIGN_URL}/dashboard" target="_blank" rel="noopener"
           style="margin-left:auto;font-size:13px">Open VOX eSign &#8599;</a>
      </div>
      <div id="s-send-body"><div class="skel"></div><div class="skel" style="width:50%"></div></div>
    </div>` : ""}
    <div class="card">
      <h2>Out for signature</h2>
      <div id="s-list"><div class="skel"></div><div class="skel" style="width:60%"></div></div>
    </div>`;

  const $ = (id) => document.getElementById(id);

  /* -- the list ---------------------------------------------------------- */
  async function loadList() {
    const box = $("s-list");
    try {
      const { rows: r } = (await callable("signingList")()).data;
      rows = r || [];
    } catch (err) {
      box.innerHTML = `<p class="muted small">Could not load. ${esc(err?.message || "")}</p>`;
      return;
    }
    if (!rows.length) {
      box.innerHTML = `<div class="empty"><div class="ico">&#9998;</div>
        <div class="t">Nothing out for signature</div>
        <div class="n">${isAdmin ? "Send one above." : "VOX has not sent anything yet."}</div></div>`;
      return;
    }
    box.innerHTML = rows.map(r => `
      <div style="margin-bottom:22px">
        <div class="item-h">
          <span class="ttl">${esc(r.documentTitle)}</span>
          <span class="tag ${r.status === "signed" ? "brick" : ""}">${esc(STATUS[r.status] || r.status)}</span>
          <time>${r.createdAt ? "sent " + esc(ago(r.createdAt)) : ""}</time>
        </div>
        <ul class="list" style="margin-top:6px">${(r.signers || []).map(s => `
          <li style="padding:9px 0">
            <div class="item-h">
              <span style="font-weight:600;font-size:14.5px">${esc(s.name)}</span>
              <span class="tag ${s.status === "signed" ? "brick" : ""}">${esc(STATUS[s.status] || s.status)}</span>
              ${s.signedAt ? `<time>signed ${esc(when(s.signedAt))}</time>` : ""}
            </div>
            <div class="small muted" style="margin-top:3px">
              ${[
                 s.email ? esc(s.email) : "",
                 s.reminderSentAt ? "chased " + esc(when(s.reminderSentAt)) : ""
               ].filter(Boolean).join(" · ")}
              ${(isAdmin && s.status !== "signed" && s.status !== "declined")
                ? ` &middot; <button class="linkish" data-remind="${esc(r.id)}" data-party="${esc(s.id)}"
                      data-name="${esc(s.name)}" style="font-size:13px">send a reminder</button>` : ""}
            </div>
          </li>`).join("")}</ul>
      </div>`).join("");

    box.querySelectorAll("[data-remind]").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await callable("remindSigner")({ requestId: b.dataset.remind, partyId: b.dataset.party });
        toast(`Reminder sent to ${b.dataset.name}.`);
        loadList();
      } catch (err) { toast(err?.message || "Could not send that reminder."); b.disabled = false; }
    }));
  }

  /* -- sending ----------------------------------------------------------- */
  async function loadSend() {
    const body = $("s-send-body");
    try {
      const { templates: t } = (await callable("signingTemplates")()).data;
      templates = t || [];
    } catch (err) {
      body.innerHTML = `<p class="muted small">Could not load the documents. ${esc(err?.message || "")}</p>`;
      return;
    }
    if (!templates.length) {
      body.innerHTML = `<div class="note note-info" style="margin:0">
        No documents are set up to send yet. In VOX eSign, send the document once and place the
        signature boxes, then press <strong>Save as template</strong> on it. It will appear here.
      </div>
      <div style="margin-top:16px">
        <a class="btn btn-ghost" href="${ESIGN_URL}/dashboard"
           target="_blank" rel="noopener">Open VOX eSign</a>
      </div>`;
      return;
    }

    body.innerHTML = `
      <p class="small muted" style="margin-top:-8px">
        The signature boxes are already placed on these. Choose who signs and it goes out by email.
      </p>
      <label class="field"><span>Document</span>
        <select id="s-template">${templates.map(t =>
          `<option value="${esc(t.id)}">${esc(t.name)}</option>`).join("")}</select></label>
      <div id="s-roles"></div>
      <div id="s-msg" hidden></div>
      <button class="btn" id="s-go">Send it</button>`;

    const drawRoles = () => {
      const t = templates.find(x => x.id === $("s-template").value);
      $("s-roles").innerHTML = (t?.roles || []).map((r, i) => `
        <div class="grid g2" style="gap:14px">
          <label class="field" style="margin:0 0 6px"><span>${esc(r.label)} &mdash; name</span>
            <input type="text" data-role="${esc(r.id)}" data-f="name"
                   placeholder="${i === 0 ? "Jane Doughty" : "Martin Prosser"}"></label>
          <label class="field" style="margin:0 0 6px"><span>${esc(r.label)} &mdash; email</span>
            <input type="email" data-role="${esc(r.id)}" data-f="email"
                   placeholder="${i === 0 ? "jane@theircharity.org" : "martin@voxhouses.global"}"></label>
        </div>`).join("")
        || `<p class="small muted">This document has no signing roles on it — re-save it as a
            template in eSign with at least one signer.</p>`;
    };
    $("s-template").addEventListener("change", drawRoles);
    drawRoles();

    $("s-go").addEventListener("click", async () => {
      const btn = $("s-go"), msg = $("s-msg");
      msg.hidden = true;
      const t = templates.find(x => x.id === $("s-template").value);
      const fill = (t?.roles || []).map(r => {
        const g = (f) => document.querySelector(`[data-role="${CSS.escape(r.id)}"][data-f="${f}"]`)?.value.trim() || "";
        return { roleId: r.id, name: g("name"), email: g("email") };
      }).filter(f => f.name || f.email);

      const fail = (text) => {
        msg.className = "note note-bad"; msg.textContent = text; msg.hidden = false; btn.disabled = false;
      };
      if (!fill.length) return fail("Fill in at least one signer.");
      const bad = fill.find(f => !f.name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email));
      if (bad) return fail(`${bad.name || "That signer"} needs both a name and a valid email address.`);

      btn.disabled = true;
      try {
        const out = (await callable("sendForSignature")({
          templateId: t.id, fill, documentTitle: t.documentTitle
        })).data;
        msg.className = "note note-ok";
        msg.textContent = `Sent to ${out.sent} ${out.sent === 1 ? "person" : "people"}. They have it by email now.`;
        msg.hidden = false;
        $("s-roles").querySelectorAll("input").forEach(i => { i.value = ""; });
        loadList();
      } catch (err) {
        return fail(err?.message || "Could not send that.");
      }
      btn.disabled = false;
    });
  }

  loadList();
  if (isAdmin) loadSend();
}
