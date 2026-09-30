// ---------------------------------------------------------------------------
// The Pledge.
//
// The document itself is signed in VOX eSign — a separate app on the same
// Firebase project — so this page is two things stacked: where YOUR signature
// has got to, and what the Pledge actually commits you to.
//
// The status comes from the pledgeStatus function rather than from Firestore
// directly. A charity must see their own Pledge and nobody else's, and the
// record that says whether they have signed sits in a subcollection carrying
// the token that IS the authority to sign. That read belongs on the server.
// ---------------------------------------------------------------------------
import { db, doc, getDoc, callable } from "../fb.js";
import { esc, paras, when, toast } from "../ui.js";

// VOX's list of everybody. Your own card writes its own wording per state,
// because the same status reads differently depending on who is looking:
// "waiting for your signature" is right on your card and wrong here, where
// it is somebody else's signature.
const ROLL_LABEL = {
  pending:  "Not opened",
  viewed:   "Opened",
  signed:   "Signed",
  declined: "Declined",
  expired:  "Expired"
};

export async function render(view) {
  let d = {};
  try { const s = await getDoc(doc(db, "content", "pledge")); if (s.exists()) d = s.data(); } catch {}

  view.innerHTML = `
    <div id="p-status"><div class="card"><div class="skel"></div>
      <div class="skel" style="width:55%"></div></div></div>

    <div class="card">
      <h3>${esc(d.headline || "The VOX London Pledge")}</h3>
      <p class="lede">${esc(d.standfirst ||
        "A declaration of interest. Two or three pages, non-binding and non-financial.")}</p>
      <div class="grid g2" style="margin:22px 0">
        <div class="stat"><div class="big">Non-binding</div>
          <div class="lab">No commitment to a location, a building, or money</div></div>
        <div class="stat"><div class="big">Free to sign</div>
          <div class="lab">Between your organisation and VOX London</div></div>
      </div>
      ${paras(d.body ||
        "Signing tells us — and tells the other charities — that you intend to be part of the "
      + "process, including choosing the site. It is what lets VOX approach landlords on behalf of the "
      + "group rather than as individual charities.\n\n"
      + "It does not stop you running your own property search alongside. The partnership covers VOX only.")}
      ${d.readUrl ? `<div style="margin-top:24px">
        <a class="btn btn-ghost" href="${esc(d.readUrl)}" target="_blank" rel="noopener">Read the Pledge</a>
      </div>` : ""}
    </div>

    <div class="card">
      <h2>Before you sign</h2>
      <div class="qa">
        <details><summary>Does this commit us to a location?</summary><div class="ans">
          <p>No. When a site is identified, organisations that want to join negotiations for that site move
          on with the project. Nobody can be voted into a building they do not want.</p></div></details>
        <details><summary>Does it cost anything?</summary><div class="ans">
          <p>Signing is free. Separately, organisations able to contribute to development costs can do so
          &mdash; and anything contributed now is taken off your costs later, as a discount once there is a
          building.</p></div></details>
        <details><summary>Can we keep looking elsewhere?</summary><div class="ans">
          <p>Yes. The partnership is limited to the VOX concept, so your own property search carries on
          unaffected.</p></div></details>
      </div>
    </div>`;

  /* -- your own Pledge, and for VOX everybody's --------------------------- */
  const box = document.getElementById("p-status");
  let res;
  try {
    res = (await callable("pledgeStatus")()).data;
  } catch (err) {
    console.error(err);
    box.innerHTML = `<div class="card"><h2>Your Pledge</h2>
      <p class="muted small">Could not check where your Pledge has got to.
      ${esc(err?.message || "")}</p></div>`;
    return;
  }

  const mine = res?.mine;
  const open = mine && (mine.status === "pending" || mine.status === "viewed");

  box.innerHTML = `
    <div class="card">
      <h2>Your Pledge</h2>
      ${!mine ? `
        <p>We have not sent your organisation the Pledge yet.</p>
        <p class="small muted">When it goes out it arrives by email, and it will also appear here
        so you can sign it without hunting through your inbox.</p>
        <div style="margin-top:18px">
          <a class="btn btn-ghost" href="mailto:martin@voxhouses.global?subject=VOX%20London%20Pledge">Ask for the Pledge</a>
        </div>`
      : mine.status === "signed" ? `
        <div class="note note-ok" style="margin:0">
          Signed${mine.signedAt ? " on " + esc(when(mine.signedAt)) : ""}. Thank you.
        </div>
        <p class="small muted" style="margin-top:14px">A copy went to the address it was sent to.
        If you need it again, ask Martin and he will send it back through.</p>`
      : mine.status === "declined" ? `
        <div class="note note-bad" style="margin:0">
          Recorded as declined${mine.declinedAt ? " on " + esc(when(mine.declinedAt)) : ""}.
        </div>
        <p class="small muted" style="margin-top:14px">If that was not what you meant, tell Martin and
        he will send it again.</p>`
      : mine.status === "expired" ? `
        <div class="note note-bad" style="margin:0">That signing link has expired.</div>
        <p class="small muted" style="margin-top:14px">Ask Martin for a fresh one — it takes a moment.</p>`
      : `
        <p class="lede" style="margin-bottom:18px">
          ${esc(mine.documentTitle)} is waiting for your signature.
        </p>
        <a class="btn" id="p-sign" href="${esc(mine.signingUrl || "#")}"
           target="_blank" rel="noopener">Sign the Pledge</a>
        <p class="small muted" style="margin-top:14px">
          Opens VOX eSign in a new tab. You draw or type your signature there; nothing to install,
          nothing to print.${mine.expiresAt ? ` This link is good until ${esc(when(mine.expiresAt))}.` : ""}
        </p>`}
    </div>

    ${res?.roll ? adminRoll(res) : ""}`;

  if (open && !mine.signingUrl) {
    // Belt and braces: the function only hands back a link while the Pledge is
    // still open, so an open status with no link means something is wrong at
    // the eSign end rather than something the person did.
    const b = document.getElementById("p-sign");
    if (b) {
      b.removeAttribute("href");
      b.setAttribute("disabled", "");
      b.addEventListener("click", () => toast("That link is not available — tell Martin."));
    }
  }
}

