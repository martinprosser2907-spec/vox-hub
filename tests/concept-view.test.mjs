/**
 * The concept page's hero image.
 *
 * Needs no emulator:  npm run test:views
 *
 * These assertions run the SHIPPED js/views/concept.js. It is copied into a
 * temporary folder with its two imports repointed — fb.js at a stub, ui.js at
 * the real thing — because the real fb.js pulls Firebase off a CDN and node
 * cannot import an https: URL. Nothing else about the file is changed, so a
 * pass here is a pass for the file that goes out.
 */
import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, writeFileSync, mkdtempSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

let render;

beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), "vox-concept-"));
  copyFileSync("js/ui.js", join(dir, "ui.js"));
  writeFileSync(join(dir, "fb.js"),
    `export const db = {};
     export const doc = (_d, ...p) => p.join("/");
     export const collection = (_d, n) => n;
     export const query = c => c;
     export const orderBy = () => null;
     export const getDoc  = async () => ({ exists: () => true, data: () => globalThis.__CONCEPT });
     export const getDocs = async () => ({ docs: [] });`);
  writeFileSync(join(dir, "concept.mjs"),
    readFileSync("js/views/concept.js", "utf8")
      .replace('from "../fb.js"', 'from "./fb.js"')
      .replace('from "../ui.js"', 'from "./ui.js"'));
  ({ render } = await import(pathToFileURL(join(dir, "concept.mjs")).href));
});

async function html(data) {
  globalThis.__CONCEPT = data;
  const view = {};
  await render(view);
  return view.innerHTML;
}

describe("the bundled Copenhagen image", () => {
  it("is what the page shows when Firestore says nothing about an image", async () => {
    const h = await html({ body: "words" });
    expect(h).toContain('src="/assets/copenhagen-1600.jpg"');
    expect(h).toContain("/assets/copenhagen-900.jpg 900w");
    expect(h).toContain("/assets/copenhagen-1600.jpg 1600w");
  });

  it("reserves the right space while it loads", async () => {
    const h = await html({ body: "words" });
    expect(h).toContain('width="1600"');
    expect(h).toContain('height="909"');
  });

  it("is the first thing in the card, so the CSS that bleeds it to the edges applies", async () => {
    // .card>.hero:first-child is what cancels the card's padding. Put anything
    // before the figure and the picture quietly becomes a framed illustration.
    const h = await html({ body: "words" });
    expect(h).toMatch(/<div class="card">\s*<figure class="hero">/);
  });

  it("says it is a visualisation, because it is a render and not a photograph", async () => {
    const h = await html({ body: "words" });
    expect(h).toMatch(/<figcaption>[^<]*visualisation/);
  });
});

describe("an image set on content/concept instead", () => {
  it("is used in place of the bundled one", async () => {
    const h = await html({ image: "https://example.test/other.jpg" });
    expect(h).toContain('src="https://example.test/other.jpg"');
  });

  it("carries no srcset, or the browser would fetch the Copenhagen file instead", async () => {
    const h = await html({ image: "https://example.test/other.jpg" });
    expect(h).not.toContain("srcset");
    expect(h).not.toContain("copenhagen");
  });

  it("carries no width or height, because nobody here knows its shape", async () => {
    const h = await html({ image: "https://example.test/other.jpg" });
    expect(h).not.toMatch(/width="1600"|height="909"/);
  });

  it("does not inherit the Copenhagen caption or alt text", async () => {
    // The failure this catches is a caption describing a Danish textile factory
    // sitting under a photograph of somewhere else entirely.
    const h = await html({ image: "https://example.test/other.jpg" });
    expect(h).not.toContain("visualisation");
    expect(h).not.toContain("VOX Copenhagen");
  });

  it("uses its own caption and alt text when they are given", async () => {
    const h = await html({ image: "a.jpg", imageCaption: "A caption", imageAlt: "Alt words" });
    expect(h).toContain(">A caption<");
    expect(h).toContain('alt="Alt words"');
  });
});

describe("escaping", () => {
  it("does not let a value from the database add attributes to the img", async () => {
    const h = await html({ image: 'x.jpg" onerror="alert(1)', imageAlt: "<script>" });
    expect(h).not.toContain('onerror="alert(1)"');
    expect(h).toContain("&lt;script&gt;");
  });
});
