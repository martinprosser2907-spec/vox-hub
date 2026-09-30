# VOX London Hub

An installable intranet for the VOX London founding group. Three access tiers,
no build step, hosted on GitHub Pages at **voxlondon.uk** with Firebase behind it.

---

## Commands

Test the security rules:

```powershell
npm install ; npm run test:rules
```

Deploy the rules:

```powershell
npm install -g firebase-tools ; firebase login ; firebase use --add ; firebase deploy --only firestore:rules,storage
```

Functions and their two secrets:

```powershell
cd functions ; npm install ; cd .. ; firebase functions:secrets:set RESEND_API_KEY ; firebase functions:secrets:set ANTHROPIC_API_KEY ; firebase deploy --only functions
```

Seed the menu and make yourself admin:

```powershell
node seed-members.js martin@voxhouses.global
```

Run it locally:

```powershell
npx serve . -l 8080
```

Stamp the build and publish:

```powershell
node -e "require('fs').writeFileSync('version.json', JSON.stringify({stamp: new Date().toISOString()}))" ; git add -A ; git commit -m "VOX London Hub" ; git push
```

First push:

```powershell
git init ; git add -A ; git commit -m "VOX London Hub - shell, sign-in and general tier" ; git branch -M main ; git remote add origin https://github.com/YOURNAME/vox-hub.git ; git push -u origin main
```

---

## Setting up, in order

1. **Firebase project.** Console > Add project. Analytics off.
2. **Firestore** > Create database > Production mode > `europe-west2` (London).
3. **Storage** > same region.
4. **Authentication** > Get started. You do not need to enable any provider —
   sign-in is by custom token, minted by the function.
5. **Authentication > Settings > Authorised domains** > add `voxlondon.uk`.
6. **Project settings > Your apps > Web** > register > paste the config into
   `js/config.js`.
7. **Resend** > add and verify `voxlondon.uk` as a sending domain.
8. Run the four command blocks above.
9. **GitHub > Settings > Pages** > Deploy from branch > `main` / root.
   The `CNAME` file is already in place; point a CNAME record at
   `YOURNAME.github.io`.

---

## How sign-in works

A six-digit code, emailed. **Not a link** — a link tapped in an email client
opens the default browser, not the installed app, so someone who installed the
hub would be signed in somewhere they are not looking.

1. They type their email. `requestSignInCode` looks for a `members` record
   whose `signInEmails` array contains it.
2. Unknown address, or no tier set? It says "sent" anyway. A stranger must not
   be able to use the sign-in box to find out which charities are involved.
3. Known address: a six-digit code from `crypto.randomInt`, stored for ten
   minutes, emailed through Resend with VOX branding. One code a minute per
   address.
4. They type the code. It is checked, spent, and the tier re-read from the
   member record — in case it changed while the email sat in an inbox.
5. The tier is stamped onto their account as a custom claim and a sign-in
   token is minted. Firebase keeps the session alive from there.

### Someone signing in from a different address

Charity staff sign in with whatever account is on their phone, which is often
not the address you hold. That is what `signInEmails` is for: it is an array.
Add the second address to their member record and they are in. Without this
they get permanently stuck, and it will happen in the first week.

## How access works

| Tier | Claim | Sees |
|---|---|---|
| 1 | `general` | Progress, concept, updates, gallery, suggestions, questions, Pledge |
| 2 | `steering` | The above, plus tracker, documents, planning tools |
| 3 | `admin` | The above, plus the VOX planner and people management |

The tier lives in a custom claim on the token, not in a document. Reading a
claim costs nothing, and **Storage rules cannot read Firestore at all**, so a
claim is the only thing both services can see.

The menu lives in the `pages` collection. Adding a page needs no deploy.

### Changing someone's tier

Edit their `members` record. The `onMemberTierChanged` function then:

1. re-stamps the claim,
2. revokes their refresh tokens, so no device can coast on the old tier,
3. touches `claimsUpdatedAt`.

The browser is watching that field and forces a token refresh the moment it
moves. The person sees their new sections appear without signing out.

### Three things not to break

1. **`request.auth.token.get('tier', '')`, never `request.auth.token.tier`.**
   A dotted reference to an absent claim *throws*, and a thrown rule denies
   everything. There is a test for it.
2. **Explicit `== 'admin'`, never `!= 'general'`.** An unexpected value must
   read as no access, not the highest. There is a test for that too.
3. **`{document=**}` stays last** in the rules. Rules are OR-ed, so a broad
   grant above a specific rule cannot be narrowed by it.

## The help assistant

The `?` button, bottom right. It proxies to the Anthropic API inside a
function, so the key never reaches a browser.

**Everything in the system prompt is visible to every signed-in person**,
whatever their tier. Site addresses, landlord names and rent figures must
never go in it. A Steering Group assistant would be a second prompt behind a
tier check.

## Layout

```
index.html              the four screens: boot, sign-in, no-access, hub
manifest.webmanifest    installable
sw.js                   network-first — never serves a stale page after a deploy
version.json            stamped at deploy; the page reloads once if it is behind
CNAME                   voxlondon.uk
assets/tokens.css       every colour and size, in one place
assets/app.css          layout and components
js/config.js            YOUR FIREBASE KEYS GO HERE
js/fb.js                Firebase, initialised once
js/auth.js              code sign-in, and forcing a refresh on a tier change
js/nav.js               the menu, read from the database
js/router.js            hash routing
js/ask.js               the help assistant
js/views/*.js           one file per page
firestore.rules         THE SECURITY
storage.rules           file access
tests/rules.test.mjs    31 tests
functions/              the only server-side code
seed-members.js         first run: you as admin, plus the menu
```

## What is not built yet

The Steering Group tier (tracker, document store, planning tools) and the
admin people screen show an honest placeholder. Those are next.

## Costs

Firebase's free tier covers a group this size. Functions need the Blaze plan
— it is pay-as-you-go and at this volume the bill is pennies, but it needs a
card on file. Resend is free to 3,000 emails a month. The Anthropic key is
metered per question.
