---
name: as-built
description: Keep a page of a Claude Design canvas an exact mirror of the app on the project's main branch (production). Use when the user says "update the as-built", "set up as-built", "change the as-built settings", or a scheduled or post-merge As-Built run fires.
---

# As-Built

As-Built screenshots every screen of the app **as it is on `origin/main`**, using fake sign-in and fixed
sample data, and mirrors the screenshots onto one page of a Claude Design canvas. Images only change
when the code changes, so only changed screens are uploaded. The page's title note records the commit.

Scripts live in `${CLAUDE_PLUGIN_ROOT}/scripts/`:

- `shoot.mjs --config <cfg> --src <app dir> --out <dir>`: screenshots + `manifest.json` (`{Name: {file, title, sha256, w, h}}`). Fails loudly on page errors.
- `plan.mjs --root <canvas dir> --sha <sha> [--manifest <m>] --config <cfg> [--first-time] [--fix]`: up-to-date check, changed/added/removed screens, old asset ids, token estimate.
- `write-boards.mjs --root <canvas dir> --manifest <m> --urls <urls.json> --sha <sha> --config <cfg> [--settings <cfg>]`: edits `project/canvas.json`, writes changed artboards, prints `{file_path, files}` for the one publish.

The project's settings live in `.claude/as-built/config.json` (plus any stub files it names). The
format is in `${CLAUDE_PLUGIN_ROOT}/templates/as-built.config.example.json` and the README.

