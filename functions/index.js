// ---------------------------------------------------------------------------
// VOX London Hub — the only server-side code in the project.
//
// Three callable functions:
//   requestSignInCode  — look the person up, email them a six-digit code
//   verifySignInCode   — check it, stamp their tier onto a sign-in token
//   askHub             — the help assistant
//
// Why a code and not a link: a link tapped in an email client opens the
// default browser, not the installed app, so someone who has installed the
// hub would be signed in somewhere they are not looking. A typed code works
// the same everywhere. Calla learned this the expensive way.
// ---------------------------------------------------------------------------

// NOTE: any function that reads a secret from process.env MUST declare it in
// its onCall options — onCall({ secrets: ["X"] }, handler). Without that the
// variable is simply undefined at runtime and the send fails with no clue why.
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { onDocumentWritten } from "firebase-functions/v2/firestore";
import { setGlobalOptions } from "firebase-functions/v2";
import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { randomInt } from "node:crypto";
import { sendSignInCode } from "./email.js";
import { BRAND } from "./brand.js";

initializeApp();
setGlobalOptions({ region: "europe-west2", maxInstances: 10 });

const db = getFirestore();
const auth = getAuth();

const CODE_TTL_MS   = 10 * 60 * 1000;  // ten minutes
const RESEND_GAP_MS = 60 * 1000;       // one code a minute, per address
const MAX_ATTEMPTS  = 5;
const TIERS = ["general", "steering", "admin"];
const MODEL = process.env.VOX_ASSISTANT_MODEL || "claude-sonnet-5";

const clean = (e) => String(e || "").trim().toLowerCase();

/* =========================================================================
   1. Ask for a code
   ========================================================================= */
export const requestSignInCode = onCall({ secrets: ["RESEND_API_KEY"] }, async (req) => {
  const email = clean(req.data?.email);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpsError("invalid-argument", "That does not look like an email address.");
  }

  // Is this address on the list? Query rather than use it as a document id,
  // so a member's record can be found by either their listed address or a
  // second one they actually sign in with.
  const snap = await db.collection("members")
    .where("signInEmails", "array-contains", email).limit(1).get();

  const member = snap.empty ? null : { id: snap.docs[0].id, ...snap.docs[0].data() };

  // Say the same thing either way. A stranger must not be able to use this to
  // discover which charities are involved.
  const quiet = { sent: true };
  if (!member) {
    console.warn(`sign-in: no members record whose signInEmails contains ${email}`);
    return quiet;
  }
  if (member.tier == null) {
    console.warn(`sign-in: member ${member.id} found but has no tier set`);
    return quiet;
  }

  // Throttle. Without this anyone can post an address in a loop and fill a
  // real person's inbox.
  const codeRef = db.collection("loginCodes").doc(email);
  const existing = await codeRef.get();
  if (existing.exists) {
    const age = Date.now() - (existing.data().createdAt?.toMillis?.() ?? 0);
    if (age < RESEND_GAP_MS) {
      console.info(`sign-in: throttled, a code for ${email} is ${Math.round(age/1000)}s old`);
      return quiet;
    }
  }

  // randomInt, not Math.random — this is a credential.
  const code = String(randomInt(100000, 1000000));

  await codeRef.set({
    code,
    email,
    memberId:  member.id,
    tier:      member.tier,
    name:      member.name || "",
    attempts:  0,
    expiresAt: new Date(Date.now() + CODE_TTL_MS),
    createdAt: FieldValue.serverTimestamp()
  });

  try {
    await sendSignInCode({ to: email, code, name: member.name });
    console.info(`sign-in: code sent to ${email}`);
  } catch (err) {
    console.error(`sign-in: email to ${email} failed — ${err?.message}`);
    throw new HttpsError("internal", "We could not send the email. Try again in a moment.");
  }
  return quiet;
});

/* =========================================================================
   2. Use the code
   ========================================================================= */
