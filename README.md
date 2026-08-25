# questlog

A single-user, offline-first habit / to-do / project tracker that turns finished
work into XP, levels and streaks. No backend, no account, no analytics. Every
byte lives on the device it was entered on, and moves between devices as a JSON
file you export and import yourself.

It has **no build step and no dependencies** — the files you edit are the files
the browser runs.

```
questlog/
├── index.html                 app shell
├── sw.js                      service worker (precaches everything)
├── manifest.webmanifest       install metadata
├── src/
│   ├── styles.css
│   ├── core/                  pure logic — no DOM, no storage, fully tested
│   │   ├── dates.js           local-calendar day keys ('YYYY-MM-DD')
│   │   ├── ids.js             sortable unique ids
│   │   ├── xp.js              awards + the level curve
│   │   ├── streaks.js         streak maths for each schedule type
│   │   ├── ledger.js          the append-only XP ledger
│   │   ├── schema.js          document shape, factories, validation
│   │   ├── state.js           the reducer — the only thing that writes entries
│   │   ├── merge.js           two-device merge (commutative, idempotent)
│   │   ├── io.js              export / import
│   │   └── selectors.js       read models for the views
│   └── ui/                    DOM layer
│       ├── dom.js             40-line hyperscript
│       ├── store.js           reducer + persistence + events
│       ├── storage.js         IndexedDB, with a localStorage mirror
│       ├── components.js      shared pieces
│       ├── forms.js           modal editors
│       ├── install.js         install-prompt plumbing
│       ├── app.js             boot, routing, toasts, celebrations
│       └── views/             today · projects · stats · settings
├── tests/                     browser test suite (154 tests)
└── tools/                     dev server + icon generator
```

## Running it

```bash
python3 /Users/admin/questlog/tools/serve.py 8123
```

Then open <http://localhost:8123/>. Any static file server works; this one just
sets `Cache-Control: no-store` so an edit shows up on reload instead of being
cached. `file://` will **not** work — ES modules and service workers both need
a real origin.

## Tests

Open <http://localhost:8123/tests/run.html>. The page runs every suite and shows
a green PASS bar with per-test results; the machine-readable results are on
`window.__testResults`.

The suite covers the whole engine — date arithmetic across DST, the XP and level
curves, all three streak types, ledger voids, every reducer action, merge
commutativity and idempotence, import validation of hostile input — plus render
smoke tests that build each screen and each form for real in the DOM.

## Deploying it

The app is static files, so any HTTPS host works. It is set up for GitHub Pages
at `https://callum-dev-x.github.io/questlog/`:

```bash
./tools/deploy.sh "what changed"
```

That stamps a new service-worker cache version (without one, installed copies
keep serving the old files), commits, and pushes to `origin/main`. The first
deploy also needs Pages switched on once: repo → Settings → Pages → Deploy from
a branch → `main` / `root`.

Paths throughout are relative, so serving from a subdirectory like
`/questlog/` works — the worker registers with scope `/questlog/` and precaches
all 30 shell files from there. That is verified, not assumed.

The repository is public; your data is not in it. Habits, tasks and XP live only
in the browser storage of each device you use.

## Installing it

- **macOS Safari** — File → Add to Dock.
- **macOS Chrome** — the install icon in the address bar.
- **iPhone Safari** — Share → Add to Home Screen.

One caveat worth knowing before you try the phone: **service workers only
install over `https` or on `localhost`.** Loading the app from your Mac's LAN
address over plain http will run, but it will not cache itself for offline use.
The simplest fix is to put this folder on any static host (GitHub Pages,
Netlify, Cloudflare Pages — all free, and none of them makes this a "backend":
they serve the same static files, and your data never leaves your device).
Install from that URL on both machines and you get real offline behaviour on
both.

For a quick look on the phone without hosting anything:

```bash
python3 /Users/admin/questlog/tools/serve.py 8123 0.0.0.0
```

and visit `http://<your-mac-ip>:8123/` while the Mac is awake.

## The XP model

| Source | XP |
| --- | --- |
| Habit | 2 / 5 / 10 / 20 by difficulty (trivial → hard) |
| Streak bonus | ×1.1 at 3, ×1.25 at 7, ×1.5 at 14, ×2 at 30 |
| Task | base XP, +25% if finished on or before its due date |
| Milestone | 3× base XP |
| Every habit done in a day | +15 |
| Every milestone in a project done | +50 |

Late work is never punished — it just misses the bonus. Levels cost 50 XP more
than the level before: level 2 at 50 XP total, level 3 at 150, level 4 at 300,
level 10 at 2,250.

Streaks understand three schedules: **every day**, **certain weekdays** (days the
habit isn't scheduled can't break it), and **N times per week** (streaks count in
weeks). A habit you haven't done *yet today* is pending, not broken.

## How the data works

The document is an append-only **ledger** of immutable facts plus the entities
they refer to. XP, levels and streaks are never stored — they are recomputed
from the ledger every time. Undo appends a `void` entry rather than deleting
one, so two devices can merge by taking the union of their entries and always
agree on the total.

The XP an action is worth is calculated once and written onto its entry. Tuning
the numbers in `xp.js` therefore changes what you earn *from now on* and never
rewrites your history. Deleting a habit is a tombstone, not an erasure: the XP
you earned from it stays earned.

### Syncing between two devices

Settings → **Export JSON** writes `questlog-YYYY-MM-DD-HHMM.json` (AirDrop it,
put it in iCloud Drive, email it to yourself — it's just a file). On the other
device, Settings → **Choose a file…** or paste the JSON.

**Merge** (the default) is safe in both directions and in any order:

- ledger entries — union by id; identical ids are the same fact
- habits, tasks, projects, milestones — last edit wins, ties broken
  deterministically so both devices reach the same answer
- deletions — tombstones, so they propagate like any other edit

Merging is *commutative* (A into B equals B into A) and *idempotent* (importing
the same file twice changes nothing), both of which the test suite asserts.
After a merge, bonuses are reconciled: if you ticked half your habits on the
laptop and the rest on the phone, neither device could award the perfect day on
its own, so the merge awards it. Reconciliation only ever adds — it will not
take back XP another device already paid you.

**Replace** throws away everything on the device you are importing into. It asks
twice, and keeps only that device's own id.

### Where it is stored

IndexedDB is the store of record, with a `localStorage` mirror as a backstop if
the database is ever evicted or unreadable. The app asks for persistent storage
on launch; installing it to the dock or home screen makes the browser far more
likely to grant it. Everything on disk is re-validated on load through the same
code path as an import, so a corrupted document degrades rather than crashing.

## Working on it

`src/core/` must stay pure: no DOM, no storage, no `Date.now()` reached for
implicitly — the reducer takes `now` from its caller, which is what makes the
tests able to script forty-five days of history in a millisecond. Everything the
UI shows comes from `selectors.js`, so the views stay dumb.

To add a new source of XP: add its kind to `ENTRY_KINDS` in `ledger.js`, award
it from a case in the reducer, and give it a colour in the `.seg-*` rules. To
regenerate the icons after changing the artwork, run
`python3 tools/make-icons.py`.

Keyboard shortcuts: `1`–`4` switch tabs, `h` adds a habit, `t` adds a task.

## Known limits

- One person, one document. There is no multi-user anything.
- Merging is last-write-wins per record, not per field: if you rename the same
  habit on both devices, the later rename wins outright.
- Bonus reconciliation after an import looks back 30 days.
- No reminders or notifications — the app only exists while you have it open.
