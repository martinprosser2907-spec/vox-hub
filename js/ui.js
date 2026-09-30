// Small shared helpers. No framework, no build step.
export const $  = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// Anything that came from a person gets escaped before it goes near innerHTML.
export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

export function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export function when(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return isNaN(d) ? "" : d.toLocaleDateString("en-GB", { day:"numeric", month:"short", year:"numeric" });
}

export function ago(ts) {
  if (!ts) return "";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1)  return "just now";
  if (m < 60) return m + " min ago";
  const h = Math.round(m / 60);
  if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
  const dd = Math.round(h / 24);
  return dd < 30 ? dd + (dd === 1 ? " day ago" : " days ago") : when(ts);
}

export function paras(text) {
  return String(text || "").split(/\n{2,}/).filter(Boolean)
    .map(p => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export function skeleton(n = 3) {
  return `<div class="card">${'<div class="skel"></div>'.repeat(n)}</div>`;
}

export function empty(icon, title, note = "") {
  return `<div class="card"><div class="empty">
    <div class="ico">${icon}</div>
    <div class="t">${esc(title)}</div>
    ${note ? `<div class="n">${esc(note)}</div>` : ""}
  </div></div>`;
}

// Two toasts used to land in exactly the same spot — same fixed position, one
// drawn on top of the other — so the second one hid the first and whichever
// message mattered was a coin toss. They stack now, newest at the bottom.
function restackToasts() {
  const all = [...document.querySelectorAll(".toast")].reverse();
  all.forEach((t, i) => { t.style.bottom = (26 + i * 52) + "px"; });
}

export function toast(msg) {
  const t = el(`<div class="toast" role="status">${esc(msg)}</div>`);
  document.body.appendChild(t);
  restackToasts();
  setTimeout(() => { t.remove(); restackToasts(); }, 3400);
}

export const TIER = { general: 1, steering: 2, admin: 3 };
export const TIER_LABEL = { 1: "General", 2: "Steering Group", 3: "Admin" };
export const tierOf = (name) => TIER[name] ?? 0;
