// ---------------------------------------------------------------------------
// Hub updates, emailed out.
//
// An admin writes an update on the Updates page. This function turns it into
// the branded email (the same wrapEmail as the sign-in code, so nothing drifts
// out of house style) and sends one email per person, so nobody sees anyone
// else's address.
//
// Recipients are chosen by group and built HERE, on the server, from the hub's
// members and the planner's CRM. The browser only says which groups; it never
// supplies the list, so a tampered page cannot mail the whole CRM.
//
//   sendUpdate({ updateId, groups, extra, dryRun: true })  -> who would get it
//   sendUpdate({ updateId, test: true })                    -> one copy to me
//   sendUpdate({ updateId, groups, extra })                 -> send it
// ---------------------------------------------------------------------------
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue, Timestamp } from "firebase-admin/firestore";
import { BRAND } from "./brand.js";
import { wrapEmail, esc } from "./email.js";

let _db = null;
const db = () => (_db ??= getFirestore());   // see tracker.js: resolved on first use
const REGION = "europe-west2";               // stated here, see tracker.js

const REPLY_TO = "martin@voxhouses.global";
// Our own addresses are left out of the charity groups (they are hub members anyway).
const INTERNAL = /@(voxhouses\.global|prossermanagement\.uk|scancastle\.com|example\.com)$/i;
const MAX_RECIPIENTS = 400;
const okEmail = (e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);

// ---- the update body: a small, safe markdown -------------------------------
//   ## Heading       - bullet       **bold**       [text](https://link)
//   Blank line = new paragraph.
const P  = `margin:0 0 16px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${BRAND.ink};`;
const H2 = `margin:26px 0 10px;font-family:Arial,Helvetica,sans-serif;font-size:18px;line-height:1.3;font-weight:bold;color:${BRAND.grey};`;
const UL = `margin:0 0 16px;padding-left:22px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;color:${BRAND.ink};`;

function inline(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      `<a href="$2" style="color:${BRAND.grey};text-decoration:underline;">$1</a>`);
}

