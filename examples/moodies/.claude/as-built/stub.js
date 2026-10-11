// As-Built sample-data stub for a Moodies-style app (sanitised example).
// The app loads its backend SDK from a CDN; As-Built routes that URL here, so screenshots use this
// module instead: fake sign-in, fixed sample data, no network. It must answer EVERY call the app makes,
// or shoot.mjs fails loudly. When the app starts using a new call, add it here.

const people = [
  { id: 'p1', name: 'Sam' },
  { id: 'p2', name: 'Alex' },
];

const entries = [
  { id: 'e1', person_id: 'p1', mood: 'calm', note: 'Walk by the river', created_at: '2026-10-10T08:15:00Z' },
  { id: 'e2', person_id: 'p2', mood: 'busy', note: 'Deadline day', created_at: '2026-10-09T17:40:00Z' },
  { id: 'e3', person_id: 'p1', mood: 'happy', note: 'Pancakes', created_at: '2026-10-08T09:05:00Z' },
];

const tables = { people, entries };
const user = { id: 'u-demo', email: 'demo@example.invalid' };

// Minimal query builder: from(table).select().eq().order().limit() → { data, error }
function query(table) {
  let rows = [...(tables[table] || [])];
  const q = {
    select: () => q,
    eq: (col, val) => { rows = rows.filter(r => r[col] === val); return q; },
    order: (col, { ascending = true } = {}) => {
      rows.sort((a, b) => (a[col] < b[col] ? -1 : 1) * (ascending ? 1 : -1)); return q;
    },
    limit: n => { rows = rows.slice(0, n); return q; },
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => q,
    delete: () => q,
    single: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
    then: (ok, fail) => Promise.resolve({ data: rows, error: null }).then(ok, fail),
  };
  return q;
}

export function createClient() {
  const signedIn = () => window.__signedIn !== false;
  return {
    from: query,
    auth: {
      getSession: async () => ({ data: { session: signedIn() ? { user } : null }, error: null }),
      getUser: async () => ({ data: { user: signedIn() ? user : null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signInWithOtp: async () => ({ data: {}, error: null }),
      signOut: async () => ({ error: null }),
    },
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  };
}