export const verifySignInCode = onCall(async (req) => {
  const email = clean(req.data?.email);
  const given = String(req.data?.code || "").trim();
  const ref   = db.collection("loginCodes").doc(email);
  const snap  = await ref.get();

  if (!snap.exists) {
    // Either no code was ever issued for this address, or one was and it has
    // already been spent — including by a duplicate submit a moment earlier.
    console.warn(`verify: no live code for ${email}`);
    throw new HttpsError("not-found", "That code is not right. Ask for a new one.");
  }
  const d = snap.data();

  if (d.expiresAt.toMillis() < Date.now()) {
    await ref.delete();
    throw new HttpsError("deadline-exceeded", "That code has expired. Ask for a new one.");
  }
  if ((d.attempts || 0) >= MAX_ATTEMPTS) {
    await ref.delete();
    throw new HttpsError("resource-exhausted", "Too many attempts. Ask for a new code.");
  }
  if (d.code !== given) {
    console.warn(`verify: wrong code for ${email} — got ${given.length} digits, attempt ${(d.attempts || 0) + 1}`);
    // Count the attempt on the existing document. Asking for a new code
    // replaces this one, so the counter cannot be reset by requesting again
    // within the throttle window.
    await ref.update({ attempts: FieldValue.increment(1) });
    const left = MAX_ATTEMPTS - (d.attempts || 0) - 1;
    throw new HttpsError("permission-denied",
      left > 0 ? `That code is not right. ${left} ${left === 1 ? "try" : "tries"} left.`
               : "That code is not right. Ask for a new one.");
  }

  console.info(`verify: correct code for ${email}`);

  // Correct. Spend it before doing anything else.
  await ref.delete();

  // The tier is re-read from the member record, not taken from the code
  // document, in case it changed while the email sat in an inbox.
  const memberSnap = await db.collection("members").doc(d.memberId).get();
  if (!memberSnap.exists) throw new HttpsError("permission-denied", "That account is no longer active.");
  const tier = memberSnap.data().tier;
  if (!TIERS.includes(tier)) throw new HttpsError("permission-denied", "That account has no access set.");

  const user = await auth.getUserByEmail(email).catch(() => auth.createUser({ email }));

  // Stamp the tier onto the account, then mint the token.
  await auth.setCustomUserClaims(user.uid, { tier, memberId: d.memberId });

  // The second argument is NOT optional. createCustomToken does not carry a
  // user's existing claims across, so without it every rule that checks the
  // tier fails silently — the person signs in perfectly and then sees nothing.
  const token = await auth.createCustomToken(user.uid, { tier, memberId: d.memberId });

  await db.collection("members").doc(d.memberId).set({
    uid: user.uid, lastSeen: FieldValue.serverTimestamp()
  }, { merge: true });

  await db.collection("audit").add({
    what: "signed in", who: user.uid, email, at: FieldValue.serverTimestamp()
  });

  return { token, tier, name: d.name };
});

/* =========================================================================
   3. The help assistant
   ========================================================================= */

// What the assistant is allowed to know. Everything here is visible to every
// signed-in person, whatever their tier — so site addresses, landlord names
// and rent figures must never appear in it.
const PROMPT_GENERAL = `You are the help assistant inside the VOX London Hub, answering questions from staff at the charities in the VOX London founding group.

VOX London is building a purpose-built shared home for London's charity sector. A group of charities negotiates for one large building together and signs leases individually, which gives them the weight of a corporate headquarters rather than a single charity.

WHERE THE PROJECT IS
Three organisations have signed the Pledge, together about 40,000 sq ft. Eight more are expected to sign, about 35,000 sq ft. Seventeen more are in active conversation, over 60,000 sq ft. The target building is 150,000-200,000 sq ft, and negotiations start once 60-80% of the final capacity is committed. Twenty-one sites have been identified across central and inner London. Ten or more are close to or within the Circle line, which remains the working hypothesis for location.

THE TIMELINE
October: the Pledge goes to the organisations already in conversation, requirements gathering opens, site visits begin.
November: a shortlist of fewer than five buildings, an in-person session with the founding group.
December: interest above three quarters of building capacity, criteria pack agreed with the Steering Group.
Q1 2027: site selection, the stop-go point on both building and commitment.
2027: lease negotiation and signature. End of 2028: move in.

THE PLEDGE
Two or three pages, between VOX London and the individual charity. Non-binding and non-financial. It is a declaration of intent to be part of the process, including choosing the site. It does NOT commit anyone to a location, a building, or money. It does not stop an organisation running its own property search — the partnership covers VOX only. Signing is free. Separately, organisations able to contribute to development costs may do so, and anything contributed now is taken off their costs later as a discount once there is a building.

PRECEDENT
Copenhagen opened in 2025 and is more than 90% let. Stockholm has 35 organisations signed to a letter of intent and is negotiating for a space.

HOW TO ANSWER
Be brief and concrete. Use plain British English. If something has not been decided, say so plainly rather than guessing — "that has not been decided yet, and it is a question for the Steering Group" is a good answer. Never invent a figure, a date, a site or a landlord. You do not know which buildings are under review or what they cost; if asked, say those details sit with the Steering Group. If someone needs a person, point them at Martin Prosser, ${BRAND.support}.`;

