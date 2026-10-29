// ---------------------------------------------------------------------------
// Viewing sign-ups — the two emails that go out when somebody signs up.
//
// Fires on a new document in viewing_signups. That document is written by a
// stranger with no account, straight from /viewing.html, so everything here
// treats it as untrusted: it is escaped before it goes near any HTML, and
// nothing in it decides who gets emailed.
//
// The address lives in viewings/{id}/private/details and is read HERE, on the
// server, never by the form. That is the whole point of the split: it reaches
// people who actually signed up and nobody who was merely forwarded a link.
//
// The region is set explicitly rather than left to setGlobalOptions in
// index.js. A re-exported trigger can be defined before that call runs, which
// would quietly deploy it to us-central1.
// ---------------------------------------------------------------------------
import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { Resend } from "resend";
import { wrapEmail, esc } from "./email.js";
import { BRAND } from "./brand.js";

let client = null;
function resend() {
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

const P = (text, colour = BRAND.ink, size = "15px") =>
  `<p style="margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:${size};
             line-height:1.7;color:${colour};">${text}</p>`;

// The Resend SDK does NOT throw on an API error — it resolves with
// { data: null, error: {...} }, so a refused send looks exactly like a
// successful one unless the error field is checked. Same trap as email.js.
async function send(opts) {
  const res = await resend().emails.send(opts);
  if (res?.error) {
    const e = res.error;
    throw new Error(`Resend refused the send: ${e.name || ""} ${e.message || JSON.stringify(e)}`);
  }
  return res;
}

function answerRows(questions, answers) {
  const byKey = new Map();
  (Array.isArray(questions) ? questions : []).forEach((q, i) => {
    byKey.set(q.key || ("q" + (i + 1)), q.label || `Question ${i + 1}`);
  });
  return Object.entries(answers || {})
    .map(([k, v]) => `<tr>
      <td style="padding:6px 14px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.muted};vertical-align:top;white-space:nowrap;">${esc(byKey.get(k) || k)}</td>
      <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.ink};">${esc(v)}</td></tr>`).join("");
}

export const onViewingSignup = onDocumentCreated(
  { document: "viewing_signups/{id}", region: "europe-west2", secrets: ["RESEND_API_KEY"] },
  async (event) => {
    const db = getFirestore();
    const ref = event.data?.ref;
    const s = event.data?.data();
    if (!ref || !s) return;

    const vSnap = await db.doc(`viewings/${s.viewingId}`).get();
    const v = vSnap.exists ? vSnap.data() : {};
    const pSnap = await db.doc(`viewings/${s.viewingId}/private/details`).get();
    const priv = pSnap.exists ? pSnap.data() : {};

    const when = [v.dateText, v.timeText].filter(Boolean).join(", ");
    const title = v.title || "the VOX London viewing";
    const rows = answerRows(v.questions, s.answers);

    /* ---- 1. the person who signed up --------------------------------- */
    let ok = false, problem = "";
    try {
      await send({
        from: BRAND.from,
        to: s.email,
        replyTo: BRAND.support,
        subject: `You are booked in — ${title}`,
        html: wrapEmail({
          title: "You are booked in",
          preheader: `${when}${priv.address ? " · " + priv.address : ""}`,
          bodyHtml:
            P(`${esc((s.name || "").split(" ")[0] || "Hello")}, thank you for signing up. Here are the details.`) +
            `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
              ${when ? `<tr><td style="padding:6px 14px 6px 0;font-family:Arial,Helvetica,sans-serif;
                 font-size:14px;color:${BRAND.muted};vertical-align:top;">When</td>
                 <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.ink};"><b>${esc(when)}</b></td></tr>` : ""}
              ${priv.address ? `<tr><td style="padding:6px 14px 6px 0;font-family:Arial,Helvetica,sans-serif;
                 font-size:14px;color:${BRAND.muted};vertical-align:top;">Where</td>
                 <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.ink};"><b>${esc(priv.address)}</b></td></tr>` : ""}
              ${s.guests ? `<tr><td style="padding:6px 14px 6px 0;font-family:Arial,Helvetica,sans-serif;
                 font-size:14px;color:${BRAND.muted};vertical-align:top;">Coming</td>
                 <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.ink};">${esc(String(s.guests))}</td></tr>` : ""}
            </table>` +
            (priv.arrivalNotes ? P(esc(priv.arrivalNotes), BRAND.muted, "14px") : "") +
            P(`If you can no longer make it, or anything changes, just reply to this email.`,
              BRAND.muted, "14px")
        })
      });
      ok = true;
    } catch (err) {
      problem = String(err?.message || err);
      console.error("viewing confirmation failed", s.email, problem);
    }

    /* ---- 2. Martin ---------------------------------------------------- */
    try {
      await send({
        from: BRAND.from,
        to: BRAND.support,
        replyTo: s.email,
        subject: `Viewing sign-up: ${s.name}${s.org ? " — " + s.org : ""}`,
        html: wrapEmail({
          title: "Somebody signed up",
          preheader: `${s.name}${s.org ? ", " + s.org : ""} — ${title}`,
          bodyHtml:
            `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
              <tr><td style="padding:6px 14px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.muted};vertical-align:top;white-space:nowrap;">Name</td>
                 <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.ink};"><b>${esc(s.name)}</b></td></tr>
              <tr><td style="padding:6px 14px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.muted};vertical-align:top;">Email</td>
                 <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.ink};">${esc(s.email)}</td></tr>
              ${s.org ? `<tr><td style="padding:6px 14px 6px 0;font-family:Arial,Helvetica,sans-serif;
                 font-size:14px;color:${BRAND.muted};vertical-align:top;">Organisation</td>
                 <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.ink};">${esc(s.org)}</td></tr>` : ""}
              ${s.role ? `<tr><td style="padding:6px 14px 6px 0;font-family:Arial,Helvetica,sans-serif;
                 font-size:14px;color:${BRAND.muted};vertical-align:top;">Job title</td>
                 <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.ink};">${esc(s.role)}</td></tr>` : ""}
              <tr><td style="padding:6px 14px 6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.muted};vertical-align:top;">Coming</td>
                 <td style="padding:6px 0;font-family:Arial,Helvetica,sans-serif;font-size:14px;
                 color:${BRAND.ink};">${esc(String(s.guests ?? 1))}</td></tr>
              ${rows}
            </table>` +
            (ok ? "" : `<div style="background:${BRAND.brick25};padding:14px 16px;margin:0 0 20px;">
              ${P(`<b>Their confirmation did not send.</b> They have not been given the address.
                   ${esc(problem)}`, BRAND.ink, "14px")}</div>`),
          ctaLabel: "Open the hub",
          ctaHref: `${BRAND.hubUrl}/#/viewings`
        })
      });
    } catch (err) {
      console.error("viewing alert to Martin failed", String(err?.message || err));
    }

    // Recorded either way, so the list in the hub can show who is still owed
    // their address rather than leaving it to somebody to notice.
    await ref.set({
      confirmationSent: ok,
      confirmationError: ok ? FieldValue.delete() : problem.slice(0, 500),
      confirmationAt: FieldValue.serverTimestamp()
    }, { merge: true });
  });
