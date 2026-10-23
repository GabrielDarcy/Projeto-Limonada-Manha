/**
 * ==============================================================================
 * COOKIE CONSENT v3 & GOOGLE CONSENT MODE v2 (Pet Amor)
 * ==============================================================================
 * Em conformidade estrita com a LGPD (Lei 13.709/2018) e GDPR:
 * 1. Inicializa Google Consent Mode v2 com 'denied' por padrão
 * 2. Bloqueia scripts de rastreamento e ads até consentimento explícito
 * 3. Banner leve, acessível (WAI-ARIA) e estilizado no padrão visual do Pet Amor
 * ==============================================================================
 */

import { CONFIG } from '../core-config.js';

// Inicialização segura do Google Consent Mode v2 (Gtag fallback)
(function initGoogleConsentDefaults() {
  if (typeof window === 'undefined') return;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () {
    window.dataLayer.push(arguments);
  };

  // Estado padrão: estritamente negado até escolha do usuário
  window.__petamorConsentState = {
    analytics_storage: 'denied',
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied'
  };

  window.gtag('consent', 'default', {
    ...window.__petamorConsentState,
    wait_for_update: 500
  });
})();

export const CookieConsent = {
  init() {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const savedConsent = this.getSavedConsent();
    if (savedConsent) {
      this.applyConsent(savedConsent);
      return;
    }

    // Exibe banner se não houver preferência registrada
    this.renderBanner();
  },

  getSavedConsent() {
    try {
      const data = localStorage.getItem(CONFIG.STORAGE_KEYS.cookieConsent);
      return data ? JSON.parse(data) : null;
    } catch (_) {
      return null;
    }
  },

  saveConsent(consentObj) {
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.cookieConsent, JSON.stringify(consentObj));
    } catch (_) {}
  },

  applyConsent(consentObj) {
    window.__petamorConsentState = consentObj;
    if (typeof window.gtag === 'function') {
      window.gtag('consent', 'update', consentObj);
    }

    // Notifica ad-slots caso precisem ser renderizados
    const event = new CustomEvent('petamor:consent-updated', { detail: consentObj });
    window.dispatchEvent(event);
  },

  renderBanner() {
    if (document.getElementById('petamorCookieBanner')) return;

    const banner = document.createElement('aside');
    banner.id = 'petamorCookieBanner';
    banner.setAttribute('role', 'region');
    banner.setAttribute('aria-label', 'Preferências de cookies e privacidade');
    banner.style.cssText = `
      position: fixed;
      bottom: 20px;
      left: 20px;
      right: 20px;
      max-width: 540px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #fed7aa;
      border-radius: 14px;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
      padding: 18px 20px;
      z-index: 99999;
      font-family: 'Manrope', system-ui, -apple-system, sans-serif;
      color: #1e293b;
      display: flex;
      flex-direction: column;
      gap: 12px;
      animation: petamorSlideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1);
    `;

    banner.innerHTML = `
      <div style="display:flex; align-items:flex-start; gap:12px;">
        <span style="font-size:1.5rem; line-height:1;" aria-hidden="true">🍪</span>
        <div style="flex:1;">
          <h2 style="font-size:0.95rem; font-weight:700; margin:0 0 4px; color:#0f172a;">Sua privacidade é nossa prioridade</h2>
          <p style="font-size:0.82rem; margin:0; line-height:1.45; color:#64748b;">
            Utilizamos cookies essenciais para autenticação e segurança. Com sua permissão, também coletamos métricas de desempenho para salvar mais vidas e melhorar o Pet Amor. Veja nossos 
            <a href="termos.html" style="color:#ea580c; text-decoration:underline; font-weight:600;" target="_blank" rel="noopener">Termos e Privacidade</a>.
          </p>
        </div>
      </div>
      <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
        <button id="btnRejectCookies" type="button" style="
          background:#f1f5f9; color:#475569; border:none; padding:8px 14px; border-radius:8px;
          font-size:0.8rem; font-weight:600; cursor:pointer; transition:background 0.2s;
        ">Apenas essenciais</button>
        <button id="btnAcceptCookies" type="button" style="
          background:#ea580c; color:#ffffff; border:none; padding:8px 16px; border-radius:8px;
          font-size:0.8rem; font-weight:700; cursor:pointer; transition:background 0.2s; box-shadow: 0 2px 4px rgba(234, 88, 12, 0.2);
        ">Aceitar todos</button>
      </div>
    `;

    document.body.appendChild(banner);

    // Eventos
    document.getElementById('btnAcceptCookies')?.addEventListener('click', () => {
      const consent = {
        analytics_storage: 'granted',
        ad_storage: 'granted',
        ad_user_data: 'granted',
        ad_personalization: 'granted'
      };
      this.saveConsent(consent);
      this.applyConsent(consent);
      banner.remove();
    });

    document.getElementById('btnRejectCookies')?.addEventListener('click', () => {
      const consent = {
        analytics_storage: 'denied',
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied'
      };
      this.saveConsent(consent);
      this.applyConsent(consent);
      banner.remove();
    });
  }
};
