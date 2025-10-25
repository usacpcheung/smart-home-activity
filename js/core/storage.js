const KEY = 'smart-home-activity';

export function saveLocal(name, obj) {
  localStorage.setItem(`${KEY}:${name}`, JSON.stringify(obj));
}
export function loadLocal(name, fallback = null) {
  const raw = localStorage.getItem(`${KEY}:${name}`);
  return raw ? JSON.parse(raw) : fallback;
}
export function downloadJson(obj, filename='scenario.json') {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename; a.click();
  URL.revokeObjectURL(a.href);
}
export async function pickJsonFile(inputEl) {
  return new Promise(res => {
    inputEl.onchange = () => {
      const file = inputEl.files?.[0]; if (!file) return res(null);
      const r = new FileReader();
      r.onload = () => res(JSON.parse(String(r.result)));
      r.readAsText(file);
    };
  });
}
