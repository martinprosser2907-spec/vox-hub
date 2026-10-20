// ---------------------------------------------------------------------------
// The Progress tracker's sync job.
//
// WHY THIS EXISTS AT ALL
// firestore.rules deliberately blocks steering-tier members from reading
// vox_projects, crm_deals and crm_contacts — those are plannerAccess(), which
// is admin-or-legacy only. A charity on the Steering Group must not be able to
// read the CRM, because it holds site addresses, landlord names, rent figures
// and every other organisation's private notes.
//
// So the tracker cannot read the planner. This job reads it on the server,
// throws away everything that must not travel, and writes what is left to
// tracker/summary, which steering members may read and nobody may write.
//
// THE FILTER IS THE POINT. Everything below exists to decide what does not go
// in. If you are adding a field here, the question is not "is this useful" but
// "is this safe in front of a charity that is not the subject of it".
// ---------------------------------------------------------------------------
import { onSchedule } from "firebase-functions/v2/scheduler";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { getFirestore, FieldValue } from "firebase-admin/firestore";

// initializeApp() lives in index.js, and ES modules evaluate an imported file
// BEFORE the body of the file importing it — so getFirestore() at the top level
// here would run first and throw "the default Firebase app does not exist".
// Resolved on first use instead, by which time index.js has initialised.
let _db = null;
const db = () => (_db ??= getFirestore());

// The planner's stages, in order. Kept here rather than imported because the
// planner is a separate app — if it renames a stage this list must be updated
// deliberately, not silently inherit a name nobody here has seen.
const STAGES = [
  "Identified",
  "Contacted",
  "Active Dialogue",
  "Expected to sign",
  "Onboarded",
  "Lost"
];

// Stages whose organisations may be NAMED to the Steering Group.
//
// Martin's decision, 20 Oct 2026: numbers for everything, names only for those
// in active dialogue or beyond. An organisation that has merely been
// identified or contacted has not agreed to be discussed, and naming a "Lost"
// one to a room of its peers is worse still.
const NAMED_STAGES = new Set(["Active Dialogue", "Expected to sign", "Onboarded"]);

// Fields copied onto a named organisation. This list is exhaustive on purpose:
// the job builds a new object field by field rather than deleting from a copy
// of the deal, because a delete-list silently stops being complete the moment
// the planner gains a field.
//
// NOT copied, and why:
//   value          — commercial. Rent and deal value stay with VOX.
//   activityLog    — private notes, written candidly, about these very people.
//   aiSummary      — same, and generated, so nobody has read it before sending.
//   notes          — same.
//   followUpDate   — says who is being chased and how hard.
//   contactId      — a key into crm_contacts, which holds names and emails.
//   pledgeNote     — may record what was negotiated to get the pledge.
const namedOrg = (d) => ({
  name:   String(d.contactName || d.title || "").trim(),
  stage:  String(d.stage || "Identified"),
  sqft:   Number(d.spaceSqft) > 0 ? Number(d.spaceSqft) : null,
  pledged: d.pledged === true
});

async function buildSummary() {
  // Archived deals are gone as far as the hub is concerned.
  const snap = await db().collection("crm_deals").where("archived", "==", false).get();

  const stages = Object.fromEntries(STAGES.map((s) => [s, 0]));
  let unknownStage = 0;
  let pledgedCount = 0;
  let pledgedSqft  = 0;
  const organisations = [];

  snap.forEach((docSnap) => {
    const d = docSnap.data() || {};
    const stage = String(d.stage || "Identified");

    if (Object.prototype.hasOwnProperty.call(stages, stage)) stages[stage] += 1;
    else unknownStage += 1;   // a stage this job has not been told about

    if (d.pledged === true) {
      pledgedCount += 1;
      if (Number(d.spaceSqft) > 0) pledgedSqft += Number(d.spaceSqft);
    }

    if (NAMED_STAGES.has(stage)) {
      const org = namedOrg(d);
      if (org.name) organisations.push(org);
    }
  });

  organisations.sort((a, b) =>
    (b.sqft || 0) - (a.sqft || 0) || a.name.localeCompare(b.name));

  // Figures nobody holds in the planner — sites reviewed, the pledge target —
  // live in settings/tracker, which an admin can edit from the hub. Reading
  // them here keeps the tracker in one place rather than half-hardcoded.
  let manual = {};
  try {
    const s = await db().collection("settings").doc("tracker").get();
    if (s.exists) manual = s.data() || {};
  } catch { /* settings are optional; the tracker still works without them */ }

  return {
    stages,
    unknownStage,
    totalDeals: snap.size,
    pledgedCount,
    pledgedSqft,
    pledgeTarget:  Number(manual.pledgeTarget) > 0 ? Number(manual.pledgeTarget) : 10,
    sitesReviewed: Number(manual.sitesReviewed) >= 0 ? Number(manual.sitesReviewed) : null,
    namedStages: [...NAMED_STAGES],
    organisations,
    syncedAt: FieldValue.serverTimestamp()
  };
}

async function writeSummary() {
  const summary = await buildSummary();
  await db().collection("tracker").doc("summary").set(summary);
  return summary;
}

/* =========================================================================
   Hourly. The tracker is a progress board, not a dashboard — nobody needs
   it to the minute, and an hourly read of one collection costs nothing.
   ========================================================================= */
export const syncTracker = onSchedule(
  { schedule: "every 60 minutes", timeZone: "Europe/London" },
  async () => {
    const s = await writeSummary();
    console.info(
      `tracker synced: ${s.totalDeals} deals, ${s.organisations.length} named, ` +
      `${s.pledgedCount} pledged` +
      (s.unknownStage ? ` — WARNING: ${s.unknownStage} deal(s) in a stage this job does not know` : "")
    );
  }
);

/* =========================================================================
   The same thing on demand, for VOX only, so the tracker can be refreshed
   after a change rather than waiting for the hour.
   ========================================================================= */
export const refreshTracker = onCall(async (req) => {
  if (req.auth?.token?.tier !== "admin") {
    throw new HttpsError("permission-denied", "VOX only.");
  }
  const s = await writeSummary();
  return { ok: true, totalDeals: s.totalDeals, named: s.organisations.length };
});