export const askHub = onCall({ secrets: ["ANTHROPIC_API_KEY"] }, async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");

  // Tier is read but deliberately not used to widen the prompt yet. When a
  // Steering Group assistant is added it gets its own prompt, behind this check.
  const tier = req.auth.token?.tier;
  if (!TIERS.includes(tier)) throw new HttpsError("permission-denied", "No access.");

  const messages = Array.isArray(req.data?.messages) ? req.data.messages.slice(-12) : [];
  if (!messages.length) throw new HttpsError("invalid-argument", "Nothing to answer.");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01"
    },
    body: JSON.stringify({
      // Model IDs from the 4.6 generation on are dateless and are the snapshot
      // itself, not an alias. Sonnet is the right fit here: a short answer to a
      // plain question, many times a day.
      model: MODEL,
      max_tokens: 700,
      system: PROMPT_GENERAL,
      messages: messages.map(m => ({
        role: m.role === "assistant" ? "assistant" : "user",
        content: String(m.content || "").slice(0, 4000)
      }))
    })
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "(no body)");
    console.error(`assistant: ${MODEL} returned ${res.status} — ${body.slice(0, 600)}`);
    throw new HttpsError("internal", "The assistant is not answering just now.");
  }
  const data = await res.json();
  return { reply: data?.content?.[0]?.text || "Sorry, I could not answer that one." };
});

/* =========================================================================
   4. Keeping the tier claim in step with the member record
   -------------------------------------------------------------------------
   A tier change in Firestore does NOT change the claim on someone's token.
   Without this, an admin promotes somebody, the member record says "steering",
   the token still says "general", and the rules — correctly — refuse them.

   So: when the tier changes, re-stamp the claim and touch claimsUpdatedAt.
   The browser watches that field and forces a token refresh when it moves.
   ========================================================================= */
export const onMemberTierChanged = onDocumentWritten("members/{memberId}", async (event) => {
  const before = event.data?.before?.data();
  const after  = event.data?.after?.data();

  // Removed from the People screen. Deleting the record used to do NOTHING to
  // the person's access: the claim lives on the auth user, not on this
  // document, so their token kept working and every refresh minted another one
  // that still said "steering". Removal has to reach the auth user or it is
  // not removal at all.
  if (!after) {
    const goneUid = before?.uid;
    if (!goneUid) return;                          // never signed in — nothing to revoke
    await auth.setCustomUserClaims(goneUid, {});
    await auth.revokeRefreshTokens(goneUid);
    await db.collection("audit").add({
      what: "member removed",
      who: goneUid,
      from: before?.tier ?? null,
      to: null,
      email: before?.email ?? null,
      at: FieldValue.serverTimestamp()
    });
    console.log(`removed: ${event.params.memberId} (${before?.email ?? "no email"}) — claims cleared, tokens revoked`);
    return;
  }

  if (before?.tier === after.tier) return;         // not a tier change — also
                                                   // stops this retriggering on
                                                   // its own write below
  const uid = after.uid;
  if (!uid) return;                                // never signed in yet; the
                                                   // claim is set at first sign-in

  const tier = TIERS.includes(after.tier) ? after.tier : null;

  await auth.setCustomUserClaims(uid, tier ? { tier, memberId: event.params.memberId } : {});

  // Revoking forces any device that is signed in to fetch a new token rather
  // than coast on the old one for up to an hour.
  await auth.revokeRefreshTokens(uid);

  await event.data.after.ref.set({
    claimsUpdatedAt: FieldValue.serverTimestamp()
  }, { merge: true });

  await db.collection("audit").add({
    what: "tier changed",
    who: uid,
    from: before?.tier ?? null,
    to: tier,
    at: FieldValue.serverTimestamp()
  });

  console.log(`tier: ${event.params.memberId} ${before?.tier ?? "none"} -> ${tier ?? "none"}`);
});

