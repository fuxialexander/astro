import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import resourcesToBackend from 'i18next-resources-to-backend'

i18n
  .use(LanguageDetector)
  .use(resourcesToBackend((language: string, namespace: string) =>
    import(`../../public/locales/${language}/${namespace}.json`)
  ))
  .use(initReactI18next)
  .init({
    defaultNS: 'common',
    ns: ['common', 'nav', 'settings', 'plan', 'tasks', 'dashboard', 'dialogs', 'auth', 'errors', 'environments', 'projects', 'workflows', 'initiatives', 'community', 'examples'],
    fallbackLng: {
      'zh-CN-wy': ['zh-CN', 'en'],
      default: ['en'],
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'astro-lang',
      caches: ['localStorage'],
    },
    interpolation: {
      escapeValue: false,
    },
    react: {
      useSuspense: true,
    },
  })

// Set document lang attribute on language change (enables CJK font via CSS selector)
// zh-CN-wy maps to zh-CN for the lang attribute so fonts activate for both styles
i18n.on('languageChanged', (lang) => {
  document.documentElement.lang = lang.startsWith('zh') ? 'zh-CN' : lang
})

// Set initial lang on load
if (typeof document !== 'undefined') {
  i18n.on('initialized', () => {
    document.documentElement.lang = i18n.language
  })
}

export default i18n
