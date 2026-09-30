/**
 * Fills in the concept page from the 15 September launch deck.
 *
 *   node seed-concept.js
 *
 * Run it as often as you like — it writes the same documents each time, so a
 * second run just refreshes them. Needs serviceAccount.json in this folder.
 *
 * What is deliberately NOT here: site addresses, landlord names and rent
 * figures. The concept page is visible to every charity signed in, and those
 * stay with the Steering Group. The deck's site slide is summarised as "sites
 * under review" and nothing more.
 *
 * Numbers are kept to the ones that will still be true in three months. The
 * count of signed pledges belongs on the Progress page, where it is expected
 * to move; putting it here would leave the concept quietly out of date.
 *
 * THE PICTURE AT THE TOP is not written from here. The Copenhagen render off
 * slide 6 ships with the app, in assets/copenhagen-1600.jpg, and js/views/
 * concept.js falls back to it. That keeps it out of Storage, where it would
 * need its own rule and its own upload for a file that never changes.
 *
 * To put a different picture there without a deploy, set three fields on
 * content/concept and the view will use them instead:
 *
 *   image        a URL, or a path under assets/
 *   imageAlt     what is in it, for anyone who cannot see it
 *   imageCaption the line printed underneath, or "" for none
 *
 * Set `image` and the Copenhagen caption and alt text do NOT carry over — a
 * caption about a Danish textile factory under a photograph of somewhere else
 * is worse than no caption — so set all three or none.
 */
import { initializeApp, cert } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { readFileSync } from "node:fs";

initializeApp({ credential: cert(JSON.parse(readFileSync("./serviceAccount.json", "utf8"))) });
const db = getFirestore();

const INTRO = {
  headline: "A purpose-built home for London's civil society",
  standfirst: "One building, shared by charities who would otherwise each carry the cost of "
    + "their own — designed around what the sector actually needs rather than what the office "
    + "market happens to offer.",
  body:
    "VOX London is a tenant-led project to create a large, purpose-built hub for charities and "
    + "civil society organisations in London. Organisations take their own space in it, and "
    + "share everything it makes no sense to duplicate eight times over: meeting and event "
    + "space, studios, training rooms, front of house, and a long list of back office services "
    + "that each organisation opts into or leaves alone.\n\n"
    + "It is not a serviced office and it is not a co-working space. Leases are negotiated "
    + "together rather than one at a time, which is what gives a group of charities the standing "
    + "with a landlord that none of them has alone — and it is why the rent for a building of "
    + "this quality can come out lower than the sum of what everyone pays today.\n\n"
    + "The model is already running. VOX Copenhagen opened in September 2025 in a transformed "
    + "textile factory and is more than ninety per cent let. VOX Stockholm has over thirty-five "
    + "organisations signed to a letter of interest and is in building negotiations. London is "
    + "the third, and the ambition is a European network of connected hubs.",
  updatedAt: FieldValue.serverTimestamp()
};

