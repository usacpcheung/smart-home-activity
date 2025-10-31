import { appendLocaleToUrl } from './locale-preferences.js';

function isSelectElement(element) {
  return typeof HTMLSelectElement !== 'undefined' && element instanceof HTMLSelectElement;
}

function isAnchorElement(element) {
  return typeof HTMLAnchorElement !== 'undefined' && element instanceof HTMLAnchorElement;
}

export function populateLocaleOptions(selectElement, locales) {
  if (typeof document === 'undefined' || !isSelectElement(selectElement)) {
    return;
  }
  const uniqueLocales = Array.isArray(locales) ? Array.from(new Set(locales.filter(Boolean))) : [];
  selectElement.innerHTML = '';
  uniqueLocales.forEach((locale) => {
    const option = document.createElement('option');
    option.value = locale;
    option.dataset.i18n = `common.locale.names.${locale}`;
    option.textContent = locale;
    selectElement.appendChild(option);
  });
}

export function syncLocaleSelector(selectElement, locale) {
  if (!isSelectElement(selectElement) || !locale) {
    return;
  }
  if (selectElement.value !== locale) {
    selectElement.value = locale;
  }
}

export function updateLocaleLinks(root, locale) {
  if (!root || !locale) {
    return;
  }
  const anchors = root.querySelectorAll('[data-preserve-locale]');
  anchors.forEach((anchor) => {
    if (!isAnchorElement(anchor)) {
      return;
    }
    const href = anchor.getAttribute('href');
    if (!href) {
      return;
    }
    anchor.setAttribute('href', appendLocaleToUrl(href, locale));
  });
}
