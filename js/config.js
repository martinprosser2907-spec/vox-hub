// ---------------------------------------------------------------------------
// Firebase project configuration.
//
// These values are PUBLIC by design. They name the project; they grant
// nothing. All security is in firestore.rules and storage.rules. Never put
// anything secret in this file — it ships to every browser.
//
// This is the same project as the VOX planner, so one sign-in covers both.
// ---------------------------------------------------------------------------
export const firebaseConfig = {
  apiKey:            "AIzaSyDM1Mp9VJJU_-qW6pURJgEYE1JT1C4spk4",
  authDomain:        "vox-project-management-dbase.firebaseapp.com",
  projectId:         "vox-project-management-dbase",
  storageBucket:     "vox-project-management-dbase.firebasestorage.app",
  messagingSenderId: "179653408029",
  appId:             "1:179653408029:web:81cfc50b6d450bba409df4"
};

// Functions live in London. The default is us-central1, so without this the
// calls would quietly go to the wrong region and fail.
export const FUNCTIONS_REGION = "europe-west2";

export const SUPPORT_EMAIL = "martin@voxhouses.global";

// VOX eSign — the signing product, a separate app on the same Firebase
// project. The hub links to it from the Signing page, which is the one screen
// where somebody hits the wall: a template has to be made in eSign before it
// can be sent from here.
//
// The Admin menu also carries a link, but that one is a URL stored on
// `pages/esign` in Firestore and seeded by seed-members.js — deliberately, so
// the menu can change without a deploy. So the address lives in two places.
// The day eSign moves to sign.voxhouses.global, change it HERE and in
// seed-members.js, then run `node seed-members.js`.
export const ESIGN_URL = "https://vox-esign.vercel.app";

/* authDomain
   ----------
   Left as the firebaseapp.com address deliberately. It is only used by the
   OAuth redirect flow, which this hub does not use — sign-in is a code and a
   custom token, so nothing here depends on it.

   You still need voxlondon.uk in Firebase > Authentication > Settings >
   Authorised domains before the hub will run from your own domain. */