/* =========================================================================
   5. The Pledge, as seen from the hub
   -------------------------------------------------------------------------
   The Pledge is signed in VOX eSign, which is a separate app on the same
   Firebase project. This function is the bridge, and it is a function rather
   than a direct read for one reason: a charity must be able to see THEIR OWN
   Pledge without being able to see anybody else's.

   Firestore rules cannot express that cleanly here — the party records live in
   a subcollection under a document the charity may not read, and each one
   carries the token that IS the authority to sign. So the read happens on the
   server, with the Admin SDK, and what comes back is filtered to the caller:
   their own line and their own link, and nothing else. Only admin gets the
   whole list.

   Which documents count as "the Pledge": any signature request whose title
   contains the word Pledge. Override by setting `esignTitleMatch` on the
   content/pledge document if that ever stops being true.
   ========================================================================= */

const ESIGN_REQUESTS = "esign_signature_requests";
const ESIGN_URL_DEFAULT = "https://vox-esign.vercel.app";

// Every address this person might have been invited under. The member record
// is the authority: signInEmails is the same array the sign-in function
// searches, so someone whose Pledge was sent to their work address still sees
// it after signing in to the hub with the account on their phone.
async function addressesFor(req) {
  const found = new Set();
  const tokenEmail = clean(req.auth.token?.email);
  if (tokenEmail) found.add(tokenEmail);

  const memberId = req.auth.token?.memberId;
  if (memberId) {
    const snap = await db.collection("members").doc(memberId).get();
    if (snap.exists) {
      const d = snap.data();
      if (d.email) found.add(clean(d.email));
      for (const a of d.signInEmails || []) if (a) found.add(clean(a));
    }
  }
  return found;
}

export const pledgeStatus = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const tier = req.auth.token?.tier;
  if (!TIERS.includes(tier)) throw new HttpsError("permission-denied", "No access.");

  const cfgSnap = await db.collection("content").doc("pledge").get();
  const cfg = cfgSnap.exists ? cfgSnap.data() : {};
  const match = String(cfg.esignTitleMatch || "pledge").toLowerCase();
  const base  = String(cfg.esignBaseUrl || process.env.VOX_ESIGN_URL || ESIGN_URL_DEFAULT)
                  .trim().replace(/\/+$/, "");

  const reqSnap = await db.collection(ESIGN_REQUESTS).get();
  const pledges = reqSnap.docs.filter(d =>
    String(d.data().documentTitle || "").toLowerCase().includes(match));

  const mineAddresses = await addressesFor(req);
  let mine = null;
  const roll = [];

  for (const docSnap of pledges) {
    const r = docSnap.data();
    const partiesSnap = await docSnap.ref.collection("parties").get();

    for (const p of partiesSnap.docs) {
      const party = p.data();
      const isMine = mineAddresses.has(clean(party.email));

      // The caller's own line — with the link, because it is theirs.
      // Only while it is still theirs to act on: once signed or declined a
      // token should not be handed back out.
      if (isMine && !mine) {
        const open = party.status === "pending" || party.status === "viewed";
        mine = {
          documentTitle: r.documentTitle || "The VOX London Pledge",
          status: party.status || "pending",
          signedAt: party.signedAt || null,
          declinedAt: party.declinedAt || null,
          expiresAt: r.expiresAt || null,
          signingUrl: open ? `${base}/sign/${party.token}` : null
        };
      }

      // The full picture, admin only. No tokens in here for anybody — a link
      // that signs on someone else's behalf has no business in a list view.
      if (tier === "admin") {
        roll.push({
          documentTitle: r.documentTitle || "",
          name: party.name || "",
          email: party.email || "",
          status: party.status || "pending",
          signedAt: party.signedAt || null,
          reminderSentAt: party.reminderSentAt || null
        });
      }
    }
  }

  roll.sort((a, b) => (a.name || "").localeCompare(b.name || ""));

  const counts = { signed: 0, pending: 0, declined: 0 };
  for (const row of roll) {
    if (row.status === "signed") counts.signed++;
    else if (row.status === "declined") counts.declined++;
    else counts.pending++;
  }

  return {
    mine,
    roll:   tier === "admin" ? roll   : null,
    counts: tier === "admin" ? counts : null,
    esignUrl: tier === "admin" ? base : null
  };
});

