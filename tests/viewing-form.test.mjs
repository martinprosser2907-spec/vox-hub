/**
 * The public viewing sign-up form — /viewing.html's module.
 *
 * Needs no emulator:  npx vitest run tests/viewing-form.test.mjs
 *
 * These assertions run the SHIPPED js/viewing.js. It is copied into a
 * temporary folder with its two imports repointed — fb.js at a stub, ui.js at
 * the real thing — because the real fb.js pulls Firebase off a CDN and node
 * cannot import an https: URL. Nothing else about the file is changed, so a
 * pass here is a pass for the file that goes out.
 *
 * The test that matters most is the last one: the form's payload is checked
 * against the key list in firestore.rules itself, so the two cannot drift
 * apart without something going red.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VIEWING = {
  title: "VOX London — property viewing",
  dateText: "Thursday 13 November 2026",
  timeText: "10:30am",
  publicLocation: "Central London",
  intro: "Come and see the building.",
  published: true,
  open: true,
  questions: [
    { key: "qaaa111", label: "Roughly how much space do you need?", type: "choice",
      options: ["Under 5,000 sq ft", "More than 5,000 sq ft"], required: true },
    { key: "qbbb222", label: "Anything you want us to cover?", type: "long", required: false }
  ]
};

// Loads a fresh copy of the shipped module against a given Firestore state.
async function load({ viewing = VIEWING, exists = true, fails = false } = {}) {
  // Inside the project, not the system temp folder: vitest serves modules
  // through vite, which refuses to load anything outside the project root.
  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".vox-viewing-"));
  copyFileSync("js/ui.js", join(dir, "ui.js"));
  const added = [];
  globalThis.__ADDED = added;
  writeFileSync(join(dir, "fb.js"), `
    export const db = {};
    export const doc = (_d, ...p) => p.join("/");
    export const collection = (_d, n) => n;
    export const serverTimestamp = () => "__SERVER_TIME__";
    export const getDoc = async () => {
      if (${fails}) throw new Error("permission-denied");
      return { exists: () => ${exists}, id: "v-test", data: () => globalThis.__VIEWING };
    };
    export const addDoc = async (c, data) => { globalThis.__ADDED.push({ c, data }); return { id: "s1" }; };`);
  writeFileSync(join(dir, "viewing.mjs"),
    readFileSync("js/viewing.js", "utf8")
      .replace('from "./fb.js"', 'from "./fb.js"')
      .replace('from "./ui.js"', 'from "./ui.js"'));
  globalThis.__VIEWING = viewing;
  await import(pathToFileURL(join(dir, "viewing.mjs")).href);
  await new Promise(r => setTimeout(r, 0));
  return { added, card: document.getElementById("v-card") };
}

beforeEach(() => {
  document.body.innerHTML = `<div class="v-wrap"><div class="v-card" id="v-card"></div></div>`;
  window.history.replaceState({}, "", "/viewing.html?v=v-test");
  vi.restoreAllMocks();
});

// The form refuses anything submitted within three seconds of opening, because
// that is a bot and never a person. Every test about the CONTENT of a sign-up
// has to get past that first, so it moves the clock on rather than waiting.
function waitedLikeAPerson() {
  const real = Date.now();
  vi.spyOn(Date, "now").mockImplementation(() => real + 5000);
}

describe("what an invitee sees", () => {

  it("shows the viewing and both of Martin's questions", async () => {
    const { card } = await load();
    expect(card.innerHTML).toContain("VOX London — property viewing");
    expect(card.innerHTML).toContain("Thursday 13 November 2026");
    expect(card.innerHTML).toContain("Roughly how much space do you need?");
    expect(card.querySelector("#fq-qaaa111")).toBeTruthy();
    expect(card.querySelector("#fq-qbbb222")).toBeTruthy();
  });

  it("offers exactly the choices Martin typed, and no others", async () => {
    const { card } = await load();
    const opts = [...card.querySelectorAll("#fq-qaaa111 option")].map(o => o.value);
    expect(opts).toEqual(["", "Under 5,000 sq ft", "More than 5,000 sq ft"]);
  });

  it("never shows the address, because the page is never given it", async () => {
    const { card } = await load({
      viewing: { ...VIEWING, address: "1 Secret Street", arrivalNotes: "Ask for Martin" }
    });
    // Even if an address were put in the public document by mistake, this page
    // renders named fields only — it does not dump the document.
    expect(card.innerHTML).not.toContain("Secret Street");
    expect(card.innerHTML).not.toContain("Ask for Martin");
  });

  it("says sign-ups have closed rather than going dead", async () => {
    const { card } = await load({ viewing: { ...VIEWING, open: false } });
    expect(card.innerHTML).toContain("closed");
    expect(card.querySelector("#v-form")).toBeNull();
  });

  it("does not admit that an unpublished viewing exists", async () => {
    const { card } = await load({ fails: true });
    expect(card.innerHTML).toContain("not live yet");
    expect(card.innerHTML).not.toContain("property viewing");
  });

  it("carries no way back into the hub", async () => {
    const { card } = await load();
    const hrefs = [...card.querySelectorAll("a")].map(a => a.getAttribute("href"));
    expect(hrefs.filter(h => h && h.startsWith("#/"))).toEqual([]);
    expect(card.innerHTML).not.toContain("Sign in");
  });
});

describe("what it refuses to send", () => {

  async function fill(card, over = {}) {
    if (!over.instant) waitedLikeAPerson();
    const set = (id, v) => { const e = card.querySelector(id); if (e) e.value = v; };
    set("#f-name", over.name ?? "Dan Collison");
    set("#f-email", over.email ?? "danc@farmafrica.example");
    set("#f-org", over.org ?? "Farm Africa");
    set("#f-role", over.role ?? "Director");
    set("#f-guests", over.guests ?? "2");
    set("#fq-qaaa111", over.q1 ?? "Under 5,000 sq ft");
    set("#fq-qbbb222", over.q2 ?? "Parking?");
    set("#f-hp", over.hp ?? "");
    card.querySelector("#v-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
  }

  it("sends a filled-in form", async () => {
    const { card, added } = await load();
    await fill(card);
    expect(added.length).toBe(1);
    expect(added[0].data.name).toBe("Dan Collison");
    expect(added[0].data.guests).toBe(2);
    expect(added[0].data.answers).toEqual({ qaaa111: "Under 5,000 sq ft", qbbb222: "Parking?" });
  });

  it("sends nothing when it is filled in faster than a person could", async () => {
    const { card, added } = await load();
    await fill(card, { instant: true });
    expect(added.length).toBe(0);
  });

  it("sends nothing at all when the hidden field was filled in", async () => {
    const { card, added } = await load();
    await fill(card, { hp: "http://spam.example" });
    expect(added.length).toBe(0);
  });

  it("refuses a nonsense email", async () => {
    const { card, added } = await load();
    await fill(card, { email: "not-an-email" });
    expect(added.length).toBe(0);
    expect(card.querySelector("#f-msg").hidden).toBe(false);
  });

  it("refuses a missing name", async () => {
    const { card, added } = await load();
    await fill(card, { name: "   " });
    expect(added.length).toBe(0);
  });

  it("refuses to skip a question Martin marked required", async () => {
    const { card, added } = await load();
    await fill(card, { q1: "" });
    expect(added.length).toBe(0);
    expect(card.querySelector("#f-msg").textContent).toContain("Roughly how much space");
  });

  it("lets an optional question go unanswered", async () => {
    const { card, added } = await load();
    await fill(card, { q2: "" });
    expect(added.length).toBe(1);
    expect(added[0].data.answers).toEqual({ qaaa111: "Under 5,000 sq ft" });
  });

  it("will not let somebody book a coach party", async () => {
    const { card, added } = await load();
    await fill(card, { guests: "500" });
    expect(added[0].data.guests).toBe(20);
  });
});

describe("the form and the security rules agree", () => {

  it("sends exactly the fields validSignup() allows, and no others", async () => {
    const { card, added } = await load();
    await fill_(card);
    const sent = Object.keys(added[0].data).sort();

    const rules = readFileSync("firestore.rules", "utf8");
    const m = rules.match(/d\.keys\(\)\.hasOnly\(\[([^\]]+)\]\)/);
    expect(m, "validSignup() hasOnly list not found in firestore.rules").toBeTruthy();
    const allowed = m[1].split(",").map(s => s.trim().replace(/^'|'$/g, "")).sort();

    expect(sent).toEqual(allowed);
  });

  async function fill_(card) {
    waitedLikeAPerson();
    const set = (id, v) => { const e = card.querySelector(id); if (e) e.value = v; };
    set("#f-name", "Dan Collison"); set("#f-email", "danc@farmafrica.example");
    set("#f-org", "Farm Africa"); set("#f-role", "Director"); set("#f-guests", "2");
    set("#fq-qaaa111", "Under 5,000 sq ft"); set("#fq-qbbb222", "Parking?");
    card.querySelector("#v-form").dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise(r => setTimeout(r, 0));
  }
});
