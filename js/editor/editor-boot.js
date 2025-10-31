import { initI18n, onLocaleReady, addLocaleChangeListener, t, getCurrentLocale, getAvailableLocales, loadLocale } from '../core/i18n.js';
import { applyTranslations } from '../core/i18n-dom.js';
import { I18N_CONFIG } from '../core/i18n-config.js';
import { resolveInitialLocale, setStoredLocale, updateDocumentLocaleParam } from '../core/locale-preferences.js';
import { populateLocaleOptions, syncLocaleSelector, updateLocaleLinks } from '../core/locale-ui.js';

const { defaultLocale, fallbackLocale, availableLocales } = I18N_CONFIG;
const initialLocale = resolveInitialLocale(availableLocales, defaultLocale);
let localeSelect = null;

setStoredLocale(initialLocale);
updateDocumentLocaleParam(initialLocale);

function renderPage() {
  document.title = t('editor.page.title');
  applyTranslations(document);
  const activeLocale = getCurrentLocale() || initialLocale;
  if (localeSelect) {
    syncLocaleSelector(localeSelect, activeLocale);
  }
  updateLocaleLinks(document, activeLocale);
  setStoredLocale(activeLocale);
  updateDocumentLocaleParam(activeLocale);
}

function handleInitError(error) {
  console.error('Failed to initialize localization', error);
}

const initPromise = initI18n({
  defaultLocale: initialLocale,
  fallbackLocale: fallbackLocale || defaultLocale,
  availableLocales
});

initPromise.catch(handleInitError);

function setupLocaleSwitcher() {
  localeSelect = document.querySelector('[data-locale-selector]');
  if (!localeSelect) {
    return;
  }
  populateLocaleOptions(localeSelect, getAvailableLocales());
  localeSelect.addEventListener('change', (event) => {
    const target = event.target;
    const nextLocale = target && typeof target.value === 'string' ? target.value : null;
    if (!nextLocale || nextLocale === getCurrentLocale()) {
      return;
    }
    setStoredLocale(nextLocale);
    updateDocumentLocaleParam(nextLocale);
    updateLocaleLinks(document, nextLocale);
    loadLocale(nextLocale).catch((error) => {
      console.error('Failed to switch locale', error);
    });
  });
}

onLocaleReady()
  .then(() => {
    setupLocaleSwitcher();
    renderPage();
    addLocaleChangeListener(renderPage);
  })
  .catch(error => {
    console.error('Failed to load locale catalog', error);
  });
