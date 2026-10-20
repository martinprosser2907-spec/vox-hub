// ---------------------------------------------------------------------------
// Planning tools — the moving pack.
//
// One pack per ORGANISATION, not per person: a charity may have three people
// in the hub and they are all filling in the same pack.
//
// WHY THIS IS A FUNCTION AND NOT A RULE
// The tier claim carries { tier, memberId }. It does not carry the person's
// organisation, so firestore.rules cannot say "you may read the pack whose org
// matches yours" — there is nothing in the token to match against. The rules as
// originally written said `allow read: if atLeast(2)`, which is not scoped to
// the owner at all: any Steering Group member could read any other charity's
// staff numbers and lease end date.
//
// pledgeStatus already solved this exact problem the same way — read on the
// server with the Admin SDK and hand back only the caller's own line. This
// follows it rather than inventing a second pattern, and `planning` is closed
// to the browser in the rules.
// ---------------------------------------------------------------------------
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// initializeApp() lives in index.js, and ES modules evaluate an imported file
// BEFORE the body of the file importing it — so getFirestore() at the top level
// here would run first and throw "the default Firebase app does not exist".
// Resolved on first use instead, by which time index.js has initialised.
let _db = null;
const db = () => (_db ??= getFirestore());
const TIERS = ["general", "steering", "admin"];

// The four sections, and the fields in each.
//
// Martin set the four sections (20 Oct 2026). The FIELDS below are a starting
// draft — he was Head of Workplace at Save the Children and holds IWFM Level 4,
// so expect these to be revised. They are listed here, in one place, precisely
// so revising them is a single edit rather than a hunt through the view.
export const SECTIONS = {
  timeline: {
    title: "Move timeline",
    note:  "When you can move, and what has to happen first.",
    fields: [
      { id: "leaseEnd",      label: "Current lease end date",        type: "date" },
      { id: "breakDate",     label: "Break clause date, if any",     type: "date" },
      { id: "noticePeriod",  label: "Notice you must give",          type: "text",  hint: "e.g. 6 months" },
      { id: "earliest",      label: "Earliest you could move",       type: "date" },
      { id: "latest",        label: "Latest you could move",         type: "date" },
      { id: "approvals",     label: "Internal approvals needed",     type: "textarea",
        hint: "Board sign-off, trustee meeting dates, anything with a fixed date" },
      { id: "constraints",   label: "Anything that would stop a move", type: "textarea" }
    ]
  },
  space: {
    title: "Space requirements",
    note:  "Desks, meeting rooms and storage. Demised space only — shared rooms are counted separately.",
    fields: [
      { id: "headcount",     label: "Total staff",                   type: "number" },
      { id: "desks",         label: "Desks required",                type: "number" },
      { id: "daysInOffice",  label: "Typical days in the office",     type: "text", hint: "e.g. 2–3" },
      { id: "offices",       label: "Private offices needed",        type: "number" },
      { id: "meetingRooms",  label: "Meeting rooms needed",          type: "textarea",
        hint: "How many, and roughly what size" },
      { id: "quietSpace",    label: "Quiet or focus space",          type: "textarea" },
      { id: "storage",       label: "Storage",                       type: "textarea",
        hint: "Linear metres, or describe it" },
      { id: "specialist",    label: "Anything specialist",           type: "textarea",
        hint: "Studio, counselling room, clinical space, secure store" }
    ]
  },
  it: {
    title: "IT and comms",
    note:  "What you bring, what you need, and anything that constrains where it can go.",
    fields: [
      { id: "connectivity",  label: "Connectivity — who provides it today", type: "text" },
      { id: "commsRoom",     label: "Comms room or rack needs",      type: "textarea" },
      { id: "av",            label: "AV requirements",               type: "textarea",
        hint: "Hybrid meeting rooms, studio, broadcast" },
      { id: "telephony",     label: "Phone system",                  type: "text" },
      { id: "equipment",     label: "Specialist equipment",          type: "textarea" },
      { id: "dataConstraint", label: "Data or security constraints", type: "textarea",
        hint: "Anything that dictates where data or kit may sit" }
    ]
  },
  decommissioning: {
    title: "Leaving your current building",
    note:  "What has to be dealt with at the other end.",
    fields: [
      { id: "dilapidations", label: "Dilapidations liability",       type: "textarea",
        hint: "Known, estimated, or not yet assessed" },
      { id: "furniture",     label: "Furniture — reuse, sell or dispose", type: "textarea" },
      { id: "confidential",  label: "Confidential waste",            type: "textarea" },
      { id: "archive",       label: "Archive and physical records",  type: "textarea" },
      { id: "handback",      label: "Target handback date",          type: "date" },
      { id: "notes",         label: "Anything else",                 type: "textarea" }
    ]
  }
};