const BLOCKS = [
  {
    order: 10, kicker: "Why now",
    title: "Four pressures the sector is carrying at once",
    body:
      "Economic uncertainty, and the need to cut cost without losing the ability to move.\n\n"
      + "Issues that are more complex and more global than any one organisation can meet on its "
      + "own, which makes collaboration and shared capacity a practical necessity rather than a "
      + "nice idea.\n\n"
      + "Competition for people who could earn more elsewhere, against workplaces the private "
      + "sector has spent a decade improving.\n\n"
      + "Physical and digital threats, and a shifting public and political view of the sector's "
      + "place. Well-designed real estate does not solve any of these on its own, but it is one "
      + "of the few levers that touches all four."
  },
  {
    order: 20, kicker: "What you told us",
    title: "What is missing today",
    body:
      "Buzz — enough people in the building, often enough, that it feels alive when you walk in.\n\n"
      + "A reason to come in: something the kitchen table cannot offer.\n\n"
      + "Flexibility — space sized for your everyday, with hot desks and meeting rooms to absorb "
      + "the days when the whole team is in.\n\n"
      + "Meeting space, which comes up in almost every conversation. Rooms at the size you need, "
      + "when you need them, instead of thousands a month spent booking them elsewhere."
  },
  {
    order: 30, kicker: "What you told us",
    title: "What is hard",
    body:
      "Cost — offices taking money that should be going to the mission, and overheads no funder "
      + "wants to pay for.\n\n"
      + "Flexibility — paying for space sized for your busiest day and watching most of it sit "
      + "empty for the rest of the week.\n\n"
      + "Succession planning — specialist knowledge leaving with the people who hold it, and "
      + "nowhere to pass it on.\n\n"
      + "Hybrid working — managing a workforce that is rarely all in one place, and making the "
      + "days together count."
  },
  {
    order: 40, kicker: "The building",
    title: "What it carries",
    body:
      "Meeting and event space on a scale no single charity could justify alone. Training rooms, "
      + "casework rooms, quiet space, collaboration areas and breakout space for informal "
      + "meetings.\n\n"
      + "Audio and video studios, creative workshop and maker space, volunteer and activist "
      + "lounges, outdoor terraces.\n\n"
      + "Hot desks and overflow space, so you lease for your everyday and not your busiest day.\n\n"
      + "Target size is 150,000 to 200,000 square feet, with the aim of opening in 2028."
  },
  {
    order: 50, kicker: "Shared services",
    title: "Around forty possibilities, all opt-in",
    body:
      "Technology — infrastructure, service desk, purchasing, cyber security, data and AI, AV.\n\n"
      + "Communications — media production, press and external, internal comms.\n\n"
      + "Finance — accounting, payroll, procurement, legacy administration.\n\n"
      + "Governance and compliance — legal, filings, data protection, risk, audit, safeguarding, "
      + "health and safety, insurance.\n\n"
      + "People — learning and development, HR advice, recruitment, internships, volunteers, "
      + "inclusion, adjustments, benefits, commuting.\n\n"
      + "Building and front of house — reception, cleaning, catering, print, maintenance, waste, "
      + "security.\n\n"
      + "Only the building-related services are obligatory. Everything else is taken if you want "
      + "it and left if you do not."
  },
  {
    order: 60, kicker: "Governance",
    title: "Tenant-led, and already running",
    body:
      "A tenant Steering Group represents the organisations' interests, and it is already "
      + "functioning rather than something to be set up later.\n\n"
      + "VOX London Office Ltd is a legal entity dedicated to implementing the concept in "
      + "accordance with what the tenants decide, and it works with real estate investors to "
      + "bridge the gap between a conventional property deal and what the sector needs.\n\n"
      + "Each VOX house has its own governance and operates independently. Signing the Pledge "
      + "does not put an organisation on the Steering Group — that is a separate commitment."
  },
  {
    order: 70, kicker: "Cost",
    title: "What participating costs during development",
    body:
      "Project direction, concept design and the building search are delivered at no cost to "
      + "tenants, with the risk carried by VOX Global.\n\n"
      + "Shared by the tenants: one full-time project manager, and legal advice — because leases "
      + "are negotiated in unison, the group needs one legal team rather than one each. During "
      + "mobilisation these are carried by the anchor tenants.\n\n"
      + "Anything beyond that, such as study trips or specialist consultants, is voluntary.\n\n"
      + "Anything an organisation contributes now is taken off its costs later, as a discount "
      + "once there is a building."
  },
  {
    order: 80, kicker: "Where we are",
    title: "Mobilisation, and what comes next",
    body:
      "The project is in mobilisation: building the founding group and gathering signatures on "
      + "the Pledge. Site selection follows, then lease negotiation, building development and "
      + "move-in.\n\n"
      + "Negotiations begin once interest reaches 60 to 80 per cent of the building's capacity. "
      + "That threshold, not a date, is what moves the project to the next phase.\n\n"
      + "Sites are under review across central and inner London. Rent is one of four tests, "
      + "alongside commute, flagship potential and the condition of the building. Addresses sit "
      + "with the Steering Group.\n\n"
      + "Signing the Pledge is non-binding and non-financial. It commits nobody to a building, a "
      + "location or a payment."
  }
];

await db.collection("content").doc("concept").set(INTRO, { merge: true });

const batch = db.batch();
BLOCKS.forEach((b, i) => {
  batch.set(db.collection("conceptBlocks").doc(`b${String(i + 1).padStart(2, "0")}`),
    { ...b, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
});
await batch.commit();

console.log(`concept page written: introduction + ${BLOCKS.length} sections`);
process.exit(0);
