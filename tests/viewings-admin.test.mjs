/**
 * The Viewings admin page — the three screens it moves between.
 *
 * Needs no emulator:  npx vitest run tests/viewings-admin.test.mjs
 *
 * Runs the SHIPPED js/views/viewings.js, copied into a temporary folder with
 * its two imports repointed — fb.js at a stub, ui.js at the real thing —
 * because the real fb.js pulls Firebase off a CDN and node cannot import an
 * https: URL. Nothing else about the file is changed.
 *
 * It exists because reading a headcount used to mean opening the invitation
 * for editing. These assertions are what stop that coming back.
 */
// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const VIEWING = {
  id: "v1", title: "Property viewing - VOX Shortlist",
  dateText: "Thursday 19 November 2026", timeText: "10.30am",
  publicLocation: "Central London", published: true, open: true,
  questions: [{ key: "qaaa", label: "Names of everyone coming", type: "long", required: true }]
};

const SIGNUPS = [
  { id: "s1", viewingId: "v1", name: "Cheryl Richardson", org: "Plan UK",
    email: "cheryl@plan-uk.example", guests: 2, attendance: "declined",
    attendanceNote: "All-day Leadership Team meeting" },
  { id: "s2", viewingId: "v1", name: "Dan Collison", org: "Farm Africa",
    email: "danc@farmafrica.example", guests: 3 },
  { id: "s3", viewingId: "v1", name: "Ashley Mason", org: "Save the Children",
    email: "ashley@stc.example", guests: 1, attendance: "coming" }
];

let render;

beforeEach(async () => {
  document.body.innerHTML = `<div id="view"></div>`;
  globalThis.__VIEWINGS = [VIEWING];
  globalThis.__SIGNUPS = SIGNUPS;

  const dir = mkdtempSync(join(process.cwd(), "node_modules", ".vox-admin-"));
  copyFileSync("js/ui.js", join(dir, "ui.js"));
  writeFileSync(join(dir, "fb.js"), `
    export const db = {};
    export const doc = (_d, ...p) => p.join("/");
    export const collection = (_d, n) => n;
    export const query = (c) => c;
    export const where = () => null;
    export const orderBy = () => null;
    export const serverTimestamp = () => "__NOW__";
    export const getDoc = async () => ({ exists: () => false, data: () => ({}) });
    export const setDoc = async () => {};
    export const addDoc = async () => ({ id: "new" });
    export const deleteDoc = async () => {};
    export const updateDoc = async () => {};
    export const getDocs = async () => ({
      docs: globalThis.__SIGNUPS.map(r => ({ id: r.id, data: () => r })), size: globalThis.__SIGNUPS.length });
    export const onSnapshot = (_q, cb) => {
      cb({ docs: globalThis.__VIEWINGS.map(v => ({ id: v.id, data: () => v })) });
      return () => {};
    };`);
  writeFileSync(join(dir, "viewings.mjs"),
    readFileSync("js/views/viewings.js", "utf8")
      .replace('from "../fb.js"', 'from "./fb.js"')
      .replace('from "../ui.js"', 'from "./ui.js"'));
  ({ render } = await import(pathToFileURL(join(dir, "viewings.mjs")).href + "?t=" + Math.random()));

  const view = document.getElementById("view");
  render(view, { user: { tier: "admin" } });
  await new Promise(r => setTimeout(r, 0));
});

const view = () => document.getElementById("view");
const text = () => view().innerText.replace(/\s+/g, " ");

describe("the list of viewings", () => {

  it("offers the attendee list without going near the editor", () => {
    expect(view().querySelector("[data-who]")).toBeTruthy();
    expect(text()).toContain("Who is coming");
  });

  it("shows the headcount on the card, so you need not click at all", async () => {
    await new Promise(r => setTimeout(r, 10));
    expect(text()).toContain("4 people coming");   // 3 + 1, Cheryl's 2 excluded
    expect(text()).toContain("1 dropped out");
  });
});

describe("the attendee list", () => {

  beforeEach(async () => {
    view().querySelector("[data-who]").click();
    await new Promise(r => setTimeout(r, 10));
  });

  it("shows who is coming, and who has dropped out and why", () => {
    expect(text()).toContain("Dan Collison");
    expect(text()).toContain("Cheryl Richardson");
    expect(view().querySelector('.s-note[data-id="s1"]').value)
      .toBe("All-day Leadership Team meeting");
  });

  it("counts only the people who are actually coming", () => {
    expect(text()).toContain("4 people coming");
    expect(text()).toContain("1 since dropped out");
  });

  it("carries no field that could change the invitation", () => {
    for (const id of ["#f-title", "#f-date", "#f-time", "#f-intro", "#f-addr", "#v-save", "#f-pub"]) {
      expect(view().querySelector(id), `${id} must not be on this page`).toBeNull();
    }
  });

  it("still has the things you need on the day", () => {
    expect(view().querySelector("#s-csv")).toBeTruthy();
    expect(view().querySelector("#s-add")).toBeTruthy();
    expect(view().querySelector("#s-refresh")).toBeTruthy();
  });

  it("goes back to the list", async () => {
    view().querySelector("#w-back").click();
    await new Promise(r => setTimeout(r, 10));
    expect(view().querySelector("[data-who]")).toBeTruthy();
    expect(view().querySelector("#s-list")).toBeNull();
  });
});

describe("the editor", () => {

  beforeEach(async () => {
    view().querySelector("[data-edit]").click();
    await new Promise(r => setTimeout(r, 10));
  });

  it("still carries the same attendee panel, from the one definition", () => {
    expect(view().querySelector("#s-list")).toBeTruthy();
    expect(view().querySelector("#s-addform")).toBeTruthy();
  });

  it("is where the invitation fields live", () => {
    expect(view().querySelector("#f-title")).toBeTruthy();
    expect(view().querySelector("#f-addr")).toBeTruthy();
    expect(view().querySelector("#v-save")).toBeTruthy();
  });
});

describe("adding somebody who replied by email", () => {

  beforeEach(async () => {
    view().querySelector("[data-who]").click();
    await new Promise(r => setTimeout(r, 10));
    view().querySelector("#s-add").click();
  });

  it("will not send the address to somebody who has just declined", async () => {
    const att = view().querySelector("#a-att");
    const tick = view().querySelector("#a-email-them");
    tick.checked = true;
    att.value = "declined";
    att.dispatchEvent(new Event("change"));
    expect(tick.checked).toBe(false);
    expect(tick.disabled).toBe(true);
    expect(view().querySelector("#a-email-why").textContent).toContain("not sent the address");
  });

  it("lets you email somebody who is coming", () => {
    const att = view().querySelector("#a-att");
    const tick = view().querySelector("#a-email-them");
    att.value = "coming";
    att.dispatchEvent(new Event("change"));
    expect(tick.disabled).toBe(false);
  });
});
