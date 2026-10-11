#!/usr/bin/env node
// As-Built: screenshot every screen of an app, deterministically, and write a manifest.
//
// Usage:
//   node shoot.mjs --config <as-built config.json> --src <app source dir> --out <output dir>
//                  [--only Name,Name] [--allow-errors]
//
// The app is either a static folder (config.app.static, served by a built-in server) or a
// start command (config.app.start + config.app.url, waited for and stopped afterwards).
// Each screen gets a fresh browser context with a frozen clock, fixed timezone, seeded
// Math.random, stubbed network routes and (by default) blocked service workers, so the same
// code always gives the same PNG bytes. Set config.serviceWorkers to "allow" for apps that
// await navigator.serviceWorker.ready.
// Output: <out>/<Name>.png for every screen and <out>/manifest.json
//   { "<Name>": { "file", "title", "sha256", "w", "h" } }
// Exits non-zero if any page error, failed step or missing route file happens (unless --allow-errors).
// Warns (without failing) when a screen's image is identical to the previous screen's.

import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn, execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, extname, join, resolve, sep } from 'node:path';
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

// ---------- Playwright + Chromium ----------

export async function loadPlaywright() {
  try { return await import('playwright'); } catch {}
  const prefixes = [dirname(dirname(process.execPath))];
  try { prefixes.push(dirname(execSync('npm root -g', { encoding: 'utf8' }).trim())); } catch {}
  for (const prefix of prefixes) {
    try { return createRequire(join(prefix, 'lib', 'node_modules', 'x.js'))('playwright'); } catch {}
    try { return createRequire(join(prefix, 'node_modules', 'x.js'))('playwright'); } catch {}
  }
  throw new Error('Playwright not found. Install it with `npm i -g playwright` (or in the project) and `npx playwright install chromium`.');
}

export function chromiumPath() {
  const candidates = [process.env.AS_BUILT_CHROMIUM, '/opt/pw-browsers/chromium'].filter(Boolean);
  for (const p of candidates) {
    try { if (statSync(p).isFile()) return p; } catch {}
  }
  return undefined; // let Playwright use its own downloaded browser
}

// ---------- Static server ----------

const MIME = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.gif': 'image/gif', '.webp': 'image/webp', '.ico': 'image/x-icon', '.avif': 'image/avif',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json', '.map': 'application/json',
};

export function startStaticServer(rootDir) {
  const root = resolve(rootDir);
  const server = createServer((req, res) => {
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
    catch { res.writeHead(400).end(); return; }
    let file = resolve(join(root, pathname));
    if (file !== root && !file.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); } catch {}
    if (!existsSync(file)) {
      // SPA fallback: unknown paths without an extension get index.html
      if (extname(pathname)) { res.writeHead(404).end(); return; }
      file = join(root, 'index.html');
      if (!existsSync(file)) { res.writeHead(404).end(); return; }
    }
    res.writeHead(200, { 'content-type': MIME[extname(file).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(readFileSync(file));
  });
  return new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => ok({ server, url: `http://127.0.0.1:${server.address().port}` }));
  });
}

// ---------- Start-command apps ----------

async function waitForUrl(url, timeoutMs, child) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (child.exitCode !== null) throw new Error(`app.start exited early with code ${child.exitCode}`);
    try { const r = await fetch(url); if (r.status < 500) return; } catch {}
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`Timed out after ${timeoutMs} ms waiting for ${url}`);
}

export async function startCommandApp(app, cwd) {
  const child = spawn(app.start, { cwd, shell: true, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, BROWSER: 'none', ...(app.env || {}) } });
  let log = '';
  child.stdout.on('data', d => { log = (log + d).slice(-4000); });
  child.stderr.on('data', d => { log = (log + d).slice(-4000); });
  const stop = () => { try { process.kill(-child.pid, 'SIGTERM'); } catch {} };
  try { await waitForUrl(app.url, app.timeout ?? 60000, child); }
  catch (e) { stop(); throw new Error(`${e.message}\n--- app output ---\n${log}`); }
  return { url: app.url.replace(/\/$/, ''), stop };
}

// ---------- Determinism ----------

