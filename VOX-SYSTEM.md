# VOX London — how the system fits together

Orientation for a Claude Code window opening any of these repos for the first
time. Read this before changing anything, because the three apps share one
Firebase project and a change in one can take another down silently. That has
already happened once, and it is described below.

Written 29 September 2026.

---

## The three apps, and the one project underneath them

| App | What it is | Lives at | Deployed to |
|---|---|---|---|
| **VOX planner** | CRM and pipeline. Predates the rest. Email/password accounts. | `C:\Users\Martin Work\vox-pm-app` | `vox-project-management-dbase.web.app` |
| **VOX London Hub** | Intranet for the founding charities. Three tiers. Vanilla ES modules, no build step. | `C:\Users\Martin Work\vox-hub` | `voxlondon.uk` |
| **VOX eSign** | Electronic signatures. Next.js 15 / React 19 / Tailwind. | `C:\Users\Martin Work\vox-esign` | `vox-esign.vercel.app` |

**All three use the same Firebase project: `vox-project-management-dbase`.**
One Firestore, one Storage bucket, one Auth user pool, one `firestore.rules`.

**The rules file that governs all of it is `vox-hub/firestore.rules`.** The
planner has no rules file of its own any more; its collections are declared in
the hub's. Deploying rules from the hub deploys rules for everything.

### The trap this created, which is real and already bit

`vox-hub/firestore.rules` ends with a deliberate catch-all:

```
match /{document=**} { allow read, write: if false; }
```

That is correct and should stay. But it means **any collection not explicitly
listed is denied**. When the hub's rules were first deployed on 17 September,
`esign_signature_requests` had not been listed, so VOX eSign's dashboard —
which reads that collection straight from the browser — showed nothing for
eleven days. Signing links kept working the whole time, because that path runs
on the Admin SDK and never consults rules. Nothing anywhere reported it.

**So: if you add a collection to any of the three apps, add it to
`vox-hub/firestore.rules` and add a test, in the same change.** A missing entry
fails silently in whichever app you are not looking at.

---

## Who can see what

The hub has three tiers, carried as a custom claim (`tier`) on the sign-in
token, stamped by `verifySignInCode` and re-stamped by `onMemberTierChanged`.

| Tier | Who | Gets |
|---|---|---|
| `general` | Staff at the founding charities | Progress, concept, updates, gallery, suggestions, questions, their own Pledge |
| `steering` | Steering Group | The above, plus the tracker, document store, planning tools, and the signing list without email addresses |
| `admin` | VOX (Martin, Frederik, Louise) | Everything, plus the planner, People and access, and sending documents for signature |
| *no claim* | Legacy email/password accounts | The planner only. `legacyUser()` in the rules. This is what keeps the planner working without migrating anyone. |

Two rules helpers carry most of this: `tier()` and `plannerAccess()`.

**Always use `.get('key', default)` when reading a claim in rules.** A dotted
reference to an absent claim throws, and a thrown rule denies everything — so
the day a new claim is added, every older token is locked out with no error
anywhere.

### Things that must never reach a charity tier

- Site addresses, landlord names, rent figures — Steering Group only, and they
  must never enter the help assistant's system prompt, which any signed-in
  person can reach.
- Another organisation's signing status, and above all **any party's signing
  token** — a token *is* the authority to sign as that person.
- The member roll. A charity cannot read `members`; they see only their own record.

---

## Signing: how it actually works

The rule is **one place knows where a signature box goes on a page**, and that
place is the PDF viewer in the eSign dashboard. Do not build a second one.

### Getting to eSign from the hub

Two ways in, both admin only:

- **Admin menu > VOX eSign** — an external link, so it is a row in the `pages`
  collection (`pages/esign`, `external: true`) seeded by `seed-members.js`,
  exactly like VOX planner. Change it and run `node seed-members.js`; no deploy.
- **Signing page > Open VOX eSign**, top right of the Send a document card.
  This one is in the code, `ESIGN_URL` in `js/config.js`.

So the address is in two places on purpose: the menu is database-driven so it
can change without a deploy, and the page link is not. If eSign ever moves off
`vox-esign.vercel.app`, change both.

The flow:

