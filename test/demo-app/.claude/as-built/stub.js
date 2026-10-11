// Sample data for As-Built screenshots: answers every backend call the demo app makes.
export async function listNotes() {
  return [
    { title: 'Groceries', body: 'Oats, lemons, coffee' },
    { title: 'Ideas', body: 'Paint the shed blue' },
  ];
}
