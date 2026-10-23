/**
 * ==============================================================================
 * ANALYTICS & TELEMETRY SERVICE (Pet Amor)
 * ==============================================================================
 * Camada especializada em telemetria ética, integridade estatística e métricas:
 * 1. De-duplicação rigorosa de visualizações por sessão/navegador (anti-inflation)
 * 2. Normalização de datas UTC para evitar anomalias de fuso horário brasileiro
 * 3. Prevenção absoluta de divisão por zero (safe conversion rate)
 * 4. Zero vazamento de memória em cálculos de séries temporais
 * ==============================================================================
 */

import { supabase } from '../supabase.js';
import { CONFIG } from '../core-config.js';

export const AnalyticsService = {
  getClient() {
    return (typeof window !== 'undefined' && window.__supabaseClient) ? window.__supabaseClient : supabase;
  },

  /**
   * Registra visualização de publicação com de-duplicação por sessão.
   * Evita inflar métricas se o usuário recarregar ou navegar repetidas vezes.
   * @param {string} postId - UUID da publicação
   * @returns {Promise<boolean>} True se a visualização foi contabilizada como inédita nesta sessão
   */
  async trackPostView(postId) {
    if (!postId || typeof window === 'undefined') return false;

    try {
      const storageKey = CONFIG.STORAGE_KEYS.analyticsSession;
      let viewedPosts = [];
      try {
        const stored = sessionStorage.getItem(storageKey);
        if (stored) viewedPosts = JSON.parse(stored);
      } catch (_) {}

      // Se já visualizou este post na sessão atual, não incrementa
      if (Array.isArray(viewedPosts) && viewedPosts.includes(postId)) {
        return false;
      }

      // Adiciona à lista da sessão
      viewedPosts.push(postId);
      sessionStorage.setItem(storageKey, JSON.stringify(viewedPosts));

      // Dispara incremento no backend se configurado ou se a tabela existir
      // Chamada fire-and-forget segura
      const client = this.getClient();
      if (client?.rpc) {
        client.rpc('increment_post_views', { p_post_id: postId }).catch(() => {});
      }
      return true;
    } catch (err) {
      console.warn('[AnalyticsService.trackPostView] Falha silenciosa de telemetria:', err);
      return false;
    }
  },

  /**
   * Calcula taxa de conversão segura (protegida contra divisão por zero)
   * @param {number} conversions - Total de adoções / contatos
   * @param {number} views - Total de visualizações / visitas
   * @returns {string} Percentual formatado (ex: "14.2%" ou "0.0%")
   */
  calculateConversionRate(conversions = 0, views = 0) {
    const safeConversions = Number(conversions) || 0;
    const safeViews = Number(views) || 0;

    if (safeViews <= 0 || safeConversions < 0) {
      return '0.0%';
    }

    const rate = (safeConversions / safeViews) * 100;
    return `${rate.toFixed(1)}%`;
  },

  /**
   * Normaliza timestamp ISO UTC para chave de data no formato YYYY-MM-DD
   * Evita bugs de corte em fusos horários locais ao agrupar métricas
   * @param {string|Date} dateInput
   * @returns {string} Data no formato YYYY-MM-DD
   */
  normalizeUTCDateKey(dateInput) {
    if (!dateInput) return new Date().toISOString().slice(0, 10);
    const date = new Date(dateInput);
    if (isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
    return date.toISOString().slice(0, 10);
  },

  /**
   * Obtém resumo consolidado de métricas para a tela de Analytics Administrativa
   */
  async getDashboardMetrics() {
    const client = this.getClient();

    try {
      const [postsRes, usersRes, bansRes, pendingRes, adoptedRes] = await Promise.all([
        client.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        client.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        client.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'banned'),
        client.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        client.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'adopted')
      ]);

      const activePosts = postsRes.count ?? 0;
      const activeUsers = usersRes.count ?? 0;
      const bannedUsers = bansRes.count ?? 0;
      const pendingPosts = pendingRes.count ?? 0;
      const adoptedPosts = adoptedRes.count ?? 0;
      const totalPosts = activePosts + adoptedPosts + pendingPosts;

      const adoptionSuccessRate = this.calculateConversionRate(adoptedPosts, totalPosts);

      return {
        activePosts,
        activeUsers,
        bannedUsers,
        pendingPosts,
        adoptedPosts,
        totalPosts,
        adoptionSuccessRate,
        timestamp: new Date().toISOString()
      };
    } catch (err) {
      console.error('[AnalyticsService.getDashboardMetrics] Erro:', err);
      return {
        activePosts: 0,
        activeUsers: 0,
        bannedUsers: 0,
        pendingPosts: 0,
        adoptedPosts: 0,
        totalPosts: 0,
        adoptionSuccessRate: '0.0%',
        timestamp: new Date().toISOString(),
        error: err.message
      };
    }
  }
};
