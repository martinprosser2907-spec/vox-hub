// Pages that are agreed but not built yet. Honest, rather than a dead link.
import { esc } from "../ui.js";
const NOTES = {
  tracker:   "The full milestone tracker, drawing live from the VOX planner.",
  documents: "The Steering Group document store — papers, minutes and drafts.",
  planning:  "Planning tools, starting with the moving pack.",
  people:    "Inviting people and setting their access level."
};
export function render(view, ctx, page) {
  view.innerHTML = `<div class="card"><div class="empty">
    <div class="ico">◳</div>
    <div class="t" style="font-size:17px">${esc(page.title)} is next on the list</div>
    <div class="n" style="max-width:440px;margin:8px auto 0">
      ${esc(NOTES[page.id] || "This section is planned but not built yet.")}</div>
  </div></div>`;
}
