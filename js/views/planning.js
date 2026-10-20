// ---------------------------------------------------------------------------
// Planning tools — the moving pack. Steering Group and above.
//
// Four sections, filled in over weeks rather than in one sitting, so each one
// saves on its own and nothing is lost by closing the tab.
//
// Everything goes through planningPack / savePlanningSection on the server.
// The `planning` collection is closed to the browser, because the tier claim
// carries no organisation and the rules therefore cannot tell one charity's
// pack from another's. See functions/planning.js for the long version.
//
// The field list lives on the server too, and arrives as `schema`. Adding a
// field is one edit there, with no deploy here.
// ---------------------------------------------------------------------------
import { callable } from "../fb.js";
import { esc, when, toast, tierOf } from "../ui.js";

const call = (name, data) => callable(name)(data).then(r => r.data);

const filled = (values) =>
  Object.values(values || {}).filter(v => String(v ?? "").trim()).length;

function fieldHtml(section, f, value) {
  const id = `pf-${section}-${f.id}`;
  const v  = value === 0 ? "0" : String(value ?? "");
  const hint = f.hint ? `<div class="small muted" style="margin-top:3px">${esc(f.hint)}</div>` : "";
  const input = f.type === "textarea"
    ? `<textarea id="${id}" rows="3" data-field="${esc(f.id)}">${esc(v)}</textarea>`
    : `<input type="${f.type === "number" ? "number" : f.type === "date" ? "date" : "text"}"
             id="${id}" data-field="${esc(f.id)}" value="${esc(v)}">`;
  return `<label style="display:block;margin-bottom:14px">
    <span class="small">${esc(f.label)}</span>${input}${hint}</label>`;
}

export function render(view, ctx) {
  const isAdmin = tierOf(ctx.user.tier) >= 3;
  let schema = null, pack = null, packId = null;

  view.innerHTML = `<div class="card"><div class="skel"></div>
    <div class="skel" style="width:60%"></div></div>`;

  const draw = () => {
    const sections = Object.entries(schema);
    const doneCount = sections.filter(([id]) => filled(pack.sections?.[id])).length;

    view.innerHTML = `
      <div class="card">
        <h3>${esc(pack.org || "Your moving pack")}</h3>
        <p class="lede" style="margin:0">
          Four sections. Fill them in as you go — each one saves on its own.
        </p>
        <div class="small muted" style="margin-top:12px">
          ${doneCount} of ${sections.length} started${
            pack.updatedAt ? " · last saved " + when(pack.updatedAt) : ""}
        </div>
      </div>
      ${sections.map(([id, s]) => `
        <div class="card" data-section="${esc(id)}">
          <h2>${esc(s.title)}
            ${filled(pack.sections?.[id]) ? `<span class="tag brick">Started</span>` : ""}
          </h2>
          <p class="small muted" style="margin-top:-6px">${esc(s.note)}</p>
          <div>${s.fields.map(f =>
            fieldHtml(id, f, pack.sections?.[id]?.[f.id])).join("")}</div>
          <button class="btn" data-save="${esc(id)}">Save this section</button>
          <span class="small muted" data-saved="${esc(id)}" style="margin-left:10px"></span>
        </div>`).join("")}`;

    view.querySelectorAll("[data-save]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.save;
        const card = view.querySelector(`[data-section="${id}"]`);
        const values = {};
        card.querySelectorAll("[data-field]").forEach(el => {
          values[el.dataset.field] = el.value;
        });

        btn.disabled = true;
        const was = btn.textContent;
        btn.textContent = "Saving…";
        try {
          await call("savePlanningSection", { section: id, values, packId });
          pack.sections = pack.sections || {};
          pack.sections[id] = values;
          const note = view.querySelector(`[data-saved="${id}"]`);
          if (note) {
            note.textContent = "Saved";
            setTimeout(() => { note.textContent = ""; }, 4000);
          }
        } catch (err) {
          toast("Could not save — " + (err.message || "unknown error"));
        } finally {
          btn.disabled = false;
          btn.textContent = was;
        }
      });
    });
  };

  call("planningPack", {})
    .then(res => {
      schema = res.schema; pack = res.pack; packId = res.packId;
      draw();
      if (isAdmin) loadAllPacks(view);
    })
    .catch(err => {
      view.innerHTML = `<div class="card">
        <h3>The moving pack would not load</h3>
        <p class="muted">${esc(err.message || String(err))}</p>
        <p class="small muted">If it says your member record has no organisation,
        that is the fix — it needs setting on the People screen.</p></div>`;
    });
}

// VOX sees who has started theirs. Names and progress only — never the
// contents of another charity's pack in a list view.
async function loadAllPacks(view) {
  try {
    const res = await call("planningPack", { all: true });
    const rows = res.all || [];
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h2>All moving packs</h2>${
      rows.length
        ? `<ul class="list">${rows.map(r => `
            <li><div><strong>${esc(r.org)}</strong></div>
            <div class="small muted">${r.complete} of ${r.total} sections started${
              r.updatedAt ? " · " + when(r.updatedAt) : ""}</div></li>`).join("")}</ul>`
        : `<p class="muted small">Nobody has started one yet.</p>`}`;
    view.appendChild(card);
  } catch { /* the admin extra is a bonus; never break the page for it */ }
}
