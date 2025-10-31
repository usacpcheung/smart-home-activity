import { initI18n, onLocaleReady, addLocaleChangeListener, t } from '../core/i18n.js';
import { applyTranslations } from '../core/i18n-dom.js';

const AVAILABLE_LOCALES = ['en'];

function renderPage() {
  document.title = t('player.page.title');
  applyTranslations(document);
}

function handleInitError(error) {
  console.error('Failed to initialize localization', error);
}

const initPromise = initI18n({
  defaultLocale: 'en',
  fallbackLocale: 'en',
  availableLocales: AVAILABLE_LOCALES
});

initPromise.catch(handleInitError);

onLocaleReady()
  .then(() => {
    renderPage();
    addLocaleChangeListener(renderPage);
  })
  .catch(error => {
    console.error('Failed to load locale catalog', error);
  });
