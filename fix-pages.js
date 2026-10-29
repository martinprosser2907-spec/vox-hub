/**
 * One-off, safe to re-run. Clears the `view` field from the page records whose
 * screens now actually exist, so the router loads documents.js / people.js /
 * tracker.js / planning.js instead of the "coming soon" placeholder.
 *
 * A merge write does not remove a field that is already stored, so dropping
 * view:"soon" from seed-members.js is not enough on its own — this is what
 * actually clears it.
 *
 *   node fix-pages.js
 *
 * 20 Oct 2026: this used to swallow every error into console.log and exit 0,
 * which meant a failure looked exactly like a success to anything calling it —
 * and that is precisely what happened, inside a deploy script, with the real
 * reason scrolling past unread. It now prints the before and after state of
 * every page record and exits non-zero if anything is still not cleared.
 *
 * Needs serviceAccount.json in this folder, same as the seed.
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

const TO_CLEAR = ["documents", "people", "tracker", "planning"];

const key = JSON.parse(readFileSync("./serviceAccount.json", "utf8"));
console.log(`Firebase project: ${key.project_id}`);
console.log(`Service account:  ${key.client_email}`);
console.log("");

initializeApp({ credential: cert(key) });
const db = getFirestore();

// Everything in `pages`, before anything is touched. If a document id here is
// not what this script expects, that is the answer on its own.
console.log("--- pages collection, as it stands ---");
const before = await db.collection("pages").get();
if (before.empty) console.log("  (the pages collection is EMPTY)");
before.forEach(d => {
  const p = d.data() || {};
  console.log(`  ${d.id.padEnd(14)} view=${JSON.stringify(p.view ?? null).padEnd(8)} ` +
              `enabled=${p.enabled} minTier=${p.minTier} title="${p.title || ""}"`);
});
console.log("");

console.log("--- clearing the view field ---");
let failed = 0;
for (const id of TO_CLEAR) {
  try {
    const ref = db.collection("pages").doc(id);
    const snap = await ref.get();
    if (!snap.exists) {
      console.log(`  ${id}: NO SUCH DOCUMENT — nothing to clear`);
      failed++; continue;
    }
    if (snap.data().view === undefined) { console.log(`  ${id}: already clear`); continue; }
    await ref.update({ view: FieldValue.delete() });
    const after = await ref.get();
    if (after.data().view === undefined) {
      console.log(`  ${id}: cleared — now loads its own view`);
    } else {
      console.log(`  ${id}: STILL SET to "${after.data().view}" after the update`);
      failed++;
    }
  } catch (e) {
    console.log(`  ${id}: FAILED — ${e.code || ""} ${e.message}`);
    failed++;
  }
}
console.log("");

if (failed) {
  console.log(`${failed} page(s) could not be cleared. The detail is above.`);
  process.exit(1);
}
console.log("All four pages now load their own view. Reload the hub.");
process.exit(0);
