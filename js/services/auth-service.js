/**
 * ==============================================================================
 * AUTHENTICATION & ACCESS CONTROL SERVICE (Pet Amor)
 * ==============================================================================
 * Camada de autenticação segura, sessão e controle de privilégios (RBAC):
 * 1. Cache temporário de verificação de privilégio de administrador
 * 2. Validação estrita de credenciais e sanitização de dados
 * 3. Sanitização pós-OAuth para impedir vazamento de fragmentos de token
 * ==============================================================================
 */

import { supabase } from '../supabase.js';
import { CONFIG } from '../core-config.js';

let cachedAdminStatus = null;
let cachedAdminTimestamp = 0;
const ADMIN_CACHE_TTL_MS = 30000; // 30 segundos de cache

export const AuthService = {
  getClient() {
    return (typeof window !== 'undefined' && window.__supabaseClient) ? window.__supabaseClient : supabase;
  },

  /**
   * Obtém a sessão do usuário salva localmente
   */
  getSession() {
    if (typeof window === 'undefined') return null;
    try {
      const data = localStorage.getItem(CONFIG.STORAGE_KEYS.session);
      return data ? JSON.parse(data) : null;
    } catch (_) {
      return null;
    }
  },

  /**
   * Grava a sessão localmente
   */
  setSession(session) {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(CONFIG.STORAGE_KEYS.session, JSON.stringify(session));
      cachedAdminStatus = null; // Reseta cache de admin na troca de sessão
    } catch (err) {
      console.warn('[AuthService.setSession] Falha ao persistir sessão:', err);
    }
  },

  /**
   * Limpa a sessão local e invalida caches
   */
  clearSession() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(CONFIG.STORAGE_KEYS.session);
      cachedAdminStatus = null;
      cachedAdminTimestamp = 0;
    } catch (_) {}
  },

  /**
   * Verifica se o usuário atual tem privilégios de administrador (com cache inteligente)
   */
  async isCurrentUserAdmin() {
    const now = Date.now();
    if (cachedAdminStatus !== null && (now - cachedAdminTimestamp < ADMIN_CACHE_TTL_MS)) {
      return cachedAdminStatus;
    }

    try {
      const client = this.getClient();
      const { data: authData } = await client.auth.getUser();
      if (!authData?.user) {
        cachedAdminStatus = false;
        cachedAdminTimestamp = now;
        return false;
      }

      const { data: profile, error } = await client
        .from('profiles')
        .select('role, status')
        .eq('id', authData.user.id)
        .single();

      if (error || !profile) {
        cachedAdminStatus = false;
      } else {
        cachedAdminStatus = (profile.role === 'admin' && profile.status === 'active');
      }

      cachedAdminTimestamp = now;
      return cachedAdminStatus;
    } catch (err) {
      console.warn('[AuthService.isCurrentUserAdmin] Erro na verificação:', err);
      cachedAdminStatus = false;
      return false;
    }
  },

  /**
   * Busca perfil detalhado por User ID
   */
  async fetchProfile(userId) {
    if (!userId) return null;
    try {
      const client = this.getClient();
      const { data, error } = await client
        .from('profiles')
        .select('id, full_name, email, username, birth_date, avatar_url, role, status, favorite_posts')
        .eq('id', userId)
        .single();

      if (error) {
        console.warn(`[AuthService.fetchProfile] Falha ao buscar perfil ${userId}:`, error.message);
        return null;
      }
      return data;
    } catch (err) {
      console.error('[AuthService.fetchProfile] Exceção:', err);
      return null;
    }
  },

  /**
   * Limpa parâmetros sensíveis da URL após retorno de fluxo OAuth (anti-leak no Referer)
   */
  cleanupAuthUrlParams() {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    let modified = false;

    // Remove hash com access_token se existir
    if (window.location.hash && window.location.hash.includes('access_token')) {
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
      modified = true;
    }

    // Remove parâmetros sensíveis da query string
    ['code', 'state', 'error', 'error_description'].forEach((param) => {
      if (url.searchParams.has(param)) {
        url.searchParams.delete(param);
        modified = true;
      }
    });

    if (modified) {
      window.history.replaceState(null, '', url.pathname + (url.search ? url.search : ''));
    }
  }
};
