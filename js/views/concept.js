import { db, doc, getDoc, collection, query, orderBy, getDocs } from "../fb.js";
import { esc, paras, empty } from "../ui.js";

// The Copenhagen building, off slide 6 of the 15 September launch deck.
//
// It ships in assets/ rather than living in Storage. It is page furniture —
// the same picture for every viewer, changed by VOX and nobody else — so a
// file beside the stylesheet needs no upload, no download URL, no Storage
// rule and no second place to get the permissions wrong. content/concept can
// still override it with `image`, `imageAlt` and `imageCaption` if the
// picture ever needs changing without a deploy.
//
// It is a visualisation, not a photograph, and the caption says so. The
// building is real and open; the image is the architect's render of it, and
// captioning a render as a photo is the kind of small dishonesty a funder
// notices.
const HERO = {
  src: "/assets/copenhagen-1600.jpg",
  srcset: "/assets/copenhagen-900.jpg 900w, /assets/copenhagen-1600.jpg 1600w",
  width: 1600,
  height: 909,
  alt: "VOX Copenhagen: a long four-storey building in brick and pale timber, "
     + "full-height glazing along every floor, a planted terrace at ground "
     + "level and mature trees on the lawn in front of it.",
  caption: "VOX Copenhagen — a former textile factory of 12,400 square metres, "
         + "transformed and opened in September 2025. Architect's visualisation."
};

// Sized to the content column: max-width 1120px less the 32px page padding on
// each side, and the card's own padding is cancelled by the negative margins
// in .card>.hero:first-child, so the image runs the full width of the card.
const SIZES = "(max-width: 1120px) 100vw, 1056px";

function heroFigure(d) {
  const custom = typeof d.image === "string" && d.image.length > 0;
  const src = custom ? d.image : HERO.src;
  const caption = d.imageCaption ?? (custom ? "" : HERO.caption);
  const alt = d.imageAlt ?? (custom ? "" : HERO.alt);

  // The bundled image carries its dimensions and a srcset; an image someone
  // else points at later does not, because guessing either would reserve the
  // wrong space and shift the page as it loads.
  const attrs = custom
    ? ""
    : ` srcset="${HERO.srcset}" sizes="${SIZES}" width="${HERO.width}" height="${HERO.height}"`;

  return `<figure class="hero">
      <img src="${esc(src)}"${attrs} alt="${esc(alt)}">
      ${caption ? `<figcaption>${esc(caption)}</figcaption>` : ""}
    </figure>`;
}

export async function render(view) {
  const [intro, blocks] = await Promise.all([
    getDoc(doc(db, "content", "concept")).catch(() => null),
    getDocs(query(collection(db, "conceptBlocks"), orderBy("order"))).catch(() => null)
  ]);
  const d = intro?.exists() ? intro.data() : {};
  const items = blocks ? blocks.docs.map(x => x.data()) : [];

  view.innerHTML = `
    <div class="card">
      ${heroFigure(d)}
      <h3>${esc(d.headline || "A purpose-built home for London's charity sector")}</h3>
      <div class="lede">${esc(d.standfirst || "")}</div>
      ${paras(d.body || "")}
    </div>
    ${items.length ? `<div class="grid g2">${items.map(b => `
      <div class="card" style="margin:0">
        ${b.kicker ? `<h2>${esc(b.kicker)}</h2>` : ""}
        <h3>${esc(b.title || "")}</h3>${paras(b.body || "")}</div>`).join("")}</div>` : ""}
    ${(!d.body && !items.length)
      ? empty("◈", "The concept page has not been written yet", "An admin can add it under content/concept.")
      : ""}`;
}
