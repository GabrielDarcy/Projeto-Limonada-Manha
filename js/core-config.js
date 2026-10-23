/**
 * ==============================================================================
 * CONFIGURAÇÕES GLOBAIS E FEATURE FLAGS (Pet Amor Core)
 * ==============================================================================
 * Gerenciamento centralizado de parâmetros operacionais, flags de monetização,
 * chaves de cache e constantes de domínio para alta escalabilidade.
 * ==============================================================================
 */

// Feature Flags Globais (Extensível em runtime)
export const CONFIG = {
  // Flag mestre para monetização com Adsense / Redes Premium
  // Quando false: Zero scripts externos, zero requisições de ad, zero CLS (elementos ocultos)
  ENABLE_ADS: false,

  // Versão de release da aplicação para cache-busting sincronizado
  APP_VERSION: '52',

  // Configurações de paginação e feed
  FEED_PAGE_SIZE: 10,
  MAX_FEED_ITEMS: 100,

  // Limite de taxa client-side (operações por janela em ms)
  RATE_LIMIT_POST_WINDOW_MS: 60000, // 1 minuto
  MAX_POSTS_PER_WINDOW: 3,

  // Timeout para chamadas de rede em milissegundos
  API_TIMEOUT_MS: 15000,

  // Chaves de armazenamento local (LocalStorage / SessionStorage)
  STORAGE_KEYS: {
    users: 'petamor_users',
    ads: 'petamor_ads',
    session: 'petamor_session',
    favorites: 'petamor_favorites',
    cookieConsent: 'petamor_cookie_consent_v3',
    analyticsSession: 'petamor_analytics_session',
    flashToast: 'petamor_flash_toast'
  },

  // Domínios de e-mail seguros permitidos
  ALLOWED_EMAIL_DOMAINS: [
    'gmail.com',
    'outlook.com',
    'hotmail.com',
    'yahoo.com',
    'icloud.com',
    'live.com'
  ],

  // Palavras proibidas no filtro léxico
  BANNED_WORDS: [
    'merda', 'porra', 'caralho', 'puta', 'puto', 'viado', 'vadia',
    'bosta', 'foder', 'fodase', 'desgracado', 'desgracada'
  ],

  DEFAULT_AVATAR_URL: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='%23fff1e4'/%3E%3Cg fill='%23d9611b' opacity='0.55'%3E%3Cellipse cx='48' cy='61' rx='19' ry='15'/%3E%3Cellipse cx='26' cy='40' rx='8' ry='10'/%3E%3Cellipse cx='43' cy='30' rx='8' ry='10.5'/%3E%3Cellipse cx='61' cy='32' rx='8' ry='10.5'/%3E%3Cellipse cx='74' cy='45' rx='7.5' ry='9.5'/%3E%3C/g%3E%3C/svg%3E"
};

// Expõe flag de Ads para controle global seguro
if (typeof window !== 'undefined') {
  window.PETAMOR_CONFIG = CONFIG;
  window.ENABLE_ADS = CONFIG.ENABLE_ADS;
}