1. In eSign, send a document once and place the signature boxes in the viewer.
2. On that document, press **Save as template**. This copies the PDF and
   re-tags every box from the people who happened to be on that first request
   to **roles** ("The charity", "VOX London") that outlast them.
3. From then on, anyone can be sent that document — from the eSign dashboard or
   from the hub's **Signing** page. Sending maps each role to a real person and
   rewrites the box tags in the copy. Same PDF, same positions, no viewer.

Autofill is native, not something to build: boxes of type `email`, `title` and
`address` are stamped from whoever ends up signing.

### Collections

- `esign_templates/{id}` — `signatureFields[].partyId` holds a **role id**, not a party id.
- `esign_signature_requests/{id}` — a sent document. `signatureFields[].partyId` holds a real party id.
- `esign_signature_requests/{id}/parties/{partyId}` — one signer. **Holds their token.**
- `esign_signature_requests/{id}/audit_log/{entryId}` — evidence trail. Admin SDK writes only.

### Hub → eSign

The hub is a Cloud Function with no human session to borrow, so it calls eSign's
API with a shared key in the `x-vox-service-key` header, held in Secret Manager
as `VOX_SERVICE_KEY` and set to the same value in Vercel. `requireCaller()` in
`vox-esign/src/lib/esign/auth.ts` accepts either that key or a Firebase ID token.

Hub functions: `signingTemplates`, `sendForSignature`, `signingList`,
`remindSigner`, `pledgeStatus`.

**`sendForSignature` deliberately does not return the signing tokens.** They go
in the signer's email and nowhere else.

---

## Traps worth knowing before you spend a day on them

**`NEXT_PUBLIC_*` is baked in at build time.** Setting or changing one in Vercel
does nothing until a redeploy. This was verified, not assumed — a stale build
kept serving the old value and only a fresh compile picked up the new one. For
anything that must be changeable at runtime, use a plain server variable with no
prefix. `APP_URL` is the one that matters; it decides where signing links point.

**A signing link used to point at a domain that does not exist.** The fallback
was hardcoded to `https://sign.voxhouses.global`, which has never had a DNS
record, so whenever the env var was unset every signing email went out with a
dead link. The send succeeded and the dashboard said "sent". `resolveAppUrl()`
in `vox-esign/src/lib/esign/appUrl.ts` now derives it from where the app is
actually served, and throws rather than guessing.

**The hub is served by a local web server during development, and its service
worker is network-first with a cache fallback.** If the server is not running,
the installed app keeps working from cache and shows old code indefinitely. If
a change "isn't appearing", check the server is up before suspecting anything
else. `127.0.0.1:8080` bypasses the service worker and is the quick test — a
different origin from `localhost:8080`, so nothing is cached for it.

**`firebase deploy --only functions` intermittently fails with "Failed to list
functions".** The Compute Engine API is disabled on the project, so Firebase
cannot look up the default service account, falls back, and sometimes gives up.
It is not a code problem. Retry, or enable the API.

**Firestore rules has no `removeAll` on a List.** Use Set `difference().hasOnly()`
— `onlyTogglesMe()` in the rules file is the working pattern.

**Sign-in is a six-digit emailed code, not a magic link.** A link tapped in an
email client opens the default browser, not the installed app, so someone who
installed the hub would be signed in somewhere they are not looking.

**`signInEmails` is an array and it is what sign-in searches.** People sign in
with whatever account is on their phone, which is often not the address you hold
for them. A second address on their member record is the difference between
getting in and being permanently stuck.

---

## Where the concept page's picture lives

The Copenhagen render off slide 6 of the launch deck is `assets/copenhagen-1600.jpg`
(with a 900px copy beside it for phones), and `js/views/concept.js` falls back to
it. It is **not** in Storage: it never changes, it is the same for every viewer,
and putting it there would mean a new Storage rule and an upload step for a file
that ships with the app anyway.

`content/concept` can override it with `image`, `imageAlt` and `imageCaption` —
all three or none, because the Copenhagen caption deliberately does not carry
over onto somebody else's photograph.

The render carries a **Colliers watermark** in the bottom right. On anything
wider than a phone the image is height-capped and the watermark falls outside
the crop; on a phone the whole frame shows. Nobody has been asked whether it
should stay.

---

## How the hub is published

