import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { shoot } from '../scripts/shoot.mjs';
import { artboardHtml, settingsText, writeBoards } from '../scripts/write-boards.mjs';
import { plan } from '../scripts/plan.mjs';

const here = new URL('.', import.meta.url).pathname;
const demo = join(here, 'demo-app');
const configPath = join(demo, '.claude/as-built/config.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const tmp = mkdtempSync(join(tmpdir(), 'as-built-test-'));
const quiet = () => {};
const hashes = m => Object.fromEntries(Object.entries(m).map(([k, v]) => [k, v.sha256]));

function writeConfig(name, changes) {
  const dir = join(tmp, name);
  mkdirSync(dir, { recursive: true });
  cpSync(join(demo, '.claude/as-built/stub.js'), join(dir, 'stub.js'));
  const p = join(dir, 'config.json');
  writeFileSync(p, JSON.stringify({ ...config, ...changes }));
  return p;
}

const freePort = () => new Promise(ok => {
  const s = createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

let first;

test('shooting the demo app twice gives identical hashes', { timeout: 120000 }, async () => {
  const a = await shoot({ configPath, srcDir: demo, outDir: join(tmp, 'a'), log: quiet });
  const b = await shoot({ configPath, srcDir: demo, outDir: join(tmp, 'b'), log: quiet });
  first = a.manifest;
  assert.deepEqual(Object.keys(a.manifest), ['Login', 'Home', 'Draft', 'HomeDirect']);
  assert.deepEqual(hashes(a.manifest), hashes(b.manifest));
  for (const [name, m] of Object.entries(a.manifest)) {
    assert.match(m.sha256, /^[0-9a-f]{64}$/);
    assert.equal(m.w, 390);
    assert.ok(m.h >= 844, `${name} height`);
    assert.ok(existsSync(join(tmp, 'a', m.file)));
  }
  // "continue" carried the signed-in state forward, and a fresh signed-in page matches it
  assert.equal(a.manifest.Home.sha256, a.manifest.HomeDirect.sha256);
  assert.notEqual(a.manifest.Login.sha256, a.manifest.Home.sha256);
  assert.deepEqual(JSON.parse(readFileSync(join(tmp, 'a', 'manifest.json'), 'utf8')), a.manifest);
});

test('a start-command app gives the same images as the static folder', { timeout: 120000 }, async () => {
  const port = await freePort();
  const p = writeConfig('start', { app: { start: `node serve.mjs ${port}`, url: `http://127.0.0.1:${port}/` } });
  const { manifest } = await shoot({ configPath: p, srcDir: demo, outDir: join(tmp, 'start'), log: quiet });
  assert.deepEqual(hashes(manifest), hashes(first));
});

test('a code change changes only the affected screen', { timeout: 120000 }, async () => {
  const src = join(tmp, 'changed-src');
  cpSync(demo, src, { recursive: true });
  const css = join(src, 'public/style.css');
  writeFileSync(css, readFileSync(css, 'utf8').replace('.card { background: #fff;', '.card { background: #ffe;'));
  const { manifest } = await shoot({ configPath: join(src, '.claude/as-built/config.json'), srcDir: src, outDir: join(tmp, 'changed'), log: quiet });
  assert.equal(manifest.Login.sha256, first.Login.sha256);
  assert.notEqual(manifest.Home.sha256, first.Home.sha256);
});

test('page errors fail the run loudly', { timeout: 120000 }, async () => {
  const p = writeConfig('no-stub', { routes: [] }); // backend not stubbed: the real fetch fails
  await assert.rejects(
    shoot({ configPath: p, srcDir: demo, outDir: join(tmp, 'no-stub'), log: quiet }),
    e => e.errors?.some(x => x.startsWith('[Home]')),
  );
  const missing = writeConfig('missing-file', { routes: [{ match: '**/backend.js', file: 'nope.js' }] });
  await assert.rejects(shoot({ configPath: missing, srcDir: demo, outDir: join(tmp, 'x'), log: quiet }), /Route file not found/);
});

test('write-boards updates the canvas index and writes only changed artboards', () => {
  const root = join(tmp, 'canvas');
  mkdirSync(join(root, 'project'), { recursive: true });
  cpSync(join(here, 'fixtures/canvas.json'), join(root, 'project/canvas.json'));
  const manifest = {
    Login: { file: 'Login.png', title: 'Sign in', sha256: 'a'.repeat(64), w: 390, h: 844 },
    Home: { file: 'Home.png', title: 'Notes <home>', sha256: 'b'.repeat(64), w: 390, h: 844 },
    Draft: { file: 'Draft.png', title: 'New note', sha256: 'c'.repeat(64), w: 390, h: 900 },
    Settings: { file: 'Settings.png', title: 'Settings', sha256: 'd'.repeat(64), w: 390, h: 844 },
  };
  const result = writeBoards({
    root, manifest, urls: { Home: '/_blob/home1', Settings: '/_blob/set1' }, sha: '0123456789abcdef',
    page: 'as-built', pageName: 'As-Built', timeZone: 'Europe/London', now: new Date('2026-10-11T07:52:00Z'),
    settings: config,
  });

  assert.deepEqual(result, {
    file_path: 'project/canvas.json',
    files: {
      'project/AsBuilt-Home.dc.html': 'project/AsBuilt-Home.dc.html',
      'project/AsBuilt-Settings.dc.html': 'project/AsBuilt-Settings.dc.html',
      'project/AsBuilt-Old.dc.html': null,
    },
  });
  const canvas = JSON.parse(readFileSync(join(root, 'project/canvas.json'), 'utf8'));
  assert.deepEqual(canvas.boards, {
    'Main.dc.html': { x: 0, y: 0, w: 880, h: 560, page: 'design' },
    'AsBuilt-Login.dc.html': { x: 0, y: 0, w: 390, h: 844, page: 'as-built', title: 'Sign in', frameless: true },
    'AsBuilt-Home.dc.html': { x: 470, y: 0, w: 390, h: 844, page: 'as-built', title: 'Notes <home>' },
    'AsBuilt-Draft.dc.html': { x: 940, y: 0, w: 390, h: 900, page: 'as-built', title: 'New note' },
    'AsBuilt-Settings.dc.html': { x: 0, y: 1020, w: 390, h: 844, page: 'as-built', title: 'Settings' },
  });
  assert.deepEqual(canvas.order, ['Main.dc.html', 'AsBuilt-Login.dc.html', 'AsBuilt-Home.dc.html', 'AsBuilt-Draft.dc.html', 'AsBuilt-Settings.dc.html']);
  assert.deepEqual(canvas.pages, [{ id: 'design', name: 'Design' }, { id: 'as-built', name: 'As-Built' }]);
  assert.deepEqual(canvas.somethingElse, { keep: true });
  assert.deepEqual(canvas.notes.flows.text, 'Flows');
  assert.deepEqual(canvas.notes['mirror-status'], {
    x: 0, y: -300, kind: 'title1', maxW: 1330, page: 'as-built',
    text: 'As-Built · main @ 0123456 · 11 Oct 2026, 08:52 BST',
  });
  assert.equal(canvas.notes['mirror-settings'].x, 1450);
  assert.equal(canvas.notes['mirror-settings'].text, settingsText(config, 'As-Built'));
  assert.match(canvas.notes['mirror-settings'].text, /daily \+ after merges \(07:52\)/);

  const home = readFileSync(join(root, 'project/AsBuilt-Home.dc.html'), 'utf8');
  assert.equal(home, artboardHtml({ title: 'Notes <home>', w: 390, h: 844, url: '/_blob/home1', sha256: 'b'.repeat(64), background: '#1d4b57' }));
  assert.ok(home.includes('<script src="./support.js"></script>'));
  assert.ok(home.includes('<title>Live · Notes &lt;home&gt;</title>'));
  assert.ok(home.includes(`data-shot="${'b'.repeat(64)}"`));
  assert.ok(home.includes(`data-props='{&quot;$preview&quot;:{&quot;width&quot;:390,&quot;height&quot;:844}}'`));
  assert.ok(!existsSync(join(root, 'project/AsBuilt-Login.dc.html')), 'unchanged screens are not rewritten');
});

test('plan finds changed, added and removed screens and estimates the cost', () => {
  const root = join(tmp, 'plan');
  mkdirSync(join(root, 'project'), { recursive: true });
  cpSync(join(here, 'fixtures/canvas.json'), join(root, 'project/canvas.json'));
  const m = (sha256, title) => ({ file: 'x.png', title, sha256, w: 390, h: 844 });
  const manifest = { Login: m('a'.repeat(64), 'Sign in'), Home: m('b'.repeat(64), 'Notes') };
  // First build: nothing on the page yet that matches
  writeFileSync(join(root, 'project/AsBuilt-Login.dc.html'),
    artboardHtml({ title: 'Sign in', w: 390, h: 844, url: '/_blob/oldlogin', sha256: 'f'.repeat(64), background: '#000' }));
  let p = plan({ root, sha: 'abcdef1234', manifest, page: 'as-built' });
  assert.equal(p.upToDate, false);
  assert.deepEqual(p.changed, ['Login', 'Home']);
  assert.deepEqual(p.added, ['Home']);
  assert.deepEqual(p.removed, ['Old']);
  assert.deepEqual(p.oldAssets, { Login: 'oldlogin' });
  assert.equal(p.estimate, 10000 + 2 * 4000 + 20000);

  // After building: same images on a new commit → title-only refresh
  writeBoards({ root, manifest, urls: { Login: '/_blob/l2', Home: '/_blob/h2' }, sha: 'abcdef1234', page: 'as-built' });
  p = plan({ root, sha: 'abcdef1234', manifest, page: 'as-built' });
  assert.equal(p.upToDate, true);
  assert.deepEqual(p.changed, []);
  p = plan({ root, sha: '9999999aaa', manifest, page: 'as-built', firstTime: true });
  assert.equal(p.upToDate, false);
  assert.equal(p.titleOnly, true);
  assert.equal(p.estimate, 10000 + 30000);
  assert.deepEqual(plan({ root, sha: 'abcdef1234ffff' }), { upToDate: true, shownSha: 'abcdef1' });
});

test('the template and the Moodies example are valid configs', () => {
  for (const f of ['../templates/as-built.config.example.json', '../examples/moodies/.claude/as-built/config.json']) {
    const c = JSON.parse(readFileSync(join(here, f), 'utf8'));
    assert.ok(c.app.static || (c.app.start && c.app.url), f);
    assert.ok(c.screens.length > 0, f);
    for (const s of c.screens) assert.match(s.name, /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/, f);
    assert.ok(c.settings.autoBuildLimit > 0, f);
    assert.match(c.canvas, /<.*>/, `${f} must keep a placeholder canvas link`);
  }
});

test('cleanup', () => rmSync(tmp, { recursive: true, force: true }));
