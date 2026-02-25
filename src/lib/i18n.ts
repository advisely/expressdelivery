import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from '../locales/en.json';
import fr from '../locales/fr.json';
import es from '../locales/es.json';
import de from '../locales/de.json';
import { ipcInvoke } from './ipc';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    fr: { translation: fr },
    es: { translation: es },
    de: { translation: de },
  },
  lng: 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
});

// Load persisted language preference (deferred to avoid racing preload bridge)
const SUPPORTED_LOCALES = ['en', 'fr', 'es', 'de'];
setTimeout(() => {
  ipcInvoke<string | null>('settings:get', 'locale').then(locale => {
    if (locale && SUPPORTED_LOCALES.includes(locale)) {
      i18n.changeLanguage(locale);
    }
  }).catch(() => { /* IPC not ready yet — use default locale */ });
}, 0);

export default i18n;