`git push` to `main` → the `Publish the hub` workflow in `.github/workflows/deploy.yml`
→ GitHub Pages → `https://voxlondon.uk`. There is no other deploy step for the
web files; `firebase deploy` only ever touches rules and functions.

- Repo: `github.com/martinprosser2907-spec/vox-hub`, **public**. In Martin's
  personal account alongside Calla's repos, not a VOX organisation — that was
  the quick way in on the day, and moving it later is GitHub's Transfer button.
- The workflow publishes **only** the browser files: `index.html`, `404.html`,
  `manifest.webmanifest`, `sw.js`, `assets/`, `js/`, `CNAME`, plus a generated
  `version.json` and `robots.txt`. The seeds, rules, functions, tests and this
  file stay in the repo and are not served from `voxlondon.uk`.
- It refuses to publish if a `serviceAccount*`, `.env*`, `.pem` or `.key` file
  reaches the publish folder, or if `CNAME` or `index.html` is missing. All four
  guards were proved by breaking them on purpose.
- `version.json` is stamped with the commit. `js/app.js` compares it against
  `sessionStorage` and reloads once when it changes — before this workflow the
  file said `REPLACED_AT_DEPLOY` forever, so that check had never fired.
- **Every path in the app is root-absolute** (`/assets/...`, `/js/app.js`,
  `/sw.js`, `/version.json`, and `start_url: /` in the manifest). That is why
  the custom domain is not cosmetic: on `martinprosser2907-spec.github.io/vox-hub/`
  the site renders as a blank page with a broken logo, because the root is the
  github.io domain and not the project folder.
- DNS is at **Cloudflare**: four A records on the apex to GitHub's
  185.199.108–111.153, and `www` CNAME to `martinprosser2907-spec.github.io`.
  All **DNS only, grey cloud, not proxied** — Cloudflare's proxy in front of
  GitHub Pages breaks the certificate. Cloudflare also holds this domain's
  Resend records; leave those alone.
- `voxlondon.uk` is in Firebase > Authentication > Settings > Authorised
  domains. Self sign-up is off, which matters now the repo is public.

---

## Rules for working on this

- **Never commit `serviceAccount.json`.** `.gitignore` uses `serviceAccount*.json`
  — the earlier `*.serviceAccount.json` would not have matched the real filename.
- **Never put a secret in a chat transcript.** Keys go from a file to Secret
  Manager via `--data-file`, and the file is deleted afterwards.
- **Synthetic data only in fixtures.** Test addresses are on `.example` domains.
  They were briefly real-looking addresses at real charities involved in VOX,
  in a repo about to go public.
- **Check before you assert.** No sentence should describe what existing code
  does unless the file has been opened in this session. "There is no X" is a
  claim about the repository like any other.
- **Proof that can fail.** Break the thing on purpose and show the right test
  failing. Every guard described here has been proved that way.

## Testing

```powershell
cd "C:\Users\Martin Work\vox-hub" ; npm run test:rules   # needs the emulators
cd "C:\Users\Martin Work\vox-hub" ; npm run test:views   # plain node, no emulator
```

64 rules tests. Each is named after the thing it stops happening, so a failure
name tells you what just became possible.

10 view tests, all on the concept page's hero image. They run the shipped
`js/views/concept.js` by copying it into a temp folder with its two imports
repointed — `fb.js` at a stub, `ui.js` at the real one — because the real
`fb.js` imports Firebase over https and node cannot load that. Nothing else
about the file is touched, so a pass is a pass for what ships.

eSign has no test suite. Its template round trip was proved against the
Firestore and Storage emulators during development, including deleting the
original PDF to show a template survives it, but that harness was not kept.
**Writing one is the most valuable unclaimed job in this repo.**

---

## Not done

- ~~The hub is not deployed anywhere.~~ **Done, 1 October 2026.** It is live at
  `https://voxlondon.uk`. See *How the hub is published* below.
- `sign.voxhouses.global` has no DNS record; eSign is reached at its Vercel URL.
- Progress tracker and Planning tools are placeholders (`view: "soon"` in `seed-members.js`).
- Content: gallery photos and the Q&A from the 15 September meeting. The concept
  page is written (`node seed-concept.js`).
- The end-to-end send — hub to eSign to a real inbox to a signed PDF — had not
  been run at the time of writing. Do that before trusting it.
