# Daktilo V14 — Online Beta

V14 turns the local prototype into a deployable static site with optional Supabase accounts and online leaderboards.

## What changed

- Adaptive training resumes **one level easier** than the last stored level as a short warm-up.
- The adaptive 80% challenge uses **very large steps at the beginning** and increasingly fine steps after reversals.
- The “Bilder prüfen” feature has been removed completely.
- Username + password accounts can be synchronized through Supabase.
- Adaptive level, aggregate scores, private learning statistics and per-word history can be restored on another device.
- Leaderboards can be shared online.
- The site still works as a local fallback if Supabase has not yet been configured.
- The current responsive/zoom layout and emerald Daktilo theme are included.

## Important account design

Users sign in with **Benutzername + Passwort only**. No personal email address is requested. Daktilo uses a Supabase Edge Function as a small authentication gateway: it maps the chosen username to a private internal Auth identity on the server. The internal identifier is never shown in the website and the mapping table is not readable through the public Data API.

- Supabase email confirmation does **not** need to be disabled.
- Password recovery is not yet available in this beta, so users should keep their password safely.
- Passwords must contain at least 8 characters.
- The Supabase secret/service-role key stays server-side in the Edge Function environment and is never included in the GitHub Pages files.
- `config.js` contains only the browser-safe publishable key.

A later release can add a recovery code or optional recovery email without changing the visible username-based login.

## 1. Create Supabase project

Create a project at Supabase.

Then open the SQL Editor and run the complete file:

`supabase/schema.sql`

This creates:

- `daktilo_profiles` — public aggregate values used for leaderboards
- `daktilo_private_state` — private personal learning state
- `daktilo_events` — private per-word history
- Row Level Security policies

## 2. Username authentication gateway

The Supabase project uses the deployed Edge Function `username-auth`. Users enter only username + password. The function handles the private mapping to Supabase Auth server-side, so there is no email-confirmation setting to change manually.

## 3. Add project URL + publishable key

Open `config.js` and replace:

```js
window.DAKTILO_CONFIG = {
  supabaseUrl: "PASTE_YOUR_SUPABASE_URL_HERE",
  supabasePublishableKey: "PASTE_YOUR_SUPABASE_PUBLISHABLE_KEY_HERE"
};
```

Use the **publishable** browser key (`sb_publishable_...`). A legacy anon key also works, but publishable keys are preferred for new projects.

Never use a secret key or `service_role` key in `config.js`.

## 4. Add the finger images

Put your files in `images/`:

- `A.png` through `Z.png`
- `Ä.png`
- `Ö.png`
- `Ü.png`
- `ß.png`
- `SCH.png`

The image-check button was deliberately removed in V14.

## 5. Test locally

Because browsers can behave differently for local `file://` pages, test with a tiny local web server if possible.

For example with Python:

```bash
python -m http.server 8000
```

Then open:

`http://localhost:8000`

## 6. Publish with GitHub Pages

Create a GitHub repository, for example `daktilo`.

Upload the **contents** of this folder so that `index.html` is directly in the repository root:

```text
index.html
app.js
cloud.js
config.js
styles.css
assets/
data/
images/
supabase/
.nojekyll
```

Then in GitHub:

1. Repository → **Settings**
2. **Pages**
3. Source → **Deploy from a branch**
4. Branch → `main`
5. Folder → `/(root)`
6. Save

Your site will then normally be available at:

`https://YOUR-GITHUB-NAME.github.io/daktilo/`

## 7. Before public launch

Do not treat the current legal text as finished legal advice.

At minimum, review and complete:

- privacy notice
- whether your Supabase/GitHub setup requires additional processor/international-transfer information
- Supabase project region and retention settings

The current privacy dialog explains the main technical data flows, but it is still a beta template.

## Account behavior

### First login

If the username does not yet exist, Daktilo creates the Supabase account using that username + password.

### Later login / another device

The same username + password restores:

- adaptive training level
- scores
- problem letters / confusions
- threshold-test history
- recent word-event history

### Adaptive warm-up

If the saved adaptive training level is 11, the next adaptive session starts at level 10. This is intentional: one slightly easier level gives a short re-entry phase while keeping the learned level nearby.

## Adaptive 80% challenge

The staircase is deliberately coarse-to-fine:

- initial: 40% step
- then 28%
- then 18%
- then 10%
- then 5%
- final fine adjustment: 2.5%

The test therefore moves rapidly away from obviously easy speeds and becomes increasingly precise around the reversal region.
