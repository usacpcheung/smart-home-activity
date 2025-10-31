const cache = new Map();
const inFlight = new Map();

let config = {
  defaultLocale: 'en',
  fallbackLocale: null,
  availableLocales: []
};

let currentLocale = null;
let currentCatalog = {};
let localeReadyPromise = Promise.resolve();
const localeListeners = new Set();

function notifyLocaleChange(locale, catalog) {
  localeListeners.forEach(listener => {
    if (typeof listener !== 'function') {
      return;
    }
    try {
      listener({ locale, catalog });
    } catch (error) {
      console.error('Locale change listener failed', error);
    }
  });
}

async function fetchCatalog(locale) {
  if (!locale) {
    throw new Error('Locale is required to fetch a catalog');
  }

  if (cache.has(locale)) {
    return cache.get(locale);
  }

  if (inFlight.has(locale)) {
    return inFlight.get(locale);
  }

  const fetchPromise = fetch(`i18n/${locale}.json`).then(response => {
    if (!response.ok) {
      throw new Error(`Failed to load locale "${locale}" (${response.status})`);
    }
    return response.json();
  }).then(data => {
    cache.set(locale, data);
    inFlight.delete(locale);
    return data;
  }).catch(error => {
    inFlight.delete(locale);
    throw error;
  });

  inFlight.set(locale, fetchPromise);
  return fetchPromise;
}

async function ensureDefaultCatalogLoaded() {
  const { defaultLocale } = config;
  if (!defaultLocale || cache.has(defaultLocale)) {
    return;
  }

  await fetchCatalog(defaultLocale);
}

function resolveKey(catalog, keyParts) {
  return keyParts.reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), catalog);
}

function interpolate(template, params = {}) {
  if (typeof template !== 'string') {
    return template;
  }

  return template.replace(/\{([^}]+)\}/g, (match, token) => {
    return Object.prototype.hasOwnProperty.call(params, token) ? params[token] : match;
  });
}

export function initI18n({ defaultLocale, fallbackLocale, availableLocales } = {}) {
  config = {
    defaultLocale: defaultLocale || config.defaultLocale,
    fallbackLocale: fallbackLocale || defaultLocale || config.defaultLocale,
    availableLocales: Array.isArray(availableLocales) ? availableLocales.slice() : (availableLocales ? [availableLocales] : [])
  };

  const uniqueLocales = new Set(config.availableLocales);
  if (config.defaultLocale) {
    uniqueLocales.add(config.defaultLocale);
  }
  if (config.fallbackLocale) {
    uniqueLocales.add(config.fallbackLocale);
  }
  config.availableLocales = [...uniqueLocales];

  const initialLocale = config.defaultLocale;
  const initialLoad = loadLocale(initialLocale);
  localeReadyPromise = initialLoad.then(() => undefined);
  return initialLoad;
}

export async function loadLocale(locale) {
  const requestedLocale = locale || config.defaultLocale;

  const loadSequence = (async () => {
    let targetLocale = requestedLocale;

    if (config.availableLocales.length && !config.availableLocales.includes(targetLocale)) {
      console.warn(`Locale "${targetLocale}" is not listed as available. Attempting to load regardless.`);
    }

    await ensureDefaultCatalogLoaded();

    let catalog;
    try {
      catalog = await fetchCatalog(targetLocale);
    } catch (error) {
      const { fallbackLocale, defaultLocale } = config;
      if (fallbackLocale && targetLocale !== fallbackLocale) {
        try {
          catalog = await fetchCatalog(fallbackLocale);
          targetLocale = fallbackLocale;
        } catch (fallbackError) {
          if (defaultLocale && fallbackLocale !== defaultLocale) {
            catalog = await fetchCatalog(defaultLocale);
            targetLocale = defaultLocale;
          } else {
            throw fallbackError;
          }
        }
      } else if (defaultLocale && targetLocale !== defaultLocale) {
        catalog = await fetchCatalog(defaultLocale);
        targetLocale = defaultLocale;
      } else {
        throw error;
      }
    }

    currentLocale = targetLocale;
    currentCatalog = catalog;

    if (typeof document !== 'undefined' && document.documentElement) {
      document.documentElement.lang = targetLocale;
    }

    notifyLocaleChange(targetLocale, catalog);
    return catalog;
  })();

  localeReadyPromise = loadSequence.then(() => undefined);
  return loadSequence;
}

export function t(key, params) {
  const keyParts = Array.isArray(key) ? key : String(key).split('.');
  let template = resolveKey(currentCatalog, keyParts);

  if (template === undefined && config.defaultLocale) {
    const defaultCatalog = cache.get(config.defaultLocale);
    if (defaultCatalog) {
      template = resolveKey(defaultCatalog, keyParts);
    }
  }

  if (template === undefined) {
    return keyParts.join('.');
  }

  return interpolate(template, params);
}

export function onLocaleReady() {
  return localeReadyPromise;
}

export function getCurrentLocale() {
  return currentLocale;
}

export function getAvailableLocales() {
  return config.availableLocales.length ? [...new Set(config.availableLocales)] : Array.from(cache.keys());
}

export function addLocaleChangeListener(listener) {
  if (typeof listener === 'function') {
    localeListeners.add(listener);
  }
  return () => {
    localeListeners.delete(listener);
  };
}

export function removeLocaleChangeListener(listener) {
  localeListeners.delete(listener);
}
