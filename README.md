# As-Built

As-Built keeps a page of a Claude Design canvas (a claude.ai "Design" artifact) an exact mirror of
what's on a project's `main` branch, i.e. production. It screenshots every app screen from the
main-branch code, using fake sign-in and fixed sample data so images only change when the code
changes. It uploads only screens whose image changed, and records the commit on the page. It runs
after each merge and on a schedule. Before each update it estimates the token cost and builds
automatically under a limit you set; above it, it asks Build / Cancel.

The name comes from architects' *as-built drawings*, which are updated to show what was actually built.

## Install

In Claude Code:

```
/plugin marketplace add TheRealKay/as-built
/plugin install as-built@as-built
```

On Claude Code 2.1.275 or later you can do it in one step:

```
/plugin install as-built --marketplace TheRealKay/as-built
```

Then, in your project, say **"set up as-built"**.

## What you need

- A **claude.ai account** with access to Design canvases (the page lives in a Design artifact).
- **Node 18+** and **Playwright with Chromium** where the screenshots are taken. Locally:
  `npm i -g playwright && npx playwright install chromium`. Claude Code cloud sessions usually have
  Chromium already (As-Built uses `/opt/pw-browsers/chromium` when it exists; set `AS_BUILT_CHROMIUM`
  to point at another browser binary).
- A git repo with a `main` branch on `origin`.

## Using it

| Say | What happens |
| --- | --- |
| "set up as-built" | Picks or creates the canvas and page, works out how to run your app, writes a sample-data stub and the screen list, asks your preferences, checks two shoots give identical images, and sets up the schedule. |
| "update the as-built" | Runs now: shoots main, works out what changed, estimates the cost, builds (or asks). |
| "change the as-built settings" | Changes how often it checks, the auto-build limit or notifications. |

### What a run does

1. Fetches `origin/main`. If the page already shows that commit, it stops ("already up to date").
2. Copies main with `git archive` (never your working tree) and screenshots every screen from
   main's own copy of the config.
3. Compares each image's SHA-256 with the `data-shot` recorded in the screen's artboard.
4. Estimates the cost and builds under your limit, or asks.
5. Uploads only the changed images, updates the artboards and the title note
   (`As-Built · main @ abc1234 · 11 Oct 2026, 08:52 BST`) in one publish, then deletes the images
   it replaced.

## Settings

Per-project settings live in the **project**, in `.claude/as-built/config.json`, next to any stub
files it uses. Commit them; the run reads main's copy, so the config always matches the code it shoots.
Full example: [`templates/as-built.config.example.json`](templates/as-built.config.example.json).

```json
{
  "canvas": "https://claude.ai/artifact/<canvas-id>",
  "page": "as-built",
  "pageName": "As-Built",
  "app": { "static": "public" },
  "viewport": { "width": 390, "height": 844, "scale": 2 },
  "timezone": "Europe/London",
  "freezeTime": "2026-10-10T19:30:00Z",
  "routes": [ { "match": "https://cdn.jsdelivr.net/**", "file": "stub.js" } ],
  "screens": [
    { "name": "Login", "title": "Sign in", "init": { "__signedIn": false } },
    { "name": "Home", "title": "Home", "continue": true,
      "steps": [ { "click": "label.who-option:first-of-type" }, { "wait": 150 } ] }
  ],
  "settings": { "schedule": "daily+merges", "cron": "CRON_TZ=Europe/London 52 7 * * *",
                "autoBuildLimit": 50000, "notify": ["chat"], "triggerId": null }
}
```

