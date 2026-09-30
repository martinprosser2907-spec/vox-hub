import { db, collection, query, orderBy, onSnapshot, addDoc, doc, updateDoc,
         serverTimestamp, arrayUnion, arrayRemove } from "../fb.js";
import { esc, paras, ago, toast } from "../ui.js";

export function render(view, ctx) {
  view.innerHTML = `
    <div class="card">
      <h2>Ask a question</h2>
      <p class="small muted" style="margin-top:-8px">If you are wondering it, others probably are too.
        Answers are posted here so everyone sees them.</p>
      <form id="q-form">
        <label class="field"><span>Your question</span>
          <textarea id="q-text" maxlength="700" required
            placeholder="For example: does signing the Pledge commit us to a location?"></textarea></label>
        <label style="display:flex;gap:9px;align-items:center;font-size:14px;margin-bottom:14px">
          <input type="checkbox" id="q-anon" style="width:auto"> Ask without my name shown</label>
        <button class="btn" id="q-send">Send the question</button>
      </form>
      <p class="small muted" style="margin:14px 0 0">In a hurry? The <b>?</b> button bottom right
        answers most things straight away.</p>
    </div>
    <div class="card"><h2>Answered</h2><div class="qa" id="q-answered"></div></div>
    <div class="card"><h2>Waiting for an answer</h2><div id="q-open"></div></div>`;

  document.getElementById("q-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = document.getElementById("q-send");
    const text = document.getElementById("q-text").value.trim();
    if (!text) return;
    btn.disabled = true;
    const anon = document.getElementById("q-anon").checked;
    try {
      await addDoc(collection(db, "questions"), {
        text,
        askedName: anon ? "" : (ctx.user.name || ctx.user.email),
        askedOrg:  anon ? "" : (ctx.user.org || ""),
        askedId:   ctx.user.uid,      // kept so we can come back to you privately
        anonymous: anon,
        answer: "", upvotes: [], createdAt: serverTimestamp()
      });
      document.getElementById("q-text").value = "";
      toast("Sent. We will answer it here.");
    } catch (err) { toast("Could not send that."); console.error(err); }
    btn.disabled = false;
  });

  return onSnapshot(query(collection(db, "questions"), orderBy("createdAt", "desc")), (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    const answered = rows.filter(r => r.answer);
    const open     = rows.filter(r => !r.answer);

    document.getElementById("q-answered").innerHTML = answered.length
      ? answered.map(r => `<details><summary>${esc(r.text)}</summary>
          <div class="ans">${paras(r.answer)}
          ${r.answeredBy ? `<div class="small muted">Answered by ${esc(r.answeredBy)}</div>` : ""}
          </div></details>`).join("")
      : `<p class="muted small">Nothing answered yet.</p>`;

    const box = document.getElementById("q-open");
    box.innerHTML = open.length
      ? `<ul class="list">${open.map(r => {
          const up = r.upvotes || [];
          const mine = up.includes(ctx.user.uid);
          return `<li><div>${esc(r.text)}</div>
            <div class="item-h" style="margin-top:7px">
              <span class="small muted">${r.anonymous ? "Asked anonymously" : esc(r.askedName || "")}
                · ${ago(r.createdAt)}</span>
              <button class="vote ${mine ? "on" : ""}" data-id="${r.id}" data-mine="${mine}"
                style="margin-left:auto">${mine ? "✓ Me too" : "Me too"}${up.length ? " · " + up.length : ""}</button>
            </div></li>`;
        }).join("")}</ul>`
      : `<p class="muted small">Nothing waiting — ask away.</p>`;

    box.querySelectorAll(".vote").forEach(b => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        await updateDoc(doc(db, "questions", b.dataset.id), {
          upvotes: b.dataset.mine === "true" ? arrayRemove(ctx.user.uid) : arrayUnion(ctx.user.uid)
        });
      } catch { toast("Could not register that."); }
      b.disabled = false;
    }));
  });
}
