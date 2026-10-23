/**
 * ==============================================================================
 * POST SERVICE & REPOSITORY LAYER (Pet Amor)
 * ==============================================================================
 * Padrão Repository e Service Layer para gerenciamento desacoplado de publicações:
 * 1. Paginação eficiente (Range / Cursor)
 * 2. Cache em memória para consultas repetidas
 * 3. Sanitização e validação de parâmetros de entrada
 * 4. Isolamento contra dependência direta do SDK em controladores de UI
 * ==============================================================================
 */

import { supabase } from '../supabase.js';
import { CONFIG } from '../core-config.js';

// Cache em memória com TTL de 60 segundos
class PostCache {
  constructor(ttlMs = 60000) {
    this.ttlMs = ttlMs;
    this.store = new Map();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    this.store.set(key, { value, timestamp: Date.now() });
  }

  invalidate(key) {
    if (key) {
      this.store.delete(key);
    } else {
      this.store.clear();
    }
  }
}

const postMemoryCache = new PostCache();

export const PostService = {
  /**
   * Obtém o cliente Supabase padronizado
   */
  getClient() {
    return (typeof window !== 'undefined' && window.__supabaseClient) ? window.__supabaseClient : supabase;
  },

  /**
   * Busca publicações do feed com paginação eficiente e filtros indexados
   */
  async fetchFeed({ animalType = '', state = '', city = '', supportType = '', page = 0, limit = CONFIG.FEED_PAGE_SIZE } = {}) {
    const client = this.getClient();
    const cacheKey = `feed_${animalType}_${state}_${city}_${supportType}_p${page}_l${limit}`;
    const cached = postMemoryCache.get(cacheKey);
    if (cached) return cached;

    const fromIndex = page * limit;
    const toIndex = fromIndex + limit - 1;

    let query = client
      .from('posts')
      .select('id, title, description, animal_type, breed, city, state, image_urls, support_type, status, created_at, user_id, profiles(full_name, avatar_url)', { count: 'exact' })
      .in('status', ['active', 'in_process'])
      .order('created_at', { ascending: false })
      .range(fromIndex, toIndex);

    if (animalType && animalType !== 'todos') {
      query = query.eq('animal_type', animalType);
    }
    if (state) {
      query = query.eq('state', state);
    }
    if (city) {
      query = query.ilike('city', `%${city.trim()}%`);
    }
    if (supportType && supportType !== 'todos') {
      query = query.eq('support_type', supportType);
    }

    const { data, count, error } = await query;
    if (error) {
      console.error('[PostService.fetchFeed] Erro na consulta:', error);
      throw error;
    }

    const result = {
      posts: data || [],
      totalCount: count ?? 0,
      page,
      hasMore: (data?.length || 0) === limit && (fromIndex + limit) < (count ?? 0)
    };

    postMemoryCache.set(cacheKey, result);
    return result;
  },

  /**
   * Busca uma única publicação por ID (com cache)
   */
  async getPostById(postId) {
    if (!postId) return null;
    const cacheKey = `post_${postId}`;
    const cached = postMemoryCache.get(cacheKey);
    if (cached) return cached;

    const client = this.getClient();
    const { data, error } = await client
      .from('posts')
      .select('*, profiles(id, full_name, email, username, phone, instagram, avatar_url)')
      .eq('id', postId)
      .single();

    if (error) {
      console.warn(`[PostService.getPostById] Falha ao buscar post ${postId}:`, error.message);
      return null;
    }

    postMemoryCache.set(cacheKey, data);
    return data;
  },

  /**
   * Busca publicações do usuário autenticado
   */
  async fetchUserPosts(userId) {
    if (!userId) return [];
    const client = this.getClient();
    const { data, error } = await client
      .from('posts')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[PostService.fetchUserPosts] Erro:', error);
      throw error;
    }
    return data || [];
  },

  /**
   * Busca publicações pendentes de aprovação administrativa
   */
  async fetchPendingPosts() {
    const client = this.getClient();
    const { data, error } = await client
      .from('posts')
      .select('*, profiles(full_name, email, username)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[PostService.fetchPendingPosts] Erro:', error);
      throw error;
    }
    return data || [];
  },

  /**
   * Invalida caches do repositório (após inserção, atualização ou exclusão)
   */
  invalidateCache() {
    postMemoryCache.invalidate();
  }
};
