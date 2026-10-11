#!/usr/bin/env node
// As-Built: decide what a run has to do, and estimate its token cost.
//
// Usage:
//   node plan.mjs --root <dir> --sha <commit> [--manifest <manifest.json>] [--prefix AsBuilt-]
//                 [--page <page-id>] [--config <as-built config.json>] [--first-time] [--fix]
//
// <root>/project/canvas.json is the canvas index; <root>/project/<prefix><Name>.dc.html are the
// existing artboards (read them with Artifact `read` + `paths`, out_dir=<root>).
// Without --manifest it only checks whether the page already shows <sha> (step 2 of a run).
// Prints JSON: { upToDate, shownSha, changed, added, removed, titleOnly, estimate, oldAssets }
//   changed: screens whose image differs (or whose artboard is missing), new screens included
//   added / removed: screens new to / gone from the page
//   oldAssets: { Name: "<asset id>" } for changed screens' current images, to delete after publishing
//   estimate: tokens = 10k base + 4k per changed screen + 20k if screens were added/removed or the
//             config needs fixing (--fix) + 30k first-time setup (--first-time)

import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './write-boards.mjs';

export const COST = { base: 10000, perScreen: 4000, structure: 20000, firstTime: 30000 };

export function plan({ root, sha, manifest = null, prefix = 'AsBuilt-', page = null, firstTime = false, fix = false, notePrefix = 'mirror-' }) {
  const indexPath = join(root, 'project', 'canvas.json');
  const canvas = existsSync(indexPath) ? JSON.parse(readFileSync(indexPath, 'utf8')) : { boards: {}, notes: {} };
  const status = canvas.notes?.[`${notePrefix}status`]?.text || '';
  const shownSha = (status.match(/main @ ([0-9a-f]{7,40})/i) || [])[1] || null;
  const upToDate = !!shownSha && sha.toLowerCase().startsWith(shownSha.toLowerCase());
  if (!manifest) return { upToDate, shownSha };

  const onPage = Object.entries(canvas.boards || {})
    .filter(([f, b]) => f.startsWith(prefix) && f.endsWith('.dc.html') && (b.page ?? null) === page)
    .map(([f]) => f.slice(prefix.length, -'.dc.html'.length));
  const names = Object.keys(manifest);
  const added = names.filter(n => !onPage.includes(n));
  const removed = onPage.filter(n => !names.includes(n));
  const changed = [];
  const oldAssets = {};
  for (const name of names) {
    const file = join(root, 'project', `${prefix}${name}.dc.html`);
    const html = existsSync(file) ? readFileSync(file, 'utf8') : '';
    const shot = (html.match(/data-shot="([0-9a-f]{64})"/) || [])[1];
    if (shot !== manifest[name].sha256) {
      changed.push(name);
      const blob = (html.match(/src="\/_blob\/([^"]+)"/) || [])[1];
      if (blob) oldAssets[name] = blob;
    }
  }
  const structure = added.length > 0 || removed.length > 0 || fix;
  const estimate = COST.base + COST.perScreen * changed.length + (structure ? COST.structure : 0) + (firstTime ? COST.firstTime : 0);
  return { upToDate, shownSha, changed, added, removed, titleOnly: !changed.length && !removed.length && !upToDate, estimate, oldAssets };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.root || !a.sha) {
    console.error('usage: node plan.mjs --root <dir> --sha <commit> [--manifest <file>] [--config <file>] [--prefix AsBuilt-] [--page <id>] [--first-time] [--fix]');
    process.exit(2);
  }
  const cfg = a.config ? JSON.parse(readFileSync(a.config, 'utf8')) : {};
  console.log(JSON.stringify(plan({
    root: a.root, sha: String(a.sha),
    manifest: a.manifest ? JSON.parse(readFileSync(a.manifest, 'utf8')) : null,
    prefix: a.prefix ?? cfg.boardPrefix ?? 'AsBuilt-',
    page: a.page ?? cfg.page ?? null,
    firstTime: !!a['first-time'], fix: !!a.fix,
  }), null, 2));
}
