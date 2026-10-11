#!/usr/bin/env node
// As-Built: update a downloaded Claude Design canvas so one page mirrors the screenshots in a manifest.
//
// Usage:
//   node write-boards.mjs --root <dir> --manifest <manifest.json> --urls <urls.json> --sha <commit>
//        [--config <as-built config.json>] [--settings <as-built config.json>]
//        [--page <page-id>] [--page-name <name>] [--prefix AsBuilt-] [--background #1d4b57]
//        [--timezone Europe/London] [--columns 3] [--now <ISO time>]
//
// <root>/project/canvas.json is the canvas index (as saved by an Artifact `read` with out_dir=<root>).
// urls.json maps screen name -> "/_blob/<id>" for the screens whose image changed (and new screens).
// For every screen in the manifest this sets the board <prefix><Name>.dc.html (position, size, page,
// title), and writes the artboard file only for screens in urls.json. Boards with the prefix on the
// same page whose screen is gone are removed. It sets the status title note, and the settings sticky
// when --settings is given. Every key it doesn't own is kept.
// Prints JSON for the one Artifact publish: { file_path, files } (paths relative to <root>;
// a null value removes that file from the canvas).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) args[key] = true;
    else { args[key] = next; i++; }
  }
  return args;
}

export const escapeHtml = s => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function artboardHtml({ title, w, h, url, sha256, background }) {
  const t = escapeHtml(title);
  const bg = escapeHtml(background);
  const props = escapeHtml(JSON.stringify({ $preview: { width: w, height: h } }));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Live · ${t}</title><script src="./support.js"></script></head><body><x-dc><helmet><style>
body{margin:0}
</style></helmet><div style="width: ${w}px; height: ${h}px; overflow: hidden; background: ${bg}"><img src="${escapeHtml(url)}" alt="${t} screen as built on main" data-shot="${escapeHtml(sha256)}" style="width: ${w}px; height: ${h}px; display: block"></div></x-dc><script type="text/x-dc" data-dc-script data-props='${props}'>
class Component extends DCLogic {
renderVals() {
return {};
}
}
</script></body></html>
`;
}

export function formatTime(date, timeZone) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone, day: 'numeric', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short',
  }).format(date);
}

const SCHEDULE_TEXT = {
  'hourly': 'hourly', 'every-few-hours': 'every few hours', 'daily': 'daily',
  'daily+merges': 'daily + after merges', 'weekly': 'weekly', 'merges': 'only after merges',
  'manual': 'only when asked',
};

export function settingsText(config, pageName) {
  const s = config.settings || {};
  const time = (s.cron || '').replace(/^CRON_TZ=\S+\s+/, '').split(/\s+/);
  const at = /^\d+$/.test(time[0]) && /^\d+$/.test(time[1]) ? ` (${time[1].padStart(2, '0')}:${time[0].padStart(2, '0')})` : '';
  const limit = s.autoBuildLimit ?? 50000;
  return [
    `${pageName} settings`,
    `Checks main: ${SCHEDULE_TEXT[s.schedule] || s.schedule || 'daily + after merges'}${at}`,
    `Builds automatically under ${Math.round(limit / 1000)}k tokens; asks above that`,
    `Notifies: ${(s.notify || ['chat']).join(', ')}`,
    `To change: ask Claude to change the as-built settings`,
  ].join('\n');
}

export function writeBoards(opts) {
  const {
    root, manifest, urls, sha, page = null, pageName = 'As-Built', prefix = 'AsBuilt-',
    background = '#1d4b57', timeZone = 'UTC', columns = 3, now = new Date(), settings = null,
    notePrefix = 'mirror-',
  } = opts;
  if (!/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error(`--sha must be a commit hash, got "${sha}"`);
  const indexPath = join(root, 'project', 'canvas.json');
  if (!existsSync(indexPath)) throw new Error(`No canvas index at ${indexPath} (read the canvas with out_dir=<root>)`);
  const canvas = JSON.parse(readFileSync(indexPath, 'utf8'));
  canvas.boards ??= {};
  canvas.order ??= [];
  canvas.notes ??= {};

  if (page) {
    canvas.pages ??= [];
    if (!canvas.pages.some(p => p.id === page)) canvas.pages.push({ id: page, name: pageName });
  }
  const onPage = b => (b.page ?? null) === page || (!page && b.page === undefined);

  const names = Object.keys(manifest);
  for (const n of Object.keys(urls)) if (!manifest[n]) throw new Error(`urls.json names "${n}", which is not in the manifest`);
  const files = {};

  // Layout: rows of `columns`, 80 px between frames, 120 px between rows.
  const colW = Math.max(...names.map(n => manifest[n].w)) + 80;
  let y = 0;
  for (let r = 0; r * columns < names.length; r++) {
    const row = names.slice(r * columns, r * columns + columns);
    row.forEach((name, c) => {
      const m = manifest[name];
      const file = `${prefix}${name}.dc.html`;
      const board = { ...(canvas.boards[file] || {}), x: c * colW, y, w: m.w, h: m.h, title: m.title };
      if (page) board.page = page; else delete board.page;
      canvas.boards[file] = board;
      if (!canvas.order.includes(file)) canvas.order.push(file);
      if (urls[name]) {
        const out = join(root, 'project', file);
        writeFileSync(out, artboardHtml({ title: m.title, w: m.w, h: m.h, url: urls[name], sha256: m.sha256, background }));
        files[`project/${file}`] = `project/${file}`;
      }
    });
    y += Math.max(...row.map(n => manifest[n].h)) + 120;
  }

  // Screens that no longer exist: remove their boards from this page.
  const keep = new Set(names.map(n => `${prefix}${n}.dc.html`));
  for (const [file, b] of Object.entries(canvas.boards)) {
    if (file.startsWith(prefix) && file.endsWith('.dc.html') && !keep.has(file) && onPage(b)) {
      delete canvas.boards[file];
      canvas.order = canvas.order.filter(f => f !== file);
      files[`project/${file}`] = null;
    }
  }

  const rowW = Math.min(columns, names.length) * colW - 80;
  const status = { ...(canvas.notes[`${notePrefix}status`] || {}), x: 0, y: -300, kind: 'title1', maxW: rowW,
    text: `${pageName} · main @ ${sha.slice(0, 7)} · ${formatTime(now, timeZone)}` };
  if (page) status.page = page;
  canvas.notes[`${notePrefix}status`] = status;

  if (settings) {
    const sticky = { ...(canvas.notes[`${notePrefix}settings`] || {}), x: rowW + 120, y: 0, w: 340, size: 'm', fill: 'blue',
      text: settingsText(settings, pageName) };
    if (page) sticky.page = page;
    canvas.notes[`${notePrefix}settings`] = sticky;
  }

  writeFileSync(indexPath, JSON.stringify(canvas, null, 2) + '\n');
  return { file_path: 'project/canvas.json', files };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.root || !a.manifest || !a.urls || !a.sha) {
    console.error('usage: node write-boards.mjs --root <dir> --manifest <manifest.json> --urls <urls.json> --sha <commit> [--config <file>] [--settings <file>] [--page <id>] [--page-name <name>] [--prefix AsBuilt-] [--background <css colour>] [--timezone <IANA>] [--columns 3] [--now <ISO>]');
    process.exit(2);
  }
  try {
    const cfg = a.config ? JSON.parse(readFileSync(a.config, 'utf8')) : {};
    const settings = a.settings ? JSON.parse(readFileSync(a.settings === true ? a.config : a.settings, 'utf8')) : null;
    mkdirSync(join(a.root, 'project'), { recursive: true });
    const result = writeBoards({
      root: a.root,
      manifest: JSON.parse(readFileSync(a.manifest, 'utf8')),
      urls: JSON.parse(readFileSync(a.urls, 'utf8')),
      sha: String(a.sha),
      page: a.page ?? cfg.page ?? null,
      pageName: a['page-name'] ?? cfg.pageName ?? 'As-Built',
      prefix: a.prefix ?? cfg.boardPrefix ?? 'AsBuilt-',
      background: a.background ?? cfg.background ?? '#1d4b57',
      timeZone: a.timezone ?? cfg.timezone ?? 'UTC',
      columns: Number(a.columns ?? cfg.columns ?? 3),
      now: a.now ? new Date(a.now) : new Date(),
      settings,
    });
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.error(`as-built write-boards failed: ${e.message}`);
    process.exit(1);
  }
}
