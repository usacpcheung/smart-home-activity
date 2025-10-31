// Loads the master device catalog (grouped categories)
export async function loadCatalog(url = 'data/catalog/devices.json') {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to load catalog: ' + url);

  const catalog = await res.json();
  const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];

  const normalizedCategories = categories.map(category => {
    const nameKey = category?.nameKey || (category?.id ? `catalog.categories.${category.id}.name` : null);
    const devices = Array.isArray(category?.devices) ? category.devices : [];

    const normalizedDevices = devices.map(device => ({
      ...device,
      nameKey: device?.nameKey || (device?.id ? `catalog.devices.${device.id}.name` : null)
    }));

    return {
      ...category,
      nameKey,
      devices: normalizedDevices
    };
  });

  return {
    ...catalog,
    categories: normalizedCategories
  };
}
