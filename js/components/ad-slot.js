/**
 * ==============================================================================
 * AD SLOT WEB COMPONENT — ZERO CLS & FEATURE FLAG CONTROLLED (<ad-slot>)
 * ==============================================================================
 * Componente modular para anúncios responsivos com:
 * 1. Controle estrito por Feature Flag (window.ENABLE_ADS = false por padrão)
 *    -> Se desativado: Zero requisições, zero scripts, zero espaço vazio (display: none).
 * 2. Prevenção de Cumulative Layout Shift (CLS)
 *    -> Se ativado: Reserva estática imediata de espaço via aspect-ratio e min-height.
 * 3. Lazy loading via IntersectionObserver a 200px do viewport para máxima performance.
 * 4. Respeito ao Google Consent Mode v2 (ad_storage = granted).
 * ==============================================================================
 */

import { CONFIG } from '../core-config.js';

const AD_SLOT_DIMENSIONS = {
  leaderboard: {
    desktop: { width: 728, height: 90, ratio: '728 / 90', minHeight: '90px', maxWidth: '728px' },
    mobile: { width: 320, height: 50, ratio: '320 / 50', minHeight: '50px', maxWidth: '320px' }
  },
  'in-feed': {
    width: 300, height: 250, ratio: '300 / 250', minHeight: '250px', maxWidth: '300px'
  },
  sidebar: {
    width: 300, height: 600, ratio: '300 / 600', minHeight: '600px', maxWidth: '300px'
  },
  'in-post': {
    width: 336, height: 280, ratio: '336 / 280', minHeight: '280px', maxWidth: '336px'
  }
};

class AdSlotElement extends HTMLElement {
  connectedCallback() {
    this.render();
  }

  isAdsEnabled() {
    return Boolean(
      (typeof window !== 'undefined' && window.ENABLE_ADS) ||
      CONFIG.ENABLE_ADS
    );
  }

  render() {
    // Regra de Ouro: Se a flag estiver desligada, oculta completamente sem ocupar layout
    if (!this.isAdsEnabled()) {
      this.style.display = 'none';
      this.setAttribute('hidden', '');
      this.innerHTML = '';
      return;
    }

    const type = this.getAttribute('type') || 'in-feed';
    const clientSlotId = this.getAttribute('slot-id') || 'placeholder';
    const isMobile = window.innerWidth < 768;

    let dim = AD_SLOT_DIMENSIONS[type] || AD_SLOT_DIMENSIONS['in-feed'];
    if (type === 'leaderboard') {
      dim = isMobile ? dim.mobile : dim.desktop;
    }

    // Configuração de reserva de espaço zero-CLS
    this.removeAttribute('hidden');
    this.style.display = 'flex';
    this.style.justifyContent = 'center';
    this.style.alignItems = 'center';
    this.style.width = '100%';
    this.style.maxWidth = dim.maxWidth;
    this.style.minHeight = dim.minHeight;
    this.style.aspectRatio = dim.ratio;
    this.style.margin = '16px auto';
    this.style.boxSizing = 'border-box';
    this.style.overflow = 'hidden';
    this.style.backgroundColor = '#fafafa';
    this.style.border = '1px dashed #e2e8f0';
    this.style.borderRadius = '8px';

    this.innerHTML = `
      <div class="ad-slot-container" data-slot-status="reserved" style="width:100%; height:100%; display:flex; align-items:center; justify-content:center; color:#94a3b8; font-size:0.75rem; text-transform:uppercase; letter-spacing:0.05em;">
        <span>Publicidade</span>
      </div>
    `;

    // Lazy load do anúncio real via IntersectionObserver a 200px da tela
    this.setupLazyLoad(clientSlotId);
  }

  setupLazyLoad(slotId) {
    if (!('IntersectionObserver' in window)) {
      this.loadAdScript(slotId);
      return;
    }

    const observer = new IntersectionObserver((entries, obs) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          obs.unobserve(this);
          this.loadAdScript(slotId);
        }
      });
    }, {
      rootMargin: '200px 0px 200px 0px' // Pré-carrega a 200px antes do usuário chegar
    });

    observer.observe(this);
  }

  loadAdScript(slotId) {
    // Verifica se consentimento de Ads foi concedido (Google Consent Mode v2)
    const consent = window.__petamorConsentState;
    if (consent && consent.ad_storage !== 'granted') {
      // Consentimento negado: não injeta trackers nem ad tags
      return;
    }

    const container = this.querySelector('.ad-slot-container');
    if (!container || container.getAttribute('data-slot-status') === 'loaded') return;

    container.setAttribute('data-slot-status', 'loaded');
    // Ponto de injeção para script real da rede (ex: (adsbygoogle = window.adsbygoogle || []).push({});)
  }
}

if (typeof customElements !== 'undefined' && !customElements.get('ad-slot')) {
  customElements.define('ad-slot', AdSlotElement);
}

export { AdSlotElement };