const SECTION_IDS = Object.keys(SECTIONS);
const FIELD_IDS = Object.fromEntries(
  SECTION_IDS.map((s) => [s, new Set(SECTIONS[s].fields.map((f) => f.id))])
);

// An organisation name becomes a document id. Two people from the same charity
// must land on the same pack, so this has to be stable — lowercase, and
// anything that is not a letter or digit becomes a hyphen.
const slug = (s) => String(s || "")
  .toLowerCase().trim()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 80);

const clean = (e) => String(e || "").trim().toLowerCase();

// Who is calling, and which organisation's pack is theirs.
async function callerOrg(req) {
  if (!req.auth) throw new HttpsError("unauthenticated", "Sign in first.");
  const tier = req.auth.token?.tier;
  if (!TIERS.includes(tier)) throw new HttpsError("permission-denied", "No access.");
  if (tier === "general") throw new HttpsError("permission-denied", "Steering Group only.");

  // The claim carries memberId. Fall back to email, for an account whose claim
  // predates memberId being stamped on it.
  let member = null;
  const memberId = req.auth.token?.memberId;
  if (memberId) {
    const s = await db().collection("members").doc(memberId).get();
    if (s.exists) member = { id: s.id, ...s.data() };
  }
  if (!member) {
    const email = clean(req.auth.token?.email);
    if (email) {
      const q = await db().collection("members")
        .where("signInEmails", "array-contains", email).limit(1).get();
      if (!q.empty) member = { id: q.docs[0].id, ...q.docs[0].data() };
    }
  }
  if (!member) throw new HttpsError("permission-denied", "No member record.");

  const org = String(member.org || "").trim();
  if (!org) {
    // Without an organisation there is no pack to own. Say so plainly rather
    // than silently handing back someone else's or creating a nameless one.
    throw new HttpsError(
      "failed-precondition",
      "Your member record has no organisation set. Ask VOX to add it."
    );
  }
  return { tier, org, packId: slug(org), member };
}

const emptyPack = (org) => ({
  org,
  sections: Object.fromEntries(SECTION_IDS.map((s) => [s, {}])),
  updatedAt: null
});

/* =========================================================================
   Read. A charity gets its own pack. Admin may ask for any, or for the list.
   ========================================================================= */
export const planningPack = onCall(async (req) => {
  const me = await callerOrg(req);

  // Admin asking for somebody else's, or for all of them.
  if (me.tier === "admin" && req.data?.all === true) {
    const snap = await db().collection("planning").get();
    return {
      schema: SECTIONS,
      all: snap.docs.map((d) => {
        const p = d.data() || {};
        const done = SECTION_IDS.filter(
          (s) => Object.values(p.sections?.[s] || {}).some((v) => String(v || "").trim())
        );
        return {
          packId: d.id,
          org: p.org || d.id,
          complete: done.length,
          total: SECTION_IDS.length,
          updatedAt: p.updatedAt || null
        };
      })
    };
  }

  const packId = (me.tier === "admin" && req.data?.packId) ? String(req.data.packId) : me.packId;
  const snap = await db().collection("planning").doc(packId).get();
  const pack = snap.exists ? snap.data() : emptyPack(me.org);

  return { schema: SECTIONS, packId, pack, readOnly: false };
});

/* =========================================================================
   Write. One section at a time, and only fields this code knows about —
   a pack is not a place to put arbitrary data just because it is yours.
   ========================================================================= */
export const savePlanningSection = onCall(async (req) => {
  const me = await callerOrg(req);

  const section = String(req.data?.section || "");
  if (!SECTION_IDS.includes(section)) {
    throw new HttpsError("invalid-argument", "Unknown section.");
  }

  const incoming = req.data?.values;
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) {
    throw new HttpsError("invalid-argument", "No values.");
  }

  const allowed = FIELD_IDS[section];
  const values = {};
  for (const [k, v] of Object.entries(incoming)) {
    if (!allowed.has(k)) continue;                       // quietly drop the rest
    if (v === null || v === undefined) { values[k] = ""; continue; }
    if (typeof v === "number") { values[k] = v; continue; }
    values[k] = String(v).slice(0, 4000);                // a form field, not an essay
  }

  const packId = (me.tier === "admin" && req.data?.packId) ? String(req.data.packId) : me.packId;

  await db().collection("planning").doc(packId).set({
    org: me.org,
    sections: { [section]: values },
    updatedAt: FieldValue.serverTimestamp(),
    updatedBy: me.member.name || me.member.email || req.auth.uid
  }, { merge: true });

  return { ok: true, section };
});
