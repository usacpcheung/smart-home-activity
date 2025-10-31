import { t } from './i18n.js';

const TRANSLATABLE_SELECTOR = '[data-i18n], [data-i18n-html], [data-i18n-attr]';
const DYNAMIC_BLOCK_ATTRIBUTE = 'data-i18n-dynamic';

function isDynamic(element) {
  if (!element || typeof element.hasAttribute !== 'function') {
    return false;
  }
  return element.hasAttribute(DYNAMIC_BLOCK_ATTRIBUTE);
}

function applyText(element, key) {
  if (!key) {
    return;
  }
  const translation = t(key);
  if (element.tagName === 'TITLE') {
    element.textContent = translation;
    if (typeof document !== 'undefined') {
      document.title = translation;
    }
    return;
  }
  element.textContent = translation;
}

function applyHtml(element, key) {
  if (!key) {
    return false;
  }
  element.innerHTML = t(key);
  return true;
}

function applyAttributes(element, mapping) {
  if (!mapping) {
    return;
  }

  mapping.split(';').map(entry => entry.trim()).filter(Boolean).forEach(entry => {
    const separatorIndex = entry.indexOf(':');
    if (separatorIndex === -1) {
      return;
    }
    const attribute = entry.slice(0, separatorIndex).trim();
    const key = entry.slice(separatorIndex + 1).trim();
    if (!attribute || !key) {
      return;
    }
    const value = t(key);
    element.setAttribute(attribute, value);
  });
}

function translateElement(element) {
  if (isDynamic(element)) {
    return;
  }
  const htmlKey = element.getAttribute('data-i18n-html');
  const textApplied = applyHtml(element, htmlKey);
  if (!textApplied) {
    const textKey = element.getAttribute('data-i18n');
    applyText(element, textKey);
  }
  const attrMap = element.getAttribute('data-i18n-attr');
  applyAttributes(element, attrMap);
}

export function applyTranslations(root = document) {
  if (!root) {
    return;
  }

  const scope = root;
  const elements = typeof scope.querySelectorAll === 'function'
    ? scope.querySelectorAll(TRANSLATABLE_SELECTOR)
    : [];

  if (scope instanceof Element || scope instanceof DocumentFragment) {
    if (scope.matches && scope.matches(TRANSLATABLE_SELECTOR)) {
      translateElement(scope);
    }
  }

  elements.forEach(element => {
    translateElement(element);
  });
}