/* -- VOX's own view ------------------------------------------------------- */
function adminRoll(res) {
  const c = res.counts || { signed: 0, pending: 0, declined: 0 };
  return `
    <div class="card">
      <h2>Every Pledge</h2>
      <p class="small muted" style="margin-top:-8px">
        Only you can see this. Send, place the signature boxes and chase from VOX eSign.
      </p>
      <div class="grid g3" style="margin:18px 0">
        <div class="stat"><div class="big">${c.signed}</div><div class="lab">Signed</div></div>
        <div class="stat"><div class="big">${c.pending}</div><div class="lab">Still waiting</div></div>
        <div class="stat"><div class="big">${c.declined}</div><div class="lab">Declined</div></div>
      </div>
      ${res.roll.length ? `<ul class="list">${res.roll.map(r => `
        <li>
          <div class="item-h">
            <span class="ttl">${esc(r.name || r.email)}</span>
            <span class="tag ${r.status === "signed" ? "brick" : ""}">${esc(ROLL_LABEL[r.status] || r.status)}</span>
            <time>${r.signedAt ? "signed " + esc(when(r.signedAt)) : ""}</time>
          </div>
          <div class="small muted" style="margin-top:3px">
            ${esc(r.email)}${r.documentTitle ? " · " + esc(r.documentTitle) : ""}
            ${r.reminderSentAt ? " · reminded " + esc(when(r.reminderSentAt)) : ""}
          </div>
        </li>`).join("")}</ul>`
      : `<div class="empty"><div class="ico">&#9998;</div>
          <div class="t">No Pledges sent yet</div>
          <div class="n">Send the first one from VOX eSign.</div></div>`}
      <div style="margin-top:20px">
        <a class="btn btn-ghost" href="${esc(res.esignUrl || "")}/dashboard"
           target="_blank" rel="noopener">Open VOX eSign</a>
      </div>
    </div>`;
}