// Runs in the page before any app script: frozen clock, seeded Math.random, init globals.
function initScript({ fixedTime, seed, init }) {
  if (fixedTime !== null) {
    const T = fixedTime;
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...args) { if (args.length === 0) super(T); else super(...args); }
      static now() { return T; }
    }
    window.Date = FixedDate;
  }
  if (seed !== null) {
    let s = seed >>> 0;
    Math.random = () => { // mulberry32
      s = (s + 0x6D2B79F5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  window.__asBuilt = init;
  for (const [k, v] of Object.entries(init)) window[k] = v;
}

export function pngSize(buf) {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

export const sha256 = buf => createHash('sha256').update(buf).digest('hex');

// ---------- Steps ----------

async function runStep(page, step) {
  if ('click' in step) return page.click(step.click);
  if ('fill' in step) return page.fill(step.fill, String(step.value ?? ''));
  if ('press' in step) return step.selector ? page.press(step.selector, step.press) : page.keyboard.press(step.press);
  if ('wait' in step) return typeof step.wait === 'number' ? page.waitForTimeout(step.wait) : page.waitForSelector(step.wait);
  if ('evaluate' in step) return page.evaluate(step.evaluate);
  if ('goto' in step) return page.goto(new URL(step.goto, page.url()).href, { waitUntil: 'load' });
  if ('scrollTop' in step) {
    return page.evaluate(sel => {
      const els = sel === true ? [document.scrollingElement, ...document.querySelectorAll('*')] : document.querySelectorAll(sel);
      for (const el of els) if (el && el.scrollTop) el.scrollTop = 0;
      window.scrollTo(0, 0);
    }, step.scrollTop);
  }
  throw new Error(`Unknown step: ${JSON.stringify(step)}`);
}

// ---------- Main ----------

export async function shoot({ configPath, srcDir, outDir, only = null, allowErrors = false, log = console.error }) {
  const config = JSON.parse(readFileSync(configPath, 'utf8'));
  const configDir = dirname(resolve(configPath));
  const viewport = { width: 390, height: 844, scale: 2, ...(config.viewport || {}) };
  const fixedTime = config.freezeTime === false ? null : new Date(config.freezeTime || '2026-01-01T12:00:00Z').getTime();
  const seed = config.randomSeed === false ? null : (config.randomSeed ?? 1);
  const timezoneId = config.timezone || 'UTC';
  const locale = config.locale || 'en-GB';
  const serviceWorkers = config.serviceWorkers ?? 'block';
  if (!['allow', 'block'].includes(serviceWorkers)) throw new Error(`serviceWorkers must be "allow" or "block", got "${serviceWorkers}"`);
  const stepTimeout = config.stepTimeout ?? 30000;
  const errors = [];
  const warnings = [];
  mkdirSync(outDir, { recursive: true });

  // Route stubs: read every file up front so a missing one fails before any browser work.
  const routes = (config.routes || []).map(r => {
    let body = r.body;
    if (r.file) {
      const p = resolve(configDir, r.file);
      if (!existsSync(p)) throw new Error(`Route file not found: ${r.file} (resolved to ${p})`);
      body = readFileSync(p);
    } else if (r.json !== undefined) body = JSON.stringify(r.json);
    const type = r.contentType || (r.file ? MIME[extname(r.file).toLowerCase()] : null) || (r.json !== undefined ? MIME['.json'] : 'text/plain');
    return { match: r.match, status: r.status ?? 200, body: body ?? '', type };
  });

  // Start the app.
  const app = config.app || {};
  let base, stopApp;
  if (app.static !== undefined) {
    const dir = resolve(srcDir, app.static);
    if (!existsSync(dir)) throw new Error(`app.static folder not found: ${dir}`);
    const s = await startStaticServer(dir);
    base = s.url; stopApp = () => s.server.close();
  } else if (app.start) {
    if (!app.url) throw new Error('app.start needs app.url to wait for');
    const s = await startCommandApp(app, resolve(srcDir, app.cwd || '.'));
    base = s.url; stopApp = s.stop;
  } else {
    throw new Error('config.app needs either "static" or "start" + "url"');
  }

  const pw = await loadPlaywright();
  const browser = await pw.chromium.launch({ executablePath: chromiumPath(), args: ['--font-render-hinting=none', '--disable-lcd-text', '--force-color-profile=srgb'] });
  const manifest = {};
  let context = null, page = null;

  const newPage = async init => {
    if (context) await context.close();
    context = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      deviceScaleFactor: viewport.scale,
      timezoneId, locale,
      colorScheme: config.colorScheme || 'light',
      reducedMotion: 'reduce',
      serviceWorkers,
    });
    await context.addInitScript(initScript, { fixedTime, seed, init: init || {} });
    for (const r of routes) await context.route(r.match, route => route.fulfill({ status: r.status, contentType: r.type, body: r.body }));
    page = await context.newPage();
    page.setDefaultTimeout(stepTimeout);
    page.on('pageerror', e => errors.push(`[${current}] page error: ${e.message}`));
    if (config.failOnConsoleError) page.on('console', m => { if (m.type() === 'error') errors.push(`[${current}] console error: ${m.text()}`); });
  };

  let current = '';
  let previous = null;
  try {
    const screens = config.screens || [];
    if (!screens.length) throw new Error('config.screens is empty');
    for (const screen of screens) {
      current = screen.name;
      if (!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(screen.name || '')) throw new Error(`Bad screen name "${screen.name}": use letters, digits, _ . - (no spaces)`);
      const fresh = !screen.continue || !page;
      if (fresh) {
        await newPage(screen.init);
        await page.goto(new URL(screen.path || '/', base + '/').href, { waitUntil: 'load' });
        if (config.ready) await page.waitForSelector(config.ready);
      } else if (screen.path) {
        await page.goto(new URL(screen.path, base + '/').href, { waitUntil: 'load' });
      }
      try {
        for (const step of screen.steps || []) await runStep(page, step);
      } catch (e) {
        errors.push(`[${screen.name}] step failed: ${e.message.split('\n')[0]}`);
      }
      if (only && !only.includes(screen.name)) continue; // still run steps so later screens can continue from here
      await page.evaluate(() => document.fonts && document.fonts.ready);
      const buf = await page.screenshot({ fullPage: !!screen.fullPage, animations: 'disabled', caret: 'hide' });
      const file = `${screen.name}.png`;
      writeFileSync(join(outDir, file), buf);
      const { width, height } = pngSize(buf);
      manifest[screen.name] = {
        file, title: screen.title || screen.name, sha256: sha256(buf),
        w: Math.round(width / viewport.scale), h: Math.round(height / viewport.scale),
      };
      log(`shot ${screen.name} ${manifest[screen.name].w}x${manifest[screen.name].h} ${manifest[screen.name].sha256.slice(0, 12)}`);
      // Identical to the screen before usually means a step had no visible effect (e.g. it waits on something that never happens).
      if (previous && manifest[previous].sha256 === manifest[screen.name].sha256) {
        const w = `[${screen.name}] warning: image is identical to the previous screen (${previous}); a step probably had no visible effect`;
        warnings.push(w);
        log(w);
      }
      previous = screen.name;
    }
  } finally {
    if (context) await context.close().catch(() => {});
    await browser.close().catch(() => {});
    stopApp();
  }

  writeFileSync(join(outDir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  if (errors.length) {
    for (const e of errors) log(e);
    if (!allowErrors) {
      const err = new Error(`${errors.length} error(s) while shooting; the stub or screen steps probably need updating.`);
      err.errors = errors;
      throw err;
    }
  }
  return { manifest, errors, warnings };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const a = parseArgs(process.argv.slice(2));
  if (!a.config || !a.src || !a.out) {
    console.error('usage: node shoot.mjs --config <config.json> --src <app dir> --out <dir> [--only A,B] [--allow-errors]');
    process.exit(2);
  }
  shoot({ configPath: a.config, srcDir: a.src, outDir: a.out, only: a.only ? String(a.only).split(',') : null, allowErrors: !!a['allow-errors'] })
    .then(() => process.exit(0))
    .catch(e => { console.error(`as-built shoot failed: ${e.message}`); process.exit(1); });
}
