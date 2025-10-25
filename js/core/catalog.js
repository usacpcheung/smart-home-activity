// Loads the master device catalog (grouped categories)
export async function loadCatalog(url = 'data/catalog/devices.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load catalog: ' + url);
  return res.json();
}
