/**
 * Puts you in as the first admin, and sets up the menu.
 *
 * Run once, from your own machine:
 *   node seed-members.js martin@voxhouses.global
 *
 * Needs serviceAccount.json in this folder — Firebase console >
 * Project settings > Service accounts > Generate new private key.
 * It is gitignored. Never commit it.
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const email = (process.argv[2] || "").trim().toLowerCase();
if (!email) { console.error("Usage: node seed-members.js you@voxhouses.global"); process.exit(1); }

initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccount.json", "utf8"))) });
const db = getFirestore();
const now = FieldValue.serverTimestamp();

// signInEmails is an array, not a single field, because people sign in with
// whatever account is on their phone — rarely the address you hold for them.
// Add a second address here and they get in without you touching anything else.
const PAGES = [
  { id: "progress",    title: "Progress",          icon: "◐", order: 10, minTier: 1, enabled: true },
  { id: "concept",     title: "The concept",       icon: "◈", order: 20, minTier: 1, enabled: true },
  { id: "updates",     title: "Updates",           icon: "▤", order: 30, minTier: 1, enabled: true },
  { id: "gallery",     title: "Photo gallery",     icon: "▣", order: 40, minTier: 1, enabled: true },
  { id: "suggestions", title: "Suggestions board", icon: "◎", order: 50, minTier: 1, enabled: true },
  { id: "questions",   title: "Questions",         icon: "?",      order: 60, minTier: 1, enabled: true },
  { id: "pledge",      title: "Sign the Pledge",   icon: "✎", order: 70, minTier: 1, enabled: true },
  { id: "tracker",     title: "Progress tracker",  icon: "▦", order: 80, minTier: 2, enabled: true, view: "soon" },
  { id: "documents",   title: "Document store",    icon: "▥", order: 90, minTier: 2, enabled: true },
  { id: "signing",     title: "Signing",          icon: "✎", order: 95, minTier: 2, enabled: true },
  { id: "planning",    title: "Planning tools",    icon: "△", order: 100, minTier: 2, enabled: true, view: "soon" },
  { id: "planner",     title: "VOX planner",       icon: "■", order: 110, minTier: 3, enabled: true,
    url: "https://vox-project-management-dbase.web.app/", external: true },
  // VOX eSign's own dashboard — where a document gets its signature boxes
  // placed and saved as a template. The hub's Signing page sends templates;
  // it cannot make one, so this is the way in. Admin only, which matches
  // eSign's own rules: esign_signature_requests is plannerAccess(), so a
  // steering member would land on a dashboard that refuses to load.
  // The address is also in js/config.js for the link on the Signing page.
  { id: "esign",       title: "VOX eSign",         icon: "✒", order: 115, minTier: 3, enabled: true,
    url: "https://vox-esign.vercel.app/dashboard", external: true },
  { id: "people",      title: "People and access", icon: "◍", order: 120, minTier: 3, enabled: true }
];

// A page carrying view:"soon" loads the "not built yet" placeholder instead of
// its own module — which is exactly right until the module exists, and a silent
// dead end afterwards. This list is the one place that decides it, so check it
// here rather than discovering it by clicking a menu item that does nothing.
{
  const placeholders = PAGES.filter(p => p.view === "soon").map(p => p.id).sort();
  const expected = ["planning", "tracker"];
  if (String(placeholders) !== String(expected)) {
    throw new Error(
      `PAGES placeholders are [${placeholders}] but should be [${expected}].\n` +
      `If you have just built one of these, drop its view:"soon" here AND run ` +
      `fix-pages.js, because a merge does not remove a field that is already stored.`);
  }
}

// An external page is a link and nothing else — the router skips it, so no
// view is ever loaded and a bad url never throws. It just renders a menu item
// that goes nowhere, or worse, to "undefined". Checked here, where the list is
// written, because there is nowhere later that this fails loudly.
{
  for (const p of PAGES.filter(p => p.external)) {
    if (!/^https:\/\//.test(p.url || "")) {
      throw new Error(`Page "${p.id}" is external but its url is ${JSON.stringify(p.url)}.`);
    }
    if (p.minTier == null) {
      throw new Error(`Page "${p.id}" is external but has no minTier, so it would be admin-only by accident.`);
    }
  }
}

const MILESTONES = [
  { order:1, title:"Mobilisation",      due:"Now",         status:"now",  public:true,
    note:"Building the founding group and gathering signatures on the Pledge." },
  { order:2, title:"Site shortlist",    due:"By Dec 2026", status:"next", public:true,
    note:"Twenty-one sites narrowed to fewer than five, with the Steering Group." },
  { order:3, title:"Site selection",    due:"Q1 2027",     status:"next", public:true,
    note:"The stop-go point on both the building and the commitment." },
  { order:4, title:"Lease negotiation", due:"2027",        status:"next", public:true,
    note:"Negotiated in unison, signed individually." },
  { order:5, title:"Building works",    due:"2027-28",     status:"next", public:true,
    note:"Carried by the owner or investor and included in the rent." },
  { order:6, title:"Move in",           due:"End 2028",    status:"next", public:true, note:"" }
];

(async () => {
  await db.collection("members").doc("martin").set({
    email, signInEmails: [email], name: "Martin Prosser",
    org: "VOX London", tier: "admin", createdAt: now
  }, { merge: true });
  console.log("admin:", email);

  const batch = db.batch();
  for (const p of PAGES)      batch.set(db.collection("pages").doc(p.id), p, { merge: true });
  for (const m of MILESTONES) batch.set(db.collection("milestones").doc("m" + m.order), m, { merge: true });
  batch.set(db.collection("content").doc("progress"), {
    headline: "VOX London is building its founding group",
    summary: "A purpose-built home for London's charity sector — one large building, taken by a "
           + "group of charities negotiating together and signing individually.",
    percent: 18, updatedAt: now
  }, { merge: true });
  await batch.commit();

  console.log(`seeded ${PAGES.length} pages, ${MILESTONES.length} milestones`);
  console.log("\nNow ask for a code at the hub and sign in.");
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
