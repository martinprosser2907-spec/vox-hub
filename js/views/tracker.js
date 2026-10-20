// ---------------------------------------------------------------------------
// Progress tracker — Steering Group and above.
//
// Reads tracker/summary and nothing else. That document is written by the
// syncTracker job on the server, which has already decided what a charity on
// the Steering Group may see about the others. Nothing here filters anything:
// if a name reaches this file it is already cleared to be shown, and if the
// filter is ever wrong the fix belongs in functions/tracker.js, not here.
//
// The tier-1 sibling is progress.js, which shows the public milestone view.
// This is the fuller picture behind it.
// ---------------------------------------------------------------------------
import { db, doc, onSnapshot } from "../fb.js";
import { callable } from "../fb.js";
import { esc, when, toast, tierOf } from "../ui.js";

const num = (n) => Number(n || 0).toLocaleString("en-GB");

const STAGE_NOTE = {
  "Identified":       "On the list, not yet approached",
  "Contacted":        "Approached, awaiting a reply",
  "Active Dialogue":  "In conversation",
  "Expected to sign": "Expected to sign",
  "Onboarded":        "Onboarded",
  "Lost":             "Not proceeding"
};

export function render(view, ctx) {
  const isAdmin = tierOf(ctx.user.tier) >= 3;

  view.innerHTML = `
    <div class="card" id="t-head">
      <div class="skel"></div><div class="skel" style="width:55%"></div>
    </div>
    <div class="grid g4" id="t-stats" style="margin-bottom:20px"></div>
    <div class="card"><h2>The pipeline</h2><div id="t-stages"></div></div>
    <div class="card">
      <h2>Organisations in dialogue or beyond</h2>
      <p class="small muted" style="margin-top:-6px">
        Earlier-stage organisations are counted above but not named — they have
        not agreed to be discussed.
      </p>
      <div id="t-orgs"></div>
    </div>`;

  return onSnapshot(doc(db, "tracker", "summary"), (snap) => {
    if (!snap.exists()) {
      view.innerHTML = `<div class="card"><div class="empty">
        <div class="ico">▦</div>
        <div class="t" style="font-size:17px">The tracker has not run yet</div>
        <div class="n" style="max-width:440px;margin:8px auto 0">
          It fills in automatically once the hourly sync has run for the first
          time. If it stays empty, tell Martin.</div>
      </div></div>`;
      return;
    }

    const d = snap.data() || {};
    const stages = d.stages || {};
    const orgs = Array.isArray(d.organisations) ? d.organisations : [];
    const target = Number(d.pledgeTarget) || 10;
    const pledged = Number(d.pledgedCount) || 0;
    const pc = Math.max(0, Math.min(100, Math.round((pledged / target) * 100)));

    document.getElementById("t-head").innerHTML = `
      <h3>${num(pledged)} of ${num(target)} pledges signed</h3>
      <div class="bar" style="margin-top:22px" role="progressbar"
           aria-valuenow="${pc}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pc}%"></i></div>
      <div class="small muted" style="margin-top:9px">
        ${d.syncedAt ? "Updated " + when(d.syncedAt) : "Not yet updated"}
        ${isAdmin ? ` · <a href="#" id="t-refresh">refresh now</a>` : ""}
      </div>`;

    if (isAdmin) {
      document.getElementById("t-refresh")?.addEventListener("click", async (e) => {
        e.preventDefault();
        e.target.textContent = "refreshing…";
        try {
          await callable("refreshTracker")();
          toast("Tracker refreshed");
        } catch (err) {
          toast("Could not refresh — " + (err.message || "unknown error"));
          e.target.textContent = "refresh now";
        }
      });
    }

    const stats = [
      { value: num(d.totalDeals), label: "Organisations tracked" },
      { value: num(pledged),      label: "Pledges signed" },
      { value: d.pledgedSqft ? num(d.pledgedSqft) : "—", label: "Sq ft pledged" },
      { value: d.sitesReviewed === null || d.sitesReviewed === undefined
                 ? "—" : num(d.sitesReviewed), label: "Sites reviewed" }
    ];
    document.getElementById("t-stats").innerHTML = stats.map(s =>
      `<div class="stat"><div class="big">${esc(s.value)}</div>
       <div class="lab">${esc(s.label)}</div></div>`).join("");

    const order = Object.keys(stages);
    const most = Math.max(1, ...order.map(k => Number(stages[k]) || 0));
    document.getElementById("t-stages").innerHTML = order.map(k => {
      const n = Number(stages[k]) || 0;
      const w = Math.round((n / most) * 100);
      return `<div style="display:flex;align-items:center;gap:12px;margin-bottom:10px">
        <div style="flex:0 0 150px" class="small">${esc(k)}</div>
        <div class="bar" style="flex:1;margin:0"><i style="width:${w}%"></i></div>
        <div style="flex:0 0 44px;text-align:right" class="small muted">${num(n)}</div>
      </div>`;
    }).join("") +
    (d.unknownStage
      ? `<p class="small muted" style="margin-top:14px">${num(d.unknownStage)}
         organisation(s) are at a stage the tracker does not recognise. The
         planner's stage names have probably changed — tell Martin.</p>`
      : "");

    document.getElementById("t-orgs").innerHTML = orgs.length
      ? `<ul class="list">${orgs.map(o => `
          <li>
            <div><strong>${esc(o.name)}</strong>
              ${o.pledged ? `<span class="tag brick">Pledged</span>` : ""}
            </div>
            <div class="small muted">${esc(STAGE_NOTE[o.stage] || o.stage)}${
              o.sqft ? ` · ${num(o.sqft)} sq ft` : ""}</div>
          </li>`).join("")}</ul>`
      : `<p class="muted small">Nobody is in active dialogue yet.</p>`;
  }, (err) => {
    console.error(err);
    view.innerHTML = `<div class="card">
      <h3>The tracker would not load</h3>
      <p class="muted">${esc(err.message || String(err))}</p></div>`;
  });
}