/* =========================================================================
   6. Signing — any document, not just the Pledge
   -------------------------------------------------------------------------
   The hub does not implement signing. VOX eSign does, and these functions are
   a thin bridge to it, because there must be exactly ONE piece of code that
   knows where a signature box sits on a page and exactly one that issues
   tokens. Two would disagree within a month.

   How a document gets here: you send it once from eSign, placing the boxes in
   the viewer that already exists, then press "Save as template". From then on
   the hub can send that document to anybody — same PDF, same box positions,
   filled in for whoever is signing. Nothing re-places boxes, ever.

   Authentication between the two: a shared key in Secret Manager. The hub is
   a Cloud Function with no human session to borrow, so it presents the key and
   says whose behalf it is acting on. The key never reaches a browser.
   ========================================================================= */

const ESIGN_TEMPLATES = "esign_templates";

function esignBase() {
  const raw = process.env.VOX_ESIGN_URL || "https://vox-esign.vercel.app";
  return String(raw).trim().replace(/\/+$/, "");
}

async function callEsign(path, body, req) {
  const key = process.env.VOX_SERVICE_KEY;
  if (!key) {
    throw new HttpsError("failed-precondition",
      "Signing is not connected yet. VOX_SERVICE_KEY has not been set on the hub.");
  }
  const res = await fetch(`${esignBase()}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      "x-vox-service-key": key
    },
    body: body ? JSON.stringify({
      ...body,
      onBehalfOf: { uid: req.auth.uid, email: req.auth.token?.email }
    }) : undefined
  });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = { error: text.slice(0, 300) }; }
  if (!res.ok) {
    console.error(`esign ${path} -> ${res.status}: ${data?.error}`);
    throw new HttpsError(res.status === 401 ? "permission-denied" : "internal",
      data?.error || `VOX eSign refused that (${res.status}).`);
  }
  return data;
}

function requireAdmin(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  if (req.auth.token?.tier !== "admin") throw new HttpsError("permission-denied", "VOX only.");
}

/* -- what can be sent ---------------------------------------------------- */
export const signingTemplates = onCall(async (req) => {
  requireAdmin(req);
  const snap = await db.collection(ESIGN_TEMPLATES).orderBy("name").get();
  return {
    templates: snap.docs.map(d => {
      const t = d.data();
      return {
        id: d.id,
        name: t.name || "Untitled",
        documentTitle: t.documentTitle || t.name || "Document",
        roles: (t.roles || []).map(r => ({ id: r.id, label: r.label })),
        fieldCount: (t.signatureFields || []).length
      };
    })
  };
});

/* -- send it ------------------------------------------------------------- */
export const sendForSignature = onCall({ secrets: ["VOX_SERVICE_KEY"] }, async (req) => {
  requireAdmin(req);

  const templateId = String(req.data?.templateId || "");
  const fill = Array.isArray(req.data?.fill) ? req.data.fill : [];
  if (!templateId) throw new HttpsError("invalid-argument", "Pick a document to send.");
  if (!fill.length) throw new HttpsError("invalid-argument", "Say who it is going to.");
  for (const f of fill) {
    if (!String(f?.name || "").trim()) throw new HttpsError("invalid-argument", "Every signer needs a name.");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean(f?.email))) {
      throw new HttpsError("invalid-argument", `${f?.name || "Someone"} needs a valid email address.`);
    }
  }

  const out = await callEsign("/api/esign/from-template", {
    templateId,
    fill: fill.map(f => ({ roleId: f.roleId, name: String(f.name).trim(), email: clean(f.email) })),
    documentTitle: req.data?.documentTitle || undefined,
    senderName: req.data?.senderName || "VOX London",
    expiryDays: req.data?.expiryDays || undefined
  }, req);

  await db.collection("audit").add({
    what: "sent for signature",
    who: req.auth.uid,
    templateId,
    signatureRequestId: out?.signatureRequestId || null,
    to: fill.map(f => clean(f.email)),
    at: FieldValue.serverTimestamp()
  });

  // Deliberately NOT returning partyTokens. A token is the authority to sign
  // as that person; it belongs in their email and nowhere else.
  return { signatureRequestId: out?.signatureRequestId || null, sent: fill.length };
});

/* -- everything out for signature ---------------------------------------- */
export const signingList = onCall(async (req) => {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const tier = req.auth.token?.tier;
  if (tier !== "admin" && tier !== "steering") {
    throw new HttpsError("permission-denied", "Steering Group and above.");
  }
  const isAdmin = tier === "admin";

  const snap = await db.collection(ESIGN_REQUESTS).orderBy("createdAt", "desc").limit(200).get();
  const rows = [];
  for (const d of snap.docs) {
    const r = d.data();
    const parties = await d.ref.collection("parties").get();
    rows.push({
      id: d.id,
      documentTitle: r.documentTitle || "Document",
      status: r.status || "pending",
      createdAt: r.createdAt?.toDate?.().toISOString() || r.createdAt || null,
      expiresAt: r.expiresAt || null,
      signers: parties.docs.map(p => {
        const q = p.data();
        return {
          id: p.id,
          name: q.name || "",
          // The Steering Group can see that a document is out and where it has
          // got to. Addresses are VOX's to hold, not the group's.
          email: isAdmin ? (q.email || "") : null,
          status: q.status || "pending",
          signedAt: q.signedAt || null,
          reminderSentAt: q.reminderSentAt || null
        };
      })
    });
  }
  return { rows, canSend: isAdmin };
});

/* -- chase somebody ------------------------------------------------------ */
export const remindSigner = onCall({ secrets: ["VOX_SERVICE_KEY"] }, async (req) => {
  requireAdmin(req);
  const requestId = String(req.data?.requestId || "");
  const partyId   = String(req.data?.partyId || "");
  if (!requestId || !partyId) throw new HttpsError("invalid-argument", "Which signer?");
  await callEsign("/api/esign/remind", { requestId, partyId }, req);
  await db.collection("audit").add({
    what: "reminder sent", who: req.auth.uid, requestId, partyId, at: FieldValue.serverTimestamp()
  });
  return { ok: true };
});

/* =========================================================================
   9. Progress tracker and the moving pack
   -------------------------------------------------------------------------
   Both live in their own files because both are about one thing each, and
   both are long enough that burying them here would hide them. Firebase only
   deploys what index.js exports, so they are re-exported rather than merely
   imported — an import alone would load the file and deploy nothing.
   ========================================================================= */
export { syncTracker, refreshTracker } from "./tracker.js";
export { planningPack, savePlanningSection } from "./planning.js";

/* =========================================================================
   Viewing sign-ups — the confirmation email, and the alert to Martin.
   Defined in its own file, with its region set there rather than relying on
   setGlobalOptions above, because a re-exported trigger can be defined before
   that call runs.
   ========================================================================= */
export { onViewingSignup } from "./viewings.js";
