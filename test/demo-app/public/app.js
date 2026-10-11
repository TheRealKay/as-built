// Tiny demo app for As-Built's tests. It uses the clock, Math.random, an animation and a
// "backend" call (stubbed by the config), so identical screenshots prove the determinism works.
import { listNotes } from '/backend.js';

const app = document.getElementById('app');

function login() {
  app.innerHTML = `
    <h1>Demo Notes</h1>
    <p class="muted">Today is ${new Date().toDateString()}</p>
    <button id="signin" class="fade">Sign in</button>`;
  document.getElementById('signin').onclick = () => { window.__signedIn = true; home(); };
}

async function home() {
  const notes = await listNotes();
  const lucky = Math.floor(Math.random() * 100);
  app.innerHTML = `
    <h1>Your notes</h1>
    <p class="muted">${new Date().toLocaleString()} · lucky number ${lucky}</p>
    ${notes.map(n => `<div class="card"><strong>${n.title}</strong><div class="muted">${n.body}</div></div>`).join('')}
    <button id="add">New note</button>`;
  document.getElementById('add').onclick = () => {
    app.insertAdjacentHTML('beforeend', '<div class="card" id="draft"><strong>Untitled</strong></div>');
  };
}

// Like Moodies' account menu: the menu only opens once a service worker is ready.
function menuPage() {
  app.innerHTML = `<h1>Account</h1><button id="menu-btn">Menu</button>`;
  document.getElementById('menu-btn').onclick = async () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    await navigator.serviceWorker.ready;
    app.insertAdjacentHTML('beforeend', '<div class="card" id="menu"><strong>Settings</strong><div class="muted">Sign out</div></div>');
  };
}

if (location.pathname === '/menu') menuPage();
else window.__signedIn ? home() : login();
