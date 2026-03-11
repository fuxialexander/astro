/**
 * Client-side i18n for the landing page.
 * Depends on window.LANDING_TRANSLATIONS (translations.js). Load after translations.js, before other scripts.
 * Language: ?lang=zh, localStorage 'landing-lang', or 'en'. Persisted on switch.
 */
(function () {
  var STORAGE_KEY = 'landing-lang';
  var DEFAULT_LANG = 'en';
  var SUPPORTED = ['en', 'zh'];

  function getInitialLang() {
    var params = new URLSearchParams(window.location.search);
    var fromUrl = params.get('lang');
    if (fromUrl && SUPPORTED.indexOf(fromUrl) !== -1) return fromUrl;
    try {
      var stored = localStorage.getItem(STORAGE_KEY);
      if (stored && SUPPORTED.indexOf(stored) !== -1) return stored;
    } catch (e) {}
    return DEFAULT_LANG;
  }

  function t(lang, key) {
    var dict = window.LANDING_TRANSLATIONS && window.LANDING_TRANSLATIONS[lang];
    if (!dict) return null;
    return dict[key] != null ? dict[key] : null;
  }

  function applyLang(lang) {
    if (!window.LANDING_TRANSLATIONS || !window.LANDING_TRANSLATIONS[lang]) return;
    document.documentElement.lang = lang === 'zh' ? 'zh-Hans' : lang;

    document.querySelectorAll('[data-i18n]').forEach(function (el) {
      var key = el.getAttribute('data-i18n');
      var value = t(lang, key);
      if (value != null) el.textContent = value;
    });

    document.querySelectorAll('[data-i18n-lang]').forEach(function (btn) {
      var l = btn.getAttribute('data-lang');
      if (l === lang) {
        btn.classList.add('active');
        btn.setAttribute('aria-pressed', 'true');
      } else {
        btn.classList.remove('active');
        btn.setAttribute('aria-pressed', 'false');
      }
      var labelKey = 'lang.' + l;
      var label = t(lang, labelKey) || (l === 'zh' ? '中文' : 'English');
      btn.textContent = l === 'zh' ? '中文' : 'EN';
    });
  }

  function setLandingLang(lang) {
    if (SUPPORTED.indexOf(lang) === -1) return;
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch (e) {}
    window.__landingLang = lang;
    applyLang(lang);
  }

  var initial = getInitialLang();
  window.__landingLang = initial;
  applyLang(initial);

  window.setLandingLang = setLandingLang;

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('[data-i18n-lang]').forEach(function (btn) {
      if (btn._i18nBound) return;
      btn._i18nBound = true;
      btn.addEventListener('click', function () {
        var l = btn.getAttribute('data-lang');
        if (l) setLandingLang(l);
      });
    });
  });
})();