Use a work folder `W` in your scratchpad directory (else `.as-built-work/` in the project; make sure
it's in `.gitignore`). Keep `pkill`/process killing in its own shell command, never chained
with git commands.

Pick the flow: **Run** (default, "update the as-built", scheduled or post-merge firing), **Setup**
("set up as-built", or no `.claude/as-built/config.json` exists), **Change settings**.

## Run

1. `git fetch origin main`, then `SHA=$(git rev-parse origin/main)`.
2. Artifact `read` the canvas (`url` = config `canvas`) with `path: "project/canvas.json"` and `out_dir: "$W/canvas"`
   (this saves `$W/canvas/project/canvas.json`; never pass `.../project` as `out_dir`, it nests twice).
   Run `node plan.mjs --root $W/canvas --sha $SHA --config .claude/as-built/config.json`.
   `upToDate: true` → reply "As-Built already shows main @ <sha7>." and stop.
3. Build main, never the working tree:
   ```bash
   rm -rf $W/src && mkdir -p $W/src && git archive origin/main | tar -x -C $W/src
   ```
   (For a big repo, `git archive origin/main <paths the app needs> .claude/as-built`.)
   If the app needs dependencies (start-command apps), install them in `$W/src` the way the project does.
   Shoot with **main's copy** of the config:
   `node shoot.mjs --config $W/src/.claude/as-built/config.json --src $W/src --out $W/shots`.
   If main has no config yet (setup not merged), use the working-tree config with `--src $W/src`.
   If it fails (page errors, a step can't find its selector), the app has probably added a backend
   call or changed a screen: this run needs a config/stub fix (`--fix` below). Don't guess silently.
   A warning that a screen is identical to the previous one means a step had no visible effect:
   treat it like a failure and fix the steps (or `serviceWorkers`) before building.
4. Artifact `read` the canvas with `paths` = `project/<prefix><Name>.dc.html` for every screen in the
   manifest that has a board on the page, `out_dir: "$W/canvas"`. Missing files are fine (new screens).
   Run `node plan.mjs --root $W/canvas --sha $SHA --manifest $W/shots/manifest.json --config <cfg>`
   (add `--fix` if step 3 needed a config fix, `--first-time` during setup).
5. The estimate is `estimate` from plan: 10k base + 4k per changed screen + 20k if screens were added
   or removed or the config needs fixing + 30k first-time setup. `titleOnly: true` means no image
   changed: only the title note is refreshed (still a build, a cheap one).
6. Decide, with `limit = settings.autoBuildLimit` (default 50000):
   - `estimate < limit` → build.
   - Otherwise, if the user is here (they asked for this run): AskUserQuestion with options
     "Build (~Nk)" and "Cancel".
   - If a schedule or a merge started this run (nobody is waiting): post a short summary in chat
     (commit, changed screens, estimate, "say 'build the as-built' to go ahead"), send it through each
     channel in `settings.notify` (`push` → `PushNotification`; `email` → only if an email connector
     is available, else say so once), and stop. "Build" later re-runs from step 1.
7. Build:
   - If a fix is needed, fix `.claude/as-built/config.json` / stub in the project (on a branch with a
     PR, following the repo's rules; never push to main) and re-shoot from the fixed copy.
   - View each changed PNG once (Read it) to check it looks like a real screen, not an error page.
   - Upload the changed PNGs in one call: Artifact `publish` with `url` = canvas, `asset: true`,
     `file_paths: [...]`. Write `$W/urls.json` = `{ "<Name>": "<the url the result gives>" }`.
     For a title-only refresh, `urls.json` is `{}`.
   - Re-read `project/canvas.json` into `$W/canvas` right before writing (someone may have saved).
   - `node write-boards.mjs --root $W/canvas --manifest $W/shots/manifest.json --urls $W/urls.json --sha $SHA --config <cfg> --settings <cfg>`.
   - **One** publish: Artifact `publish` with `url` = canvas, `root: "$W/canvas"`,
     `file_path: "$W/canvas/project/canvas.json"`, `files` = the printed `files` map (null removes a
     board's file). If it's refused because of a newer save, re-read what it names, redo
     write-boards, publish again (stop after the third refusal and tell the user).
   - Then Artifact `delete` with `url` = canvas and `path` = each id in plan's `oldAssets` (images the
     new ones replaced). Delete nothing else.
8. Report in 1–2 lines: "As-Built now shows main @ abc1234: 3 screens updated (Home, Me, Picker)."

## Setup

Ask only what you can't read from the repo. Defaults are in brackets.

1. **Canvas.** Ask for the Design canvas link, or offer to create one (Artifact `quickstart` with
   intent "design", then create from the Design type with a title like "<App> As-Built"). Read its
   `project/canvas.json`. Ask whether to use a new page [new page "As-Built"] or an existing one;
   a new page gets an id like `as-built` (write-boards adds it to `pages`).
2. **App.** Work out from the repo whether it's a static folder (`{"static": "public"}`) or needs a
   start command (`{"start": "npm run dev", "url": "http://localhost:5173/"}`). Confirm in one line.
3. **Sample data.** Find every backend/SDK/config request the app makes on its screens. Write a stub
   module (e.g. `.claude/as-built/stub.js`) that answers each with fixed sample data and fake
   sign-in, and add `routes` entries for them. No real keys, emails or user data in the stub.
   If the app awaits `navigator.serviceWorker.ready` anywhere on its screens (menus, push
   prompts), set `"serviceWorkers": "allow"`; blocked workers make that promise hang forever.
4. **Screens.** List the screens and how to reach each (`init` globals for signed-in state; `steps`:
   `click`, `fill`+`value`, `press`, `wait` ms or selector, `evaluate`, `scrollTop`, `goto`).
   Use `"continue": true` to carry state from the previous screen (e.g. Picker opened from Me).
5. **Preferences** (one AskUserQuestion, 3 questions):
   - How often to check main: [daily ~08:00 local + after merges], hourly, every few hours,
     only after merges, weekly, never/manual.
   - Auto-build limit: [50k tokens], 25k, 100k. Under it builds; at or over asks Build/Cancel.
   - Notifications: [chat], chat + phone push (needs Remote Control), chat + email.
   Timezone: read it from the user or system; ask if unknown.
6. Write `.claude/as-built/config.json` and the stub. Shoot twice into two folders and check the
   hashes are identical; if not, find what's moving (clock, random, animation, live data) and fix it.
7. **Schedule.** Only in a Claude Code cloud session (the `create_trigger` tool exists):
   `create_trigger` bound to this session, `initiation: "human_request"`, `name: "As-Built"`,
   cron from the preference with `CRON_TZ=<tz>` and a jittered minute a few minutes before the hour
   (daily 08:00 → `CRON_TZ=Europe/London 52 7 * * *`; hourly → `0 * * * *`; every few hours →
   `0 */4 * * *`; weekly → `52 7 * * 1`), prompt:
   "Scheduled run of the as-built skill: update the As-Built page from origin/main. Nobody is
   waiting: follow the skill's rules for unattended runs." Save its id in `settings.triggerId`.
   "After merges": when you see a PR merged into main in this session (a PR event or the user says
   so), run the Run flow as an unattended run. Locally there are no routines: tell the user to say
   "update the as-built", or run `claude -p "update the as-built"` from their own scheduler.
8. Commit the config and stub on a branch and open a PR (following the repo's rules). Then do the
   first Run with `--first-time` (it can run from the working-tree config before the PR merges).

## Change settings

Settings live in `settings` in `.claude/as-built/config.json`:
`schedule`, `cron`, `autoBuildLimit`, `notify`, `triggerId`.

- Frequency: compute the new cron (rules in Setup step 7) and `update_trigger` with `triggerId`
  (create one if missing; `enabled: false` for manual/only-after-merges). Hourly is the minimum.
- Limit or notifications: just edit the config.
- Commit the change the way the project takes changes, then refresh the settings sticky on the next
  run (write-boards `--settings`), or straight away with a title-only build if the user wants.
- Screens, routes, viewport and timezone changes are config edits too; they change images, so the
  next run will rebuild those screens.

## Rules

- The page shows main exactly: always shoot from `git archive origin/main`, never the working tree.
- Images must be uploaded assets (`/_blob/<id>`), never data URIs. Keep every canvas key you don't change.
- Only boards named `<prefix><Name>.dc.html` on the As-Built page are yours; never touch other boards or pages.
- Never put real canvas links, emails, keys or user data in anything committed to a public repo.
