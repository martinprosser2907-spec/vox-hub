// ---------------------------------------------------------------------------
// Sign in with a six-digit emailed code, and keep the tier claim honest.
//
// Why a code and not a link: a link tapped in an email client opens the
// default browser, not the installed app. Someone who installed the hub would
// be signed in somewhere they are not looking. A typed code works the same
// everywhere.
// ---------------------------------------------------------------------------
import {
  auth, db, callable, signInWithCustomToken, signOut, onIdTokenChanged,
  doc, onSnapshot, collection, query, where, limit
} from "./fb.js";

const LAST_EMAIL = "vox.hub.email";

export async function requestCode(email) {
  const clean = String(email || "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) {
    throw new Error("That does not look like an email address.");
  }
  await callable("requestSignInCode")({ email: clean });
  try { localStorage.setItem(LAST_EMAIL, clean); } catch {}
  return clean;
}

export async function submitCode(email, code) {
  const res = await callable("verifySignInCode")({
    email: String(email).trim().toLowerCase(),
    code:  String(code).replace(/\D/g, "")
  });
  await signInWithCustomToken(auth, res.data.token);
  return res.data;
}

export function lastEmail() {
  try { return localStorage.getItem(LAST_EMAIL) || ""; } catch { return ""; }
}

export function leave() {
  try { localStorage.removeItem(LAST_EMAIL); } catch {}
  return signOut(auth);
}

/* ---------------------------------------------------------------------------
   Watching the session.

   The tier comes off the ID token, not out of a document, because that is
   what the security rules read. Firebase refreshes the token about hourly, so
   onIdTokenChanged fires on its own — but that is far too slow when somebody
   has just been promoted and is sitting waiting.

   So: the browser also watches its own member record. When a tier changes,
   the onMemberTierChanged function re-stamps the claim and touches
   claimsUpdatedAt. Seeing that move, we force a refresh straight away. The
   function also revokes refresh tokens, so any other device the person has
   open picks the change up on its next call rather than coasting on the old
   tier for the rest of the hour.
   --------------------------------------------------------------------------- */
export function onSession(cb) {
  let stopWatchingMember = null;
  let lastStamp = null;

  const stopAuth = onIdTokenChanged(auth, async (user) => {
    if (stopWatchingMember) { stopWatchingMember(); stopWatchingMember = null; lastStamp = null; }

    if (!user) return cb(null);

    const token = await user.getIdTokenResult();
    const tier  = token.claims.tier || null;
    const memberId = token.claims.memberId || null;

    cb({
      uid: user.uid,
      email: user.email || "",
      tier,
      memberId,
      name: "",
      org: ""
    });

    if (!memberId) return;

    // Own record: name and organisation for the sidebar, and the claims stamp.
    stopWatchingMember = onSnapshot(doc(db, "members", memberId), async (snap) => {
      // Their record has gone — removed on the People screen. The function
      // clears the claim and revokes the tokens, but that can take a second or
      // two to land, and until it does this browser is sitting on a perfectly
      // valid token. Sign out here so the screen goes at the same moment the
      // record does, rather than carrying on until something happens to fail.
      if (!snap.exists()) {
        console.warn("member record removed — signing out");
        await signOut(auth).catch(() => {});
        return;
      }
      const d = snap.data();

      const stamp = d.claimsUpdatedAt?.toMillis?.() ?? null;
      if (stamp && lastStamp !== null && stamp !== lastStamp) {
        // Tier changed underneath us. Get a new token; this callback runs
        // again through onIdTokenChanged with the new claim.
        await auth.currentUser?.getIdToken(true);
        return;
      }
      lastStamp = stamp;

      cb({
        uid: user.uid,
        email: user.email || d.email || "",
        tier,
        memberId,
        name: d.name || "",
        org:  d.org  || ""
      });
    }, () => { /* refused — the tier claim is what matters, carry on */ });
  });

  return () => { stopAuth(); if (stopWatchingMember) stopWatchingMember(); };
}

/* Plain English for the handful of failures people actually hit. */
export function friendly(err) {
  const c = String(err?.code || err?.message || "");
  if (c.includes("invalid-argument"))     return "That does not look like an email address.";
  if (c.includes("not-found"))            return "That code is not right. Ask for a new one.";
  if (c.includes("deadline-exceeded"))    return "That code has expired. Ask for a new one.";
  if (c.includes("resource-exhausted"))   return "Too many attempts. Ask for a new code.";
  if (c.includes("permission-denied"))    return err?.message || "That code is not right.";
  if (c.includes("unauthorized-domain"))  return "This address is not authorised in Firebase yet.";
  if (c.includes("unavailable") || c.includes("network"))
    return "No connection. Check your internet and try again.";
  if (c.includes("internal"))             return "Something went wrong at our end. Try again in a moment.";
  return err?.message || "Something went wrong. Try again, or email martin@voxhouses.global.";
}
