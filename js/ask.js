// ---------------------------------------------------------------------------
// The help assistant. A floating button, a panel, and one callable function.
// The Anthropic key lives in the function, never in the browser.
//
// Adapted from the HelpPanel in Calla Practice Management.
// ---------------------------------------------------------------------------
import { callable } from "./fb.js";
import { $, el, esc } from "./ui.js";

const OPENERS = [
  "Does signing the Pledge commit us to a location?",
  "What does it cost to take part?",
  "When is a building chosen?",
  "Can we keep looking at other offices?"
];

export function mountAsk() {
  const btn = el(`<button class="ask-btn" id="ask-btn" aria-label="Ask about VOX London">?</button>`);
  document.body.appendChild(btn);

  let panel = null;
  const history = [];

  btn.addEventListener("click", () => {
    if (panel) { panel.remove(); panel = null; btn.classList.remove("on"); return; }
    btn.classList.add("on");
    panel = el(`
      <section class="ask" role="dialog" aria-label="Ask about VOX London">
        <div class="ask-head">
          <div><div class="label" style="font-size:10px">Ask</div>
               <div class="t">Anything about VOX London</div></div>
          <button class="linkish" id="ask-close" aria-label="Close">Close</button>
        </div>
        <div class="ask-log" id="ask-log">
          <div class="ask-msg it">Ask me anything about the project &mdash; the Pledge, the timeline, how the building works, what happens next.</div>
        </div>
        <div class="ask-sugg" id="ask-sugg">
          ${OPENERS.map(q => `<button type="button">${esc(q)}</button>`).join("")}
        </div>
        <form class="ask-form" id="ask-form">
          <input type="text" id="ask-input" placeholder="Type a question…" autocomplete="off">
          <button class="btn btn-sm" type="submit">Ask</button>
        </form>
      </section>`);
    document.body.appendChild(panel);

    $("#ask-close", panel).addEventListener("click", () => btn.click());
    $("#ask-form", panel).addEventListener("submit", (e) => {
      e.preventDefault();
      send($("#ask-input", panel).value);
    });
    panel.querySelectorAll(".ask-sugg button")
      .forEach(b => b.addEventListener("click", () => send(b.textContent)));
    setTimeout(() => $("#ask-input", panel)?.focus(), 60);
  });

  async function send(text) {
    const q = String(text || "").trim();
    if (!q || !panel) return;
    const log = $("#ask-log", panel);
    $("#ask-sugg", panel)?.remove();
    $("#ask-input", panel).value = "";

    log.appendChild(el(`<div class="ask-msg me">${esc(q)}</div>`));
    history.push({ role: "user", content: q });

    const thinking = el(`<div class="ask-msg it dots"><span></span><span></span><span></span></div>`);
    log.appendChild(thinking);
    log.scrollTop = log.scrollHeight;

    try {
      const res = await callable("askHub")({ messages: history });
      const reply = res.data?.reply || "Sorry, I could not answer that one.";
      thinking.replaceWith(el(`<div class="ask-msg it">${esc(reply)}</div>`));
      history.push({ role: "assistant", content: reply });
    } catch (err) {
      console.error(err);
      thinking.replaceWith(el(`<div class="ask-msg it">I could not reach the assistant just now. If it is urgent, email martin@voxhouses.global.</div>`));
      history.pop();
    }
    log.scrollTop = log.scrollHeight;
  }
}
