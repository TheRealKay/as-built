// The real backend client. Screenshots never use it: the as-built config routes it to stub.js.
export async function listNotes() {
  const r = await fetch('https://api.example.invalid/notes');
  return r.json();
}