export function mdToEmailHtml(text) {
  const blocks = String(text || "").replace(/\r/g, "").split(/\n{2,}/).map(b => b.trim()).filter(Boolean);
  return blocks.map(b => {
    if (b.startsWith("## ")) return `<h2 style="${H2}">${inline(b.slice(3))}</h2>`;
    const lines = b.split("\n");
    if (lines.every(l => /^\s*[-•]\s+/.test(l))) {
      return `<ul style="${UL}">${lines.map(l => `<li style="margin:0 0 6px;">${inline(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    return `<p style="${P}">${lines.map(inline).join("<br>")}</p>`;
  }).join("");
}

function mdToText(text) {
  return String(text || "").replace(/\r/g, "")
    .replace(/^## /gm, "").replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1 ($2)")
    .replace(/^\s*[-•]\s+/gm, "• ");
}

// ---- who gets it -------------------------------------------------------------
export const GROUPS = {
  members:  "Hub members",
  signed:   "Signed charities",
  expected: "Expected to sign"
};

async function buildRecipients(groups, extra) {
  const out = new Map();
  const add = (email, name, group) => {
    const e = String(email || "").trim().toLowerCase();
    if (!okEmail(e) || out.has(e)) return;
    out.set(e, { email: e, name: String(name || "").trim(), group });
  };

  if (groups.includes("members")) {
    (await db().collection("members").get()).forEach(d => {
      const m = d.data() || {};
      add(m.email, m.name, GROUPS.members);
    });
  }

  if (groups.includes("signed") || groups.includes("expected")) {
    const deals = (await db().collection("crm_deals").get()).docs
      .map(d => d.data() || {}).filter(d => d.archived !== true);
    for (const d of deals) {
      const isSigned = d.stage === "Onboarded" || d.pledged === true;
      const group = groups.includes("signed") && isSigned ? GROUPS.signed
                  : groups.includes("expected") && d.stage === "Expected to sign" ? GROUPS.expected : null;
      if (!group || !d.contactId) continue;
      const c = await db().collection("crm_contacts").doc(d.contactId).get();
      if (!c.exists) continue;
      const x = c.data() || {};
      // Only the main contact, and only an address we know works.
      if (x.email && !x.emailUnverified && !INTERNAL.test(x.email)) {
        add(x.email, x.contactName, `${group}: ${x.orgName || d.contactName || ""}`);
      }
    }
    if (groups.includes("signed")) {
      // Whoever actually signed the Pledge by e-sign, on the charity's side.
      const reqs = await db().collection("esign_signature_requests").where("status", "==", "signed").get();
      for (const r of reqs.docs) {
        if (r.data().hidden) continue;
        if (!/pledge/i.test(r.data().title || "")) continue;
        const parties = await r.ref.collection("parties").get();
        parties.forEach(p => {
          const q = p.data() || {};
          if (q.status === "signed" && !INTERNAL.test(q.email || "")) add(q.email, q.name, `${GROUPS.signed}: signed the Pledge`);
        });
      }
    }
  }

  (Array.isArray(extra) ? extra : []).forEach(e => add(e, "", "Added by hand"));
  return [...out.values()];
}

// ---- sending -----------------------------------------------------------------
async function resendBatch(messages) {
  const res = await fetch("https://api.resend.com/emails/batch", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(messages)
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Resend refused the send: ${body.message || res.status}`);
  return body;
}

export const sendUpdate = onCall({ region: REGION, secrets: ["RESEND_API_KEY"], timeoutSeconds: 120 }, async (req) => {
  if (req.auth?.token?.tier !== "admin") throw new HttpsError("permission-denied", "Only admins can email updates.");
  const { updateId, groups = [], extra = [], exclude = [], dryRun = false, test = false } = req.data || {};

  const ref = db().collection("updates").doc(String(updateId || "x"));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError("not-found", "Save the update first, then email it.");
  const u = snap.data() || {};
  if (!u.title || !u.body) throw new HttpsError("failed-precondition", "The update needs a title and some text.");

  const firstLine = mdToText(u.body).split("\n").find(l => l.trim() && !/^(hello|hi|dear)\b/i.test(l.trim())) || "";
  const html = wrapEmail({
    title: u.title,
    bodyHtml: mdToEmailHtml(u.body),
    ctaLabel: u.ctaLabel || "Read it on the hub",
    ctaHref: u.ctaHref || `${BRAND.hubUrl}/#/updates`,
    preheader: firstLine.slice(0, 140)
  });
  const text = `${u.title}\n\n${mdToText(u.body)}\n\n${u.ctaHref || BRAND.hubUrl + "/#/updates"}`;
  const subject = u.subject || u.title;
  const message = (to) => ({ from: BRAND.from, to: [to], reply_to: REPLY_TO, subject, html, text });

  if (test) {
    const me = String(req.auth.token.email || "").toLowerCase();
    if (!okEmail(me)) throw new HttpsError("failed-precondition", "Your account has no email address.");
    await resendBatch([{ ...message(me), subject: "[Test] " + subject }]);
    return { sent: 1, test: true, to: me };
  }

  const skip = new Set((Array.isArray(exclude) ? exclude : []).map(e => String(e).trim().toLowerCase()));
  const list = (await buildRecipients(Array.isArray(groups) ? groups : [], extra)).filter(r => !skip.has(r.email));
  if (dryRun) return { count: list.length, recipients: list };
  if (!list.length) throw new HttpsError("failed-precondition", "Nobody to send to. Pick at least one group.");
  if (list.length > MAX_RECIPIENTS) throw new HttpsError("failed-precondition", `That is ${list.length} people — more than the ${MAX_RECIPIENTS} limit.`);

  for (let i = 0; i < list.length; i += 100) {
    await resendBatch(list.slice(i, i + 100).map(r => message(r.email)));
  }
  await ref.update({
    sends: FieldValue.arrayUnion({
      at: Timestamp.now(), count: list.length, groups, by: req.auth.token.email || "",
      to: list.map(r => r.email)
    })
  });
  console.info(`update ${updateId} emailed to ${list.length}`);
  return { sent: list.length };
});
