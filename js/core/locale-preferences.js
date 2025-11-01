const STORAGE_KEY = 'smartHomeActivity.locale';

function isLocaleSupported(locale, availableLocales) {
  if (!locale) {
    return false;
  }
  if (!Array.isArray(availableLocales) || availableLocales.length === 0) {
    return true;
  }
  return availableLocales.includes(locale);
}

export function getStoredLocale() {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Unable to read stored locale preference', error);
    return null;
  }
}

export function setStoredLocale(locale) {
  if (typeof window === 'undefined' || !window.localStorage) {
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, locale);
  } catch (error) {
    console.warn('Unable to persist locale preference', error);
  }
}

export function getLocaleFromQuery(searchString) {
  if (typeof searchString !== 'string' && typeof window !== 'undefined') {
    searchString = window.location.search;
  }
  if (typeof searchString !== 'string' || searchString.length === 0) {
    return null;
  }
  try {
    const params = new URLSearchParams(searchString);
    const locale = params.get('locale');
    return locale || null;
  } catch (error) {
    console.warn('Failed to parse locale from query string', error);
    return null;
  }
}

export function resolveInitialLocale(availableLocales, defaultLocale) {
  const normalizedDefault = defaultLocale || null;
  const normalizedAvailable = Array.isArray(availableLocales) && availableLocales.length > 0
    ? availableLocales
    : (normalizedDefault ? [normalizedDefault] : []);

  const fromQuery = getLocaleFromQuery();
  if (isLocaleSupported(fromQuery, normalizedAvailable)) {
    return fromQuery;
  }

  const stored = getStoredLocale();
  if (isLocaleSupported(stored, normalizedAvailable)) {
    return stored;
  }

  if (normalizedDefault && isLocaleSupported(normalizedDefault, normalizedAvailable)) {
    return normalizedDefault;
  }

  return normalizedAvailable.length > 0 ? normalizedAvailable[0] : normalizedDefault;
}

export function appendLocaleToUrl(url, locale) {
  if (!url || !locale) {
    return url;
  }

  let baseHref = 'http://localhost/';
  if (typeof window !== 'undefined' && window.location) {
    const { href, origin, pathname } = window.location;
    baseHref = href || `${origin || 'http://localhost'}${pathname || '/'}`;
  }

  try {
    const urlObject = new URL(url, baseHref);
    urlObject.searchParams.set('locale', locale);

    const isAbsolute = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url);
    if (isAbsolute) {
      return urlObject.toString();
    }
    return `${urlObject.pathname}${urlObject.search}${urlObject.hash}`;
  } catch (error) {
    console.warn('Failed to append locale to URL', error);
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}locale=${encodeURIComponent(locale)}`;
  }
}

export function updateDocumentLocaleParam(locale) {
  if (typeof window === 'undefined' || !window.history || typeof window.history.replaceState !== 'function') {
    return;
  }
  try {
    const url = new URL(window.location.href);
    if (locale) {
      url.searchParams.set('locale', locale);
    } else {
      url.searchParams.delete('locale');
    }
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch (error) {
    console.warn('Failed to update document locale parameter', error);
  }
}
