/**
 * One-off. The `pages` records for Document store and People and access were
 * seeded as placeholders; both now have real views. This removes the `view`
 * field so the router loads documents.js and people.js instead of soon.js.
 *
 * 20 Oct 2026: Progress tracker and Planning tools joined them. A merge write
 * does not remove a field that is already stored, so dropping view:"soon" from
 * seed-members.js is not enough on its own — this is what actually clears it.
 *
 *   node fix-pages.js
 *
 * Safe to run more than once. Needs serviceAccount.json, same as the seed.
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccount.json", "utf8"))) });
const db = getFirestore();

for (const id of ["documents", "people", "tracker", "planning"]) {
  await db.collection("pages").doc(id).update({ view: FieldValue.delete() })
    .then(() => console.log(`${id}: now loads its own view`))
    .catch(e => console.log(`${id}: ${e.message}`));
}
process.exit(0);
