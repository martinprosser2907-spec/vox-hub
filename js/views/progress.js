// The light progress view everyone sees.
import { db, doc, getDoc, collection, query, orderBy, onSnapshot } from "../fb.js";
import { esc, when } from "../ui.js";

export function render(view) {
  view.innerHTML = `
    <div class="card" id="p-head"><div class="skel"></div><div class="skel" style="width:55%"></div></div>
    <div class="card"><h2>Where we are</h2><div id="p-steps"></div></div>
    <div class="grid g4" id="p-stats" style="margin-bottom:20px"></div>
    <div class="card"><h2>What happens next</h2><ul class="list" id="p-next"></ul></div>`;

  getDoc(doc(db, "content", "progress")).then(s => {
    const d = s.exists() ? s.data() : {};
    const pc = Math.max(0, Math.min(100, Number(d.percent) || 0));
    document.getElementById("p-head").innerHTML = `
      <h3>${esc(d.headline || "VOX London is building its founding group")}</h3>
      <p class="lede" style="margin:0">${esc(d.summary || "")}</p>
      <div class="bar" style="margin-top:22px" role="progressbar" aria-valuenow="${pc}"
           aria-valuemin="0" aria-valuemax="100"><i style="width:${pc}%"></i></div>
      <div class="small muted" style="margin-top:9px">${pc}% of the way to a signed lease${
        d.updatedAt ? " · updated " + when(d.updatedAt) : ""}</div>`;
  }).catch(() => {});

  getDoc(doc(db, "content", "headline_stats")).then(s => {
    const rows = (s.exists() ? s.data().rows : null) || [];
    document.getElementById("p-stats").innerHTML = rows.map(r =>
      `<div class="stat"><div class="big">${esc(r.value)}</div>
       <div class="lab">${esc(r.label)}</div></div>`).join("");
  }).catch(() => {});

  return onSnapshot(query(collection(db, "milestones"), orderBy("order")), (snap) => {
    const all = snap.docs.map(d => d.data()).filter(m => m.public !== false);
    const steps = document.getElementById("p-steps");
    const next  = document.getElementById("p-next");
    if (!all.length) { steps.innerHTML = `<p class="muted small">The timeline will appear here once it is set.</p>`; return; }

    steps.innerHTML = `<div class="steps">${all.map(m => `
      <div class="step ${m.status === "done" ? "done" : m.status === "now" ? "now" : ""}">
        <div class="t">${esc(m.title)}</div><div class="d">${esc(m.due || "")}</div></div>`).join("")}</div>`;

    const upcoming = all.filter(m => m.status !== "done").slice(0, 5);
    next.innerHTML = upcoming.map(m => `<li>
      <div class="item-h"><span class="ttl">${esc(m.title)}</span>
        ${m.status === "now" ? '<span class="tag brick">In progress</span>' : ""}
        <time>${esc(m.due || "")}</time></div>
      ${m.note ? `<div class="small muted" style="margin-top:5px">${esc(m.note)}</div>` : ""}</li>`).join("")
      || `<li class="muted small">Everything on the current plan is done.</li>`;
  }, () => {
    document.getElementById("p-steps").innerHTML = `<p class="muted small">Could not load the timeline.</p>`;
  });
}