| Key | Meaning |
| --- | --- |
| `canvas`, `page`, `pageName` | The Design canvas, the id of the page the screens go on (created if missing), and its name. |
| `boardPrefix` | Artboard file prefix, default `AsBuilt-`. Only boards with this prefix on this page are touched. |
| `background` | Colour behind each screenshot, default `#1d4b57`. |
| `app` | Either `{ "static": "<folder>" }`, served by a built-in static server with SPA fallback, or `{ "start": "npm run dev", "url": "http://localhost:5173/" }` (optional `cwd`, `env`, `timeout` ms). The start command is stopped afterwards. |
| `viewport` | CSS size and device scale. Default 390×844 @2x. |
| `timezone`, `locale`, `colorScheme` | Browser settings. Defaults `UTC`, `en-GB`, `light`. |
| `freezeTime` | The fixed instant `Date` returns (`new Date()`, `Date.now()`). `false` turns it off. |
| `randomSeed` | Seed for `Math.random`, default `1`. `false` turns it off. |
| `ready` | Optional selector to wait for after every fresh page load. |
| `routes` | Requests to answer locally: `match` (Playwright glob or URL) plus `file` (relative to the config), `json`, or `body` + `contentType`. |
| `screens` | In order. `name` (letters, digits, `_ . -`), `title`, `path` (default `/`), `fullPage`. A screen starts a fresh page, with `init` copied onto `window` before any app script runs, unless it has `"continue": true`, which keeps the previous screen's page and state. |
| `screens[].steps` | `{ "click": sel }`, `{ "fill": sel, "value": "text" }`, `{ "press": "Enter", "selector"?: sel }`, `{ "wait": 150 }` (ms) or `{ "wait": sel }`, `{ "evaluate": "js string" }`, `{ "scrollTop": true or sel }`, `{ "goto": "/path" }`. |
| `failOnConsoleError` | Also fail on `console.error`, not just uncaught page errors. |
| `settings` | Your preferences, below. |

### Preferences

Setup asks these; you can change any of them later by asking in chat.

- **How often to check main**: after merges + daily at a chosen time (default: daily about 08:00
  local + after merges), hourly, every few hours, weekly, only after merges, or never (manual).
  Frequency changes update the scheduled routine (`CRON_TZ=<your tz>`, hourly at most, round hours
  jittered a few minutes early).
- **Auto-build limit** in tokens (default 50k). Under the limit it builds; at or over it asks
  Build / Cancel. Unattended runs over the limit post a summary and wait for you to say "build".
- **Notifications**: chat, chat + phone push (needs Remote Control), or chat + email (needs an
  email connector).

## Cost estimate

Before building, As-Built estimates the tokens the update will take:

| Part | Tokens |
| --- | --- |
| Base (fetch, shoot, compare, publish) | 10k |
| Each changed screen (view it once, upload, artboard) | 4k |
| Screens added or removed, or the config/stub needs fixing | +20k |
| First-time setup | +30k |

A new commit with no changed images only refreshes the title note (about 10k).

## Limits and gotchas

- **Scheduled routines exist only in Claude Code cloud sessions.** Locally, say "update the
  as-built" when you want it, or have your own scheduler run `claude -p "update the as-built"` in
  the project.
- **Phone push needs Remote Control.**
- **The stub must answer every backend call the app makes.** When the app adds a new call, the
  shoot fails loudly with the page error; the run then counts as "config needs fixing" (+20k) and
  updates the stub.
- **Determinism is the whole trick.** The clock, `Math.random`, animations, the caret, timezone and
  locale are fixed, and service workers are blocked. If two shoots differ, something live is still
  leaking in (real network data, a `performance.now()` driven animation, a remote font): stub it.
- An Artifact `read` with `out_dir` saves to `<out_dir>/<published path>`: pass `out_dir=$W/canvas`
  to get `$W/canvas/project/canvas.json`. Passing `.../project` nests it twice.
- Keep `pkill` and other process killing in separate shell commands from git commits. A combined
  command once killed the shell before the commit ran.
- A publish over someone's newer save of the canvas is refused; As-Built re-reads and redoes it.

## Example: Moodies

[`examples/moodies/`](examples/moodies/) is a sanitised copy of the setup As-Built was first built
for: a static web app whose backend SDK comes from a CDN, with a stub that fakes sign-in and sample
data, and screens that continue from each other (the Picker is opened from the Me view).

## Scripts

The skill drives three Node scripts in [`scripts/`](scripts/), which you can also run yourself:

```bash
node scripts/shoot.mjs --config .claude/as-built/config.json --src <app dir> --out shots/
node scripts/plan.mjs --root canvas/ --sha <commit> --manifest shots/manifest.json --config <cfg>
node scripts/write-boards.mjs --root canvas/ --manifest shots/manifest.json --urls urls.json --sha <commit> --config <cfg> --settings <cfg>
```

## Development

```bash
npm test
```

The tests shoot a tiny demo app (`test/demo-app/`) twice and check the hashes are identical, check a
start-command app gives the same images, that a CSS change changes only the affected screens, that
page errors fail the run, and check `write-boards` and `plan` against a sample `canvas.json`.

## Licence

[MIT](LICENSE) © 2026 Kay (TheRealKay)
