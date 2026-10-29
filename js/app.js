// Entry point. Decides which of the four screens to show, then hands over.
import { $, el, toast, tierOf } from "./ui.js";
import { requestCode, submitCode, lastEmail, leave, onSession, friendly } from "./auth.js";
import { mountNav } from "./nav.js";
import { start as startRouter, setPages } from "./router.js";
import { mountAsk } from "./ask.js";
import { db } from "./fb.js";

const boot = $("#boot"), gate = $("#gate"), nogo = $("#nogo"), app = $("#app");
const show = n => [boot, gate, nogo, app].forEach(x => x.hidden = (x !== n));
const msg  = $("#gate-msg");

function say(kind, html) {
  msg.className = "note note-" + kind;
  msg.innerHTML = html;
  msg.hidden = false;
}

/* ---- step one: ask for a code ----------------------------------------- */
let pendingEmail = "";
let lastSentAt = 0;

/* The function sends at most one code a minute per address, and says nothing
   when it refuses — so a resend button with no countdown would look broken.
   Mirror the same limit here and show the wait. */
const RESEND_GAP_MS = 60 * 1000;

function countdownResend() {
  const btn = $("#resend-code");
  const left = Math.ceil((RESEND_GAP_MS - (Date.now() - lastSentAt)) / 1000);
  if (left <= 0) {
    btn.disabled = false;
    btn.textContent = "Send me a new code";
    return;
  }
  btn.disabled = true;
  btn.textContent = `Send me a new code (${left}s)`;
  setTimeout(countdownResend, 1000);
}

$("#form-email").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#btn-email");
  btn.disabled = true; btn.textContent = "Sending…"; msg.hidden = true;
  try {
    pendingEmail = await requestCode($("#email").value);
    lastSentAt = Date.now();
    $("#sent-to").textContent = pendingEmail;
    $("#step-email").hidden = true;
    $("#step-code").hidden = false;
    countdownResend();
    setTimeout(() => $("#code").focus(), 60);
  } catch (err) {
    say("bad", friendly(err));
  }
  btn.disabled = false; btn.textContent = "Send me a code";
});

/* ---- step two: use it -------------------------------------------------- */
$("#form-code").addEventListener("submit", async (e) => {
  e.preventDefault();
  const btn = $("#btn-code");
  btn.disabled = true; btn.textContent = "Signing in…"; msg.hidden = true;
  try {
    await submitCode(pendingEmail, $("#code").value);
    // onSession takes it from here.
  } catch (err) {
    say("bad", friendly(err));
    $("#code").value = ""; $("#code").focus();
    btn.disabled = false; btn.textContent = "Sign in";
  }
});

$("#code").addEventListener("input", (e) => {
  e.target.value = e.target.value.replace(/\D/g, "").slice(0, 6);
  if (e.target.value.length === 6) $("#form-code").requestSubmit();
});

$("#resend-code").addEventListener("click", async () => {
  if (Date.now() - lastSentAt < RESEND_GAP_MS) return;
  const btn = $("#resend-code");
  btn.disabled = true; btn.textContent = "Sending\u2026"; msg.hidden = true;
  try {
    await requestCode(pendingEmail);
    lastSentAt = Date.now();
    say("ok", "A new code is on its way. The old one no longer works.");
    $("#code").value = ""; $("#code").focus();
    signingIn = false;
    $("#btn-code").disabled = false;
    $("#btn-code").textContent = "Sign in";
  } catch (err) {
    say("bad", friendly(err));
  }
  countdownResend();
});

$("#back-to-email").addEventListener("click", () => {
  $("#step-code").hidden = true; $("#step-email").hidden = false;
  msg.hidden = true; $("#email").focus();
});

$("#nogo-out").addEventListener("click", () => leave());
$("#signout").addEventListener("click", () => leave());

/* ---- mobile menu ------------------------------------------------------- */
$("#burger").addEventListener("click", () => {
  const side = $("#side");
  side.classList.add("open");
  const scrim = el('<div class="scrim"></div>');
  scrim.addEventListener("click", () => { side.classList.remove("open"); scrim.remove(); });
  document.body.appendChild(scrim);
});

/* ---- session -----------------------------------------------------------
   One object, updated in place, shared with the router and every view.

   It has to be the SAME object throughout. The tier arrives on the token
   immediately but the name and organisation come a moment later, from the
   member record — so a copy handed over at start-up stays nameless forever,
   and anything posted gets filed under an email address instead of a person. */
const session = {
  db,
  user: { uid: "", email: "", tier: null, memberId: null, name: "", org: "" }
};
let started = false, stopNav = null;

onSession((user) => {
  if (!user) {
    show(gate);
    $("#email").value = lastEmail();
    $("#step-code").hidden = true; $("#step-email").hidden = false;
    started = false;
    if (stopNav) { stopNav(); stopNav = null; }
    return;
  }

  if (!tierOf(user.tier)) {
    $("#nogo-email").textContent = user.email;
    show(nogo);
    return;
  }

  Object.assign(session.user, user);

  $("#me-name").textContent = session.user.name || session.user.email;
  $("#me-org").textContent  = session.user.org || "";
  show(app);

  if (!started) {
    started = true;
    startRouter(session);
    stopNav = mountNav(session.user, setPages);
    mountAsk(session.user);
  }
});

/* ---- installable, and never stale -------------------------------------- */
if ("serviceWorker" in navigator) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}

// A static host will happily serve yesterday's index.html out of a browser
// cache next to today's scripts. version.json is written at deploy; if the
// page is older than the deploy, reload once. The sessionStorage key makes a
// loop impossible. Borrowed from EGBC's checkFresh().
// This used to run ONCE, at load. A window left open all day therefore never
// looked again, and kept running the build it started with while a newer one
// sat on the server — which is exactly how a page that had just been deployed
// showed "not built yet" on 29 Oct 2026. It now looks again whenever the tab
// is brought back to the front.
//
// Coming back to the tab does NOT reload the page. Somebody may be halfway
// through typing a viewing, or a question, and throwing that away to pick up a
// deploy would be a worse bug than the one being fixed. It offers instead.
let knownStamp = null;
let offering = false;

async function checkFresh({ reloadOnFirstChange = false } = {}) {
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    const { stamp } = await res.json();
    const seen = knownStamp || sessionStorage.getItem("vox.stamp");

    if (seen && seen !== stamp) {
      sessionStorage.setItem("vox.stamp", stamp);
      knownStamp = stamp;
      if (reloadOnFirstChange) { location.reload(); return; }
      offerReload();
      return;
    }
    sessionStorage.setItem("vox.stamp", stamp);
    knownStamp = stamp;
  } catch {}
}

function offerReload() {
  if (offering) return;
  offering = true;
  const bar = el(`<div class="freshbar" role="status">
    <span>A newer version of the hub is ready.</span>
    <button class="btn btn-sm" id="fresh-go">Reload</button></div>`);
  document.body.appendChild(bar);
  bar.querySelector("#fresh-go").addEventListener("click", () => location.reload());
}

// At load, a changed stamp means this tab is simply out of date — reload it,
// the same as before. The sessionStorage key makes a loop impossible.
checkFresh({ reloadOnFirstChange: true });

addEventListener("visibilitychange", () => { if (!document.hidden) checkFresh(); });
addEventListener("focus", () => checkFresh());
