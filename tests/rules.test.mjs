/* ===========================================================================
   VOX London Hub — security rules tests
   ---------------------------------------------------------------------------
   Every test is named after the thing it stops happening. When one fails, the
   name tells you what just became possible.

   Run:  npm run test:rules
   =========================================================================== */

import { beforeAll, afterAll, beforeEach, describe, test } from "vitest";
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where,
  serverTimestamp
} from "firebase/firestore";
import { readFileSync } from "node:fs";

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: "vox-hub-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080
    }
  });
});

afterAll(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

/* -- the four people we test as ------------------------------------------ */
const general  = () => env.authenticatedContext("u-gen",   { tier: "general",  email: "jane@charity-one.example" }).firestore();
const steering = () => env.authenticatedContext("u-steer", { tier: "steering", email: "tasha@charity-two.example" }).firestore();
const admin    = () => env.authenticatedContext("u-admin", { tier: "admin",    email: "admin@vox.example" }).firestore();
const stranger = () => env.unauthenticatedContext().firestore();

/* Signed in, but the token carries no tier claim at all — the shape a brand
   new Firebase user has, and the one that must never be mistaken for access. */
const claimless = () => env.authenticatedContext("u-none", { email: "nobody@example.com" }).firestore();

/* A token with a tier value we have never heard of. A typo, or a fourth tier
   added to the functions and not to the rules. Must read as NO access. */
const bogus = () => env.authenticatedContext("u-bogus", { tier: "superadmin", email: "x@example.com" }).firestore();

async function seed(fn) { await env.withSecurityRulesDisabled(async (c) => fn(c.firestore())); }

/* ========================================================================= */
describe("the ladder itself", () => {

  test("a signed-out visitor can read nothing", async () => {
    await seed(db => setDoc(doc(db, "content/concept"), { body: "hello" }));
    await assertFails(getDoc(doc(stranger(), "content/concept")));
  });

  test("a token with NO tier claim gets no hub access, and does not throw its way to any", async () => {
    // A claimless token is a legacy planner account. It belongs in the
    // planner, not in the hub.
    await seed(db => setDoc(doc(db, "content/concept"), { body: "hello" }));
    await assertFails(getDoc(doc(claimless(), "content/concept")));
  });

  test("an UNKNOWN tier value is refused, not treated as the highest", async () => {
    await seed(db => setDoc(doc(db, "content/concept"), { body: "hello" }));
    await assertFails(getDoc(doc(bogus(), "content/concept")));
    await assertFails(setDoc(doc(bogus(), "content/concept"), { body: "changed" }));
  });

  test("general reads tier 1, and is refused tier 2 and tier 3", async () => {
    await seed(async db => {
      await setDoc(doc(db, "content/concept"), { body: "hello" });
      await setDoc(doc(db, "documents/d1"), { title: "Heads of terms", uploadedBy: "u-steer" });
      await setDoc(doc(db, "audit/a1"), { what: "signed in" });
    });
    await assertSucceeds(getDoc(doc(general(), "content/concept")));
    await assertFails(getDoc(doc(general(), "documents/d1")));
    await assertFails(getDoc(doc(general(), "audit/a1")));
  });

  test("steering reads tier 1 and tier 2, and is refused tier 3", async () => {
    await seed(async db => {
      await setDoc(doc(db, "content/concept"), { body: "hello" });
      await setDoc(doc(db, "documents/d1"), { title: "Heads of terms", uploadedBy: "u-steer" });
      await setDoc(doc(db, "audit/a1"), { what: "signed in" });
    });
    await assertSucceeds(getDoc(doc(steering(), "content/concept")));
    await assertSucceeds(getDoc(doc(steering(), "documents/d1")));
    await assertFails(getDoc(doc(steering(), "audit/a1")));
  });

  test("admin reads all three", async () => {
    await seed(async db => {
      await setDoc(doc(db, "content/concept"), { body: "hello" });
      await setDoc(doc(db, "documents/d1"), { title: "Heads of terms", uploadedBy: "u-steer" });
      await setDoc(doc(db, "audit/a1"), { what: "signed in" });
    });
    await assertSucceeds(getDoc(doc(admin(), "content/concept")));
    await assertSucceeds(getDoc(doc(admin(), "documents/d1")));
    await assertSucceeds(getDoc(doc(admin(), "audit/a1")));
  });
});

/* ========================================================================= */
describe("nobody can promote themselves", () => {

  test("a member may fix their own name but NOT their tier", async () => {
    await seed(db => setDoc(doc(db, "members/m1"),
      { email: "jane@charity-one.example", name: "Jane", org: "Charity One", tier: "general" }));

    await assertSucceeds(updateDoc(doc(general(), "members/m1"), { name: "Jane Doughty" }));
    await assertFails(updateDoc(doc(general(), "members/m1"), { tier: "admin" }));
    await assertFails(updateDoc(doc(general(), "members/m1"), { name: "Jane", tier: "steering" }));
  });

  test("a member cannot read or edit somebody else's record", async () => {
    await seed(db => setDoc(doc(db, "members/m2"),
      { email: "someone@charity-three.example", name: "Someone", tier: "steering" }));
    await assertFails(getDoc(doc(general(), "members/m2")));
    await assertFails(updateDoc(doc(general(), "members/m2"), { name: "Hacked" }));
  });

  test("a member cannot create a record for themselves at any tier", async () => {
    await assertFails(setDoc(doc(general(), "members/new"),
      { email: "jane@charity-one.example", tier: "general" }));
    await assertFails(setDoc(doc(general(), "members/new2"),
      { email: "jane@charity-one.example", tier: "admin" }));
  });

  test("admin may set anyone's tier", async () => {
    await seed(db => setDoc(doc(db, "members/m1"), { email: "a@b.example", tier: "general" }));
    await assertSucceeds(updateDoc(doc(admin(), "members/m1"), { tier: "steering" }));
  });

  test("the sign-in code store is invisible to every browser, admin included", async () => {
    await seed(db => setDoc(doc(db, "loginCodes/jane@charity-one.example"), { code: "123456" }));
    await assertFails(getDoc(doc(general(),  "loginCodes/jane@charity-one.example")));
    await assertFails(getDoc(doc(steering(), "loginCodes/jane@charity-one.example")));
    await assertFails(getDoc(doc(admin(),    "loginCodes/jane@charity-one.example")));
  });
});

/* ========================================================================= */
describe("react but do not rewrite", () => {

  test("anyone in may back a suggestion", async () => {
    await seed(db => setDoc(doc(db, "suggestions/s1"),
      { text: "A green screen room", authorId: "u-steer", backers: [] }));
    await assertSucceeds(updateDoc(doc(general(), "suggestions/s1"), { backers: ["u-gen"] }));
  });

  test("backing a suggestion cannot smuggle in an edit to its text", async () => {
    await seed(db => setDoc(doc(db, "suggestions/s1"),
      { text: "A green screen room", authorId: "u-steer", backers: [] }));
    await assertFails(updateDoc(doc(general(), "suggestions/s1"),
      { backers: ["u-gen"], text: "Something I made up" }));
  });

  test("you cannot delete other people's backing", async () => {
    await seed(db => setDoc(doc(db, "suggestions/s1"),
      { text: "A green screen room", authorId: "u-steer", backers: ["u-steer", "u-admin"] }));
    await assertFails(updateDoc(doc(general(), "suggestions/s1"), { backers: [] }));
  });

  test("you may remove your own backing", async () => {
    await seed(db => setDoc(doc(db, "suggestions/s1"),
      { text: "A green screen room", authorId: "u-steer", backers: ["u-steer", "u-gen"] }));
    await assertSucceeds(updateDoc(doc(general(), "suggestions/s1"), { backers: ["u-steer"] }));
  });

  test("a suggestion must be posted under your own name", async () => {
    await assertFails(setDoc(doc(general(), "suggestions/s2"),
      { text: "Posted as someone else", authorId: "u-admin", backers: [] }));
    await assertSucceeds(setDoc(doc(general(), "suggestions/s2"),
      { text: "Posted as me", authorId: "u-gen", backers: [] }));
  });

  test("a suggestion cannot arrive pre-loaded with backers", async () => {
    await assertFails(setDoc(doc(general(), "suggestions/s3"),
      { text: "Everyone loves this already", authorId: "u-gen", backers: ["u-steer", "u-admin"] }));
  });

  test("an empty or oversized suggestion is refused", async () => {
    await assertFails(setDoc(doc(general(), "suggestions/s4"),
      { text: "", authorId: "u-gen", backers: [] }));
    await assertFails(setDoc(doc(general(), "suggestions/s5"),
      { text: "x".repeat(901), authorId: "u-gen", backers: [] }));
  });

  test("the author may edit their own, and delete it", async () => {
    await seed(db => setDoc(doc(db, "suggestions/mine"),
      { text: "Mine", authorId: "u-gen", backers: [] }));
    await assertSucceeds(updateDoc(doc(general(), "suggestions/mine"), { text: "Mine, reworded" }));
    await assertSucceeds(deleteDoc(doc(general(), "suggestions/mine")));
  });
});

/* ========================================================================= */
describe("questions are asked by members and answered only by VOX", () => {

  test("a member may ask, with the answer left empty", async () => {
    await assertSucceeds(setDoc(doc(general(), "questions/q1"),
      { text: "Does signing commit us to a location?", askedId: "u-gen", answer: "", upvotes: [] }));
  });

  test("a member cannot post their own answer alongside the question", async () => {
    await assertFails(setDoc(doc(general(), "questions/q2"),
      { text: "Is it free?", askedId: "u-gen", answer: "Yes, obviously", upvotes: [] }));
  });

  test("a member cannot answer an existing question", async () => {
    await seed(db => setDoc(doc(db, "questions/q3"), { text: "Parking?", askedId: "u-gen", answer: "", upvotes: [] }));
    await assertFails(updateDoc(doc(general(), "questions/q3"), { answer: "There is loads" }));
    await assertFails(updateDoc(doc(steering(), "questions/q3"), { answer: "There is loads" }));
  });

  test("admin answers, and members may upvote", async () => {
    await seed(db => setDoc(doc(db, "questions/q4"), { text: "Parking?", askedId: "u-gen", answer: "", upvotes: [] }));
    await assertSucceeds(updateDoc(doc(admin(), "questions/q4"),
      { answer: "Not inside the Circle line; possibly further out." }));
    await assertSucceeds(updateDoc(doc(general(), "questions/q4"), { upvotes: ["u-gen"] }));
  });
});

/* ========================================================================= */
describe("updates, documents and the tracker", () => {

  test("only admin posts an update; anyone in may mark it read", async () => {
    await seed(db => setDoc(doc(db, "updates/u1"), { title: "September meeting", readBy: [] }));
    await assertFails(setDoc(doc(general(), "updates/u2"), { title: "Made up" }));
    await assertSucceeds(updateDoc(doc(general(), "updates/u1"), { readBy: ["u-gen"] }));
    await assertFails(updateDoc(doc(general(), "updates/u1"), { readBy: ["u-gen"], title: "Rewritten" }));
  });

  test("a steering member may add a document but only VOX may delete one", async () => {
    await seed(db => setDoc(doc(db, "documents/d1"), { title: "Draft lease", uploadedBy: "u-admin" }));
    await assertSucceeds(setDoc(doc(steering(), "documents/d2"),
      { title: "My paper", uploadedBy: "u-steer" }));
    await assertFails(deleteDoc(doc(steering(), "documents/d1")));
    await assertSucceeds(deleteDoc(doc(admin(), "documents/d1")));
  });

  test("a document must be filed under your own name", async () => {
    await assertFails(setDoc(doc(steering(), "documents/d3"),
      { title: "Filed as someone else", uploadedBy: "u-admin" }));
  });

  test("the planner tracker is readable by steering and writable by nobody, not even admin", async () => {
    await seed(db => setDoc(doc(db, "tracker/summary"), { percent: 18 }));
    await assertSucceeds(getDoc(doc(steering(), "tracker/summary")));
    await assertFails(getDoc(doc(general(), "tracker/summary")));
    await assertFails(updateDoc(doc(admin(), "tracker/summary"), { percent: 99 }));
  });

  test("the audit trail can be added to but never rewritten", async () => {
    await seed(db => setDoc(doc(db, "audit/a1"), { what: "signed in", who: "u-gen" }));
    await assertSucceeds(setDoc(doc(general(), "audit/a2"), { what: "opened a document", who: "u-gen" }));
    await assertFails(updateDoc(doc(admin(), "audit/a1"), { what: "nothing happened" }));
    await assertFails(deleteDoc(doc(admin(), "audit/a1")));
  });
});

/* ========================================================================= */
describe("the menu shows a page only to the tier that owns it", () => {

  test("a steering-only page is invisible to a general member", async () => {
    await seed(async db => {
      await setDoc(doc(db, "pages/progress"),  { title: "Progress",  minTier: 1, order: 1, enabled: true });
      await setDoc(doc(db, "pages/documents"), { title: "Documents", minTier: 2, order: 2, enabled: true });
    });
    await assertSucceeds(getDoc(doc(general(), "pages/progress")));
    await assertFails(getDoc(doc(general(), "pages/documents")));
    await assertSucceeds(getDoc(doc(steering(), "pages/documents")));
  });

  test("a page with no minTier set is admin-only, not everyone-only", async () => {
    await seed(db => setDoc(doc(db, "pages/oops"), { title: "Someone forgot minTier", order: 9 }));
    await assertFails(getDoc(doc(general(),  "pages/oops")));
    await assertFails(getDoc(doc(steering(), "pages/oops")));
    await assertSucceeds(getDoc(doc(admin(), "pages/oops")));
  });
});

/* ========================================================================= */
describe("nothing else is reachable", () => {

  test("an invented collection is closed to everyone", async () => {
    await seed(db => setDoc(doc(db, "secrets/s1"), { rent: "confidential" }));
    await assertFails(getDoc(doc(admin(),    "secrets/s1")));
    await assertFails(getDoc(doc(general(),  "secrets/s1")));
    await assertFails(setDoc(doc(admin(),    "secrets/s2"), { x: 1 }));
  });
});

/* =========================================================================
   THE MERGE: three apps, one project.

   These are the tests that matter most. The planner holds the site
   addresses and landlord names, and the whole reason for merging the rules
   rather than appending them is that the old catch-all would have handed
   all of it to every charity that signed in.
   ========================================================================= */

/* An account that predates the hub: signed in with email and password,
   carrying no tier claim. You, Frederik and Louise, today. */
const legacy = () => env.authenticatedContext("u-legacy", { email: "admin@vox.example" }).firestore();

const PLANNER = ["vox_projects", "crm_contacts", "crm_deals", "incoming_emails",
                 "boards", "surveys", "steering_actions", "survey_responses"];

describe("the planner keeps working", () => {

  test("a legacy email-and-password account still reads and writes every planner collection", async () => {
    await seed(async db => {
      for (const c of PLANNER) await setDoc(doc(db, `${c}/x1`), { hello: "world" });
    });
    for (const c of PLANNER) {
      await assertSucceeds(getDoc(doc(legacy(), `${c}/x1`)));
      await assertSucceeds(setDoc(doc(legacy(), `${c}/x2`), { hello: "again" }));
    }
  });

  test("a planner collection that was NOT listed is refused, even to a legacy account", async () => {
    // The deliberate trade. Miss a collection and the planner throws a clear
    // permission error that takes one deploy to fix. The alternative — an open
    // catch-all — silently hands legacy accounts the sign-in code store and a
    // rewritable audit trail. Ask for a rule; do not leave a gap.
    await seed(db => setDoc(doc(db, "some_collection_we_forgot/x1"), { a: 1 }));
    await assertFails(getDoc(doc(legacy(), "some_collection_we_forgot/x1")));
  });

  test("the Business Planner still works, and an issued version stays unalterable", async () => {
    await seed(async db => {
      await setDoc(doc(db, "businesses/b1"), { name: "A plan" });
      await setDoc(doc(db, "businesses/b1/data/general"), { x: 1 });
      await setDoc(doc(db, "businesses/b1/versions/v1"), { issued: true });
    });
    await assertSucceeds(getDoc(doc(legacy(), "businesses/b1")));
    await assertSucceeds(setDoc(doc(legacy(), "businesses/b1/data/pitch"), { x: 2 }));
    await assertSucceeds(getDoc(doc(legacy(), "businesses/b1/versions/v1")));
    await assertFails(updateDoc(doc(legacy(), "businesses/b1/versions/v1"), { issued: false }));
    await assertFails(deleteDoc(doc(legacy(), "businesses/b1/versions/v1")));
  });

  test("the public survey still takes responses from someone with no account", async () => {
    await assertSucceeds(setDoc(doc(stranger(), "requirement_responses/r1"),
      { org: "Charity One", desks: 20 }));
    await assertSucceeds(getDoc(doc(stranger(), "config/survey_fields")));
  });

  test("but a stranger still cannot read the responses back", async () => {
    await seed(db => setDoc(doc(db, "requirement_responses/r1"), { org: "Charity One" }));
    await assertFails(getDoc(doc(stranger(), "requirement_responses/r1")));
  });
});

describe("a charity signing in to the hub cannot reach the CRM", () => {

  test("general tier is refused every planner collection", async () => {
    await seed(async db => {
      for (const c of PLANNER) await setDoc(doc(db, `${c}/x1`), { landlord: "confidential" });
    });
    for (const c of PLANNER) {
      await assertFails(getDoc(doc(general(), `${c}/x1`)));
      await assertFails(setDoc(doc(general(), `${c}/x2`), { a: 1 }));
    }
  });

  test("STEERING tier is refused the planner too — the hub tracker is the way in", async () => {
    await seed(db => setDoc(doc(db, "crm_deals/x1"), { site: "confidential address" }));
    await assertFails(getDoc(doc(steering(), "crm_deals/x1")));
  });

  test("general tier is refused a collection nobody remembered to list", async () => {
    await seed(db => setDoc(doc(db, "some_collection_we_forgot/x1"), { a: 1 }));
    await assertFails(getDoc(doc(general(), "some_collection_we_forgot/x1")));
  });

  test("general tier cannot read survey responses or the Business Planner", async () => {
    await seed(async db => {
      await setDoc(doc(db, "requirement_responses/r1"), { org: "Charity One" });
      await setDoc(doc(db, "businesses/b1"), { name: "A plan" });
    });
    await assertFails(getDoc(doc(general(), "requirement_responses/r1")));
    await assertFails(getDoc(doc(general(), "businesses/b1")));
  });

  test("admin reaches both the hub and the planner", async () => {
    await seed(async db => {
      await setDoc(doc(db, "crm_deals/x1"), { site: "confidential" });
      await setDoc(doc(db, "content/concept"), { body: "hello" });
    });
    await assertSucceeds(getDoc(doc(admin(), "crm_deals/x1")));
    await assertSucceeds(getDoc(doc(admin(), "content/concept")));
  });

  test("a legacy account gets the planner and nothing of the hub", async () => {
    await seed(async db => {
      await setDoc(doc(db, "members/m1"), { email: "jane@charity-one.example", tier: "general" });
      await setDoc(doc(db, "loginCodes/jane@charity-one.example"), { code: "123456" });
      await setDoc(doc(db, "audit/a1"), { what: "signed in" });
    });
    await assertFails(getDoc(doc(legacy(), "members/m1")));
    await assertFails(getDoc(doc(legacy(), "loginCodes/jane@charity-one.example")));
    await assertFails(updateDoc(doc(legacy(), "audit/a1"), { what: "nothing" }));
  });
});

/* =========================================================================
   The People screen, and the document store's delete rule.

   These cover the two screens built in this phase. The member tests matter
   more than they look: the People screen is the ONLY thing that grants
   access, so every rule here is the difference between an invitation and a
   way in.
   ========================================================================= */
describe("the People screen", () => {

  test("only admin may add someone — adding a member IS granting access", async () => {
    await assertFails(setDoc(doc(general(), "members/new1"),
      { email: "friend@charity-four.example", signInEmails: ["friend@charity-four.example"], tier: "general" }));
    await assertFails(setDoc(doc(steering(), "members/new2"),
      { email: "friend@charity-four.example", signInEmails: ["friend@charity-four.example"], tier: "general" }));
    await assertSucceeds(setDoc(doc(admin(), "members/new3"),
      { email: "friend@charity-four.example", signInEmails: ["friend@charity-four.example"], tier: "general" }));
  });

  test("only admin may remove someone", async () => {
    await seed(db => setDoc(doc(db, "members/m1"),
      { email: "jane@charity-one.example", signInEmails: ["jane@charity-one.example"], tier: "general" }));
    await assertFails(deleteDoc(doc(general(),  "members/m1")));
    await assertFails(deleteDoc(doc(steering(), "members/m1")));
    await assertSucceeds(deleteDoc(doc(admin(), "members/m1")));
  });

  test("nobody may add a second sign-in address to their own record", async () => {
    // This is the one that would quietly matter. signInEmails is what the
    // sign-in function searches, so a person who could append to their own
    // array could hand access to any address they liked, at their own tier,
    // without anybody being told.
    await seed(db => setDoc(doc(db, "members/m1"),
      { email: "jane@charity-one.example", signInEmails: ["jane@charity-one.example"], tier: "general" }));
    await assertFails(updateDoc(doc(general(), "members/m1"),
      { signInEmails: ["jane@charity-one.example", "someone.else@example.com"] }));
    await assertSucceeds(updateDoc(doc(admin(), "members/m1"),
      { signInEmails: ["jane@charity-one.example", "jane.personal@mail.example"] }));
  });

  test("a steering member cannot read the roll, so cannot learn who else is in", async () => {
    await seed(db => setDoc(doc(db, "members/m1"),
      { email: "jane@charity-one.example", signInEmails: ["jane@charity-one.example"], tier: "general" }));
    await assertFails(getDoc(doc(steering(), "members/m1")));
    await assertSucceeds(getDoc(doc(admin(), "members/m1")));
  });

  test("a person may correct their own name but not promote themselves by the back door", async () => {
    await seed(db => setDoc(doc(db, "members/m1"),
      { email: "jane@charity-one.example", signInEmails: ["jane@charity-one.example"], tier: "general", name: "J" }));
    await assertSucceeds(updateDoc(doc(general(), "members/m1"), { name: "Jane Doughty", org: "Charity One" }));
    await assertFails(updateDoc(doc(general(), "members/m1"), { tier: "admin" }));
    await assertFails(updateDoc(doc(general(), "members/m1"), { name: "Jane", tier: "steering" }));
    await assertFails(updateDoc(doc(general(), "members/m1"), { uid: "u-someone-else" }));
  });
});

describe("deleting a document", () => {

  test("a steering member may delete the document they added", async () => {
    // The view shows the delete control to the uploader as well as to VOX.
    // If this ever stops being true the control is a lie, and the person
    // clicking it gets a permission error with nothing to do about it.
    await seed(db => setDoc(doc(db, "documents/mine"),
      { title: "My draft", uploadedBy: "u-steer", storagePath: "documents/u-steer/1-a.pdf" }));
    await assertSucceeds(deleteDoc(doc(steering(), "documents/mine")));
  });

  test("a steering member may not delete a document somebody else added", async () => {
    await seed(db => setDoc(doc(db, "documents/theirs"),
      { title: "Heads of terms", uploadedBy: "u-admin", storagePath: "documents/u-admin/1-b.pdf" }));
    await assertFails(deleteDoc(doc(steering(), "documents/theirs")));
  });

  test("a general member sees no part of the store", async () => {
    await seed(db => setDoc(doc(db, "documents/d1"), { title: "Draft lease", uploadedBy: "u-admin" }));
    await assertFails(getDoc(doc(general(), "documents/d1")));
    await assertFails(setDoc(doc(general(), "documents/d9"), { title: "In", uploadedBy: "u-gen" }));
    await assertFails(deleteDoc(doc(general(), "documents/d1")));
  });
});

/* =========================================================================
   VOX eSign lives in this same project.

   These exist because it was left out of the merged rules entirely, and the
   catch-all at the bottom therefore denied it — eSign's dashboard reads the
   collection straight from the browser, so it showed nothing from the day
   these rules went live. The signing links carried on working, because that
   path runs on the Admin SDK and never consults these rules, which is why
   nothing complained.
   ========================================================================= */
describe("VOX eSign", () => {

  test("a legacy VOX account can work the eSign dashboard again", async () => {
    await seed(async db => {
      await setDoc(doc(db, "esign_signature_requests/r1"),
        { documentTitle: "VOX London Pledge", senderEmail: "admin@vox.example", status: "pending" });
      await setDoc(doc(db, "esign_signature_requests/r1/parties/p1"),
        { name: "Jane Doughty", email: "jane@charity-one.example", token: "tok-1", status: "pending" });
    });
    await assertSucceeds(getDoc(doc(legacy(), "esign_signature_requests/r1")));
    await assertSucceeds(getDoc(doc(legacy(), "esign_signature_requests/r1/parties/p1")));
  });

  test("an admin can too", async () => {
    await seed(db => setDoc(doc(db, "esign_signature_requests/r1"), { documentTitle: "Pledge" }));
    await assertSucceeds(getDoc(doc(admin(), "esign_signature_requests/r1")));
  });

  test("a charity cannot read the signing collection — not even their own line", async () => {
    // Their own Pledge reaches them through the pledgeStatus function, which
    // reads on the server. Direct access would show them which other
    // organisations have been sent what, and hand them other people's tokens.
    await seed(async db => {
      await setDoc(doc(db, "esign_signature_requests/r1"), { documentTitle: "Pledge" });
      await setDoc(doc(db, "esign_signature_requests/r1/parties/p1"),
        { name: "Jane", email: "jane@charity-one.example", token: "tok-1", status: "pending" });
    });
    await assertFails(getDoc(doc(general(),  "esign_signature_requests/r1")));
    await assertFails(getDoc(doc(steering(), "esign_signature_requests/r1")));
    await assertFails(getDoc(doc(general(),  "esign_signature_requests/r1/parties/p1")));
    await assertFails(getDoc(doc(steering(), "esign_signature_requests/r1/parties/p1")));
  });

  test("a party's token is not readable by anyone who should not have it", async () => {
    // The token IS the authority to sign. Whoever holds one can sign as that
    // party, so this is the single most important line in this file.
    await seed(db => setDoc(doc(db, "esign_signature_requests/r1/parties/p1"),
      { name: "Jane", email: "jane@charity-one.example", token: "tok-1", status: "pending" }));
    await assertFails(getDoc(doc(general(),  "esign_signature_requests/r1/parties/p1")));
    await assertFails(getDoc(doc(steering(), "esign_signature_requests/r1/parties/p1")));
    await assertFails(getDoc(doc(stranger(), "esign_signature_requests/r1/parties/p1")));
    await assertFails(getDoc(doc(bogus(),    "esign_signature_requests/r1/parties/p1")));
  });

  test("the evidence trail can be read by VOX and rewritten by nobody", async () => {
    await seed(db => setDoc(doc(db, "esign_signature_requests/r1/audit_log/a1"),
      { event: "signed", at: "2026-09-20T10:00:00Z" }));
    await assertSucceeds(getDoc(doc(admin(), "esign_signature_requests/r1/audit_log/a1")));
    await assertFails(updateDoc(doc(admin(),  "esign_signature_requests/r1/audit_log/a1"), { event: "nothing" }));
    await assertFails(setDoc(doc(legacy(),    "esign_signature_requests/r1/audit_log/a2"), { event: "made up" }));
    await assertFails(getDoc(doc(steering(),  "esign_signature_requests/r1/audit_log/a1")));
  });

  test("a signed-out visitor gets nothing from eSign", async () => {
    await seed(db => setDoc(doc(db, "esign_signature_requests/r1"), { documentTitle: "Pledge" }));
    await assertFails(getDoc(doc(stranger(), "esign_signature_requests/r1")));
    await assertFails(setDoc(doc(stranger(), "esign_signature_requests/r2"), { documentTitle: "Mine now" }));
  });
});

describe("signing templates", () => {

  test("only VOX can read or write a template", async () => {
    // A template holds the storage path of the blank document and the exact
    // positions of every signature box. Neither is a charity's business, and
    // the hub reads them through a function rather than from the browser.
    await seed(db => setDoc(doc(db, "esign_templates/t1"),
      { name: "VOX London Pledge", documentStoragePath: "esign/templates/t1.pdf", roles: [] }));
    await assertSucceeds(getDoc(doc(admin(),  "esign_templates/t1")));
    await assertSucceeds(getDoc(doc(legacy(), "esign_templates/t1")));
    await assertFails(getDoc(doc(steering(), "esign_templates/t1")));
    await assertFails(getDoc(doc(general(),  "esign_templates/t1")));
    await assertFails(getDoc(doc(stranger(), "esign_templates/t1")));
  });

  test("a charity cannot invent a template", async () => {
    await assertFails(setDoc(doc(general(),  "esign_templates/t2"), { name: "Mine" }));
    await assertFails(setDoc(doc(steering(), "esign_templates/t3"), { name: "Mine" }));
    await assertSucceeds(setDoc(doc(admin(), "esign_templates/t4"), { name: "Real one" }));
  });
});

describe("the suggestions board", () => {

  test("any member can move a note, because it is a pin board", async () => {
    await seed(db => setDoc(doc(db, "suggestions/s1"),
      { text: "A bookable green-screen room", authorId: "u-admin", backers: [] }));
    // Not the author, and not an admin.
    await assertSucceeds(updateDoc(doc(general(),  "suggestions/s1"), { x: 300, y: 420, z: 7 }));
    await assertSucceeds(updateDoc(doc(steering(), "suggestions/s1"), { x: 10, y: 20, z: 2 }));
  });

  test("moving a note cannot be used to rewrite it", async () => {
    // The whole risk of opening up movement: a "move" that quietly edits the
    // words, the author, or who is backing it.
    await seed(db => setDoc(doc(db, "suggestions/s1"),
      { text: "A bookable green-screen room", authorId: "u-admin", backers: [] }));
    await assertFails(updateDoc(doc(general(), "suggestions/s1"), { x: 5, y: 5, z: 1, text: "Something else" }));
    await assertFails(updateDoc(doc(general(), "suggestions/s1"), { x: 5, y: 5, z: 1, authorId: "u-gen" }));
    await assertFails(updateDoc(doc(general(), "suggestions/s1"), { x: 5, y: 5, z: 1, backers: ["u-gen"] }));
    await assertFails(updateDoc(doc(general(), "suggestions/s1"), { text: "Sneaky" }));
  });

  test("a position has to be a number", async () => {
    // A string here does not error anywhere — it reaches every other person's
    // browser as a note that will not lay out.
    await seed(db => setDoc(doc(db, "suggestions/s1"),
      { text: "A note", authorId: "u-admin", backers: [] }));
    await assertFails(updateDoc(doc(general(), "suggestions/s1"), { x: "300", y: 420, z: 1 }));
    await assertFails(updateDoc(doc(general(), "suggestions/s1"), { x: 300, y: null, z: 1 }));
  });

  test("a signed-out visitor cannot touch the board", async () => {
    await seed(db => setDoc(doc(db, "suggestions/s1"), { text: "A note", authorId: "u-admin", backers: [] }));
    await assertFails(getDoc(doc(stranger(), "suggestions/s1")));
    await assertFails(updateDoc(doc(stranger(), "suggestions/s1"), { x: 1, y: 1, z: 1 }));
  });
});

describe("the concept page", () => {

  test("everyone in can read the concept and its sections; only VOX writes them", async () => {
    // conceptBlocks was missing from these rules, so the page rendered its
    // introduction and then nothing, silently. This is the test that says so.
    await seed(async db => {
      await setDoc(doc(db, "content/concept"), { headline: "A purpose-built home" });
      await setDoc(doc(db, "conceptBlocks/b1"), { order: 1, title: "Why now", body: "..." });
    });
    await assertSucceeds(getDoc(doc(general(),  "conceptBlocks/b1")));
    await assertSucceeds(getDoc(doc(steering(), "conceptBlocks/b1")));
    await assertFails(setDoc(doc(general(),  "conceptBlocks/b2"), { order: 2, title: "Mine" }));
    await assertFails(setDoc(doc(steering(), "conceptBlocks/b3"), { order: 3, title: "Mine" }));
    await assertSucceeds(setDoc(doc(admin(), "conceptBlocks/b4"), { order: 4, title: "Real one" }));
  });

  test("a signed-out visitor gets none of it", async () => {
    await seed(db => setDoc(doc(db, "conceptBlocks/b1"), { order: 1, title: "Why now" }));
    await assertFails(getDoc(doc(stranger(), "conceptBlocks/b1")));
    await assertFails(getDoc(doc(bogus(),    "conceptBlocks/b1")));
  });
});

/* ========================================================================= */
describe("viewings — the one open door in the hub", () => {

  // A viewing people can sign up to, and the address that must not travel
  // with the link.
  async function openViewing(id = "v1", extra = {}) {
    await seed(async db => {
      await setDoc(doc(db, "viewings", id),
        { title: "Property viewing", published: true, open: true, questions: [], ...extra });
      await setDoc(doc(db, "viewings", id, "private", "details"),
        { address: "1 Secret Street, London EC1" });
    });
  }

  const signup = (over = {}) => ({
    viewingId: "v1",
    name: "Dan Collison",
    email: "danc@farmafrica.example",
    org: "Farm Africa",
    role: "Director",
    guests: 2,
    answers: { q1: "About 3,500 sq ft" },
    createdAt: serverTimestamp(),
    ...over
  });

  /* -- what the public may see ------------------------------------------ */

  test("a stranger can open a published viewing", async () => {
    await openViewing();
    await assertSucceeds(getDoc(doc(stranger(), "viewings/v1")));
  });

  test("a draft viewing is invisible until it is published", async () => {
    await openViewing("v1", { published: false });
    await assertFails(getDoc(doc(stranger(), "viewings/v1")));
    await assertSucceeds(getDoc(doc(admin(), "viewings/v1")));
  });

  test("the address never reaches the public document", async () => {
    await openViewing();
    await assertFails(getDoc(doc(stranger(), "viewings/v1/private/details")));
    await assertFails(getDoc(doc(general(), "viewings/v1/private/details")));
    await assertFails(getDoc(doc(steering(), "viewings/v1/private/details")));
    await assertSucceeds(getDoc(doc(admin(), "viewings/v1/private/details")));
  });

  test("a stranger cannot edit the viewing they were sent", async () => {
    await openViewing();
    await assertFails(updateDoc(doc(stranger(), "viewings/v1"), { title: "Cancelled" }));
    await assertFails(updateDoc(doc(general(), "viewings/v1"), { title: "Cancelled" }));
  });

  /* -- signing up -------------------------------------------------------- */

  test("a stranger with the link can sign up", async () => {
    await openViewing();
    await assertSucceeds(setDoc(doc(stranger(), "viewing_signups/s1"), signup()));
  });

  test("sign-ups stop the moment the viewing is closed", async () => {
    await openViewing("v1", { open: false });
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s1"), signup()));
  });

  test("you cannot sign up to a viewing that does not exist", async () => {
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s1"), signup({ viewingId: "made-up" })));
  });

  test("a sign-up cannot smuggle in fields of its own", async () => {
    await openViewing();
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s1"),
      signup({ tier: "admin" })));
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s2"),
      signup({ notes: "x".repeat(50) })));
  });

  test("a sign-up cannot choose its own timestamp", async () => {
    await openViewing();
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s1"),
      signup({ createdAt: new Date("2020-01-01") })));
  });

  test("a sign-up needs a name and something shaped like an email", async () => {
    await openViewing();
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s1"), signup({ name: "" })));
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s2"), signup({ email: "not-an-email" })));
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s3"), signup({ email: "two@at@signs.com" })));
  });

  test("a sign-up cannot bring a coach party or a novel", async () => {
    await openViewing();
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s1"), signup({ guests: 500 })));
    await assertFails(setDoc(doc(stranger(), "viewing_signups/s2"), signup({ org: "x".repeat(200) })));
  });

  /* -- what happens to them afterwards ---------------------------------- */

  test("nobody can read a sign-up back except VOX admin", async () => {
    await openViewing();
    await seed(db => setDoc(doc(db, "viewing_signups/s1"),
      { viewingId: "v1", name: "Dan", email: "d@x.example" }));
    await assertFails(getDoc(doc(stranger(), "viewing_signups/s1")));
    await assertFails(getDoc(doc(general(), "viewing_signups/s1")));
    await assertFails(getDoc(doc(steering(), "viewing_signups/s1")));
    await assertSucceeds(getDoc(doc(admin(), "viewing_signups/s1")));
  });

  test("a sign-up cannot be edited or deleted once it is in", async () => {
    await openViewing();
    await seed(db => setDoc(doc(db, "viewing_signups/s1"),
      { viewingId: "v1", name: "Dan", email: "d@x.example" }));
    await assertFails(updateDoc(doc(stranger(), "viewing_signups/s1"), { name: "Someone else" }));
    await assertFails(deleteDoc(doc(stranger(), "viewing_signups/s1")));
    await assertFails(deleteDoc(doc(steering(), "viewing_signups/s1")));
  });

  test("the whole list of who is coming is admin only", async () => {
    await openViewing();
    await seed(db => setDoc(doc(db, "viewing_signups/s1"),
      { viewingId: "v1", name: "Dan", email: "d@x.example" }));
    await assertFails(getDocs(collection(steering(), "viewing_signups")));
    await assertSucceeds(getDocs(collection(admin(), "viewing_signups")));
  });
});
