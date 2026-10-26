import { supabase } from './supabase.js';

const STORAGE_KEYS = {
  users: 'petamor_users',
  ads: 'petamor_ads',
  session: 'petamor_session',
  favorites: 'petamor_favorites'
};

const DEFAULT_AVATAR_URL = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 96 96'%3E%3Crect width='96' height='96' fill='%23fff1e4'/%3E%3Cg fill='%23d9611b' opacity='0.55'%3E%3Cellipse cx='48' cy='61' rx='19' ry='15'/%3E%3Cellipse cx='26' cy='40' rx='8' ry='10'/%3E%3Cellipse cx='43' cy='30' rx='8' ry='10.5'/%3E%3Cellipse cx='61' cy='32' rx='8' ry='10.5'/%3E%3Cellipse cx='74' cy='45' rx='7.5' ry='9.5'/%3E%3C/g%3E%3C/svg%3E";

const ALLOWED_EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com'];
const FEED_PAGE_SIZE = 10;
let feedCurrentPage = 0;

window.ENABLE_ADS = false;

// feito ocultacao do ad-slot via display:none porque customElements sem configuracao causavam espaco vazio em tela e resolvemos escondendo quando window.ENABLE_ADS for false
if (typeof customElements !== 'undefined' && !customElements.get('ad-slot')) {
  customElements.define('ad-slot', class extends HTMLElement {
    connectedCallback() {
      if (!window.ENABLE_ADS) {
        this.style.display = 'none';
        this.setAttribute('hidden', '');
      }
    }
  });
}

// feito tratamento defensivo de total <= 0 porque divisao por zero resultava em NaN/Infinity na interface e resolvemos retornando '0.0%'
function calculateConversionRate(conversions = 0, total = 0) {
  const conv = Number(conversions) || 0;
  const tot = Number(total) || 0;
  if (tot <= 0 || conv < 0) return '0.0%';
  return ((conv / tot) * 100).toFixed(1) + '%';
}

// feito deduplicacao em sessionStorage porque pageviews repetidos na mesma sessao inflavam a telemetria e resolvemos checando array local antes da RPC
function trackPostView(postId) {
  if (!postId || typeof window === 'undefined') return;
  try {
    let viewed = [];
    const stored = sessionStorage.getItem('petamor_views');
    if (stored) viewed = JSON.parse(stored);
    if (Array.isArray(viewed) && viewed.includes(postId)) return;
    viewed.push(postId);
    sessionStorage.setItem('petamor_views', JSON.stringify(viewed));
    const client = getSupabaseClient();
    if (client?.rpc) {
      client.rpc('increment_post_views', { p_post_id: postId }).catch(() => {});
    }
  } catch (_) {}
}

function initCookieConsent() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const key = 'petamor_cookies';
  if (localStorage.getItem(key)) return;
  if (document.getElementById('cookieConsentBanner')) return;

  const banner = document.createElement('aside');
  banner.id = 'cookieConsentBanner';
  banner.style.cssText = 'position:fixed;bottom:20px;left:20px;right:20px;max-width:500px;margin:0 auto;background:#fff;border:1px solid #fed7aa;border-radius:12px;box-shadow:0 10px 25px rgba(0,0,0,0.1);padding:16px 20px;z-index:99999;color:#1e293b;';
  banner.innerHTML = '<p style="margin:0 0 10px;font-size:0.88rem;line-height:1.4;">Usamos cookies essenciais para autentica\u00e7\u00e3o e navega\u00e7\u00e3o no site. Veja nossos <a href="termos.html" style="color:#d9611b;text-decoration:underline;">Termos</a>.</p><div style="display:flex;gap:8px;justify-content:flex-end;"><button type="button" id="btnAcceptCookies" style="background:#d9611b;color:#fff;border:none;padding:8px 16px;border-radius:8px;font-size:0.82rem;font-weight:700;cursor:pointer;">Entendi</button></div>';
  document.body.appendChild(banner);
  document.getElementById('btnAcceptCookies')?.addEventListener('click', () => {
    localStorage.setItem(key, 'accepted');
    banner.remove();
  });
}

const BANNED_WORDS = [
  'merda', 'porra', 'caralho', 'puta', 'puto', 'viado', 'vadia', 'bosta', 'foder', 'fodase', 'desgracado', 'desgracada'
];

function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// feito validacao estrita de prefixos de URL porque esquemas como javascript: permitiam DOM XSS e resolvemos aceitando apenas http, https, data ou caminhos relativos
function sanitizeUrl(url) {
  if (!url) return '';
  const trimmed = String(url).trim();
  if (/^(?:https?:\/\/|data:image\/(?:png|jpeg|jpg|webp|gif|svg\+xml)[;,])/i.test(trimmed)) {
    return trimmed;
  }
  if (trimmed.startsWith('/') || trimmed.startsWith('./') || trimmed.startsWith('../')) {
    return trimmed;
  }
  return '';
}

// feito sanitizacao de caracteres especiais porque virgulas e parenteses quebravam a sintaxe de filtro do PostgREST e resolvemos removendo pontuacoes reservadas
function sanitizeFiltroPostgrest(valor) {
  return String(valor || '')
    .normalize('NFC')
    .replace(/[,().:*"'\\%\[\]{}]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(valor) {
  return UUID_REGEX.test(String(valor || '').trim());
}

function ehFalhaDeRede(codigo, texto) {
  return /network|fetch|failed to fetch|timeout|ERR_NAME|ERR_INTERNET/i.test(String(codigo) + String(texto));
}

// feito mapeamento amigavel de erros do Supabase porque mensagens nativas em ingles e tecnicas assustavam o usuario e resolvemos traduzindo codigos para explicacoes claras em portugues
const ERROS_PT = {
  '23505': 'Esse dado já está cadastrado.',
  '23503': 'Esse item está ligado a outro registro e não pode ser alterado agora.',
  '23502': 'Faltou preencher um campo obrigatório.',
  '23514': 'Algum valor está fora do que é permitido.',
  '42501': 'Você não tem permissão para essa ação.',
  '22P02': 'Um dos valores enviados tem formato inválido.',
  '22001': 'O texto enviado é longo demais.',
  'user_already_exists': 'Este e-mail já está cadastrado. Tente entrar ou recuperar a senha.',
  'email_exists': 'Este e-mail já está cadastrado. Tente entrar ou recuperar a senha.',
  'weak_password': 'Sua senha é fraca. Use pelo menos 8 caracteres, com letras e números.',
  'email_address_invalid': 'Informe um e-mail válido.',
  'validation_failed': 'Confira os dados preenchidos e tente de novo.',
  'email_not_confirmed': 'Confirme seu e-mail antes de entrar.',
  'invalid_credentials': 'E-mail ou senha incorretos.',
  'over_email_send_rate_limit': 'Muitos e-mails enviados. Aguarde alguns minutos.',
  'over_request_rate_limit': 'Muitas tentativas. Aguarde alguns minutos.',
  'session_expired': 'Sua sessão expirou. Entre novamente.',
    'refresh_token_not_found': 'Sua sessão expirou. Entre novamente.',
  'email_provider_disabled': 'O cadastro por e-mail está desativado no painel da Supabase. Ative o provedor "Email" em Authentication > Providers no painel da Supabase.',
};

function mensagemDeErroSegura(error, alternativa) {
  const padrao = alternativa || 'Algo deu errado. Tente novamente em instantes.';
  const codigo = String(error?.code || error?.status || '');
  const chave = String(error?.error_code || '');
  const texto = String(error?.message || error?.msg || '');

  if (ehFalhaDeRede(codigo, texto)) return 'Não foi possível conectar. Verifique sua internet e tente novamente.';
  if (/rate|too many|429/i.test(codigo + texto + chave)) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';

  if (ERROS_PT[chave]) return ERROS_PT[chave];
  if (ERROS_PT[codigo]) return ERROS_PT[codigo];

  if (/already registered|already exists|user_already/i.test(texto)) return ERROS_PT['user_already_exists'];
  if (/duplicate key/i.test(texto)) return ERROS_PT['23505'];
  if (/password should be at least|weak password/i.test(texto)) return ERROS_PT['weak_password'];
  if (/unable to validate email|invalid email/i.test(texto)) return ERROS_PT['email_address_invalid'];
  if (/violates foreign key/i.test(texto)) return ERROS_PT['23503'];
  if (/violates row-level security|permission denied/i.test(texto)) return ERROS_PT['42501'];
  if (/value too long/i.test(texto)) return ERROS_PT['22001'];
    if (/email.*provider.*disabled|signups are disabled|logins are disabled/i.test(texto + chave)) return 'O cadastro/login por e-mail está desativado no painel da Supabase. Ative o provedor "Email" em Authentication > Providers.';
  if (/jwt|token.*expired|session.*expired/i.test(texto)) return 'Sua sessão expirou. Entre novamente.';

  return padrao;
}

function mensagemDeAuthSegura(error) {
  const codigo = String(error?.code || error?.status || '');
  const chave = String(error?.error_code || '');
  const texto = String(error?.message || error?.msg || '');
  if (/banned|banida/i.test(texto)) return texto;
  if (ehFalhaDeRede(codigo, texto)) return 'Não foi possível conectar. Verifique sua internet e tente novamente.';
  if (/rate|too many|429/i.test(codigo + texto + chave)) return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.';
    if (/email.*provider.*disabled|email logins are disabled/i.test(texto + chave)) {
    return 'O login por e-mail está desativado no painel do Supabase. Ative o provedor "Email" em Authentication > Providers.';
  }
  if (chave === 'email_not_confirmed' || /email not confirmed/i.test(texto)) {
    return 'E-mail ainda não confirmado no Supabase.';
  }
  if (/user not found|usuário não encontrado/i.test(texto)) {
    return 'Usuário não encontrado.';
  }
  if (/invalid.*credential|credenciais inválidas|invalid login credentials/i.test(texto + chave)) {
    return 'Senha incorreta.';
  }
  return error?.message || 'E-mail/usuário ou senha incorretos.';
}

function formatAnimalType(type) {
  const normalized = String(type || '').trim();
  if (normalized === 'Fazenda') return 'Animal de Fazenda';
  if (normalized === 'Exótico') return 'Animal Exótico';
  if (normalized === 'Marinho') return 'Animal Marinho';
  return normalized;
}

function truncateText(text, maxLength = 80) {
  const value = String(text || '').trim();
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

window.truncateText = truncateText;

function readStorage(key, fallback) {
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch (error) { return fallback; }
}

function writeStorage(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function getSupabaseClient() {
  return supabase;
}

function showToast(message, type = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.innerHTML = `<span class="toast-icon" aria-hidden="true">${type === 'error' ? '!' : '✓'}</span><span>${escapeHTML(message)}</span>`;
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  window.setTimeout(() => {
    toast.classList.remove('is-visible');
    window.setTimeout(() => toast.remove(), 220);
  }, 3500);
}

function syncModalScrollLock() {
  const isAnyModalOpen = Boolean(
    document.querySelector('.dynamic-modal, #adoptionModal:not([hidden]), #supportModal:not([hidden]), #contactModal:not([hidden])')
  );
  if (isAnyModalOpen) {
    document.body.classList.add('modal-open');
    document.documentElement.classList.add('modal-open');
  } else {
    document.body.classList.remove('modal-open');
    document.documentElement.classList.remove('modal-open');
  }
}

function closeDynamicModal(modal) {
  if (!modal) return;
  modal.querySelectorAll('[src^="blob:"], [href^="blob:"]').forEach((el) => {
    const url = el.getAttribute('src') || el.getAttribute('href');
    if (url && url.startsWith('blob:')) {
      try { URL.revokeObjectURL(url); } catch (_) {}
    }
  });
  modal.remove();
  syncModalScrollLock();
}

function createDynamicModal(content, className = '') {
  const modal = document.createElement('div');
  modal.className = `dynamic-modal ${className}`;
  const hasCustomClose = content.includes('data-close-dynamic') || content.includes('terms-modal-close') || content.includes('dynamic-modal-close');
  const closeBtnHtml = hasCustomClose ? '' : '<button type="button" class="dynamic-modal-close" aria-label="Fechar modal" data-close-dynamic>&times;</button>';

  modal.innerHTML = `
    <div class="dynamic-modal-backdrop" data-close-dynamic></div>
    <section class="dynamic-modal-panel" role="dialog" aria-modal="true">
      ${closeBtnHtml}
      ${content}
    </section>`;
  document.body.appendChild(modal);
  syncModalScrollLock();

  const handleEsc = (event) => {
    if (event.key === 'Escape') {
      event.stopImmediatePropagation();
      closeDynamicModal(modal);
      document.removeEventListener('keydown', handleEsc);
    }
  };
  document.addEventListener('keydown', handleEsc);

  modal.querySelectorAll('[data-close-dynamic]').forEach((el) => {
    el.addEventListener('click', () => {
      closeDynamicModal(modal);
      document.removeEventListener('keydown', handleEsc);
    });
  });

  return modal;
}

function saveSession(user) {
  const payload = {
    userId: user.id || user.user_id,
    email: user.email,
    name: user.name || user.full_name || user.email,
    username: user.username || null,
    birth_date: user.birth_date || null,
    avatar_url: user.avatar_url || null,
    favorite_posts: Array.isArray(user.favorite_posts) ? user.favorite_posts.map((id) => String(id)) : []
  };
  writeStorage(STORAGE_KEYS.session, payload);
}

function getSession() {
  return readStorage(STORAGE_KEYS.session, null);
}

function normalizeUsername(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase()
    .replace(/^@+/, '')
    .replace(/[^a-z0-9._]/g, '');
}

// feito unificacao da checagem de username porque funcoes divergentes impediam o usuario de salvar o proprio perfil e resolvemos centralizando com exclusao do idAtual
async function garantirUsernameLivre(client, username, idAtual) {
  let consulta = client.from('profiles').select('id').ilike('username', username);
  if (idAtual) consulta = consulta.neq('id', idAtual);
  const { data, error } = await consulta.limit(1);
  if (error) throw new Error(mensagemDeErroSegura(error, 'Não foi possível verificar o nome de usuário. Tente novamente.'));
  if (Array.isArray(data) && data.length) {
    throw new Error('Este nome de usuário já está em uso. Escolha outro.');
  }
}

function getFavoriteIds() {
  const session = getSession();
  if (session && Array.isArray(session.favorite_posts)) return session.favorite_posts.map((id) => String(id));
  const favorites = readStorage(STORAGE_KEYS.favorites, []);
  return Array.isArray(favorites) ? favorites.map((id) => String(id)) : [];
}

async function persistFavoriteIds(ids) {
  const normalizedIds = ids.map((id) => String(id));
  const session = getSession();
  if (session) {
    saveSession({ ...session, id: session.userId, favorite_posts: normalizedIds });
    await getSupabaseClient().from('profiles').update({ favorite_posts: normalizedIds }).eq('id', session.userId);
  } else {
    writeStorage(STORAGE_KEYS.favorites, normalizedIds);
  }
}

function isFavorite(postId) {
  return getFavoriteIds().includes(String(postId));
}

async function toggleFavorite(postId) {
  const normalizedId = String(postId);
  const session = getSession();
  const favorites = getFavoriteIds();
  const isAlreadyFav = favorites.includes(normalizedId);
  const nextFavorites = isAlreadyFav
    ? favorites.filter((id) => id !== normalizedId)
    : [...favorites, normalizedId];
  // feito atualizacao otimista imediata no DOM e cache local porque esperar a resposta do banco causava atraso na interface e resolvemos alternando as classes antes da requisicao
  writeStorage(STORAGE_KEYS.favorites, nextFavorites);
  document.querySelectorAll(`[data-favorite-id="${normalizedId}"]`).forEach((btn) => {
    btn.classList.toggle('is-favorite', !isAlreadyFav);
    btn.setAttribute('aria-pressed', String(!isAlreadyFav));
    btn.setAttribute('aria-label', !isAlreadyFav ? 'Remover dos favoritos' : 'Adicionar aos favoritos');
  });

  if (session) {
    try {
      // feito chamada a RPC toggle_favorite_post com fallback para update direto porque queries concorrentes causavam Lost Update no array e resolvemos priorizando transacao atomica no banco
      const { error: rpcError } = await getSupabaseClient().rpc('toggle_favorite_post', { p_post_id: normalizedId });
      if (rpcError) {
        await getSupabaseClient().from('profiles').update({ favorite_posts: nextFavorites }).eq('id', session.userId);
      }
      saveSession({ ...session, id: session.userId, favorite_posts: nextFavorites });
    } catch (err) {
      console.warn('Erro ao persistir favorito:', err);
    }
  }
  return !isAlreadyFav;
}

function favoriteButtonHTML(postId) {
  const favorite = isFavorite(postId);
  const icon = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.4 1.4L12 21.2l7.5-7.4 1.3-1.4a5.5 5.5 0 0 0 0-7.8Z"></path></svg>`;
  return `<button class="favorite-button${favorite ? ' is-favorite' : ''}" type="button" data-favorite-id="${escapeHTML(postId)}" aria-label="${favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" aria-pressed="${favorite}">${icon}</button>`;
}

function getPostShareUrl(post) {
  if (!post || !post.id) return window.location.href;
  const categoryMap = {
    'Cachorro': 'animais/cachorro.html',
    'Gato': 'animais/gato.html',
    'Fazenda': 'animais/fazenda.html',
    'Exótico': 'animais/exotico.html',
    'Marinho': 'animais/marinho.html',
    'Outros': 'animais/outros.html'
  };
  const targetPage = categoryMap[post.animal_type] || 'index.html';
  const base = document.baseURI || window.location.href;
  try {
    return new URL(`${targetPage}?post=${encodeURIComponent(post.id)}`, base).href;
  } catch (e) {
    return `${window.location.origin}/${targetPage}?post=${encodeURIComponent(post.id)}`;
  }
}

function shareButtonHTML(post) {
  const postUrl = getPostShareUrl(post);
  return `<button class="share-button" type="button" data-share-post="${escapeHTML(post.id)}" data-share-title="${escapeHTML(post.title || 'Pet Amor')}" data-share-text="${escapeHTML(post.description || '')}" data-share-url="${escapeHTML(postUrl)}" aria-label="Compartilhar publicação" title="Compartilhar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a3 3 0 1 0-2.83-4A3 3 0 0 0 15 5c0 .18.02.36.05.53L8.91 9.05A3 3 0 1 0 9 12c0-.18-.02-.36-.05-.53l6.14-3.52c.52.65 1.32 1.05 2.22 1.05Zm0 8a3 3 0 0 0-2.83 2L9.03 14.5A3 3 0 1 0 8 16c.18 0 .36-.02.53-.05l6.14 3.52A3 3 0 1 0 18 16Z"></path></svg></button>`;
}

function getPostPhone(post) {
  const directPhone = post.phone || post.contact_phone;
  if (directPhone) return String(directPhone).replace(/\D/g, '');
  const phoneMatch = String(post.contact_info || '').match(/(?:Tel|Telefone|WhatsApp):\s*([^|]+)/i);
  return phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';
}

function postActionButtonsHTML(post, podeAdministrar = false) {
  const phone = getPostPhone(post);
  const title = encodeURIComponent(`Olá, vi o post do ${post.title || 'animal'} no Pet Amor e gostaria de saber mais!`);
  const adminActions = adminPostActions(post.id, podeAdministrar);

  if (phone) {
    return `<button class="btn btn-secondary" type="button" data-post-details="${escapeHTML(post.id)}">Ver detalhes</button><a class="btn btn-primary" href="https://wa.me/55${phone}?text=${title}" target="_blank" rel="noopener noreferrer">Conversar no WhatsApp</a>${adminActions}`;
  }

  return `<button class="btn btn-primary" type="button" data-post-details="${escapeHTML(post.id)}">Ver detalhes</button>${adminActions}`;
}

function postActionHTML(post, podeAdministrar = false) {
  return `<div class="post-action-row">${postActionButtonsHTML(post, podeAdministrar)}</div>`;
}

function renderAuthorBar(profile) {
  const authorProfile = Array.isArray(profile) ? profile[0] : profile;
  const firstName = authorProfile?.full_name?.split(' ')[0] || 'Usuário';
  const username = authorProfile?.username ? `@${escapeHTML(authorProfile.username.replace(/^@/, ''))}` : '';
  const avatarUrl = sanitizeUrl(authorProfile?.avatar_url) || DEFAULT_AVATAR_URL;
  return `<div class="post-author-bar"><img class="post-author-avatar" src="${escapeHTML(avatarUrl)}" alt="Foto de ${escapeHTML(firstName)}"><strong class="post-author-name">${escapeHTML(firstName)}</strong>${username ? `<small class="post-author-username">${escapeHTML(username)}</small>` : ''}</div>`;
}

function sortPostsByProximity(posts, cityValue) {
  if (!cityValue) return posts;
  const normalizedCity = cityValue.trim().toLowerCase();
  return [...posts].sort((firstPost, secondPost) => {
    const firstIsNearby = String(firstPost.city || '').trim().toLowerCase() === normalizedCity;
    const secondIsNearby = String(secondPost.city || '').trim().toLowerCase() === normalizedCity;
    return Number(secondIsNearby) - Number(firstIsNearby);
  });
}

function renderProximityDivider(posts, cityValue, renderCard) {
  const cards = sortPostsByProximity(posts, cityValue).map((post, index, sortedPosts) => {
    const isFirstOtherCity = cityValue && index > 0
      && String(sortedPosts[index - 1].city || '').trim().toLowerCase() === cityValue.trim().toLowerCase()
      && String(post.city || '').trim().toLowerCase() !== cityValue.trim().toLowerCase();
    return `${isFirstOtherCity ? '<div class="proximity-divider">Animais próximos em outras cidades</div>' : ''}${renderCard(post)}`;
  });
  return cards.join('');
}

function bindAdoptionButtons(target, posts) {
  const postsById = new Map(posts.map((post) => [String(post.id), post]));
  target.querySelectorAll('[data-adoption-post]').forEach((button) => {
    button.addEventListener('click', () => openAdoptionModal(postsById.get(button.dataset.adoptionPost)));
  });
}

function isValidEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized || !normalized.includes('@')) return false;
  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain || localPart.length < 2) return false;
  const domainRegex = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
  return domainRegex.test(domain);
}

function getPasswordStrength(password) {
  let score = 0;
  if (!password) return { score: 0, label: 'Sem senha', color: '#ef4444' };
  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[a-z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  if (score <= 2) return { score: 1, label: 'Fraca', color: '#ef4444' };
  if (score === 3 || score === 4) return { score: 2, label: 'Média', color: '#f59e0b' };
  return { score: 3, label: 'Forte', color: '#22c55e' };
}

function updatePasswordStrength(password) {
  const strength = getPasswordStrength(password);
  const bar = document.getElementById('passwordStrengthBar');
  const text = document.getElementById('passwordStrengthText');
  if (!bar || !text) return;
  const widthMap = { 0: '0%', 1: '35%', 2: '70%', 3: '100%' };
  bar.style.width = widthMap[strength.score] || '0%';
  bar.style.background = strength.color;
  text.textContent = `Força da senha: ${strength.label}`;
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEYS.session);
}

// feito validacao de role via tabela profiles do banco porque dados em localStorage eram suscetiveis a adulteracao local e resolvemos consultando o servidor
const AUTHORITATIVE_SESSION_KEY = 'petamor_verified_session';
let perfilVerificado = null;

function saveVerifiedSession(user) {
  const payload = {
    userId: user.id || user.user_id,
    role: user.role || 'user',
    email: user.email,
    name: user.name || user.full_name || user.email,
    username: user.username || null,
    birth_date: user.birth_date || null,
    avatar_url: user.avatar_url || null,
    favorite_posts: Array.isArray(user.favorite_posts) ? user.favorite_posts.map((id) => String(id)) : []
  };
  sessionStorage.setItem(AUTHORITATIVE_SESSION_KEY, JSON.stringify(payload));
  return payload;
}

// feito cache de sessao em sessionStorage porque consultas repetidas a cada acao degradavam a cota da API e resolvemos armazenando a leitura inicial
async function getVerificacaoAtual() {
  if (perfilVerificado) return perfilVerificado;
  const client = getSupabaseClient();
  if (!client) return null;
  try {
    const { data: authData } = await client.auth.getUser();
    if (!authData?.user) {
      sessionStorage.removeItem(AUTHORITATIVE_SESSION_KEY);
      perfilVerificado = { user: null, role: 'guest' };
      return perfilVerificado;
    }
    const profile = await fetchProfileByUserId(authData.user.id);
    perfilVerificado = {
      user: authData.user,
      profile,
      role: String(profile?.role || 'user').toLowerCase(),
      status: String(profile?.status || 'active').toLowerCase()
    };
  } catch (error) {
    perfilVerificado = { user: null, role: 'guest', erro: error.message };
  }
  return perfilVerificado;
}

async function isCurrentUserAdmin() {
  const verificacao = await getVerificacaoAtual();
  return verificacao?.role === 'admin';
}

function podeAdministrarAgora() {
  return perfilVerificado?.role === 'admin';
}

function resetVerificacao() {
  perfilVerificado = null;
  sessionStorage.removeItem(AUTHORITATIVE_SESSION_KEY);
}

// feito select com projecao restrita porque select('*') vazava recovery_code e metadados no cliente e resolvemos listando apenas colunas essenciais
const COLUNAS_PERFIL_PUBLICAS = 'id, email, full_name, username, birth_date, avatar_url, favorite_posts, role, status, created_at';

async function fetchProfileByUserId(userId) {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client
      .from('profiles')
      .select(COLUNAS_PERFIL_PUBLICAS)
      .eq('id', userId)
      .single();
    if (!error && data) return data;
  }
  return null;
}

async function resolveEmailFromIdentifier(client, identifier) {
  const raw = String(identifier || '').trim();
  if (!raw) throw new Error('Informe seu e-mail ou nome de usuário.');
  if (raw.toLowerCase() === 'admin') {
    return 'admin@petamor.com';
  }

  const isExplicitUsername = raw.startsWith('@');
  const cleanInput = raw.replace(/^@+/, '').trim();

  if (!isExplicitUsername && cleanInput.includes('@')) {
    const emailLower = cleanInput.toLowerCase();
    if (!isValidEmail(emailLower)) {
      throw new Error('Informe um e-mail válido.');
    }
    return emailLower;
  }

  const cleanUsername = normalizeUsername(cleanInput);
  if (!cleanUsername) {
    throw new Error('Informe um nome de usuário válido.');
  }

  // feito resolucao de username via RPC get_email_by_username porque a tabela auth.users nao e publica para visitantes anonimos e resolvemos com funcao security definer
  try {
    const { data: rpcEmail, error: rpcError } = await client.rpc('get_email_by_username', {
      p_username: cleanUsername
    });
    if (!rpcError && rpcEmail && typeof rpcEmail === 'string' && rpcEmail.trim()) {
      return rpcEmail.trim().toLowerCase();
    }
  } catch (err) {
    console.warn('Tentativa via RPC get_email_by_username falhou:', err);
  }

  try {
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('email')
      .ilike('username', cleanUsername)
      .maybeSingle();

    if (!profileError && profile?.email) {
      return String(profile.email).trim().toLowerCase();
    }
  } catch (err) {
    console.warn('Tentativa direta em profiles por username falhou:', err);
  }

  throw new Error('Usuário não encontrado.');
}

async function loginWithSupabase(identifier, password) {
  const client = getSupabaseClient();
  const resolvedEmail = await resolveEmailFromIdentifier(client, identifier);

  const { data, error } = await client.auth.signInWithPassword({
    email: resolvedEmail,
    password
  });
  if (error) throw new Error(mensagemDeAuthSegura(error));

  const profile = await fetchProfileByUserId(data.user.id);
  if (profile?.status === 'banned') throw new Error('Esta conta foi banida. Entre em contato com a administração.');
  return {
    id: data.user.id,
    email: data.user.email,
    name: profile?.full_name || data.user.user_metadata?.full_name || data.user.email,
    role: profile?.role || 'user',
    status: profile?.status || 'active',
    username: profile?.username || null,
    birth_date: profile?.birth_date || null,
    avatar_url: profile?.avatar_url || null,
    favorite_posts: profile?.favorite_posts || []
  };
}

async function handleAdminAccountSubmit(event) {
  event.preventDefault();
  if (!(await isCurrentUserAdmin())) {
    showToast('Apenas administradores podem alterar credenciais de administração.', 'error');
    return;
  }
  const emailField = document.getElementById('adminAccountEmail');
  const passwordField = document.getElementById('adminAccountPassword');
  const emailValue = emailField.value.trim().toLowerCase();
  const passwordValue = passwordField.value.trim();
  const updates = {};

  if (emailValue === 'admin') {
    updates.email = 'admin@petamor.com';
  } else if (isValidEmail(emailValue)) {
    updates.email = emailValue;
  } else {
    showToast('Informe um e-mail válido ou use o usuário admin.', 'error');
    return;
  }

  if (passwordValue) {
    if (passwordValue.length < 8) {
      showToast('A nova senha deve ter pelo menos 8 caracteres.', 'error');
      return;
    }
    updates.password = passwordValue;
  }

  try {
    const { data: authData, error } = await getSupabaseClient().auth.updateUser(updates);
    if (error) throw new Error(mensagemDeErroSegura(error));

    if (authData.user) {
      await getSupabaseClient().from('profiles').update({ email: updates.email }).eq('id', authData.user.id);
      saveSession({ ...getSession(), id: authData.user.id, email: updates.email });
      emailField.value = updates.email;
      passwordField.value = '';
    }
    showToast('Credenciais atualizadas com sucesso.');
  } catch (error) {
    showToast(`Não foi possível atualizar as credenciais: ${mensagemDeErroSegura(error)}`, 'error');
  }
}

// feito compressao em canvas com WebP porque imagens pesadas estouravam o Storage e atrasavam o LCP e resolvemos redimensionando dinamicamente com limite de 150KB
function compressAndValidateImage(file, profileName = 'pet') {
  if (typeof window !== 'undefined' && window.ImageService && typeof window.ImageService.compressAndValidateImage === 'function') {
    return window.ImageService.compressAndValidateImage(file, profileName);
  }

  return new Promise((resolve, reject) => {
    const fileError = validateImageFile(file);
    if (fileError) return reject(new Error(fileError));

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    const cleanup = () => {
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
    };

    img.onload = () => {
      cleanup();
      try {
        const origW = img.naturalWidth || img.width;
        const origH = img.naturalHeight || img.height;
        let targetW = origW;
        let targetH = origH;
        let initialQuality = 0.80;

        if (profileName === 'perfil') {
          initialQuality = 0.75;
          const maxDim = 300;
          if (origW > maxDim || origH > maxDim) {
            const ratio = Math.min(maxDim / origW, maxDim / origH);
            targetW = Math.round(origW * ratio);
            targetH = Math.round(origH * ratio);
          }
        } else {
          initialQuality = 0.80;
          const maxDim = 900;
          if (origW > maxDim || origH > maxDim) {
            if (origW >= origH) {
              targetW = maxDim;
              targetH = Math.round((origH * maxDim) / origW);
            } else {
              targetH = maxDim;
              targetW = Math.round((origW * maxDim) / origH);
            }
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, targetW);
        canvas.height = Math.max(1, targetH);
        const ctx = canvas.getContext('2d', { alpha: false });
        if (!ctx) {
          canvas.width = 0; canvas.height = 0;
          return reject(new Error('Não foi possível inicializar o canvas 2D.'));
        }

        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const MAX_BLOB_BYTES = 150 * 1024;

        const tryEncode = (quality) => {
          canvas.toBlob((blob) => {
            if (!blob) {
              canvas.width = 0; canvas.height = 0;
              return reject(new Error('Falha ao gerar WebP a partir do canvas.'));
            }
            if (blob.size <= MAX_BLOB_BYTES) {
              canvas.width = 0; canvas.height = 0;
              return resolve(blob);
            }
            if (quality > 0.45) {
              return tryEncode(Number((quality - 0.12).toFixed(2)));
            }
            canvas.width = 0; canvas.height = 0;
            return reject(new Error(`A imagem comprimida (${(blob.size / 1024).toFixed(1)} KB) excedeu o limite máximo de 150 KB.`));
          }, 'image/webp', quality);
        };

        tryEncode(initialQuality);
      } catch (err) {
        reject(new Error(`Erro ao processar imagem no canvas: ${err.message}`));
      }
    };

    img.onerror = () => {
      cleanup();
      reject(new Error('Não foi possível processar o arquivo de imagem enviado.'));
    };

    img.src = objectUrl;
  });
}

// feito remocao segura de fotos no Storage porque manter arquivos sem vinculo estourava a cota gratuita e resolvemos expurgando caminhos orfaos
async function deleteStorageImageByUrl(urlOrPath, bucket = 'imagens-adocao') {
  if (typeof window !== 'undefined' && window.ImageService && typeof window.ImageService.deleteStorageImage === 'function') {
    return window.ImageService.deleteStorageImage(urlOrPath, getSupabaseClient(), bucket);
  }
  if (!urlOrPath) return false;
  let path = null;
  const cleanUrl = String(urlOrPath).split('?')[0];
  const marker = `/storage/v1/object/public/${bucket}/`;
  if (cleanUrl.includes(marker)) {
    path = decodeURIComponent(cleanUrl.split(marker)[1]);
  } else if (cleanUrl.includes('/storage/v1/object/public/pet_images/')) {
    path = decodeURIComponent(cleanUrl.split('/storage/v1/object/public/pet_images/')[1]);
    bucket = 'pet_images';
  } else if (cleanUrl.includes('/storage/v1/object/public/avatars/')) {
    path = decodeURIComponent(cleanUrl.split('/storage/v1/object/public/avatars/')[1]);
    bucket = 'avatars';
  } else if (!cleanUrl.startsWith('http')) {
    path = cleanUrl;
  }
  if (!path) return false;

  try {
    const { error } = await getSupabaseClient().storage.from(bucket).remove([path]);
    if (error) console.warn('[Storage Anti-Orphan] Aviso ao remover:', error.message);
    return !error;
  } catch (e) {
    console.warn('[Storage Anti-Orphan] Exceção:', e);
    return false;
  }
}

async function uploadAvatar(file, userId) {
  const fileError = validateImageFile(file);
  if (fileError) throw new Error(fileError);

  const webpBlob = await compressAndValidateImage(file, 'perfil');
  const uuid = (crypto && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `av-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const fileName = `${userId}/${uuid}.webp`;

  const client = getSupabaseClient();
  const { data, error } = await client.storage.from('imagens-adocao').upload(fileName, webpBlob, {
    cacheControl: '31536000',
    upsert: false,
    contentType: 'image/webp'
  });

  if (error) throw new Error(`Não foi possível enviar a foto de perfil: ${mensagemDeErroSegura(error)}`);
  const { data: publicUrlData } = client.storage.from('imagens-adocao').getPublicUrl(data.path);
  if (!publicUrlData?.publicUrl) throw new Error('Não foi possível obter a URL pública.');

  return publicUrlData.publicUrl;
}

async function registerWithSupabase(name, username, email, password, birthDate, avatarFile, recoveryCode) {
  if (!name || !name.trim()) throw new Error('Informe seu nome completo.');
  const normalizedUsername = normalizeUsername(username);
  if (!normalizedUsername) throw new Error('Informe um nome de usuário válido.');
  if (!isValidEmail(email)) throw new Error('Use um e-mail válido com domínio conhecido.');
  if (!birthDate) throw new Error('Informe sua data de nascimento.');
  if (new Date(`${birthDate}T00:00:00`) > new Date()) throw new Error('A data de nascimento não pode estar no futuro.');

  const strength = getPasswordStrength(password);
  if (strength.score < 2) {
    throw new Error('Sua senha é fraca. Use pelo menos 8 caracteres e misture letras, números e símbolos.');
  }

  const client = getSupabaseClient();
  await garantirUsernameLivre(client, normalizedUsername, null);

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { full_name: name.trim() } }
  });

  if (error) throw new Error(mensagemDeErroSegura(error));

  let currentSession = data.session;
  // feito login automatico via signInWithPassword porque o signUp com confirmacao desativada nem sempre retornava sessao imediata e resolvemos autenticando na sequencia
  if (!currentSession && data.user) {
    try {
      const loginRes = await client.auth.signInWithPassword({ email, password });
      if (loginRes.data?.session) {
        currentSession = loginRes.data.session;
      }
    } catch (_) {
    }
  }

  const userId = data.user?.id;
  let avatarUrl = null;
  if (userId && avatarFile) avatarUrl = await uploadAvatar(avatarFile, userId);
  if (userId) {
    const { error: profileError } = await client.from('profiles').update({
      email,
      full_name: name.trim(),
      username: normalizedUsername,
      birth_date: birthDate,
      avatar_url: avatarUrl,
      status: 'active'
    }).eq('id', userId);
    if (profileError) {
      if (avatarUrl) {
        await deleteStorageImageByUrl(avatarUrl);
      }
      // feito verificacao isolada de violacao da chave 23505 porque outras constraints geravam mensagens falsas de username duplicado e resolvemos checando garantirUsernameLivre
      if (profileError.code === '23505') {
        await garantirUsernameLivre(client, normalizedUsername, userId);
      }
      throw new Error(mensagemDeErroSegura(profileError, 'Não foi possível salvar o perfil. Tente novamente.'));
    }

    try {
      await client.rpc('save_recovery_code', { p_code: recoveryCode });
    } catch (rcError) {
      console.warn('Registro de código de recuperação criptografado:', rcError);
    }
  }

  return {
    id: userId,
    email,
    name: name.trim(),
    username: normalizedUsername,
    role: 'user',
    status: 'active',
    birth_date: birthDate,
    avatar_url: avatarUrl,
    recovery_code: recoveryCode,
    favorite_posts: [],
    has_session: Boolean(currentSession)
  };
}

// feito recolhimento do hero com classe CSS em vez de display:none porque esconder o elemento quebrava a navegacao por ancoras #inicio e resolvemos com altura colapsada
async function updateHomeUserActions() {
  const session = getSession();
  const heroSection = document.getElementById('inicio');

  if (heroSection) heroSection.classList.toggle('is-collapsed', Boolean(session));

  const actionsNode = document.getElementById('homeUserActions');
  if (!actionsNode) return;

  if (!session) {
    actionsNode.innerHTML = `
      <a href="conta/login.html" class="btn btn-secondary">Entrar</a>
      <a href="conta/register.html" class="btn btn-primary">Cadastrar</a>
    `;
    return;
  }

  const isAdmin = await isCurrentUserAdmin();
  const avatarUrl = session.avatar_url || DEFAULT_AVATAR_URL;
  actionsNode.innerHTML = `
    ${isAdmin ? '<a href="admin/admin.html" class="btn btn-primary">Dashboard admin</a>' : ''}
    <a href="publicacoes/create-post.html" class="btn btn-primary">Criar publicação</a>
    <a href="publicacoes/my-posts.html" class="btn btn-secondary">Minhas publicações</a>
    <a href="publicacoes/favorites.html" class="header-favorites-link" aria-label="Abrir meus favoritos" title="Meus favoritos"><svg class="header-favorites-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"></path></svg></a>
    <a href="conta/profile.html" class="profile-avatar-link" aria-label="Abrir meu perfil"><img class="profile-avatar" src="${escapeHTML(avatarUrl)}" alt="Foto de perfil de ${escapeHTML(session.name || 'usuário')}"></a>
    <button class="btn btn-secondary" id="homeLogoutButton">Sair</button>
  `;

  const headerFavoriteLink = actionsNode.querySelector('.header-favorites-link');
  headerFavoriteLink?.classList.add('header-favorite-link');
  headerFavoriteLink?.querySelector('svg')?.setAttribute('fill', 'currentColor');

  document.getElementById('homeLogoutButton')?.addEventListener('click', () => {
    getSupabaseClient().auth.signOut().finally(() => {
      clearSession();
      resetVerificacao();
      const page = document.body.dataset.page;
      const protectedPages = ['profile', 'my-posts', 'favorites', 'create-post', 'admin'];
      if (protectedPages.includes(page)) {
        window.location.href = 'index.html';
      } else {
        updateHomeUserActions();
      }
    });
  });
}

function setupDonationRedirect() {
  const button = document.getElementById('btnQueroDoar');
  if (!button) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    window.location.href = getSession() ? 'publicacoes/create-post.html' : 'conta/register.html?redirect=publicacoes/create-post.html';
  });
}

// feito estilizacao progressiva com IntersectionObserver porque usuarios sem JavaScript ou com conexao lenta ficavam com conteudo invisivel e resolvemos revelando apenas via script ativo
function setupScrollReveal() {
  const alvos = document.querySelectorAll('[data-reveal], [data-reveal-stagger]');
  if (!alvos.length) return;

  const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (semMovimento || !('IntersectionObserver' in window)) {
    alvos.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observador = new IntersectionObserver((entradas) => {
    entradas.forEach((entrada) => {
      if (!entrada.isIntersecting) return;
      entrada.target.classList.add('is-visible');
      observador.unobserve(entrada.target);
    });
  }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });

  alvos.forEach((el) => observador.observe(el));
}

function setupPWA() {
  if ('serviceWorker' in navigator && (window.location.protocol === 'https:' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    const swUrl = new URL('sw.js', document.baseURI || window.location.href).href;
    navigator.serviceWorker.register(swUrl).catch((err) => {
      console.warn('Falha ao registrar Service Worker do Pet Amor:', err);
    });
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    const deferredPrompt = event;
    const actionsArea = document.querySelector('.profile-intro') || document.querySelector('.home-actions');
    if (actionsArea && !document.getElementById('pwaInstallBtn')) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = 'pwaInstallBtn';
      btn.className = 'btn-pwa-install';
      btn.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> Instalar App`;
      btn.addEventListener('click', async () => {
        btn.remove();
        deferredPrompt.prompt();
        const { outcome } = await deferredPrompt.userChoice;
        if (outcome === 'accepted') {
          showToast('Obrigado por instalar o Pet Amor! 🐾');
        }
      });
      actionsArea.appendChild(btn);
    }
  });
}

// feito fallback global de imagens com trava de dataset porque falhas consecutivas de rede geravam loop infinito no evento error e resolvemos marcando dataset.fallbackAplicado
function setupImageFallbacks() {
  const PLACEHOLDER = DEFAULT_AVATAR_URL;
  document.addEventListener('error', (event) => {
    const alvo = event.target;
    if (!(alvo instanceof HTMLImageElement)) return;
    if (alvo.dataset.fallbackAplicado === '1') return;
    alvo.dataset.fallbackAplicado = '1';
    alvo.src = PLACEHOLDER;
  }, true);
}

function setupMobileNavCurrent() {
  const path = window.location.pathname.toLowerCase();
  const page = document.body.dataset.page;
  const isHome = page === 'home' || path.endsWith('index.html') || path.endsWith('/') || (!page && !path.includes('.'));
  const isFavorites = page === 'favorites' || path.includes('favorites');
  const isCreate = path.includes('create-post');
  const isProfile = page === 'profile' || path.includes('profile') || path.includes('my-posts');

  document.querySelectorAll('.mobile-bottom-nav .nav-item').forEach((item) => {
    item.removeAttribute('aria-current');
    const navKey = item.dataset.nav;
    if (navKey === 'home' && isHome) item.setAttribute('aria-current', 'page');
    else if (navKey === 'favorites' && isFavorites) item.setAttribute('aria-current', 'page');
    else if (navKey === 'create' && isCreate) item.setAttribute('aria-current', 'page');
    else if (navKey === 'profile' && isProfile) item.setAttribute('aria-current', 'page');
  });
}

function setupSupportModal() {
  const modal = document.getElementById('supportModal');
  const contactModal = document.getElementById('contactModal');

  function openModal(target) {
    if (!target) return;
    target.hidden = false;
    syncModalScrollLock();
  }

  function closeModal(target) {
    if (!target) return;
    target.hidden = true;
    syncModalScrollLock();
  }

  const openButton = document.getElementById('helpSiteButton');
  if (modal && openButton) openButton.addEventListener('click', () => { openModal(modal); });

  document.querySelectorAll('[data-help-reason]').forEach((button) => {
    button.addEventListener('click', () => {
      const message = document.getElementById('supportModalMessage');
      if (message) message.textContent = `Que lindo! Sua ajuda com ${button.dataset.helpReason} mantém o Pet Amor vivo. Obrigado por cuidar com a gente!`;
      openModal(modal);
    });
  });

  const copyPixButton = document.getElementById('copyPixKeyButton');
  if (copyPixButton) {
    copyPixButton.addEventListener('click', async () => {
      const key = copyPixButton.dataset.pixKey || 'e584eb30-3b18-4eea-94a1-edaa5defa928';
      try {
        if (navigator.clipboard && window.isSecureContext) {
          await navigator.clipboard.writeText(key);
        } else {
          const tempInput = document.createElement('textarea');
          tempInput.value = key;
          tempInput.style.position = 'fixed';
          tempInput.style.left = '-9999px';
          document.body.appendChild(tempInput);
          tempInput.focus();
          tempInput.select();
          document.execCommand('copy');
          document.body.removeChild(tempInput);
        }

        const labelSpan = copyPixButton.querySelector('span');
        const originalText = labelSpan ? labelSpan.textContent : copyPixButton.textContent;
        if (labelSpan) labelSpan.textContent = 'Chave copiada! ✓';
        showToast('Chave PIX copiada com sucesso!');

        setTimeout(() => {
          if (labelSpan) labelSpan.textContent = originalText;
        }, 2500);
      } catch (error) {
        console.error('Erro ao copiar chave PIX:', error);
        showToast('Não foi possível copiar a chave PIX.', 'error');
      }
    });
  }

  document.getElementById('supportContactLink')?.addEventListener('click', (event) => {
    event.preventDefault();
    openModal(contactModal);
  });

  modal?.querySelectorAll('[data-support-close]').forEach((element) => {
    element.addEventListener('click', () => { closeModal(modal); });
  });

  contactModal?.querySelectorAll('[data-contact-close]').forEach((element) => {
    element.addEventListener('click', () => { closeModal(contactModal); });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.querySelector('.dynamic-modal')) return;
      if (modal && !modal.hidden) closeModal(modal);
      if (contactModal && !contactModal.hidden) closeModal(contactModal);
    }
  });
}

function redirectIfLoggedOut() {
  const session = getSession();
  if (!session) {
    window.location.href = 'conta/login.html';
    return null;
  }
  return session;
}

async function getPostApprovalSetting() {
  try {
    const { data, error } = await getSupabaseClient()
      .from('system_settings')
      .select('value')
      .eq('key', 'require_post_approval')
      .maybeSingle();

    if (error || !data) return false;
    const val = data.value;
    if (typeof val === 'boolean') return val;
    if (typeof val === 'string') return val === 'true';
    if (typeof val === 'object' && val !== null) {
      return Boolean(val);
    }
    return false;
  } catch (e) {
    console.warn('Erro ao consultar configuração de aprovação:', e);
    return false;
  }
}

async function setPostApprovalMode(enabled) {
  if (!(await isCurrentUserAdmin())) {
    showToast('Apenas administradores podem alterar esta configuração.', 'error');
    return false;
  }

  // feito chamada a RPC admin_set_post_approval_mode com fallback para upsert direto porque instalacoes sem a procedure causavam falha na alteracao e resolvemos sincronizando com system_settings
  const { data, error } = await getSupabaseClient().rpc('admin_set_post_approval_mode', {
    p_enabled: Boolean(enabled)
  });

  if (error) {
    const { error: updateErr } = await getSupabaseClient()
      .from('system_settings')
      .upsert({
        key: 'require_post_approval',
        value: Boolean(enabled),
        updated_at: new Date().toISOString()
      });

    if (updateErr) {
      showToast(`Não foi possível alterar a configuração: ${mensagemDeErroSegura(updateErr)}`, 'error');
      return false;
    }
  }

  return true;
}

async function setupPostApprovalToggle() {
  const toggle = document.getElementById('togglePostApproval');
  const label = document.getElementById('approvalStatusLabel');
  const panel = document.getElementById('moderationToggleCard');
  if (!toggle) return;

  const isEnabled = await getPostApprovalSetting();
  toggle.checked = isEnabled;
  updateToggleUI(isEnabled);

  toggle.addEventListener('change', async () => {
    const desiredState = toggle.checked;
    toggle.disabled = true;

    const success = await setPostApprovalMode(desiredState);
    toggle.disabled = false;

    if (success) {
      updateToggleUI(desiredState);
      showToast(
        desiredState
          ? 'Modo de aprovação ativado: novas publicações exigirão validação manual. 🛡️'
          : 'Modo de aprovação desativado: publicações serão ativadas diretamente. 🚀'
      );
    } else {
      toggle.checked = !desiredState;
      updateToggleUI(!desiredState);
    }
  });

  function updateToggleUI(enabled) {
    if (label) {
      label.textContent = enabled ? 'Ativado' : 'Desativado';
      label.className = `approval-status-badge ${enabled ? 'badge-on' : 'badge-off'}`;
    }
    if (panel) {
      panel.classList.toggle('active-mode', enabled);
    }
  }
}

async function renderPendingPostsAdmin() {
  const tbody = document.getElementById('pendingPostsTableBody');
  const countBadge = document.getElementById('pendingPostsCount');
  const totalPendingEl = document.getElementById('totalPending');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding:1.5rem;">Carregando fila de moderação...</td></tr>';

  const { data: posts, error } = await getSupabaseClient()
    .from('posts')
    .select('*, profiles(full_name, email, username)')
    .eq('status', 'pending')
    .order('created_at', { ascending: false });

  if (error) {
    tbody.innerHTML = `<tr><td colspan="6">Não foi possível carregar as publicações pendentes: ${escapeHTML(error.message)}</td></tr>`;
    return;
  }

  const count = posts?.length || 0;
  if (countBadge) countBadge.textContent = String(count);
  if (totalPendingEl) totalPendingEl.textContent = String(count);

  if (!posts || posts.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--muted);">Nenhuma publicação pendente de aprovação. Tudo limpo! ✨</td></tr>';
    return;
  }

  registerPostsInGlobalCache(posts);

  tbody.innerHTML = posts.map((post) => {
    const rawImage = Array.isArray(post.image_urls) ? post.image_urls[0] : (post.image_urls || 'img/pet-placeholder.webp');
    const authorName = post.profiles?.full_name || post.profiles?.username || 'Usuário';
    const authorEmail = post.profiles?.email || 'Não informado';
    const postDate = post.created_at ? new Date(post.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const location = [post.city, post.state].filter(Boolean).join('/') || 'Não informada';

    let modalityBadge = '<span class="status-badge" style="background:#f1f5f9; color:#475569;">Adoção</span>';
    if (post.support_type === 'lar_temporario') {
      modalityBadge = '<span class="status-badge badge-lt">🏠 Lar Temp.</span>';
    } else if (post.support_type === 'apadrinhamento') {
      modalityBadge = '<span class="status-badge badge-padrinho">⭐ Padrinho</span>';
    }

    return `
      <tr data-pending-id="${escapeHTML(post.id)}">
        <td>
          <div class="admin-pet-cell">
            <img src="${escapeHTML(rawImage)}" alt="${escapeHTML(post.title)}" class="admin-pet-thumb" loading="lazy" />
            <div class="admin-pet-details">
              <strong>${escapeHTML(post.title)}</strong>
              <small>${escapeHTML(formatAnimalType(post.animal_type))}</small>
            </div>
          </div>
        </td>
        <td>${modalityBadge}</td>
        <td>
          <div class="admin-pet-details">
            <strong>${escapeHTML(authorName)}</strong>
            <small>${escapeHTML(authorEmail)}</small>
          </div>
        </td>
        <td>${escapeHTML(location)}</td>
        <td><small>${escapeHTML(postDate)}</small></td>
        <td>
          <div class="admin-action-group">
            <button class="admin-btn inspect" type="button" data-action="inspect-pending" data-id="${escapeHTML(post.id)}" title="Ver detalhes completos do anúncio">
              Inspecionar
            </button>
            <button class="admin-btn approve" type="button" data-action="approve-post" data-id="${escapeHTML(post.id)}" title="Aprovar e publicar no site">
              ✓ Aprovar
            </button>
            <button class="admin-btn reject" type="button" data-action="reject-post" data-id="${escapeHTML(post.id)}" title="Recusar anúncio">
              ✕ Recusar
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function moderatePost(postId, action) {
  if (!(await isCurrentUserAdmin())) {
    showToast('Apenas administradores podem moderar publicações.', 'error');
    return;
  }

  const isApproval = action === 'approve';
  const actionLabel = isApproval ? 'aprovar' : 'recusar';

  if (!isApproval) {
    const confirmReject = window.confirm('Deseja realmente recusar esta publicação? Ela não será exibida publicamente no site.');
    if (!confirmReject) return;
  }

  // feito chamada a RPC admin_moderate_post com fallback para update direto porque ambientes legados sem a procedure precisam atualizar o status e resolvemos com bloco defensivo
  const { data, error } = await getSupabaseClient().rpc('admin_moderate_post', {
    p_post_id: postId,
    p_action: action
  });

  if (error) {
    const newStatus = isApproval ? 'active' : 'rejected';
    const { error: updateErr } = await getSupabaseClient()
      .from('posts')
      .update({ status: newStatus })
      .eq('id', postId);

    if (updateErr) {
      showToast(`Não foi possível ${actionLabel} a publicação: ${mensagemDeErroSegura(updateErr)}`, 'error');
      return;
    }
  }

  showToast(
    isApproval
      ? 'Publicação aprovada com sucesso! Ela agora está disponível publicamente no site. 🎉'
      : 'Publicação recusada pela moderação.',
    isApproval ? 'success' : 'info'
  );

  await renderPendingPostsAdmin();
  await renderAdminDashboard();
}

async function renderAdminDashboard() {
  const client = getSupabaseClient();
  try {
    const [adsRes, usersRes, bansRes, pendingRes, adoptedRes, viewsRes, statsRes] = await Promise.all([
      client.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      client.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      client.from('profiles').select('id', { count: 'exact', head: true }).eq('status', 'banned'),
      client.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      client.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'adopted'),
      client.from('posts').select('views_count').limit(100),
      client.from('site_statistics').select('total_lares').eq('id', 1).single()
    ]);

    const activeCount = adsRes.count ?? 0;
    const usersCount = usersRes.count ?? 0;
    const bansCount = bansRes.count ?? 0;
    const pendingCount = pendingRes.count ?? 0;
    const adoptedCount = adoptedRes.count ?? 0;
    const totalHomes = Number(statsRes?.data?.total_lares || 0);

    let totalViews = 0;
    if (viewsRes?.data) {
      totalViews = viewsRes.data.reduce((acc, curr) => acc + (Number(curr.views_count) || 0), 0);
    }

    const totalPosts = activeCount + adoptedCount + pendingCount;
    const adoptionRateStr = calculateConversionRate(adoptedCount, totalPosts);

    if (document.getElementById('totalAds')) document.getElementById('totalAds').textContent = String(activeCount);
    if (document.getElementById('totalUsers')) document.getElementById('totalUsers').textContent = String(usersCount);
    if (document.getElementById('totalBans')) document.getElementById('totalBans').textContent = String(bansCount);
    if (document.getElementById('totalPending')) document.getElementById('totalPending').textContent = String(pendingCount);
    if (document.getElementById('pendingPostsCount')) document.getElementById('pendingPostsCount').textContent = String(pendingCount);
    if (document.getElementById('totalAdopted')) document.getElementById('totalAdopted').textContent = String(adoptedCount);
    if (document.getElementById('adoptionRate')) document.getElementById('adoptionRate').textContent = adoptionRateStr;
    if (document.getElementById('analyticsTotalViews')) document.getElementById('analyticsTotalViews').textContent = totalViews.toLocaleString('pt-BR');
    if (document.getElementById('analyticsConversionRate')) document.getElementById('analyticsConversionRate').textContent = adoptionRateStr;
    if (document.getElementById('analyticsTotalHomes')) document.getElementById('analyticsTotalHomes').textContent = totalHomes.toLocaleString('pt-BR');

    if (document.getElementById('funnelActivePosts')) document.getElementById('funnelActivePosts').textContent = String(activeCount);
    if (document.getElementById('funnelAdoptedPosts')) document.getElementById('funnelAdoptedPosts').textContent = String(adoptedCount);

    const activePct = totalPosts > 0 ? Math.min(100, Math.round((activeCount / totalPosts) * 100)) : 0;
    const adoptedPct = totalPosts > 0 ? Math.min(100, Math.round((adoptedCount / totalPosts) * 100)) : 0;

    const funnelActiveBar = document.getElementById('funnelActiveBar');
    if (funnelActiveBar) funnelActiveBar.style.width = activePct + '%';
    const funnelAdoptedBar = document.getElementById('funnelAdoptedBar');
    if (funnelAdoptedBar) funnelAdoptedBar.style.width = adoptedPct + '%';
  } catch (err) {
    console.warn('Erro ao carregar estatísticas do admin:', err);
  }
  const postsTableBody = document.getElementById('postsTableBody');
  if (postsTableBody) {
    const { data: posts, error } = await client
      .from('posts')
      .select('id, title, animal_type, city, status')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) {
      postsTableBody.innerHTML = `<tr><td colspan="4">Não foi possível carregar os posts: ${escapeHTML(error.message)}</td></tr>`;
    } else {
      postsTableBody.innerHTML = (posts || []).map((post) => `
        <tr>
          <td>
            <strong>${escapeHTML(post.title)}</strong>
            ${post.status === 'pending' ? ' <span class="status-badge status-pending" style="font-size:0.7rem;">Pendente</span>' : ''}
            ${post.status === 'rejected' ? ' <span class="status-badge status-rejected" style="font-size:0.7rem;">Recusado</span>' : ''}
          </td>
          <td>${escapeHTML(post.animal_type || 'Não informado')}</td>
          <td>${escapeHTML(post.city || 'Não informada')}</td>
          <td><button class="admin-btn danger" data-action="delete-post" data-id="${escapeHTML(post.id)}">Excluir</button></td>
        </tr>
      `).join('') || '<tr><td colspan="4">Nenhum post publicado.</td></tr>';
    }
  }
  const usersTableBody = document.getElementById('usersTableBody');
  if (usersTableBody) {
    const { data: users, error: userErr } = await client
      .from('profiles')
      .select('id, full_name, email, role, status')
      .order('created_at', { ascending: false })
      .limit(30);

    if (users && !userErr) {
      usersTableBody.innerHTML = users.map((u) => `
        <tr>
          <td>${escapeHTML(u.full_name || 'Sem nome')}</td>
          <td>${escapeHTML(u.email || 'Não informado')}</td>
          <td><span class="mini-tag">${escapeHTML(u.role || 'user')}</span></td>
          <td>${escapeHTML(u.status || 'active')}</td>
          <td>
            <button class="admin-btn danger" type="button" data-action="ban-user" data-id="${escapeHTML(u.id)}" ${u.status === 'banned' ? 'disabled' : ''}>
              ${u.status === 'banned' ? 'Banido' : 'Banir'}
            </button>
          </td>
        </tr>
      `).join('') || '<tr><td colspan="5">Nenhum usuário encontrado.</td></tr>';
    }
  }
}

async function loadSiteStatistics() {
  const { data, error } = await getSupabaseClient()
    .from('site_statistics')
    .select('total_lares, base_diaria')
    .eq('id', 1)
    .single();
  if (error) {
    showToast(`Não foi possível carregar as estatísticas: ${mensagemDeErroSegura(error)}`, 'error');
    return;
  }
  const totalHomes = Number(data?.total_lares || 0);
  const dailyBase = Number(data?.base_diaria || 0);
  const dailyDonations = dailyBase + new Date().getHours() * 3;
  document.getElementById('totalHomesStat')?.replaceChildren(String(totalHomes));
  document.getElementById('dailyDonationsStat')?.replaceChildren(String(dailyDonations));
  const adminTotalHomes = document.getElementById('adminTotalHomes');
  if (adminTotalHomes) adminTotalHomes.value = String(totalHomes);
}

async function loadHomeRealStats() {
  const alvos = document.querySelectorAll('[data-stat]');
  if (!alvos.length) return;
  const client = getSupabaseClient();

  try {
    const [totalRes, ativosRes, adotadosRes] = await Promise.all([
      client.from('posts').select('id', { count: 'exact', head: true }),
      client.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'active'),
      client.from('posts').select('id', { count: 'exact', head: true }).eq('status', 'adopted')
    ]);

    const total = totalRes.count ?? 0;
    const ativos = ativosRes.count ?? 0;
    const adotados = adotadosRes.count ?? 0;
    const taxa = total > 0 ? Math.round((adotados / total) * 100) : 0;

    const escrever = (chave, valor) => {
      const alvo = document.querySelector(`[data-stat="${chave}"]`);
      if (alvo) alvo.textContent = valor;
    };
    escrever('animais', total.toLocaleString('pt-BR'));
    escrever('adotados', adotados.toLocaleString('pt-BR'));
    escrever('taxa', total > 0 ? `${taxa}%` : '—');

    document.querySelector('[data-stat="animais"]')?.setAttribute('title', `${ativos} com adoção em aberto`);
  } catch (error) {
    alvos.forEach((alvo) => { alvo.textContent = '—'; });
  }
}

async function updateSiteStatistics(totalHomes, reset = false) {
  if (!(await isCurrentUserAdmin())) {
    showToast('Apenas administradores podem alterar as estatísticas.', 'error');
    return;
  }
  const updates = reset ? { total_lares: 0, base_diaria: 0 } : { total_lares: Number(totalHomes) };
  const { error } = await getSupabaseClient().from('site_statistics').update(updates).eq('id', 1);
  if (error) {
    showToast(`Não foi possível atualizar as estatísticas: ${mensagemDeErroSegura(error)}`, 'error');
    return;
  }
  showToast(reset ? 'Estatísticas zeradas.' : 'Total de lares atualizado.');
  await loadSiteStatistics();
}

function setupStatisticsManagement() {
  document.getElementById('adminStatisticsForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = Number(document.getElementById('adminTotalHomes').value);
    if (!Number.isInteger(value) || value < 0) return showToast('Informe um total de lares válido.', 'error');
    updateSiteStatistics(value);
  });
  document.getElementById('resetStatisticsButton')?.addEventListener('click', () => updateSiteStatistics(0, true));
}

// feito exclusao em cascata de publicacoes e fotos porque apagar apenas o registro deixava arquivos orfaos no Storage e resolvemos iterando image_urls antes do retorno
async function deletePost(postId) {
  const session = getSession();
  const isAdmin = await isCurrentUserAdmin();
  const client = getSupabaseClient();

  const { data: post, error: fetchErr } = await client
    .from('posts')
    .select('id, user_id, image_urls')
    .eq('id', postId)
    .single();

  if (fetchErr || !post) {
    showToast('Publicação não encontrada.', 'error');
    return;
  }
  // feito checagem de autoria e perfil admin porque requisicoes forjadas no cliente podiam apagar posts de terceiros e resolvemos validando com session.userId
  if (post.user_id !== session?.userId && !isAdmin) {
    showToast('Apenas o autor da publicação ou administradores podem excluí-la.', 'error');
    return;
  }

  if (!window.confirm('Tem certeza que deseja excluir esta publicação? As fotos associadas também serão apagadas.')) {
    return;
  }

  const { error } = await client.from('posts').delete().eq('id', postId);
  if (error) {
    showToast(`Não foi possível excluir o post: ${mensagemDeErroSegura(error)}`, 'error');
    return;
  }
  if (post.image_urls) {
    const rawUrls = Array.isArray(post.image_urls) ? post.image_urls : [post.image_urls];
    for (const url of rawUrls) {
      await deleteStorageImageByUrl(url);
    }
  }

  showToast('Publicação e imagens associadas excluídas com sucesso.');
  if (isAdmin && typeof renderAdminDashboard === 'function' && document.getElementById('adminPostsTable')) {
    renderAdminDashboard();
  } else if (typeof renderUserPosts === 'function' && document.getElementById('userPosts')) {
    renderUserPosts();
  } else {
    window.location.reload();
  }
}

async function searchAdminUsers(queryValue) {
  const target = document.getElementById('adminUserResults');
  const termo = sanitizeFiltroPostgrest(queryValue);
  if (!target || !termo) return;
  const { data: users, error } = await getSupabaseClient().from('profiles')
    .select('id, email, full_name, username, birth_date, status, role')
    .or(`email.ilike.%${termo}%,full_name.ilike.%${termo}%,username.ilike.%${termo}%`)
    .limit(10);
  if (error) {
    target.innerHTML = `<p class="admin-search-message">Não foi possível buscar usuários: ${escapeHTML(error.message)}</p>`;
    return;
  }
  if (!users?.length) {
    target.innerHTML = '<p class="admin-search-message">Nenhum usuário encontrado.</p>';
    return;
  }
  target.innerHTML = users.map((user) => `
    <article class="admin-user-result" data-user-id="${escapeHTML(user.id)}">
      <div>
        <strong>${escapeHTML(user.full_name || 'Sem nome')}</strong>
        <p class="admin-user-info">${escapeHTML(user.email || '')} · @${escapeHTML(user.username || 'sem username')}</p>
        <p class="admin-user-meta">Nascimento: ${escapeHTML(user.birth_date || 'Não informado')} · Status: ${escapeHTML(user.status || 'active')}</p>
      </div>
      <button class="admin-btn danger" type="button" data-action="ban-user" data-id="${escapeHTML(user.id)}" ${user.status === 'banned' ? 'disabled' : ''}>${user.status === 'banned' ? 'Banido' : 'Banir'}</button>
      <div class="admin-user-posts" data-posts-for="${escapeHTML(user.id)}"><p>Carregando publicações...</p></div>
    </article>
  `).join('');
  users.forEach((user) => loadAdminUserPosts(user.id));
}

async function loadAdminUserPosts(userId) {
  const target = document.querySelector(`[data-posts-for="${CSS.escape(userId)}"]`);
  if (!target) return;
  const { data: posts, error } = await getSupabaseClient().from('posts').select('id, title, animal_type, status').eq('user_id', userId).order('created_at', { ascending: false });
  if (error) {
    target.textContent = 'Não foi possível carregar as publicações.';
    return;
  }
  target.innerHTML = posts?.length
    ? `<strong>Publicações</strong><ul>${posts.map((post) => `<li>${escapeHTML(post.title)} · ${escapeHTML(post.status || 'active')}</li>`).join('')}</ul>`
    : '<p>Nenhuma publicação.</p>';
}

async function banAdminUser(userId) {
  const { error } = await getSupabaseClient().rpc('admin_ban_user', { p_user_id: userId });
  if (error) return showToast(`Não foi possível banir o usuário: ${mensagemDeErroSegura(error)}`, 'error');
  showToast('Usuário banido com sucesso.');
  searchAdminUsers(document.getElementById('adminUserSearch')?.value);
}

function bindAdminActions() {
  // feito guarda booleana __adminActionsBound porque re-renderizacoes do painel duplicavam listeners de clique e resolvemos travando apos a primeira vinculacao
  if (window.__adminActionsBound) return;
  window.__adminActionsBound = true;
  document.body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    const action = button.dataset.action;
    const id = button.dataset.id;

    if (action === 'delete-post') {
      deletePost(id);
    } else if (action === 'ban-user') {
      banAdminUser(id);
    } else if (action === 'approve-post') {
      moderatePost(id, 'approve');
    } else if (action === 'reject-post') {
      moderatePost(id, 'reject');
    } else if (action === 'inspect-pending') {
      const post = globalPostsMap.get(String(id));
      if (post) {
        openAdoptionModal(post);
      } else {
        openAdoptionModal(id);
      }
    }
  });
}

function validateImageFile(file) {
  if (!file) return 'Selecione uma imagem.';
  const name = file.name.toLowerCase();
  const allowedExtensions = /\.(jpe?g|png|webp)$/i;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedExtensions.test(name) || !allowedTypes.includes(file.type)) {
    return 'Aceitamos apenas fotos em formato JPG, PNG ou WebP.';
  }
  if (file.size > 15 * 1024 * 1024) {
    const tamanhoMB = (file.size / (1024 * 1024)).toFixed(1);
    return `A imagem original é muito grande (${tamanhoMB} MB). O limite máximo de envio é 15 MB.`;
  }
  return null;
}

function containsBannedWord(text) {
  const normalizedText = String(text || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return BANNED_WORDS.some((word) => new RegExp(`(^|[^a-z])${word}([^a-z]|$)`, 'i').test(normalizedText));
}

function formatPhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : '';
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`;
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
}

function isValidInstagram(value) {
  if (!value) return true;
  return /^[a-z0-9._]{1,30}$/i.test(value);
}

function getContactItems(post) {
  const rawContact = String(post.contact_info || '');
  const parsedItems = rawContact.split('|').map((item) => item.trim()).filter((item) => item && !/Não informado|Nao informado/i.test(item));
  const directItems = [post.phone && `Tel: ${post.phone}`, post.email && `Email: ${post.email}`, post.instagram && `IG: @${String(post.instagram).replace(/^@/, '')}`].filter(Boolean);
  return directItems.length ? directItems : parsedItems;
}

function extractPhoneNumber(post) {
  let rawPhone = post?.phone || post?.contact_phone || '';
  if (!rawPhone && post?.contact_info) {
    const parts = String(post.contact_info).split('|');
    for (const part of parts) {
      const cleaned = part.replace(/\D/g, '');
      if (cleaned.length >= 10 && cleaned.length <= 13) {
        rawPhone = cleaned;
        break;
      }
    }
  }
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.length === 10 || digits.length === 11) {
    return `55${digits}`;
  }
  if (digits.length === 12 || digits.length === 13) {
    return digits;
  }
  return null;
}

function renderWhatsAppButton(post) {
  const phone = extractPhoneNumber(post);
  if (!phone) return '';
  const animalTitle = post?.title ? `"${escapeHTML(post.title)}"` : 'do animal';
  const animalType = formatAnimalType(post?.animal_type) || 'Pet';
  let defaultGreeting = `Olá! Vi o anúncio do pet ${animalTitle} (${animalType}) no Pet Amor e gostaria de saber se ele ainda está disponível para adoção responsável!`;
  if (post.support_type === 'lar_temporario') {
    defaultGreeting = `Olá! Vi o anúncio de Lar Temporário (LT) para o pet ${animalTitle} no Pet Amor e gostaria de me voluntariar/ajudar! 🏠`;
  } else if (post.support_type === 'apadrinhamento') {
    defaultGreeting = `Olá! Vi a campanha de Apadrinhamento/Cuidados para o pet ${animalTitle} no Pet Amor e gostaria de ajudar com os custos/cuidados! ⭐`;
  }
  const message = encodeURIComponent(defaultGreeting);
  const waUrl = `https://wa.me/${phone}?text=${message}`;

  return `
    <a href="${waUrl}" target="_blank" rel="noopener noreferrer" class="btn-whatsapp" aria-label="Conversar com o anunciante no WhatsApp">
      <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true">
        <path d="M12.04 2c-5.46 0-9.91 4.45-9.91 9.91 0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.816 9.816 0 0 0 12.04 2m.01 1.67c2.2 0 4.26.86 5.82 2.42a8.225 8.225 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.24 8.24-1.48 0-2.93-.4-4.2-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.196 8.196 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.24-8.24m4.52 11.66c-.25-.13-1.47-.72-1.7-.81-.23-.08-.39-.13-.56.13-.17.25-.64.81-.79.97-.14.17-.29.19-.54.06-.25-.13-1.06-.39-2.03-1.25-.75-.67-1.26-1.5-1.41-1.75-.14-.25-.02-.39.11-.51.11-.11.25-.29.37-.44.13-.15.17-.25.25-.42.08-.17.04-.31-.02-.44-.06-.13-.56-1.35-.77-1.85-.2-.49-.41-.42-.56-.43h-.48c-.17 0-.44.06-.67.31-.23.25-.88.86-.88 2.1 0 1.24.9 2.44 1.03 2.61.13.17 1.77 2.7 4.29 3.79.6.26 1.07.41 1.44.53.6.19 1.15.16 1.58.1.48-.07 1.47-.6 1.68-1.18.21-.58.21-1.07.15-1.18-.06-.11-.23-.17-.48-.29z"/>
      </svg>
      <span>Conversar no WhatsApp</span>
    </a>
  `;
}

function renderCopyableContacts(post) {
  const waBtn = renderWhatsAppButton(post);
  const copyBtns = getContactItems(post).map((item) => {
    const contact = String(item);
    const match = contact.match(/^(Tel|Telefone|Email|E-mail|IG|Instagram)\s*:\s*(.+)$/i);
    const label = match?.[1] || 'Contato';
    const value = match?.[2]?.trim() || contact;

    let iconSvg = '';
    if (/tel|telefone/i.test(label)) {
      iconSvg = `<svg class="contact-type-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"/></svg>`;
    } else if (/email|e-mail/i.test(label)) {
      iconSvg = `<svg class="contact-type-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="16" x="2" y="4" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>`;
    } else {
      iconSvg = `<svg class="contact-type-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="20" height="20" x="2" y="2" rx="5" ry="5"/><path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/><line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/></svg>`;
    }

    return `
      <button type="button" class="copy-contact-btn" data-copy="${escapeHTML(value)}" aria-label="Copiar ${escapeHTML(label)}: ${escapeHTML(value)}" title="Clique para copiar">
        <span class="copy-btn-info">
          ${iconSvg}
          <span class="copy-btn-text"><strong>${escapeHTML(label)}:</strong> ${escapeHTML(value)}</span>
        </span>
        <span class="copy-action-indicator" aria-hidden="true">
          <svg class="icon-copy" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
          <span class="copy-state-label">Copiar</span>
        </span>
      </button>
    `;
  }).join('');
  const contactList = copyBtns || '<p class="contact-empty">Contato não informado</p>';
  return waBtn ? `${waBtn}${contactList}` : contactList;
}

function renderContactItems(post) {
  return getContactItems(post).map((item) => `<p class="contact-item">${escapeHTML(item)}</p>`).join('');
}

function adminPostActions(postId, podeAdministrar = false) {
  return podeAdministrar
    ? `<button class="btn btn-danger admin-feed-delete" type="button" data-action="delete-post" data-id="${escapeHTML(postId)}">Deletar Post</button>`
    : '';
}

async function uploadPostImage(file, userId) {
  const client = getSupabaseClient();
  const fileError = validateImageFile(file);
  if (fileError) throw new Error(fileError);

  const effectiveUserId = userId || getSession()?.userId || (await client.auth.getUser())?.data?.user?.id;
  if (!effectiveUserId) throw new Error('Usuário não autenticado para envio da imagem.');

  const webpBlob = await compressAndValidateImage(file, 'pet');
  const uuid = (crypto && typeof crypto.randomUUID === 'function')
    ? crypto.randomUUID()
    : `pet-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
  const fileName = `${effectiveUserId}/${uuid}.webp`;

  const { data, error } = await client.storage.from('imagens-adocao').upload(fileName, webpBlob, {
    cacheControl: '31536000',
    upsert: false,
    contentType: 'image/webp'
  });

  if (error) throw new Error(`Não foi possível enviar a imagem: ${mensagemDeErroSegura(error)}`);
  const { data: publicUrlData } = client.storage.from('imagens-adocao').getPublicUrl(data.path);
  if (!publicUrlData?.publicUrl) throw new Error('Não foi possível obter a URL da imagem.');

  const res = {
    publicUrl: publicUrlData.publicUrl,
    path: data.path,
    toString() { return this.publicUrl; }
  };
  return res;
}

const BREED_CATALOGS = {
  Cachorro: `Vira-lata (SRD)|Affenpinscher|Afghan Hound|Airedale Terrier|Akita|Akita Americano|American Bully|American Staffordshire Terrier|Australian Cattle Dog|Australian Shepherd|Basenji|Basset Hound|Beagle|Bearded Collie|Bernese Mountain Dog|Bichon Frisé|Bloodhound|Border Collie|Boston Terrier|Boxer|Buldogue Americano|Buldogue Campeiro|Buldogue Francês|Buldogue Inglês|Bull Terrier|Bullmastiff|Cane Corso|Cão de Crista Chinês|Cão de água português|Cão de montanha dos Pirineus|Cavalier King Charles Spaniel|Chihuahua|Chow Chow|Cocker Spaniel Americano|Cocker Spaniel Inglês|Collie|Dachshund|Dálmata|Doberman|Dogo Argentino|Dogue Alemão|Dogue de Bordeaux|Fila Brasileiro|Fox Paulistinha|Golden Retriever|Greyhound|Griffon de Bruxelas|Husky Siberiano|Jack Russell Terrier|Labrador Retriever|Lhasa Apso|Lulu da Pomerânia|Malamute do Alasca|Maltês|Mastiff|Norfolk Terrier|Norwich Terrier|Old English Sheepdog|Papillon|Pastor Alemão|Pastor Australiano|Pastor Belga|Pastor Branco Suíço|Pastor de Shetland|Pequinês|Pinscher|Pit Bull|Pointer Inglês|Poodle|Pug|Rottweiler|Samoieda|Schnauzer|Setter Irlandês|Shar-Pei|Shiba Inu|Shih Tzu|Staffordshire Bull Terrier|São Bernardo|Terrier Brasileiro|Terrier Escocês|Vizsla|Weimaraner|Welsh Corgi|West Highland White Terrier|Whippet|Yorkshire Terrier`,
  Gato: `Vira-lata (SRD)|Abissínio|American Curl|American Shorthair|American Wirehair|Angorá|Azul Russo|Balinês|Bengal|Birmanês|Bombaim|British Longhair|British Shorthair|Burmês|Chartreux|Cornish Rex|Devon Rex|Exótico de Pelo Curto|Himalaio|Khao Manee|LaPerm|Maine Coon|Manx|Munchkin|Nebelung|Norueguês da Floresta|Oriental|Persa|Peterbald|Ragdoll|Sagrado da Birmânia|Savannah|Scottish Fold|Scottish Straight|Selkirk Rex|Siamês|Siberiano|Singapura|Somali|Sphynx|Tonquinês|Turco Van`,
  Fazenda: `Não sei|Abelha|Alpaca|Asinino|Avestruz|Búfalo|Bode|Boi|Boi Angus|Boi Brahman|Boi Hereford|Boi Nelore|Cabra|Cabra Anglonubiana|Cabra Boer|Cabra Saanen|Cabra Toggenburg|Cavalo|Cavalo Árabe|Cavalo Campolina|Cavalo Crioulo|Cavalo Mangalarga|Cavalo Quarto de Milha|Codorna|Coelho|Coelho Angorá|Coelho Mini Lop|Coelho Nova Zelândia|Égua|Gado de leite|Galinha|Galinha caipira|Ganso|Jumento|Lhama|Marreco|Mula|Ovelha|Ovelha Dorper|Ovelha Hampshire Down|Ovelha Santa Inês|Pato|Pavão|Peru|Pônei|Porco|Porco caipira|Vaca|Vaca Girolando|Vaca Holandesa|Vaca Jersey|Vaca Nelore`,
  Exótico: `Não sei|Agapornis|Axolote|Cacatua|Calopsita|Camaleão|Canário|Chinchila|Cobra|Cobra-do-milho|Cágado|Degú|Dragão-barbudo|Escorpião|Esquilo-da-Mongólia|Furão|Gecko-leopardo|Gerbil|Hamster|Hamster chinês|Hamster sírio|Iguana|Jabuti|Jabuti-piranga|Jiboia|Lagartixa|Lagarto|Maritaca|Mini pig|Ouriço-cacheiro|Periquito|Periquito-australiano|Pogona|Porquinho-da-índia|Rato|Rato twister|Sagui|Salamandra|Serpente|Tarântula|Tartaruga|Teiú|Tigre-d'água|Tritão|Outro`,
  Marinho: `Não sei|Anêmona-do-mar|Baiacu|Camarão|Caranguejo|Cavalo-marinho|Coral|Coral-cérebro|Donzela|Estrela-do-mar|Lagosta|Lula|Medusa|Molusco|Ostra|Ouriço-do-mar|Peixe|Peixe-anjo|Peixe-betta|Peixe-cirurgião|Peixe-dourado|Peixe-leão|Peixe-palhaço|Peixe-papagaio|Pepino-do-mar|Polvo|Raia|Sardinha|Tartaruga-marinha|Tartaruga-verde|Tubarão|Água-viva|Outro`,
  Outro: `Não sei`
};

const breedOptionsCache = new Map();

// feito centralizacao de ICONE_PIN em constante unica porque o mesmo SVG estava duplicado em 7 pontos do bundle e resolvemos reaproveitando a string
const ICONE_PIN = '<svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5.2-8 12-8 12s-8-6.8-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg>';

const SPECIES_OPTIONS = {
  Fazenda: `Abelha|Alpaca|Asinino|Búfalo|Boi|Cabra|Cavalo|Codorna|Coelho|Égua|Galinha|Ganso|Marreco|Ovelha|Pato|Pavão|Peru|Porco|Pônei|Vaca|Outro`.split('|'),
  Exótico: `Agapornis|Axolote|Camaleão|Calopsita|Canário|Cacatua|Chinchila|Cobra|Cobra-do-milho|Cágado|Dragão-barbudo|Esquilo-da-Mongólia|Escorpião|Furão|Gecko-leopardo|Gerbil|Hamster|Iguana|Jabuti|Jabuti-piranga|Lagartixa|Lagarto|Maritaca|Mini pig|Pogona|Periquito|Porquinho-da-índia|Rato|Rato twister|Sagui|Salamandra|Serpente|Tarântula|Tartaruga|Teiú|Tigre-d'água|Tritão|Ouriço-cacheiro|Outro`.split('|'),
  Marinho: `Anêmona-do-mar|Baiacu|Baleia|Camarão|Caranguejo|Cavalo-marinho|Coral|Estrela-do-mar|Golfinho|Lagosta|Leão-marinho|Lula|Medusa|Ostra|Peixe|Pinguim|Polvo|Raia|Robalo|Sardinha|Tartaruga-marinha|Tubarão|Água-viva|Outro`.split('|')
};

const BREEDS_BY_SPECIES = {
  Abelha: `Africana|Africanizada|Carniolana|Caucasiana|Italiana`,
  Asinino: `Andaluz|Baudet du Poitou|Catalão|Pêga`,
  Alpaca: `Huacaya|Suri`,
  Búfalo: `Mediterrâneo|Murrah|Jafarabadi`,
  Boi: `Angus|Brahman|Charolês|Hereford|Holandês|Jersey|Nelore|Pardo-Suíço|Simmental`,
  Cabra: `Anglo-Nubiana|Boer|Mambrina|Saanen|Toggenburg`,
  Cavalo: `Andaluz|Árabe|Appaloosa|Brasileiro de Hipismo|Bretão|Campolina|Clydesdale|Crioulo|Frísio|Hanoveriano|Lusitano|Mangalarga|Mangalarga Marchador|Morgan|Mustang|Paint Horse|Percheron|Pônei Brasileiro|Puro Sangue Inglês|Quarto de Milha|Shetland|Welsh`,
  Égua: `Andaluz|Árabe|Appaloosa|Brasileiro de Hipismo|Bretã|Campolina|Clydesdale|Crioula|Frísia|Hanoveriana|Lusitana|Mangalarga|Mangalarga Marchador|Morgan|Mustang|Paint Horse|Percheron|Pônei Brasileiro|Puro Sangue Inglês|Quarto de Milha|Shetland|Welsh`,
  Codorna: `Bobwhite|Chinesa|Japonesa`,
  Coelho: `Angorá|Californiano|Chinchila|Fuzzy Lop|Holandês|Lionhead|Mini Lop|Nova Zelândia|Rex`,
  Galinha: `Australorp|Brahma|Cochinchina|Plymouth Rock|Rhode Island Red|Sedosa|Sussex`,
  Ganso: `Africano|Chinês|Embden|Toulouse`,
  Marreco: `Call Duck|Muscovy|Pequim|Rouen`,
  Ovelha: `Dorper|Hampshire Down|Merino|Santa Inês|Suffolk`,
  Pato: `Call Duck|Muscovy|Pequim|Rouen`,
  Pavão: `Azul-indiano|Branco|Verde`,
  Porco: `Duroc|Landrace|Large White|Pietrain`,
  Pônei: `Falabella|Pônei Brasileiro|Shetland|Welsh`,
  Peru: `Bourbon Red|Bronzeado|Narragansett|Branco de peito largo`,
  Vaca: `Angus|Brahman|Charolês|Girolando|Holandesa|Hereford|Jersey|Nelore|Pardo-Suíço|Simmental`,
  Agapornis: `Personatus|Roseicollis|Fischeri`,
  Axolote: `Albino|Arlequim|Dourado|Leucístico|Selvagem`,
  Camaleão: `Do Iêmen|Do Quênia|Pantera`,
  Calopsita: `Arlequim|Cara-branca|Canela|Lutino|Pérola|Silvestre`,
  Canário: `Belga|Harzer Roller|Timbrado Espanhol|Waterslager`,
  Chinchila: `Bege|Branca|Cinza-padrão|Ebony|Violeta`,
  ['Cobra-do-milho']: `Âmbar|Anery|Amelanística|Caramelo|Okeetee|Snow`,
  ['Gecko-leopardo']: `Albino|Banded|Blizzard|Mack Snow|Tangerine`,
  Furão: `Albino|Canela|Sable`,
  Iguana: `Azul|Comum|Verde`,
  ['Porquinho-da-índia']: `Abissínio|Coroado Americano|Coroado Inglês|Peruano|Rex|Sheltie|Teddy|Texel`,
  Hamster: `Anão-russo|Chinês|Roborovski|Sírio`,
  Peixe: `Betta|Carpa koi|Kinguio|Peixe-palhaço`
};

// feito ordenacao de racas com prioridade para SRD ou Nao sei porque usuarios perdiam tempo rolando listas longas e resolvemos inserindo a opcao padrao no topo
function orderBreedsForAnimal(breeds, animalTypeOrSpecies) {
  const isDogOrCat = animalTypeOrSpecies === 'Cachorro' || animalTypeOrSpecies === 'Gato';
  const defaultOption = isDogOrCat ? 'Vira-lata (SRD)' : 'Não sei';
  const normalizedDefault = normalizeSelectSearch(defaultOption);

  const others = [];
  const seen = new Set();
  seen.add(normalizedDefault);

  (breeds || []).forEach((breed) => {
    const trimmed = String(breed || '').trim();
    if (!trimmed) return;
    const normalized = normalizeSelectSearch(trimmed);
    // feito expurgo de Vira-lata para exoticos e Nao sei para caes e gatos porque opcoes incongruentes poluiam a selecao e resolvemos filtrando pela especie
    if (!isDogOrCat && (normalized.includes('vira-lata') || normalized.includes('srd'))) {
      return;
    }
    if (isDogOrCat && normalized === 'nao sei') {
      return;
    }
    if (!seen.has(normalized)) {
      seen.add(normalized);
      others.push(trimmed);
    }
  });

  others.sort((first, second) => first.localeCompare(second, 'pt-BR'));
  return [defaultOption, ...others];
}

function getSpeciesBreedOptions(species) {
  const raw = (BREEDS_BY_SPECIES[species] || '').split('|').filter(Boolean);
  return orderBreedsForAnimal(raw, species);
}

function populateSpeciesSelect(select, animalType) {
  const previousValue = select.value;
  const speciesOptions = SPECIES_OPTIONS[animalType] || [];
  select.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = 'Selecione a espécie';
  select.appendChild(placeholder);
  speciesOptions.forEach((species) => {
    const option = document.createElement('option');
    option.value = species;
    option.textContent = species;
    select.appendChild(option);
  });
  select.value = speciesOptions.includes(previousValue) ? previousValue : '';
  select.dispatchEvent(new Event('customselect:refresh', { bubbles: true }));
}

function uniqueBreedOptions(breeds) {
  const uniqueBreeds = new Map();
  breeds.forEach((breed) => {
    const normalizedBreed = String(breed || '').trim();
    const key = normalizedBreed.toLocaleLowerCase('pt-BR');
    if (key && !uniqueBreeds.has(key)) uniqueBreeds.set(key, normalizedBreed);
  });
  return [...uniqueBreeds.values()];
}

function hasMatchingParentBreed(animalBreed, motherBreed, fatherBreed) {
  const normalizedAnimalBreed = normalizeSelectSearch(animalBreed);
  if (!normalizedAnimalBreed) return false;
  const isUndetermined = ['nao sei', 'desconhecido', 'nao informado', 'nao sei / mestico', 'vira-lata (srd)', 'vira-lata'].includes(normalizedAnimalBreed);
  return [motherBreed, fatherBreed].some((parentBreed) => {
    const normParent = normalizeSelectSearch(parentBreed);
    if (!normParent) return false;
    if (normParent === normalizedAnimalBreed) return true;
    if (isUndetermined && ['nao sei', 'desconhecido', 'nao informado', 'nao sei / mestico', 'vira-lata (srd)', 'vira-lata'].includes(normParent)) {
      return true;
    }
    if (['desconhecido', 'nao informado', 'nao sei'].includes(normParent)) {
      return true;
    }
    return false;
  });
}

function formatSpeciesBreed(species, breed) {
  if (!species || !breed) return breed;
  const normalized = normalizeSelectSearch(breed);
  if (['desconhecido', 'nao informado'].includes(normalized)) return breed;
  if (['nao sei', 'nao sei / mestico', 'mestico'].includes(normalized)) return 'Não sei';
  if (breed.toLowerCase().startsWith(species.toLowerCase())) return breed;
  return `${species} - ${breed}`;
}

function populateBreedSelect(select, breeds, placeholder, extraOptions = [], animalTypeOrSpecies = '') {
  select.replaceChildren();
  const placeholderOption = document.createElement('option');
  placeholderOption.value = '';
  placeholderOption.textContent = placeholder;
  select.appendChild(placeholderOption);

  const orderedBreeds = animalTypeOrSpecies ? orderBreedsForAnimal(breeds, animalTypeOrSpecies) : uniqueBreedOptions(breeds);
  const optionsList = uniqueBreedOptions([...orderedBreeds, ...extraOptions]);

  optionsList.forEach((breed) => {
    const option = document.createElement('option');
    option.value = breed;
    option.textContent = breed;
    select.appendChild(option);
  });
  select.dispatchEvent(new Event('customselect:refresh', { bubbles: true }));
}

function getBreedOptions(animalType) {
  if (!breedOptionsCache.has(animalType)) {
    const catalog = (BREED_CATALOGS[animalType] || '').split('|').filter(Boolean);
    const request = getSupabaseClient().rpc('get_active_breeds', { p_animal_type: animalType })
      .then(({ data, error }) => {
        if (error) throw new Error(mensagemDeErroSegura(error));
        const activeBreeds = (data || []).map((item) => item?.breed).filter(Boolean);
        return orderBreedsForAnimal([...catalog, ...activeBreeds], animalType);
      })
      .catch((error) => {
        console.warn(`Usando catálogo local de raças para ${animalType}:`, error);
        return orderBreedsForAnimal(catalog, animalType);
      });
    breedOptionsCache.set(animalType, request);
  }
  return breedOptionsCache.get(animalType);
}

async function loadDynamicBreedOptions(animalType, selectElement, defaultLabel, extraOptions = []) {
  if (!selectElement) return [];
  selectElement.dataset.animalType = animalType || '';
  const catalog = (BREED_CATALOGS[animalType] || '').split('|').filter(Boolean);
  populateBreedSelect(selectElement, catalog, defaultLabel, extraOptions, animalType);
  if (!animalType) return [];

  const breeds = await getBreedOptions(animalType);
  if (selectElement.dataset.animalType !== animalType) return breeds;
  const selectedValue = selectElement.value;
  populateBreedSelect(selectElement, breeds, defaultLabel, extraOptions, animalType);
  if (selectedValue && [...selectElement.options].some((option) => option.value === selectedValue)) {
    selectElement.value = selectedValue;
  }
  return breeds;
}

function setupCreatePostForm() {
  const form = document.getElementById('createPostForm');
  const typeField = form?.elements.animalType;
  const stateField = form?.elements.state;
  const cityField = form?.elements.city;
  const geneticsFields = document.getElementById('postGeneticsFields');
  const detailsStep = document.getElementById('postDetailsStep');
  const mediaStep = document.getElementById('postMediaStep');
  const submitButton = document.getElementById('createPostSubmit');
  const speciesField = document.getElementById('postSpecies');
  const speciesLabel = document.getElementById('postSpeciesField');
  const sizeField = document.getElementById('postSizeField');
  const sizeInput = document.getElementById('postSize');
  const breedField = document.getElementById('postBreed');
  const motherBreedField = document.getElementById('motherBreed');
  const fatherBreedField = document.getElementById('fatherBreed');
  const photoInput = document.getElementById('photoInput');
  const photoAddButton = document.getElementById('photoAddButton');
  const photoGallery = document.getElementById('photoGallery');
  const photoCount = document.getElementById('photoCount');

  if (!form || !typeField || !stateField || !cityField || !geneticsFields || !detailsStep || !mediaStep || !submitButton || !speciesField || !speciesLabel || !sizeField || !sizeInput || !breedField || !motherBreedField || !fatherBreedField || !photoInput || !photoAddButton || !photoGallery) return;

  const selectedFiles = [];

  const renderPhotoGallery = () => {
    photoGallery.querySelectorAll('.photo-preview').forEach((preview) => preview.remove());
    selectedFiles.forEach((file, index) => {
      const reader = new FileReader();
      reader.onload = () => {
        const preview = document.createElement('div');
        preview.className = 'photo-preview';
        preview.innerHTML = `<img src="${reader.result}" alt="Prévia da foto ${index + 1}"><button type="button" aria-label="Remover foto ${index + 1}">×</button>`;
        preview.querySelector('button').addEventListener('click', () => {
          selectedFiles.splice(index, 1);
          renderPhotoGallery();
        });
        photoGallery.insertBefore(preview, photoAddButton);
      };
      reader.readAsDataURL(file);
    });
    photoCount.textContent = `${selectedFiles.length}/4`;
    photoAddButton.hidden = selectedFiles.length >= 4;
  };

  photoAddButton.addEventListener('click', () => photoInput.click());
  photoInput.addEventListener('change', () => {
    const availableSlots = 4 - selectedFiles.length;
    Array.from(photoInput.files).slice(0, availableSlots).forEach((file) => {
      const error = validateImageFile(file);
      if (!error) selectedFiles.push(file);
      else showToast(error, 'error');
    });
    if (photoInput.files.length > availableSlots) showToast('Você pode adicionar no máximo 4 fotos.', 'error');
    photoInput.value = '';
    renderPhotoGallery();
  });
  form.__selectedFiles = selectedFiles;

  form.elements.phone.addEventListener('input', (event) => {
    event.target.value = formatPhoneNumber(event.target.value);
  });

  form.elements.instagram.addEventListener('input', (event) => {
    event.target.value = event.target.value.replace(/[^a-z0-9._]/gi, '').slice(0, 30).toLowerCase();
  });

  const loadStates = async () => {
    try {
      const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome');
      const states = await response.json();
      stateField.innerHTML = '<option value="">Selecione o estado</option>';
      states.forEach((state) => {
        stateField.insertAdjacentHTML('beforeend', `<option value="${escapeHTML(state.sigla)}">${escapeHTML(state.nome)}</option>`);
      });
    } catch (error) {
      stateField.innerHTML = '<option value="">Estados indisponíveis</option>';
    }
  };

  let currentCityFetchState = '';
  const loadCities = async () => {
    const selectedState = stateField.value;
    currentCityFetchState = selectedState;
    cityField.innerHTML = '<option value="">Selecione a cidade</option>';
    cityField.disabled = !selectedState;
    if (!selectedState) return;

    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${selectedState}/municipios`);
      const cities = await response.json();
      if (currentCityFetchState !== selectedState) return;
      cities.forEach((city) => {
        cityField.insertAdjacentHTML('beforeend', `<option value="${escapeHTML(city.nome)}">${escapeHTML(city.nome)}</option>`);
      });
    } catch (error) {
      if (currentCityFetchState === selectedState) {
        cityField.innerHTML = '<option value="">Cidades indispon\u00edveis</option>';
      }
    }
  };

  const updateBreedFields = () => {
    const val = form.elements.supportType?.value || 'adocao';
    const isAdoption = val === 'adocao';
    const isSponsorship = val === 'apadrinhamento';
    const animalType = typeField.value;
    const speciesOptions = SPECIES_OPTIONS[animalType] || [];
    const needsSpecies = Boolean(speciesOptions.length);
    const typeChanged = typeField.dataset.previousValue !== animalType;
    if (typeChanged) {
      speciesField.value = '';
      breedField.value = '';
      motherBreedField.value = '';
      fatherBreedField.value = '';
      typeField.dataset.previousValue = animalType;
      speciesField.dataset.previousValue = '';
    }
    populateSpeciesSelect(speciesField, animalType);
    const species = needsSpecies ? speciesField.value : '';
    if (speciesField.dataset.previousValue !== species) {
      breedField.value = '';
      motherBreedField.value = '';
      fatherBreedField.value = '';
      speciesField.dataset.previousValue = species;
    }
    const canChooseBreed = Boolean(animalType && (!needsSpecies || (species && BREEDS_BY_SPECIES[species])));
    speciesLabel.hidden = !needsSpecies;
    speciesField.disabled = !needsSpecies;
    if (!isAdoption) {
      geneticsFields.hidden = true;
      [breedField, motherBreedField, fatherBreedField].forEach((select) => {
        select.disabled = true;
        select.value = '';
      });
    } else {
      geneticsFields.hidden = !canChooseBreed;
      [breedField, motherBreedField, fatherBreedField].forEach((select) => {
        select.disabled = !canChooseBreed;
      });
    }

    const animalName = {
      Cachorro: 'cachorro', Gato: 'gato', Fazenda: 'animal de fazenda',
      'Ex\u00f3tico': 'animal ex\u00f3tico', Marinho: 'animal marinho'
    }[animalType] || 'animal';
    breedField.closest('label').firstChild.textContent = (species ? ('Ra\u00e7a da esp\u00e9cie ' + species) : ('Qual a ra\u00e7a/esp\u00e9cie do ' + animalName + '?')) + ' ';
    motherBreedField.closest('label').firstChild.textContent = (species ? ('Ra\u00e7a da m\u00e3e (' + species + ')') : 'Ra\u00e7a ou Esp\u00e9cie da M\u00e3e') + ' ';
    fatherBreedField.closest('label').firstChild.textContent = (species ? ('Ra\u00e7a do pai (' + species + ')') : 'Ra\u00e7a/Esp\u00e9cie do Pai') + ' ';
    const showSize = !isSponsorship && animalType === 'Cachorro';
    sizeField.hidden = !showSize;
    sizeInput.disabled = !showSize;
    sizeInput.required = false;
    if (!showSize) sizeInput.value = '';

    const parentOptions = ['Desconhecido', 'Não informado'];
    if (canChooseBreed && needsSpecies && isAdoption) {
      const breeds = getSpeciesBreedOptions(species);
      populateBreedSelect(breedField, breeds, 'Selecione a raça', [], species);
      populateBreedSelect(motherBreedField, breeds, 'Selecione a raça', parentOptions, species);
      populateBreedSelect(fatherBreedField, breeds, 'Selecione a raça', parentOptions, species);
    } else if (canChooseBreed && isAdoption) {
      void Promise.all([
        loadDynamicBreedOptions(animalType, breedField, 'Selecione a raça/espécie'),
        loadDynamicBreedOptions(animalType, motherBreedField, 'Selecione a raça/espécie', parentOptions),
        loadDynamicBreedOptions(animalType, fatherBreedField, 'Selecione a raça/espécie', parentOptions)
      ]).then(updateProgressiveStages);
    } else {
      populateBreedSelect(breedField, [], 'Selecione a espécie primeiro');
      populateBreedSelect(motherBreedField, [], 'Selecione a espécie primeiro', parentOptions);
      populateBreedSelect(fatherBreedField, [], 'Selecione a espécie primeiro', parentOptions);
    }
    updateProgressiveStages();
  };

  const revealStep = (element, visible) => {
    const shouldShow = Boolean(visible);
    if (!element || element.hidden === !shouldShow) return;
    element.hidden = !shouldShow;
    if (shouldShow) {
      element.classList.remove('is-revealing');
      requestAnimationFrame(() => element.classList.add('is-revealing'));
    } else {
      element.classList.remove('is-revealing');
    }
  };

  function updateProgressiveStages() {
    const val = form.elements.supportType?.value || 'adocao';
    const isAdoption = val === 'adocao';
    const isSponsorship = val === 'apadrinhamento';
    const hasType = Boolean(typeField.value);
    const needsSpecies = Boolean(SPECIES_OPTIONS[typeField.value]?.length);
    const hasSpecies = !needsSpecies || Boolean(speciesField.value);
    const requiresGenetics = isAdoption && (!needsSpecies || Boolean(BREEDS_BY_SPECIES[speciesField.value]));
    revealStep(detailsStep, hasType);

    const parentMatches = !requiresGenetics || hasMatchingParentBreed(breedField.value, motherBreedField.value, fatherBreedField.value);
    const geneticsError = document.getElementById('postGeneticsError');
    const geneticsComplete = Boolean(breedField.value && motherBreedField.value && fatherBreedField.value);
    if (geneticsError) {
      geneticsError.hidden = !requiresGenetics || !geneticsComplete || parentMatches;
    }

    const hasContact = Boolean(form.phone.value.trim() || form.email.value.trim() || form.instagram.value.trim());
    const geneticReady = !requiresGenetics || Boolean(
      breedField.value.trim() && parentMatches && motherBreedField.value.trim() && fatherBreedField.value.trim()
    );
    const sizeReady = isSponsorship || typeField.value !== 'Cachorro' || Boolean(sizeInput.value);

    const detailsReady = Boolean(
      hasType && hasSpecies && form.title.value.trim() && form.description.value.trim()
      && stateField.value && cityField.value && geneticReady
      && sizeReady
      && hasContact
    );
    revealStep(mediaStep, detailsReady);
    submitButton.hidden = !detailsReady;
  }

  const updateModalityFields = () => {
    const val = form.elements.supportType?.value || 'adocao';
    const isAdoption = val === 'adocao';
    const isLT = val === 'lar_temporario';
    const isSponsorship = val === 'apadrinhamento';
    // feito exibicao condicional de genetica e porte porque modalidades como apadrinhamento e especies nao-caninas nao exigem esses dados e resolvemos ocultando e desabilitando os inputs no form
    const ltFields = document.getElementById('larTemporarioFields');
    const sponsorshipFields = document.getElementById('apadrinhamentoFields');
    if (ltFields) {
      revealStep(ltFields, isLT);
      ltFields.disabled = !isLT;
      if (!isLT) {
        ['ltDuration', 'ltCostsCovered', 'ltHomeRequirements'].forEach((fName) => {
          if (form.elements[fName]) form.elements[fName].value = '';
        });
      }
    }
    if (sponsorshipFields) {
      revealStep(sponsorshipFields, isSponsorship);
      sponsorshipFields.disabled = !isSponsorship;
      if (!isSponsorship) {
        ['sponsorshipPurpose', 'sponsorshipGoal', 'sponsorshipPix'].forEach((fName) => {
          if (form.elements[fName]) form.elements[fName].value = '';
        });
      }
    }
    const livingFieldset = document.getElementById('postLivingFieldset');
    if (livingFieldset) {
      revealStep(livingFieldset, !isSponsorship);
      livingFieldset.disabled = isSponsorship;
      if (isSponsorship) {
        ['goodWithKids', 'goodWithDogs', 'goodWithCats'].forEach((fName) => {
          if (form.elements[fName]) form.elements[fName].value = '';
        });
      }
    }
    const apartmentField = document.getElementById('postApartmentField');
    if (apartmentField) {
      apartmentField.hidden = isSponsorship;
      const aptInput = form.elements.apartmentFriendly;
      if (aptInput) {
        aptInput.disabled = isSponsorship;
        if (isSponsorship) aptInput.value = '';
      }
    }
    const energyLevelField = document.getElementById('postEnergyLevelField');
    if (energyLevelField) {
      energyLevelField.hidden = isSponsorship;
      const energyInput = form.elements.energyLevel;
      if (energyInput) {
        energyInput.disabled = isSponsorship;
        if (isSponsorship) energyInput.value = '';
      }
    }
    updateBreedFields();
  };

  stateField.addEventListener('change', loadCities);
  typeField.addEventListener('change', updateBreedFields);
  speciesField.addEventListener('change', updateBreedFields);
  if (form.elements.supportType) {
    form.elements.supportType.addEventListener('change', updateModalityFields);
  }
  form.addEventListener('input', updateProgressiveStages);
  form.addEventListener('change', updateProgressiveStages);

  // feito salvamento automatico de rascunho em localStorage porque perdas de conexao ou recarregamentos limpavam o formulario e resolvemos persistindo a cada digitacao
  const savePostDraft = () => {
    try {
      const draft = {
        title: form.title?.value || '',
        description: form.description?.value || '',
        animalType: typeField?.value || '',
        species: speciesField?.value || '',
        supportType: form.elements.supportType?.value || 'adocao',
        phone: form.phone?.value || '',
        email: form.email?.value || '',
        instagram: form.instagram?.value || ''
      };
      localStorage.setItem('petamor_post_draft', JSON.stringify(draft));
    } catch (_) {}
  };
  form.addEventListener('input', savePostDraft);
  form.addEventListener('change', savePostDraft);
  try {
    const rawDraft = localStorage.getItem('petamor_post_draft');
    if (rawDraft) {
      const d = JSON.parse(rawDraft);
      if (d && (d.title || d.description)) {
        const notice = document.createElement('div');
        notice.className = 'draft-notice';
        notice.innerHTML = `
          <span>Você possui um rascunho salvo anteriormente. Deseja restaurá-lo?</span>
          <div style="display:flex;gap:8px;">
            <button type="button" class="btn btn-secondary btn-sm" id="btnRestoreDraft">Restaurar</button>
            <button type="button" class="btn btn-sm" id="btnDiscardDraft" style="background:transparent;border:none;cursor:pointer;color:#64748b;">Descartar</button>
          </div>
        `;
        form.parentNode.insertBefore(notice, form);
        notice.querySelector('#btnRestoreDraft')?.addEventListener('click', () => {
          if (d.title && form.title) form.title.value = d.title;
          if (d.description && form.description) form.description.value = d.description;
          if (d.phone && form.phone) form.phone.value = d.phone;
          if (d.email && form.email) form.email.value = d.email;
          if (d.instagram && form.instagram) form.instagram.value = d.instagram;
          if (d.animalType && typeField) {
            typeField.value = d.animalType;
            updateBreedFields();
          }
          if (d.supportType && form.elements.supportType) {
            form.elements.supportType.value = d.supportType;
            updateModalityFields();
          }
          updateProgressiveStages();
          notice.remove();
          showToast('Rascunho restaurado com sucesso!', 'info');
        });
        notice.querySelector('#btnDiscardDraft')?.addEventListener('click', () => {
          localStorage.removeItem('petamor_post_draft');
          notice.remove();
        });
      }
    }
  } catch (_) {}

  updateModalityFields();
  loadStates();
  form.addEventListener('submit', handleCreatePostSubmit);
}

async function handleCreatePostSubmit(event) {
  event.preventDefault();

  const form = event.currentTarget;
  const submitButton = form.querySelector('button[type="submit"]') || document.getElementById('createPostSubmit');
  const originalSubmitText = submitButton ? submitButton.innerHTML : '';

  // feito desabilitacao imediata do botao de submit porque cliques duplos enviavam posts duplicados e resolvemos bloqueando com indicador de carregamento
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = '<span class="spinner" aria-hidden="true"></span> Publicando anúncio...';
  }

  const unlockSubmit = () => {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = originalSubmitText;
    }
  };

  const supportType = form.elements.supportType?.value || 'adocao';
  const isAdoption = supportType === 'adocao';
  const isLT = supportType === 'lar_temporario';
  const isSponsorship = supportType === 'apadrinhamento';

  const title = form.title.value.trim();
  const description = form.description.value.trim();
  const animalType = form.animalType.value;
  const isDog = animalType === 'Cachorro';
  const species = (form.elements.namedItem('species')?.value || '').trim();
  const breedValue = (form.elements.namedItem('breed')?.value || '').trim();
  const requiresGenetics = isAdoption && (!SPECIES_OPTIONS[animalType]?.length || Boolean(BREEDS_BY_SPECIES[species]));
  const size = (!isSponsorship && isDog) ? (form.elements.namedItem('size')?.value || '').trim() || null : null;
  const motherBreedValue = (form.elements.namedItem('motherBreed')?.value || '').trim();
  const fatherBreedValue = (form.elements.namedItem('fatherBreed')?.value || '').trim();
  const breed = requiresGenetics ? formatSpeciesBreed(species, breedValue) || null : (species || null);
  const motherBreed = requiresGenetics ? formatSpeciesBreed(species, motherBreedValue) || null : null;
  const fatherBreed = requiresGenetics ? formatSpeciesBreed(species, fatherBreedValue) || null : null;
  const state = form.state.value.trim();
  const city = form.city.value.trim();
  const phone = form.phone.value.trim();
  const email = form.email.value.trim();
  const instagram = form.instagram.value.trim();
  const photoFiles = form.__selectedFiles || [];

  // feito conversao de campos vazios para null porque armazenar false excluia animais sem informacao dos filtros tri-state e resolvemos tratando 'sim'/'nao' explicitamente
  const simNaoOuNulo = (nome) => {
    const v = (form.elements.namedItem(nome)?.value || '').trim();
    if (v === 'sim') return true;
    if (v === 'nao') return false;
    return null;
  };
  const textoOuNulo = (nome) => (form.elements.namedItem(nome)?.value || '').trim() || null;

  if (!title || !description || !animalType || !state || !city || (requiresGenetics && !breedValue) || (SPECIES_OPTIONS[animalType]?.length && !species) || (!isSponsorship && isDog && !size)) {
    showToast('Por favor, preencha todos os campos obrigat\u00f3rios, incluindo a cidade.', 'error');
    return;
  }

  const hasMatchingParent = hasMatchingParentBreed(breedValue, motherBreedValue, fatherBreedValue);
  if (requiresGenetics && (!motherBreedValue || !fatherBreedValue || !hasMatchingParent)) {
    showToast('Erro gen\u00e9tico: Pelo menos um dos pais deve ser da mesma ra\u00e7a/esp\u00e9cie do animal doado.', 'error');
    return;
  }

  const { data: userData } = await getSupabaseClient().auth.getUser();
  if (!userData.user) {
    showToast('Voc\u00ea precisa fazer login para criar uma publica\u00e7\u00e3o.', 'error');
    window.location.href = 'conta/login.html';
    return;
  }

  if (!photoFiles.length) {
    unlockSubmit();
    showToast('Adicione pelo menos uma foto do animal.', 'error');
    return;
  }

  if (containsBannedWord(title) || containsBannedWord(description)) {
    showToast('Vamos manter um linguajar respeitoso para todos. Revise o t\u00edtulo e a descri\u00e7\u00e3o antes de publicar.', 'error');
    return;
  }

  if (!isValidInstagram(instagram)) {
    showToast('Informe apenas letras, n\u00fameros, pontos e underlines no Instagram.', 'error');
    return;
  }

  if (!phone && !email && !instagram) {
    showToast('Informe pelo menos um meio de contato externo.', 'error');
    return;
  }

  const uploadedResults = [];
  try {
    // feito envio sequencial de imagens com rastreamento de caminhos porque upload em lote sem controle impedia o rollback em caso de falha e resolvemos armazenando uploadedResults
    for (const file of photoFiles) {
      const res = await uploadPostImage(file, userData.user.id);
      uploadedResults.push(res);
    }
    const imageUrls = uploadedResults.map((item) => (typeof item === 'object' && item.publicUrl ? item.publicUrl : String(item)));
    const contatoFinal = [phone && `Tel: ${phone}`, email && `Email: ${email}`, instagram && `IG: @${instagram}`].filter(Boolean).join(' | ');

    const post = {
      user_id: userData.user.id,
      title,
      description,
      contact_info: contatoFinal,
      state,
      city,
      animal_type: animalType,
      breed,
      size: size ?? null,
      mother_breed: motherBreed,
      father_breed: fatherBreed,
      image_urls: imageUrls,
      support_type: supportType,
      lt_duration: isLT ? textoOuNulo('ltDuration') : null,
      lt_costs_covered: isLT ? textoOuNulo('ltCostsCovered') : null,
      lt_home_requirements: isLT ? textoOuNulo('ltHomeRequirements') : null,
      sponsorship_purpose: isSponsorship ? textoOuNulo('sponsorshipPurpose') : null,
      sponsorship_goal: isSponsorship ? textoOuNulo('sponsorshipGoal') : null,
      sponsorship_pix: isSponsorship ? textoOuNulo('sponsorshipPix') : null,
      age_group: textoOuNulo('ageGroup'),
      gender: textoOuNulo('gender'),
      energy_level: isSponsorship ? null : textoOuNulo('energyLevel'),
      neutered: simNaoOuNulo('neutered'),
      vaccinated: simNaoOuNulo('vaccinated'),
      dewormed: simNaoOuNulo('dewormed'),
      special_needs: simNaoOuNulo('specialNeeds'),
      apartment_friendly: isSponsorship ? null : simNaoOuNulo('apartmentFriendly'),
      good_with_kids: isSponsorship ? null : simNaoOuNulo('goodWithKids'),
      good_with_dogs: isSponsorship ? null : simNaoOuNulo('goodWithDogs'),
      good_with_cats: isSponsorship ? null : simNaoOuNulo('goodWithCats'),
      status: 'active'
    };
    const requireApproval = await getPostApprovalSetting();
    const isAdmin = await isCurrentUserAdmin();
    if (requireApproval && !isAdmin) {
      post.status = 'pending';
    }

    const { error } = await getSupabaseClient().from('posts').insert([post]).select().single();
    if (error) {
      console.error(error);
      // feito rollback manual no Storage imagens-adocao porque a falha no insert do banco deixava arquivos orfaos e resolvemos removendo os caminhos de uploadedResults
      const pathsToRollback = uploadedResults.map((r) => r.path).filter(Boolean);
      if (pathsToRollback.length > 0) {
        await getSupabaseClient().storage.from('imagens-adocao').remove(pathsToRollback);
      }

      if (error.message.includes('RATE_LIMIT_EXCEEDED')) {
        showToast('Voc\u00ea excedeu os limites da nossa infraestrutura que \u00e9 modesta. Voc\u00ea poder\u00e1 postar mais daqui a uma hora.', 'error');
        return;
      }
      showToast(mensagemDeErroSegura(error), 'error');
      return;
    }

    if (post.status === 'pending') {
      showToast('Publica\u00e7\u00e3o enviada com sucesso! Ela est\u00e1 em an\u00e1lise pela modera\u00e7\u00e3o e ficar\u00e1 vis\u00edvel publicamente assim que aprovada.', 'info');
      try {
        sessionStorage.setItem('petamor_flash_toast', JSON.stringify({
          msg: 'Publica\u00e7\u00e3o enviada com sucesso! Ela est\u00e1 em an\u00e1lise pela modera\u00e7\u00e3o e ficar\u00e1 vis\u00edvel publicamente assim que aprovada.',
          type: 'info'
        }));
      } catch (_) {}
      setTimeout(() => {
        window.location.href = 'publicacoes/my-posts.html';
      }, 700);
    } else {
      showToast('Publica\u00e7\u00e3o criada com sucesso!');
      try {
        sessionStorage.setItem('petamor_flash_toast', JSON.stringify({
          msg: 'Publica\u00e7\u00e3o criada com sucesso!',
          type: 'success'
        }));
      } catch (_) {}
      try { localStorage.removeItem('petamor_post_draft'); } catch (_) {}
      setTimeout(() => {
        window.location.href = 'index.html';
      }, 700);
    }
  } catch (error) {
    unlockSubmit();
    if (uploadedResults && uploadedResults.length > 0) {
      const pathsToClean = uploadedResults.map((r) => r.path).filter(Boolean);
      if (pathsToClean.length > 0) {
        try {
          await getSupabaseClient().storage.from('imagens-adocao').remove(pathsToClean);
        } catch (_) {}
      }
    }
    showToast(mensagemDeErroSegura(error, 'Erro ao criar a publica\u00e7\u00e3o.'), 'error');
  }
}

const POST_CARD_COLUMNS = 'id, title, animal_type, breed, state, city, image_urls, status, support_type, created_at, profiles(full_name, username, avatar_url)';
const feedSWRMemoryCache = new Map();

function getFeedSkeletonHTML(count = 4) {
  return `
    <article class="feed-card skeleton-card">
      <div class="skeleton skeleton-img"></div>
      <div class="feed-card-body">
        <div class="skeleton-author">
          <div class="skeleton skeleton-avatar"></div>
          <div class="skeleton skeleton-title" style="width: 120px; height: 14px; margin-bottom: 0;"></div>
        </div>
        <div class="skeleton skeleton-title"></div>
        <div class="skeleton skeleton-text" style="width: 70%;"></div>
        <div class="skeleton skeleton-text" style="width: 45%;"></div>
      </div>
    </article>
  `.repeat(count);
}
function renderFeed(append = false) {
  const feedTarget = document.getElementById('feedPosts');
  const typeField = document.getElementById('feedType');
  const breedField = document.getElementById('feedBreed');
  const cityField = document.getElementById('feedCity');
  const stateField = document.getElementById('feedState');

  if (!feedTarget) return;

  if (!append) {
    feedCurrentPage = 0;
    feedTarget.innerHTML = getFeedSkeletonHTML(4);
  }
  const page = feedCurrentPage;
  const stateValue = (stateField?.value || '').trim();
  const cityValue = (cityField?.value || '').trim();
  const typeValue = typeField?.value || 'Todos';
  const breedValue = (breedField?.value || '').trim().toLowerCase();
  const breedLabel = breedField?.selectedOptions[0]?.textContent || breedValue;

  // feito projecao POST_CARD_COLUMNS nas consultas do feed porque selecionar todos os campos saturava a banda e atrasava o LCP e resolvemos requisitando apenas colunas visiveis
  let query = getSupabaseClient().from('posts').select(POST_CARD_COLUMNS).eq('status', 'active').order('created_at', { ascending: false }).range(page * FEED_PAGE_SIZE, (page + 1) * FEED_PAGE_SIZE - 1);

  if (stateValue) query = query.eq('state', stateValue);
  if (typeValue !== 'Todos') query = query.eq('animal_type', typeValue);
  if (breedValue) {
    if (breedValue === 'não sei' || breedValue === 'nao sei') {
      query = query.or('breed.eq.Não sei,breed.ilike.%Não sei%');
    } else {
      query = query.ilike('breed', `%${breedValue}%`);
    }
  }

  query.then(({ data, error }) => {
    if (error) {
      feedTarget.innerHTML = `<div class="empty-state">Não foi possível carregar as publicações: ${escapeHTML(error.message)}</div>`;
      return;
    }
    const filteredPosts = data || [];

    if (!filteredPosts.length && !append) {
      const isDogOrCat = typeValue === 'Cachorro' || typeValue === 'Gato';
      const alternativeSuggestion = isDogOrCat ? 'um Vira-lata' : 'um animal sem raça definida';
      feedTarget.innerHTML = breedValue
        ? `<div class="empty-state">Poxa! No momento não temos nenhum ${escapeHTML(breedLabel)} precisando de um lar. Que tal dar uma chance a ${alternativeSuggestion} ou conhecer outros animais incríveis?</div>`
        : '<div class="empty-state">Poxa! No momento não encontramos animais com esses filtros. Que tal tentar outra cidade ou conhecer outras categorias?</div>';
      return;
    }

    const cardsHTML = renderProximityDivider(filteredPosts, cityValue, (post) => `
      <article class="feed-card">
        <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
        ${generateImageCarouselHTML(post.image_urls, post.title)}
        <div class="feed-card-body">
          ${renderAuthorBar(post.profiles)}
          <div class="feed-card-header">
            <div>
              <span class="mini-tag">${escapeHTML(formatAnimalType(post.animal_type))}</span>
              <h3>${escapeHTML(post.title)}</h3>
            </div>
            <p class="feed-location"><svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5.2-8 12-8 12s-8-6.8-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg> ${escapeHTML(formatPostLocation(post))}</p>
          </div>
          <div class="feed-meta">
            <p class="post-breed-info"><strong>Raça:</strong> ${escapeHTML(post.breed || 'Não informado')}</p>
          </div>
          <div class="post-action-row">
            ${postActionButtonsHTML(post, podeAdministrarAgora())}
          </div>
        </div>
      </article>
    `);
    if (append) {
      feedTarget.querySelector('.feed-load-more')?.remove();
      feedTarget.insertAdjacentHTML('beforeend', cardsHTML);
    } else {
      feedTarget.innerHTML = cardsHTML;
    }
    if (filteredPosts.length === FEED_PAGE_SIZE) {
      feedTarget.insertAdjacentHTML('beforeend', '<button class="btn btn-secondary feed-load-more" type="button">Carregar mais</button>');
      feedTarget.querySelector('.feed-load-more')?.addEventListener('click', () => { feedCurrentPage += 1; renderFeed(true); }, { once: true });
    }
    bindAdoptionButtons(feedTarget, filteredPosts);
    const postsById = new Map(filteredPosts.map((post) => [String(post.id), post]));
    feedTarget.querySelectorAll('[data-post-details]').forEach((button) => {
      button.addEventListener('click', () => openAdoptionModal(postsById.get(button.dataset.postDetails)));
    });
  }).catch((error) => {
    feedTarget.innerHTML = `<div class="empty-state">Não foi possível carregar as publicações: ${escapeHTML(error.message)}</div>`;
  });
}

function renderRecentPostsData(target, posts) {
  target.innerHTML = (posts || []).map((post) => `
    <article class="recent-post-card ${post.status === 'adopted' ? 'adopted-card' : ''}">
      <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
      ${post.status === 'adopted' ? '<div class="adopted-ribbon">Adotado! 🎉</div>' : ''}
      ${post.status === 'in_process' ? '<div class="adopted-ribbon" style="background: #f59e0b;">Em processo ⏳</div>' : ''}
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="recent-post-body">
        ${renderAuthorBar(post.profiles)}
        <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 6px;">
          <span class="mini-tag">${escapeHTML(formatAnimalType(post.animal_type))}</span>
          ${renderSupportTypeBadge(post.support_type)}
        </div>
        <h3>${escapeHTML(post.title)}</h3>
        <p class="recent-post-location"><svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5.2-8 12-8 12s-8-6.8-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg> ${escapeHTML(formatPostLocation(post))}</p>
        ${post.status === 'active' || post.status === 'in_process' ? `<div class="post-action-row">${postActionButtonsHTML(post, podeAdministrarAgora())}</div>` : ''}
      </div>
    </article>
  `).join('');

  const postsById = new Map((posts || []).map((post) => [String(post.id), post]));
  target.querySelectorAll('[data-adoption-post]').forEach((button) => {
    button.addEventListener('click', () => openAdoptionModal(postsById.get(button.dataset.adoptionPost)));
  });
  target.querySelectorAll('[data-post-details]').forEach((button) => {
    button.addEventListener('click', () => openAdoptionModal(postsById.get(button.dataset.postDetails)));
  });
}

function renderRecentPosts() {
  const target = document.getElementById('recentPosts');
  if (!target) return;

  // feito cache SWR em feedSWRMemoryCache com validade de 45s porque requisicoes frequentes a cada navegacao causavam lentidao e resolvemos servindo memoria antes da rede
  const cached = feedSWRMemoryCache.get('recent_posts_home');
  if (cached && (Date.now() - cached.time < 45000)) {
    renderRecentPostsData(target, cached.data);
  } else if (!target.children.length) {
    target.innerHTML = getFeedSkeletonHTML(4);
  }

  getSupabaseClient().from('posts').select(POST_CARD_COLUMNS).in('status', ['active', 'in_process']).order('created_at', { ascending: false }).limit(12)
    .then(({ data, error }) => {
      if (error) throw new Error(mensagemDeErroSegura(error));
      feedSWRMemoryCache.set('recent_posts_home', { time: Date.now(), data: data || [] });
      registerPostsInGlobalCache(data);
      renderRecentPostsData(target, data || []);
    })
    .catch((error) => {
      if (!cached) {
        target.innerHTML = `<div class="empty-state">Não foi possível carregar as publicações: ${escapeHTML(error.message)}</div>`;
      }
    });
}

async function loadStates(stateField, cityField) {
  if (!stateField || !cityField) return;
  try {
    const response = await fetch('https://servicodados.ibge.gov.br/api/v1/localidades/estados?orderBy=nome');
    const states = await response.json();
    stateField.innerHTML = '<option value="">Todos os estados</option>';
    states.forEach((state) => {
      stateField.insertAdjacentHTML('beforeend', `<option value="${escapeHTML(state.sigla)}">${escapeHTML(state.nome)}</option>`);
    });
  } catch (error) {
    stateField.innerHTML = '<option value="">Estados indisponíveis</option>';
  }
}

async function loadCities(stateField, cityField) {
  if (!stateField || !cityField) return;
  const state = stateField.value;
  cityField.innerHTML = '<option value="">Todas as cidades</option>';
  cityField.disabled = !state;
  if (!state) return;
  try {
    const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${state}/municipios`);
    const cities = await response.json();
    cities.forEach((city) => {
      cityField.insertAdjacentHTML('beforeend', `<option value="${escapeHTML(city.nome)}">${escapeHTML(city.nome)}</option>`);
    });
  } catch (error) {
    cityField.innerHTML = '<option value="">Cidades indisponíveis</option>';
  }
}

function setupFeedFilters() {
  const typeField = document.getElementById('feedType');
  const breedField = document.getElementById('feedBreed');
  const breedWrap = document.getElementById('breedFilterWrap');
  const stateField = document.getElementById('feedState');
  const cityField = document.getElementById('feedCity');

  if (!typeField || !breedField || !breedWrap || !stateField || !cityField) return;

  const toggleBreedFilter = async () => {
    const hasSpecificType = Boolean(typeField.value && typeField.value !== 'Todos');
    breedWrap.style.display = hasSpecificType ? 'grid' : 'none';
    breedField.disabled = !hasSpecificType;
    if (!hasSpecificType) {
      breedField.innerHTML = '<option value="">Selecione o tipo primeiro</option>';
      breedField.dispatchEvent(new Event('customselect:refresh', { bubbles: true }));
      return;
    }
    await loadDynamicBreedOptions(typeField.value, breedField, 'Todas as raças/espécies');
  };

  typeField.addEventListener('change', async () => {
    await toggleBreedFilter();
    renderFeed();
  });
  void toggleBreedFilter();
  document.getElementById('applyFiltersBtn')?.addEventListener('click', renderFeed);
  breedField.addEventListener('change', renderFeed);
  stateField.addEventListener('change', async () => { await loadCities(stateField, cityField); renderFeed(); });
  cityField.addEventListener('change', renderFeed);
  loadStates(stateField, cityField);
  renderFeed();
}

function setupAdoptionCarousel() {
  const carousel = document.getElementById('adoptionCarousel');
  const previousButton = document.getElementById('previousCategory');
  const nextButton = document.getElementById('nextCategory');
  if (!carousel || !previousButton || !nextButton) return;
  const scrollAmount = () => carousel.clientWidth * 0.85;
  previousButton.addEventListener('click', () => carousel.scrollBy({ left: -scrollAmount(), behavior: 'smooth' }));
  nextButton.addEventListener('click', () => carousel.scrollBy({ left: scrollAmount(), behavior: 'smooth' }));
}

function getPostImageUrl(post) {
  const image = Array.isArray(post.image_urls) ? post.image_urls[0] : post.image_urls;
  return sanitizeUrl(image) || 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80';
}

function getOptimizedImageUrl(url) {
  if (!url) return url;
  if (String(url).includes('/storage/v1/object/public/imagens-adocao/')) {
    const path = decodeURIComponent(String(url).split('/storage/v1/object/public/imagens-adocao/')[1].split('?')[0]);
    const { data } = getSupabaseClient().storage.from('imagens-adocao').getPublicUrl(path);
    return data?.publicUrl || url;
  }
  if (String(url).includes('/storage/v1/object/public/pet_images/')) {
    const path = decodeURIComponent(String(url).split('/storage/v1/object/public/pet_images/')[1].split('?')[0]);
    const { data } = getSupabaseClient().storage.from('pet_images').getPublicUrl(path);
    return data?.publicUrl || url;
  }
  return url;
}

function formatPostLocation(post) {
  const city = String(post?.city || '').trim();
  const state = String(post?.state || post?.estado || '').trim().toUpperCase();
  if (!city && !state) return 'Localização não informada';
  return [city, state].filter(Boolean).join(', ');
}

// feito calculo dinamico de faixa etaria via birth_date porque faixas fixas ficavam desatualizadas com o tempo e resolvemos computando a diferenca em meses na data atual
function faixaDeIdadePorNascimento(birthDate) {
  if (!birthDate) return null;
  const nasc = new Date(`${birthDate}T00:00:00`);
  if (Number.isNaN(nasc.getTime())) return null;
  const agora = new Date();
  if (nasc > agora) return null;
  let meses = (agora.getFullYear() - nasc.getFullYear()) * 12 + (agora.getMonth() - nasc.getMonth());
  if (agora.getDate() < nasc.getDate()) meses -= 1;
  const anos = meses / 12;
  if (anos < 1) return 'Filhote';
  if (anos < 3) return 'Jovem';
  if (anos < 8) return 'Adulto';
  return 'Idoso';
}

function generateImageCarouselHTML(imageUrls, altText) {
  const rawUrls = (Array.isArray(imageUrls) ? imageUrls : imageUrls ? [imageUrls] : []).filter(Boolean);
  const normalizedUrls = rawUrls.map(sanitizeUrl).filter(Boolean);
  const safeAltText = escapeHTML(altText || 'Imagem do animal');
  const urls = normalizedUrls.length
    ? normalizedUrls.map(getOptimizedImageUrl)
    : ['https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80'];

  if (urls.length === 1) {
    return `<img class="post-single-image" src="${escapeHTML(urls[0])}" alt="${safeAltText}" width="600" height="450" loading="lazy" decoding="async" />`;
  }

  return `
    <div class="post-carousel" data-carousel-index="0">
      <div class="post-carousel-track">
        ${urls.map((url, index) => `<img class="post-carousel-image" src="${escapeHTML(url)}" alt="${safeAltText} - imagem ${index + 1}" width="600" height="450" loading="lazy" decoding="async" />`).join('')}
      </div>
      <button class="post-carousel-button post-carousel-previous" type="button" data-carousel-action="previous" aria-label="Imagem anterior">&#8592;</button>
      <button class="post-carousel-button post-carousel-next" type="button" data-carousel-action="next" aria-label="Próxima imagem">&#8594;</button>
      <div class="post-carousel-dots" role="tablist" aria-label="Imagens da publicação">
        ${urls.map((url, index) => `<button class="post-carousel-dot${index === 0 ? ' active' : ''}" type="button" data-carousel-dot="${index}" role="tab" aria-label="Ir para a imagem ${index + 1}" aria-selected="${index === 0}"></button>`).join('')}
      </div>
    </div>
  `;
}

function getPostContact(post) {
  const contacts = getContactItems(post);
  return contacts.length ? contacts.join(' | ') : 'Contato não informado';
}
function lerFiltrosDaTela() {
  const v = (id) => (document.getElementById(id)?.value || '').trim();
  return {
    state: v('categoryState'), city: v('categoryCity'), breed: v('categoryBreed'),
    support_type: v('categorySupportType'),
    gender: v('categoryGender'), age: v('categoryAge'), size: v('categorySize'),
    energy: v('categoryEnergy'), neutered: v('categoryNeutered'),
    vaccinated: v('categoryVaccinated'), dewormed: v('categoryDewormed'),
    apartment: v('categoryApartment'), kids: v('categoryWithKids'),
    dogs: v('categoryWithDogs'), cats: v('categoryWithCats'), special: v('categorySpecial'),
  };
}

function algumFiltroAtivo(f) {
  return Object.values(f).some((x) => x !== '');
}

// feito filtro tri-state em aplicarBooleano porque buscas booleanas binarias excluiam registros com valor null e resolvemos ignorando condicoes vazias
function aplicarBooleano(query, coluna, valor) {
  if (valor === 'sim') return query.eq(coluna, true);
  if (valor === 'nao') return query.eq(coluna, false);
  return query;
}
function fotoVazia() {
  return { url: 'https://images.unsplash.com/photo-1552053831-71594a27632d?auto=format&fit=crop&w=800&q=72', alt: 'Cachorro aguardando adoção' };
}

// feito geracao de chipsDeAtributos com cores semanticas porque atributos booleanos precisavam de distincao visual e resolvemos mapeando classes de destaque
function chipsDeAtributos(post) {
  const chips = [];
  const add = (texto, tom) => chips.push(`<span class="atributo atributo-${tom || 'neutro'}">${escapeHTML(texto)}</span>`);

  if (post.gender) add(post.gender);
  if (post.age_group) add(post.age_group);
  if (post.size) add(`Porte ${post.size}`);
  if (post.energy_level) add(post.energy_level);

  if (post.neutered === true) add('Castrado', 'ok');
  if (post.vaccinated === true) add('Vacinado', 'ok');
  if (post.good_with_kids === true) add('Dócil c/ crianças', 'ok');
  if (post.special_needs === true) add('Necessidades especiais', 'atencao');

  return chips.length ? `<div class="post-atributos">${chips.join('')}</div>` : '';
}
const ROTULOS_FILTRO = {
  state: 'Estado', city: 'Cidade', breed: 'Raça', gender: 'Sexo', age: 'Idade',
  size: 'Porte', energy: 'Energia', neutered: 'Castrado', vaccinated: 'Vacinado',
  dewormed: 'Vermifugado', apartment: 'Apartamento', kids: 'Com crianças',
  dogs: 'Com cachorros', cats: 'Com gatos', special: 'Necessidades especiais',
};

// feito interatividade direta nos chips de filtro porque reabrir o painel para desmarcar causava atrito na navegacao e resolvemos removendo chaves via data-limpar-filtro
function renderChipsFiltros(f) {
  const alvo = document.getElementById('filtrosAtivos');
  if (!alvo) return;
  const ativos = Object.entries(f).filter(([, v]) => v !== '');
  if (!ativos.length) { alvo.hidden = true; alvo.innerHTML = ''; return; }

  alvo.hidden = false;
  alvo.innerHTML = ativos.map(([chave, valor]) => {
    const rotulo = ROTULOS_FILTRO[chave] || chave;
    const legivel = valor === 'sim' ? 'Sim' : valor === 'nao' ? 'Não' : valor;
    return `<button type="button" class="filtro-chip" data-limpar-filtro="${escapeHTML(chave)}">
      <span>${escapeHTML(rotulo)}: ${escapeHTML(legivel)}</span>
      <span class="filtro-chip-x" aria-hidden="true">&times;</span>
      <span class="sr-only">Remover este filtro</span>
    </button>`;
  }).join('');
}
function atualizarResumoFiltros(f, total) {
  const contagem = document.getElementById('filtrosContagem');
  const limpar = document.getElementById('filtrosLimpar');
  const ativos = Object.values(f).filter((x) => x !== '').length;
  if (limpar) limpar.hidden = ativos === 0;
  renderChipsFiltros(f);
  if (!contagem) return;
  if (typeof total !== 'number') { contagem.textContent = ''; return; }
  contagem.textContent = total === 1 ? '1 animal encontrado' : `${total} animais encontrados`;
}

// feito persistencia de filtros em sessionStorage CHAVE_FILTROS porque navegar para detalhes e voltar perdia a busca do usuario e resolvemos recarregando o estado no load
const CHAVE_FILTROS = 'petamor_filtros_categoria';

const IDS_CAMPOS_FILTRO = {
  state: 'categoryState', city: 'categoryCity', breed: 'categoryBreed',
  gender: 'categoryGender', age: 'categoryAge', size: 'categorySize',
  energy: 'categoryEnergy', neutered: 'categoryNeutered',
  vaccinated: 'categoryVaccinated', dewormed: 'categoryDewormed',
  apartment: 'categoryApartment', kids: 'categoryWithKids',
  dogs: 'categoryWithDogs', cats: 'categoryWithCats', special: 'categorySpecial',
};

function salvarFiltrosNaSessao(f) {
  try { sessionStorage.setItem(CHAVE_FILTROS, JSON.stringify(f)); } catch (e) {}
}

function restaurarFiltrosDaSessao() {
  let salvo = null;
  try { salvo = JSON.parse(sessionStorage.getItem(CHAVE_FILTROS) || 'null'); } catch (e) { salvo = null; }
  if (!salvo) return false;
  let algum = false;
  for (const [chave, id] of Object.entries(IDS_CAMPOS_FILTRO)) {
    const campo = document.getElementById(id);
    if (campo && salvo[chave]) { campo.value = salvo[chave]; algum = true; }
  }
  return algum;
}

// feito disparo de customselect:refresh em sincronizarSelectCustomizado porque disparar change causava cascata de novas buscas e resolvemos atualizando apenas a interface do select
function sincronizarSelectCustomizado(campo) {
  if (!campo) return;
  campo.dispatchEvent(new Event('customselect:refresh'));
}

function limparFiltros() {
  const todosOsCampos = [
    'categoryState', 'categoryCity', 'categoryBreed', 'categoryGender',
    'categoryAge', 'categorySize', 'categoryEnergy', 'categoryNeutered',
    'categoryVaccinated', 'categoryDewormed', 'categoryApartment',
    'categoryWithKids', 'categoryWithDogs', 'categoryWithCats', 'categorySpecial'
  ];

  todosOsCampos.forEach((id) => {
    const campo = document.getElementById(id);
    if (!campo) return;
    campo.value = '';
    sincronizarSelectCustomizado(campo);
  });

  const cityField = document.getElementById('categoryCity');
  if (cityField) {
    cityField.innerHTML = '<option value="">Todas as cidades</option>';
    cityField.disabled = true;
    sincronizarSelectCustomizado(cityField);
  }
  document.querySelectorAll('input[type="search"], .search-input, #searchInput, .custom-select-search').forEach((input) => {
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  document.querySelectorAll('#painelFiltros input[type="checkbox"], #painelFiltros input[type="radio"]').forEach((input) => {
    input.checked = false;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  });

  limparBuscaDeSelectCustomizado();

  try {
    sessionStorage.removeItem(CHAVE_FILTROS);
  } catch (e) {
  }

  const chipsContainer = document.getElementById('filtrosAtivos');
  if (chipsContainer) {
    chipsContainer.hidden = true;
    chipsContainer.innerHTML = '';
  }

  const botaoLimpar = document.getElementById('filtrosLimpar');
  if (botaoLimpar) {
    botaoLimpar.hidden = true;
  }
}

function limparBuscaDeSelectCustomizado() {
  document.querySelectorAll('.custom-select-search').forEach((busca) => {
    busca.value = '';
    busca.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

// feito atraso de 220ms para esqueletoDeCards porque exibir loading em conexoes rapidas gerava cintilacao visual e resolvemos aguardando o limiar antes de renderizar
function esqueletoDeCards(quantidade) {
  return `<div class="carregando-cards" aria-hidden="true">${
    Array.from({ length: quantidade || 3 }, () => `
      <div class="carregando-card">
        <div class="sk-foto"></div>
        <div class="sk-linha sk-media"></div>
        <div class="sk-linha"></div>
        <div class="sk-linha sk-curta"></div>
      </div>`).join('')
  }</div>`;
}

async function renderCategoryFeed(animalType) {
  const target = document.getElementById('categoryPosts');
  if (!target) return;
  const f = lerFiltrosDaTela();

  // feito controle de concorrencia com dataset.pedido em renderCategoryFeed porque respostas lentas anteriores sobrescreviam filtros mais recentes e resolvemos descartando requisicoes obsoletas
    const meuPedido = (Number(target.dataset.pedido) || 0) + 1;
  target.dataset.pedido = String(meuPedido);
  const aindaVale = () => target.dataset.pedido === String(meuPedido);
  const temporizador = window.setTimeout(() => {
    if (aindaVale() && !target.children.length) target.innerHTML = esqueletoDeCards(3);
  }, 220);

  let query = getSupabaseClient()
    .from('posts')
    .select(POST_CARD_COLUMNS)
    .eq('animal_type', animalType)
    .in('status', ['active', 'in_process'])
    .order('created_at', { ascending: false })
    .limit(120);

  if (f.state) query = query.eq('state', f.state);
  if (f.city) query = query.eq('city', f.city);
  if (f.support_type) query = query.eq('support_type', f.support_type);
  if (f.breed) {
    if (f.breed === 'Não sei') {
      query = query.or('breed.eq.Não sei,breed.ilike.%Não sei%');
    } else {
      query = query.ilike('breed', `%${f.breed}%`);
    }
  }
  if (f.gender) query = query.eq('gender', f.gender);
  if (f.age) query = query.eq('age_group', f.age);
  if (f.size) query = query.eq('size', f.size);
  if (f.energy) query = query.eq('energy_level', f.energy);
  query = aplicarBooleano(query, 'neutered', f.neutered);
  query = aplicarBooleano(query, 'vaccinated', f.vaccinated);
  query = aplicarBooleano(query, 'dewormed', f.dewormed);
  query = aplicarBooleano(query, 'apartment_friendly', f.apartment);
  query = aplicarBooleano(query, 'good_with_kids', f.kids);
  query = aplicarBooleano(query, 'good_with_dogs', f.dogs);
  query = aplicarBooleano(query, 'good_with_cats', f.cats);
  query = aplicarBooleano(query, 'special_needs', f.special);

  const { data, error } = await query;
  window.clearTimeout(temporizador);
  if (!aindaVale()) return;

  atualizarResumoFiltros(f, data?.length);

  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar: ${escapeHTML(mensagemDeErroSegura(error))}</div>`;
    return;
  }
  if (!data?.length) {
    const vazio = fotoVazia();
    target.innerHTML = `<div class="empty-state category-empty-state">
      <img src="${vazio.url}" alt="${vazio.alt}" loading="lazy" decoding="async">
      <p>${algumFiltroAtivo(f)
        ? 'Nenhum animal combina com esses filtros. Tente remover um deles para ver mais resultados.'
        : 'Ainda não temos animais publicados aqui. Volte em breve para conhecer novos amigos.'}</p>
    </div>`;
    return;
  }

  registerPostsInGlobalCache(data);
  target.innerHTML = renderProximityDivider(data, f.city, (post) => `
    <article class="category-pet-card">
      <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
      ${post.status === 'in_process' ? '<div class="adopted-ribbon" style="background: #f59e0b;">Em processo ⏳</div>' : ''}
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="category-pet-card-body">
        ${renderAuthorBar(post.profiles)}
        <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 6px;">
          <h2>${escapeHTML(post.title)}</h2>
          ${renderSupportTypeBadge(post.support_type)}
        </div>
        <p class="category-pet-location">${ICONE_PIN} ${escapeHTML(formatPostLocation(post))}</p>
        <p class="category-pet-breed"><strong>Raça:</strong> ${escapeHTML(post.breed || 'Não informado')}</p>
        ${chipsDeAtributos(post)}
        <div class="post-action-row">
          ${postActionButtonsHTML(post, podeAdministrarAgora())}
        </div>
      </div>
    </article>
  `);
  bindAdoptionButtons(target, data);
  const postsById = new Map(data.map((post) => [String(post.id), post]));
  target.querySelectorAll('[data-post-details]').forEach((button) => {
    button.addEventListener('click', () => openAdoptionModal(postsById.get(button.dataset.postDetails)));
  });
}

async function renderFavorites() {
  const target = document.getElementById('profileFavoritePosts');
  if (!target) return;
  const favoriteIds = getFavoriteIds();
  if (!favoriteIds.length) {
    target.innerHTML = '<div class="empty-state">Você ainda não favoritou nenhum animal.</div>';
    return;
  }

  target.innerHTML = '<div class="empty-state">Carregando seus favoritos...</div>';

  const { data, error } = await getSupabaseClient().from('posts').select(POST_CARD_COLUMNS).in('id', favoriteIds);
  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar seus favoritos: ${escapeHTML(error.message)}</div>`;
    return;
  }
  if (!data?.length) {
    target.innerHTML = '<div class="empty-state">Seus favoritos não estão mais disponíveis.</div>';
    return;
  }

  const orderedPosts = favoriteIds.map((id) => data.find((post) => String(post.id) === id)).filter(Boolean);
  const validFavoriteIds = orderedPosts.map((post) => String(post.id));
  if (validFavoriteIds.length !== favoriteIds.length) await persistFavoriteIds(validFavoriteIds);

  const postsById = new Map(orderedPosts.map((post) => [String(post.id), post]));

  registerPostsInGlobalCache(orderedPosts);
  target.innerHTML = orderedPosts.map((post) => `
    <article class="recent-post-card profile-post-card ${post.status === 'adopted' ? 'adopted-card' : ''}" data-card-post-id="${escapeHTML(post.id)}">
      <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
      ${post.status === 'adopted' ? '<div class="adopted-ribbon">Adotado! 🎉</div>' : ''}
      ${post.status === 'in_process' ? '<div class="adopted-ribbon" style="background: #f59e0b;">Em processo ⏳</div>' : ''}
      <div class="post-card-media-trigger" data-post-details="${escapeHTML(post.id)}" style="cursor: pointer;" title="Clique para ver detalhes">
        ${generateImageCarouselHTML(post.image_urls, post.title)}
      </div>
      <div class="recent-post-body profile-post-card-body">
        ${renderAuthorBar(post.profiles)}
        <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 6px;">
          <span class="mini-tag">${escapeHTML(formatAnimalType(post.animal_type))}</span>
          ${renderSupportTypeBadge(post.support_type)}
        </div>
        <h3 class="post-card-title-trigger" data-post-details="${escapeHTML(post.id)}" style="cursor: pointer;" title="Clique para ver detalhes">${escapeHTML(post.title)}</h3>
        <p class="recent-post-location"><svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5.2-8 12-8 12s-8-6.8-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg> ${escapeHTML(formatPostLocation(post))}</p>
        ${post.status === 'active' || post.status === 'in_process' ? `<div class="post-action-row">${postActionButtonsHTML(post, podeAdministrarAgora())}</div>` : ''}
      </div>
    </article>
  `).join('');

  bindAdoptionButtons(target, orderedPosts.filter((post) => post.status === 'active' || post.status === 'in_process'));

  target.querySelectorAll('[data-post-details]').forEach((trigger) => {
    trigger.addEventListener('click', (e) => {
      if (e.target.closest('[data-carousel-action], [data-carousel-dot]')) return;
      const postId = trigger.dataset.postDetails;
      const post = postsById.get(String(postId));
      if (post) openAdoptionModal(post);
    });
  });
}

const POST_FIELD_LABELS = {
  age_group: 'Faixa Etária',
  gender: 'Sexo',
  neutered: 'Castrado',
  vaccinated: 'Vacinado',
  dewormed: 'Vermifugado',
  special_needs: 'Necessidades Especiais',
  good_with_kids: 'Dá-se bem com crianças',
  good_with_dogs: 'Dá-se bem com cães',
  good_with_cats: 'Dá-se bem com gatos',
  energy_level: 'Nível de Energia',
  apartment_friendly: 'Adapta-se a apartamento',
  birth_date: 'Data de nascimento',
  size: 'Porte'
};

const INAPPLICABLE_FIELDS_BY_TYPE = {
  Fazenda: new Set(['apartment_friendly', 'good_with_cats', 'good_with_dogs']),
  Marinho: new Set(['apartment_friendly', 'good_with_cats', 'good_with_dogs', 'neutered', 'dewormed']),
  Exótico: new Set(['apartment_friendly']),
  Outro: new Set(['apartment_friendly'])
};

function formatDetailValue(key, value) {
  if (value === true || value === 'true') return 'Sim';
  if (value === false || value === 'false') return 'Não';
  if (Array.isArray(value)) return value.join(', ');
  if (key === 'birth_date' && typeof value === 'string' && value.includes('-')) {
    const parts = value.split('-');
    if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  }
  return String(value);
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function loadImageAsync(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = (e) => reject(e);
    img.src = url;
  });
}

function renderSupportTypeBadge(supportType) {
  if (supportType === 'lar_temporario') {
    return '<span class="status-badge badge-lt">🏠 Lar Temporário</span>';
  }
  if (supportType === 'apadrinhamento') {
    return '<span class="status-badge badge-padrinho">⭐ Padrinho Solidário</span>';
  }
  return '';
}

function renderPostStatusBadge(status) {
  if (status === 'pending') {
    return '<span class="status-badge status-pending">Aguardando aprovação ⏳</span>';
  }
  if (status === 'rejected') {
    return '<span class="status-badge status-rejected">Não aprovado ❌</span>';
  }
  if (status === 'in_process') {
    return '<span class="status-badge status-in-process">Em processo ⏳</span>';
  }
  if (status === 'adopted') {
    return '<span class="status-badge status-adopted">Adotado! 🎉</span>';
  }
  return '<span class="status-badge status-active">Disponível</span>';
}

async function generateInstagramStory(post) {
  showToast('Gerando card para Stories... 🎨');

  try {
    if (document.fonts) {
      await document.fonts.ready;
    }
    const canvas = document.createElement('canvas');
    canvas.width = 1080;
    canvas.height = 1920;
    const ctx = canvas.getContext('2d');
    // feito geracao dinamica de card de story em Canvas 1080x1920 porque compartilhamento em redes sociais precisava de layout visual atrativo e resolvemos compondo fundo gradiente, foto e metadados
    const bgGrad = ctx.createLinearGradient(0, 0, 0, 1920);
    bgGrad.addColorStop(0, '#fffbf7');
    bgGrad.addColorStop(0.5, '#fef5eb');
    bgGrad.addColorStop(1, '#fde8d7');
    ctx.fillStyle = bgGrad;
    ctx.fillRect(0, 0, 1080, 1920);
    ctx.save();
    ctx.fillStyle = 'rgba(217, 97, 27, 0.05)';
    ctx.beginPath();
    ctx.arc(950, 150, 260, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(100, 1750, 320, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.fillStyle = '#b8490f';
    ctx.font = 'bold 44px Manrope, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('🐾 Pet Amor • Adoção Responsável', 540, 120);

    ctx.fillStyle = '#786f68';
    ctx.font = '500 32px Manrope, sans-serif';
    const subtitle = post.support_type === 'lar_temporario'
      ? 'Precisa de um Lar Temporário com carinho 🏠'
      : post.support_type === 'apadrinhamento'
      ? 'Campanha de Apadrinhamento e Cuidados ⭐'
      : 'Uma vida cheia de amor esperando por você! ✨';
    ctx.fillText(subtitle, 540, 175);
    ctx.restore();
    const cardX = 80;
    const cardY = 230;
    const cardW = 920;
    const cardH = 960;
    const radius = 36;

    ctx.save();
    ctx.shadowColor = 'rgba(31, 27, 27, 0.16)';
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 16;
    ctx.fillStyle = '#ffffff';
    drawRoundedRect(ctx, cardX, cardY, cardW, cardH, radius);
    ctx.fill();
    ctx.restore();
    const imgUrl = (Array.isArray(post.image_urls) && post.image_urls[0]) ? post.image_urls[0] : DEFAULT_AVATAR_URL;
    try {
      const img = await loadImageAsync(imgUrl);
      ctx.save();
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, radius);
      ctx.clip();

      const imgRatio = img.width / img.height;
      const boxRatio = cardW / cardH;
      let sx, sy, sWidth, sHeight;
      if (imgRatio > boxRatio) {
        sHeight = img.height;
        sWidth = img.height * boxRatio;
        sx = (img.width - sWidth) / 2;
        sy = 0;
      } else {
        sWidth = img.width;
        sHeight = img.width / boxRatio;
        sx = 0;
        sy = (img.height - sHeight) / 2;
      }
      ctx.drawImage(img, sx, sy, sWidth, sHeight, cardX, cardY, cardW, cardH);
      ctx.restore();
    } catch {
      ctx.save();
      ctx.fillStyle = '#fbe9dc';
      drawRoundedRect(ctx, cardX, cardY, cardW, cardH, radius);
      ctx.fill();
      ctx.fillStyle = '#b8490f';
      ctx.font = 'bold 90px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('🐾', 540, cardY + cardH / 2);
      ctx.restore();
    }
    const infoY = 1270;
    ctx.save();
    ctx.fillStyle = '#1f1b1b';
    ctx.font = '800 66px Manrope, sans-serif';
    ctx.textAlign = 'center';
    const petName = post.title || 'Amiguinho sem nome';
    ctx.fillText(petName.length > 25 ? petName.substring(0, 23) + '...' : petName, 540, infoY);

    ctx.fillStyle = '#66605b';
    ctx.font = '600 36px Manrope, sans-serif';
    ctx.fillText(`📍 ${formatPostLocation(post)}`, 540, infoY + 65);
    ctx.restore();
    const badges = [
      formatAnimalType(post.animal_type) || 'Animal',
      post.breed || 'SRD',
      post.gender || null,
      post.neutered ? 'Castrado ✓' : null,
      post.vaccinated ? 'Vacinado ✓' : null,
      post.support_type === 'lar_temporario' ? 'Lar Temporário 🏠' : post.support_type === 'apadrinhamento' ? 'Padrinho Solidário ⭐' : null
    ].filter(Boolean);

    ctx.save();
    ctx.font = 'bold 30px Manrope, sans-serif';
    const badgeY = infoY + 130;
    const chipWidths = badges.map((b) => ctx.measureText(b).width + 44);
    const totalRowW = chipWidths.reduce((a, b) => a + b, 0) + (badges.length - 1) * 16;
    let currentX = Math.max(60, 540 - Math.min(totalRowW, 960) / 2);

    badges.slice(0, 4).forEach((badge, idx) => {
      const w = chipWidths[idx];
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = 'rgba(184, 73, 15, 0.2)';
      ctx.lineWidth = 2;
      drawRoundedRect(ctx, currentX, badgeY, w, 56, 28);
      ctx.fill();
      ctx.stroke();

      ctx.fillStyle = '#b8490f';
      ctx.textAlign = 'center';
      ctx.fillText(badge, currentX + w / 2, badgeY + 39);
      currentX += w + 16;
    });
    ctx.restore();
    ctx.save();
    const footerBoxY = 1570;
    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgba(31, 27, 27, 0.08)';
    ctx.shadowBlur = 24;
    ctx.shadowOffsetY = 8;
    drawRoundedRect(ctx, 100, footerBoxY, 880, 240, 32);
    ctx.fill();

    ctx.fillStyle = '#1f1b1b';
    ctx.font = '800 38px Manrope, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Ajude a encontrar um lar para este pet!', 540, footerBoxY + 70);

    ctx.fillStyle = '#b8490f';
    ctx.font = '700 34px Manrope, sans-serif';
    ctx.fillText('Compartilhe no seu Story 🐾', 540, footerBoxY + 130);

    ctx.fillStyle = '#786f68';
    ctx.font = '500 28px Manrope, sans-serif';
    ctx.fillText('Acesse: petamor.com.br', 540, footerBoxY + 190);
    ctx.restore();
    canvas.toBlob(async (blob) => {
      if (!blob) {
        showToast('Não foi possível gerar a imagem.', 'error');
        return;
      }

      const safeFileName = `pet-amor-${(post.title || 'story').toLowerCase().replace(/[^a-z0-9]/g, '-')}.png`;
      const file = new File([blob], safeFileName, { type: 'image/png' });

      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
          await navigator.share({
            files: [file],
            title: `Adoção: ${post.title}`,
            text: `Conheça ${post.title} no Pet Amor!`
          });
          showToast('Story compartilhado com sucesso!');
          return;
        } catch (e) {
          if (e.name === 'AbortError') return;
        }
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = safeFileName;
      a.click();

      createDynamicModal(`
        <div class="story-preview-container">
          <h2>Card para Stories Gerado! 🎉</h2>
          <p>A imagem em formato 9:16 foi baixada. Você já pode publicá-la no seu <strong>Instagram Stories</strong> ou <strong>WhatsApp Status</strong>!</p>
          <img src="${url}" alt="Prévia do Story" class="story-preview-img" />
          <div class="story-preview-actions">
            <a href="${url}" download="${safeFileName}" class="btn btn-primary">Baixar Novamente</a>
            <button type="button" class="btn btn-secondary" data-close-dynamic>Fechar</button>
          </div>
        </div>
      `, 'story-modal');
    }, 'image/png');
  } catch (err) {
    console.error('Erro ao gerar Story:', err);
    showToast('Não foi possível gerar o card para Stories.', 'error');
  }
}

// feito cache global globalPostsMap indexado por ID porque abrir o modal a partir do feed nao deve disparar nova requisicao de rede e resolvemos reutilizando dados ja carregados
const globalPostsMap = new Map();

function registerPostsInGlobalCache(posts) {
  if (!Array.isArray(posts)) return;
  posts.forEach((p) => {
    if (p && p.id) globalPostsMap.set(String(p.id), p);
  });
}

async function openAdoptionModal(postOrId) {
  if (!postOrId) return;
  const modal = document.getElementById('adoptionModal');
  if (!modal) return;

  let post = typeof postOrId === 'object' ? postOrId : globalPostsMap.get(String(postOrId));

  if (!post) {
    try {
      const { data, error } = await getSupabaseClient()
        .from('posts')
        .select('*, profiles(full_name, username, avatar_url)')
        .eq('id', postOrId)
        .single();
      if (!error && data) {
        post = data;
        globalPostsMap.set(String(post.id), post);
      }
    } catch (fetchErr) {
      console.warn('Erro ao carregar publicação para modal:', fetchErr);
    }
  }

  if (!post) {
    showToast('Não foi possível carregar os detalhes desta publicação.', 'error');
    return;
  }

  if (post.id) {
    trackPostView(post.id);
  }

  try {
  const imageContainer = document.getElementById('modalImageContainer');
  if (imageContainer) {
    imageContainer.innerHTML = generateImageCarouselHTML(post.image_urls, post.title);
  }
  const titleEl = document.getElementById('modalPostTitle');
  if (titleEl) titleEl.textContent = post.title;

  const locEl = document.getElementById('modalPostLocation');
  if (locEl) {
    locEl.innerHTML = `<svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5.2-8 12-8 12s-8-6.8-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg> ${formatPostLocation(post)}`;
  }

  const descEl = document.getElementById('modalPostDescription');
  if (descEl) descEl.textContent = post.description || 'Descrição não informada.';
  const modalBodyEl = modal.querySelector('.adoption-modal-body');
  if (modalBodyEl) {
    let tagsContainer = modalBodyEl.querySelector('.modal-tags-row');
    if (!tagsContainer) {
      const existingTag = modalBodyEl.querySelector('.mini-tag');
      if (existingTag) {
        tagsContainer = document.createElement('div');
        tagsContainer.className = 'modal-tags-row';
        tagsContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 8px;';
        existingTag.parentNode.insertBefore(tagsContainer, existingTag);
        existingTag.remove();
      }
    }
    if (tagsContainer) {
      const animalLabel = escapeHTML(formatAnimalType(post.animal_type));
      const supportBadge = renderSupportTypeBadge(post.support_type);
      let statusBadge = '';
      if (post.status === 'in_process') {
        statusBadge = '<span class="status-badge status-in-process">Em processo de adoção ⏳</span>';
      } else if (post.status === 'adopted') {
        statusBadge = '<span class="status-badge status-adopted">Adotado com amor! 🎉</span>';
      }
      tagsContainer.innerHTML = `<span class="mini-tag">${animalLabel}</span>${supportBadge}${statusBadge}`;
    }
  }

  const modalBreed = document.getElementById('modalBreed');
  const modalMotherBreed = document.getElementById('modalMotherBreed');
  const modalFatherBreed = document.getElementById('modalFatherBreed');
  const geneticsSection = modalBreed?.closest('.modal-genetics');

  const isMeaningfulValue = (val) => {
    const s = String(val || '').trim().toLowerCase();
    return s && s !== 'Não informado' && s !== 'desconhecido' && s !== 'null';
  };

  const hasBreed = isMeaningfulValue(post.breed);
  const hasMother = isMeaningfulValue(post.mother_breed);
  const hasFather = isMeaningfulValue(post.father_breed);

  if (modalBreed) {
    modalBreed.textContent = post.breed || 'Não informado';
    if (modalBreed.parentElement) modalBreed.parentElement.hidden = !hasBreed;
  }
  if (modalMotherBreed) {
    modalMotherBreed.textContent = post.mother_breed || '';
    if (modalMotherBreed.parentElement) modalMotherBreed.parentElement.hidden = !hasMother;
  }
  if (modalFatherBreed) {
    modalFatherBreed.textContent = post.father_breed || '';
    if (modalFatherBreed.parentElement) modalFatherBreed.parentElement.hidden = !hasFather;
  }
  if (geneticsSection) geneticsSection.hidden = !(hasBreed || hasMother || hasFather);

  const modalSize = document.getElementById('modalSize');
  const modalSizeSection = document.getElementById('modalSizeSection');
  if (modalSize && modalSizeSection) {
    modalSize.textContent = post.size || '';
    modalSizeSection.hidden = !post.size;
  }

  let modalitySection = document.getElementById('modalModalitySection');
  if (!modalitySection) {
    modalitySection = document.createElement('section');
    modalitySection.id = 'modalModalitySection';
    const modalBody = modal.querySelector('.adoption-modal-body');
    const contactSec = modal.querySelector('.modal-contact');
    if (modalBody && contactSec) {
      modalBody.insertBefore(modalitySection, contactSec);
    } else if (modalBody) {
      modalBody.appendChild(modalitySection);
    }
  }

  if (modalitySection) {
    if (post.support_type === 'lar_temporario') {
      modalitySection.hidden = false;
      modalitySection.className = 'modal-modality-highlight lt-highlight';
      modalitySection.innerHTML = `
        <div class="modality-highlight-header">
          <span class="modality-badge-icon" aria-hidden="true">&#127968;</span>
          <h4>Necessidade de Lar Temporário (LT)</h4>
        </div>
        <dl class="modality-highlight-dl">
          ${post.lt_duration ? `<div><dt>Tempo estimado</dt><dd>${escapeHTML(post.lt_duration)}</dd></div>` : ''}
          ${post.lt_costs_covered ? `<div><dt>Custos cobertos</dt><dd>${escapeHTML(post.lt_costs_covered)}</dd></div>` : ''}
          ${post.lt_home_requirements ? `<div class="full-dl"><dt>Requisitos de moradia</dt><dd>${escapeHTML(post.lt_home_requirements)}</dd></div>` : ''}
        </dl>
      `;
    } else if (post.support_type === 'apadrinhamento') {
      modalitySection.hidden = false;
      modalitySection.className = 'modal-modality-highlight sponsorship-highlight';
      const pixKeyEscaped = post.sponsorship_pix ? escapeHTML(post.sponsorship_pix) : '';
      const pixBlock = post.sponsorship_pix ? `
        <div class="pix-donation-callout">
          <div class="pix-callout-header">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2 3.5 10.5 12 19l8.5-8.5L12 2Zm0 3.8 5.3 5.3-5.3 5.3-5.3-5.3 5.3-5.3Z"/></svg>
            <strong>Chave PIX do Protetor:</strong>
          </div>
          <div class="pix-callout-body">
            <code class="pix-key-code">${pixKeyEscaped}</code>
            <button type="button" class="copy-contact-btn pix-sponsor-copy" data-copy="${pixKeyEscaped}" aria-label="Copiar chave PIX" title="Clique para copiar chave PIX">
              <span class="copy-action-indicator" aria-hidden="true">
                <svg class="icon-copy" viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
                <span class="copy-state-label">Copiar PIX</span>
              </span>
            </button>
          </div>
        </div>
      ` : '';

      modalitySection.innerHTML = `
        <div class="modality-highlight-header">
          <span class="modality-badge-icon" aria-hidden="true">&#11088;</span>
          <h4>Campanha de Apadrinhamento Solidário</h4>
        </div>
        <dl class="modality-highlight-dl">
          ${post.sponsorship_purpose ? `<div><dt>Finalidade da ajuda</dt><dd>${escapeHTML(post.sponsorship_purpose)}</dd></div>` : ''}
          ${post.sponsorship_goal ? `<div><dt>Meta / Valor sugerido</dt><dd>${escapeHTML(post.sponsorship_goal)}</dd></div>` : ''}
        </dl>
        ${pixBlock}
      `;
    } else {
      modalitySection.hidden = true;
      modalitySection.innerHTML = '';
    }
  }

  const contactEl = document.getElementById('modalPostContact');
  if (contactEl) {
    const storyBtnHtml = `
      <button type="button" class="btn-story" id="btnGenerateStory" aria-label="Gerar card do animal para Stories do Instagram">
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <rect width="20" height="20" x="2" y="2" rx="5" ry="5"/>
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"/>
          <line x1="17.5" x2="17.51" y1="6.5" y2="6.5"/>
        </svg>
        <span>Gerar Card para Stories</span>
      </button>
    `;
    contactEl.innerHTML = renderCopyableContacts(post) + storyBtnHtml;
    contactEl.querySelector('#btnGenerateStory')?.addEventListener('click', () => generateInstagramStory(post));
  }

  let additionalSection = document.getElementById('modalAdditionalDetails');
  let additionalDetails = document.getElementById('modalPostAdditionalDetails');
  if (!additionalSection) {
    const modalBody = modal.querySelector('.adoption-modal-body');
    const contactSec = modal.querySelector('.modal-contact');
    if (modalBody) {
      additionalSection = document.createElement('section');
      additionalSection.className = 'modal-genetics';
      additionalSection.id = 'modalAdditionalDetails';
      additionalSection.setAttribute('aria-labelledby', 'additionalDetailsTitle');
      additionalSection.innerHTML = '<h3 id="additionalDetailsTitle">Mais informações</h3><dl id="modalPostAdditionalDetails"></dl>';
      if (contactSec) {
        modalBody.insertBefore(additionalSection, contactSec);
      } else {
        modalBody.appendChild(additionalSection);
      }
      additionalDetails = additionalSection.querySelector('#modalPostAdditionalDetails');
    }
  }

  if (additionalSection && additionalDetails) {
    const excludedFields = new Set([
      'id', 'user_id', 'profiles', 'image_urls', 'title', 'description',
      'animal_type', 'state', 'city', 'breed', 'mother_breed', 'father_breed', 'size', 'lt_duration', 'lt_costs_covered', 'lt_home_requirements', 'sponsorship_purpose', 'sponsorship_goal', 'sponsorship_pix',
      'phone', 'contact_phone', 'contact_info', 'status', 'support_type', 'created_at', 'updated_at'
    ]);
    const inapplicable = INAPPLICABLE_FIELDS_BY_TYPE[post.animal_type] || new Set();

    const details = Object.entries(post).filter(([key, value]) => {
      if (excludedFields.has(key)) return false;
      if (inapplicable.has(key)) return false;
      return value !== null && value !== undefined && value !== '';
    });

    if (details.length) {
      additionalDetails.innerHTML = details.map(([key, value]) => {
        const label = POST_FIELD_LABELS[key] || key.replace(/_/g, ' ');
        const formattedValue = formatDetailValue(key, value);
        return `<div><dt>${escapeHTML(label)}</dt><dd>${escapeHTML(formattedValue)}</dd></div>`;
      }).join('');
      additionalSection.hidden = false;
    } else {
      additionalDetails.innerHTML = '';
      additionalSection.hidden = true;
    }
  }

  const modalBody = modal.querySelector('.adoption-modal-body');
  if (modalBody) modalBody.scrollTop = 0;


  } catch (err) {
    console.error('Erro ao preencher dados no modal de adoção:', err);
  } finally {
    modal.hidden = false;
    syncModalScrollLock();
  }
}

function closeAdoptionModal() {
  const modal = document.getElementById('adoptionModal');
  if (!modal) return;
  modal.hidden = true;
  syncModalScrollLock();
}

function openTermsModal() {
  const existing = document.querySelector('.dynamic-modal.terms-modal');
  if (existing) closeDynamicModal(existing);

  const content = `
    <header class="terms-modal-header">
      <h2>Termos de Uso e Isenção de Responsabilidade</h2>
      <button type="button" class="terms-modal-close" aria-label="Fechar termos" data-close-dynamic>&times;</button>
    </header>
    <div class="terms-modal-body">
      <div class="terms-notice-box" style="margin-bottom: 18px;">
        <strong>AVISO LEGAL IMPORTANTE:</strong> O Pet Amor é exclusivamente uma plataforma comunitária voluntária e gratuita para publicação de anúncios. Não somos abrigo, canil, criadores, autoridade veterinária ou guardiões de animais. O uso deste serviço isenta total e expressamente a plataforma e seus mantenedores de quaisquer responsabilidades.
      </div>

      <h3>1. Mero Intermediário Digital Gratuito</h3>
      <p>O <strong>Pet Amor</strong> atua unicamente disponibilizando espaço virtual (classificados online) para que a comunidade publique e encontre animais para adoção responsável e ajuda voluntária.</p>
      <p>Nos termos do <strong>Artigo 19 do Marco Civil da Internet (Lei nº 12.965/2014)</strong>, o site não responde civilmente por atos, omissões, dados, fotos ou conteúdos veiculados por terceiros.</p>

      <h3>2. Isenção Total sobre os Animais (Saúde, Temperamento e Custos)</h3>
      <p>A plataforma <strong>não realiza inspeções físicas, triagens presenciais ou laudos veterinários</strong>. Os mantenedores e desenvolvedores do site isentam-se expressamente de qualquer responsabilidade por:</p>
      <ul>
        <li><strong>Saúde e Zoonoses:</strong> Doenças pré-existentes, patologias congênitas, vírus, parasitas, zoonoses (raiva, cinomose, parvovirose, leishmaniose, esporotricose) ou falecimento de animais;</li>
        <li><strong>Comportamento e Danos:</strong> Agressividade, mordidas, ataques ou danos patrimoniais e corporais causados pelo animal a pessoas, crianças ou outros animais;</li>
        <li><strong>Genética e Raça:</strong> Veracidade de raça, porte futuro, idade estimada ou autenticidade de vacinas e castração (que devem ser conferidas diretamente com o anunciante);</li>
        <li><strong>Despesas:</strong> Honorários veterinários, clínicas, rações ou tratamentos após a adoção.</li>
      </ul>

      <h3>3. Isenção sobre Encontros, Conversas e Entregas</h3>
      <p>Todo contato, conversa e entrega de animais ocorre <strong>fora da plataforma</strong>, por deliberação autônoma dos usuários (via WhatsApp ou telefone particular). A plataforma não fiscaliza a idoneidade moral, civil ou psicológica de adotantes ou anunciantes e não responde por atritos, furtos, acidentes ou crimes ocorridos em visitas ou entregas.</p>
      <p><strong>Dica de segurança:</strong> Recomendamos sempre marcar encontros em locais públicos e movimentados (como clínicas veterinárias, pet shops ou praças de dia) e nunca repassar dados bancários ou senhas a terceiros.</p>

      <h3>4. Proibição de Vendas e Isenção sobre Golpes Financeiros</h3>
      <p>É <strong>terminantemente proibida a comercialização de animais</strong> ou a cobrança de taxas de adoção com finalidade de lucro. O Pet Amor apoia exclusivamente o resgate e a doação solidária.</p>
      <p>A plataforma <strong>não processa nem intermedeia valores financeiros entre usuários</strong>. Isentamo-nos integralmente de prejuízos decorrentes de golpes de terceiros, pedidos indevidos de transferências ou estelionato.</p>

      <h3>5. Doações Voluntárias via PIX para Manutenção do Site</h3>
      <p>As contribuições financeiras enviadas voluntariamente através do QR Code / Chave PIX do site destinam-se exclusivamente ao custeio de infraestrutura técnica (hospedagem, banco de dados, domínio e servidores). Trata-se de <strong>doação pura e simples (Art. 538 do Código Civil)</strong> por mera liberalidade, sem contraprestação de serviços, sem planos pagos e sem direito a restituição ou reembolso.</p>

      <h3>6. Responsabilidade do Anunciante e Crimes Ambientais</h3>
      <p>O usuário que publica um anúncio assume <strong>responsabilidade civil e penal exclusiva</strong> pela veracidade de todas as informações. O <strong>abandono e os maus-tratos a animais configuram crimes inafiançáveis (Lei nº 9.605/1998 e Lei Sansão nº 14.064/2020)</strong> com pena de 2 a 5 anos de reclusão. A plataforma colaborará com autoridades policiais e judiciais mediante ordem competente.</p>

      <h3>7. Moderação e Exclusão Autônoma</h3>
      <p>A administração poderá, a qualquer tempo, sem aviso prévio ou indenização, remover publicações e suspender contas que violem estas diretrizes ou apresentem conduta suspeita.</p>

      <h3>8. Privacidade (LGPD) e Foro de Eleição</h3>
      <p>Dados de contato informados em anúncios tornam-se públicos exclusivamente para viabilizar que pretendentes à adoção entrem em contato. Fica eleito o Foro de domicílio do mantenedor para dirimir quaisquer controvérsias.</p>
    </div>
    <footer class="terms-modal-footer">
      <a href="termos.html" class="btn btn-secondary" style="margin-right: auto;" target="_blank">Página completa</a>
      <button type="button" class="btn btn-primary" data-close-dynamic>Entendi e concordo</button>
    </footer>
  `;

  const modal = createDynamicModal(content, 'terms-modal');
  modal.querySelectorAll('[data-close-dynamic]').forEach((button) => {
    button.addEventListener('click', () => closeDynamicModal(modal));
  });
  modal.querySelector('.dynamic-modal-backdrop')?.addEventListener('click', () => closeDynamicModal(modal));

  const escHandler = (event) => {
    if (event.key === 'Escape') {
      closeDynamicModal(modal);
      document.removeEventListener('keydown', escHandler);
    }
  };
  document.addEventListener('keydown', escHandler);
}

function setupTermsModalHandler() {
  document.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-open-terms]');
    if (!trigger) return;
    event.preventDefault();
    event.stopPropagation();
    openTermsModal();
  });
}

function setupGlobalModalHandlers() {
  document.querySelectorAll('[data-modal-close]').forEach((element) => {
    element.addEventListener('click', closeAdoptionModal);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if (document.querySelector('.dynamic-modal')) return;
      closeAdoptionModal();
    }
  });
  const adoptionModal = document.getElementById('adoptionModal');
  if (adoptionModal) {
    adoptionModal.addEventListener('click', (event) => {
      if (event.target === adoptionModal || event.target.classList.contains('adoption-modal-backdrop')) {
        closeAdoptionModal();
      }
    });
  }
  // feito delegacao global de cliques no document.body para botoes data-post-details porque cards renderizados dinamicamente perdiam listeners individuais e resolvemos interceptando eventos no ancestral comum
  document.body.addEventListener('click', (event) => {
    const trigger = event.target.closest('[data-post-details], [data-adoption-post]');
    if (!trigger) return;
    if (event.target.closest('[data-carousel-action], [data-carousel-dot], [data-action="delete-post"], .favorite-button, .share-button, .btn-whatsapp, .copy-contact-btn')) return;
    const postId = trigger.dataset.postDetails || trigger.dataset.adoptionPost;
    if (postId) {
      event.preventDefault();
      openAdoptionModal(postId);
    }
  });

  setupTermsModalHandler();
}

async function setupCategoryPage() {
  const animalType = document.body.dataset.animalType;
  const stateField = document.getElementById('categoryState');
  const cityField = document.getElementById('categoryCity');
  const breedField = document.getElementById('categoryBreed');
  if (!animalType) return;

  const label = animalType === 'Cachorro' || animalType === 'Gato' ? 'Todas as raças' : 'Todas as espécies';

  // feito debounce de 260ms na funcao buscar porque alterar multiplos selects seguidos gerava sobrecarga de consultas concorrentes e resolvemos agrupando via temporizador
  let temporizador = null;
  const buscar = (imediato) => {
    window.clearTimeout(temporizador);
    const executar = () => {
      salvarFiltrosNaSessao(lerFiltrosDaTela());
      renderCategoryFeed(animalType);
    };
    if (imediato) executar();
    else temporizador = window.setTimeout(executar, 260);
  };

  if (stateField && cityField) {
    stateField.addEventListener('change', async () => {
      await loadCities(stateField, cityField);
      buscar(true);
    });
    cityField.addEventListener('change', () => buscar(true));
    loadStates(stateField, cityField);
  }
  [
    'categorySupportType', 'categoryGender', 'categoryAge', 'categorySize', 'categoryEnergy',
    'categoryNeutered', 'categoryVaccinated', 'categoryDewormed',
    'categoryApartment', 'categoryWithKids', 'categoryWithDogs',
    'categoryWithCats', 'categorySpecial',
  ].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', () => buscar(false));
  });

  // feito recolhimento inicial de filtrosCaixa em mobile e desktop porque manter o painel aberto ocupava toda a viewport inicial e resolvemos com toggle colapsavel via data-estado
    const caixa = document.getElementById('filtrosCaixa');
  const toggle = document.getElementById('filtrosToggle');
  const rotuloToggle = toggle?.querySelector('.filtros-toggle-texto');
  let liberaOverflow = null;

  const definirAberto = (aberto, animar) => {
    if (!caixa || !toggle) return;
    caixa.dataset.estado = aberto ? 'aberto' : 'fechado';
    toggle.setAttribute('aria-expanded', String(aberto));
    if (rotuloToggle) rotuloToggle.textContent = aberto ? 'Ocultar filtros' : 'Mostrar filtros';
    if (aberto) caixa.removeAttribute('inert');
    else caixa.setAttribute('inert', '');

    // feito alternancia de overflow entre hidden e visible via liberaOverflow porque a transicao de grid 0fr exige clip de conteudo mas o dropdown do select precisa vazar a borda e resolvemos atrasando a visibilidade
        window.clearTimeout(liberaOverflow);
    delete caixa.dataset.aberto;
    if (aberto) {
      const liberar = () => { caixa.dataset.aberto = 'sim'; };
      const semMovimento = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (animar && !semMovimento) liberaOverflow = window.setTimeout(liberar, 560);
      else liberar();
    }

    if (!animar) caixa.dataset.semAnimacao = '';
  };
  definirAberto(false, false);
  // feito desativacao temporaria de transicoes via data-sem-animacao no primeiro quadro porque a caixa animava fechando no carregamento da tela e resolvemos liberando no requestAnimationFrame
  window.requestAnimationFrame(() => { if (caixa) delete caixa.dataset.semAnimacao; });

  toggle?.addEventListener('click', () => {
    definirAberto(caixa?.dataset.estado !== 'aberto', true);
  });

  const executarLimpezaFiltros = () => {
    limparFiltros();
    buscar(true);
  };

  document.getElementById('filtrosLimpar')?.addEventListener('click', executarLimpezaFiltros);
  document.getElementById('painelFiltros')?.addEventListener('click', (evento) => {
    if (evento.target.closest('#filtrosLimpar, .filtros-limpar')) {
      executarLimpezaFiltros();
    }
  });
  document.getElementById('filtrosAtivos')?.addEventListener('click', (evento) => {
    const chip = evento.target.closest('[data-limpar-filtro]');
    if (!chip) return;
    const campo = document.getElementById(IDS_CAMPOS_FILTRO[chip.dataset.limparFiltro]);
    if (campo) {
      campo.value = '';
      sincronizarSelectCustomizado(campo);
    }
    buscar(true);
  });
  const restaurou = restaurarFiltrosDaSessao();
  if (restaurou) definirAberto(true, true);

  if (breedField) await loadDynamicBreedOptions(animalType, breedField, label);
  await renderCategoryFeed(animalType);
}

function setupPostCarouselNavigation() {
  document.body.addEventListener('click', (event) => {
    const control = event.target.closest('[data-carousel-action], [data-carousel-dot]');
    if (!control) return;

    const carousel = control.closest('.post-carousel');
    const track = carousel?.querySelector('.post-carousel-track');
    const slides = carousel?.querySelectorAll('.post-carousel-image');
    if (!carousel || !track || !slides?.length) return;

    const currentIndex = Number(carousel.dataset.carouselIndex || 0);
    const nextIndex = control.hasAttribute('data-carousel-dot')
      ? Number(control.dataset.carouselDot)
      : (currentIndex + (control.dataset.carouselAction === 'next' ? 1 : -1) + slides.length) % slides.length;
    carousel.dataset.carouselIndex = String(nextIndex);
    track.style.transform = `translateX(-${nextIndex * 100}%)`;
    carousel.querySelectorAll('[data-carousel-dot]').forEach((dot, index) => {
      dot.classList.toggle('active', index === nextIndex);
      dot.setAttribute('aria-selected', String(index === nextIndex));
    });
  });
}

function setupFavoriteInteractionsV7() {
  document.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-favorite-id]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    try {
      const favorite = await toggleFavorite(button.dataset.favoriteId);
      document.querySelectorAll(`[data-favorite-id="${CSS.escape(button.dataset.favoriteId)}"]`).forEach((favoriteButton) => {
        favoriteButton.classList.toggle('is-favorite', favorite);
        favoriteButton.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.4 1.4L12 21.2l7.5-7.4 1.3-1.4a5.5 5.5 0 0 0 0-7.8Z"></path></svg>';
        favoriteButton.setAttribute('aria-pressed', String(favorite));
      });
      if (!getSession()) showToast('Favorito salvo neste dispositivo. Faça login para sincronizar seus favoritos.');
      if (document.getElementById('profileFavoritePosts')) renderProfileFavorites();
    } catch (error) {
      showToast(mensagemDeErroSegura(error), 'error');
    }
  });
}

function setupShareInteractions() {
  document.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-share-post]');
    if (!button) return;
    const shareUrl = button.dataset.shareUrl || window.location.href;
    const shareData = { title: button.dataset.shareTitle, text: button.dataset.shareText, url: shareUrl };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(shareUrl);
        showToast('Link copiado!');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('Não foi possível compartilhar a publicação.', 'error');
    }
  });
}

function setupCopyContactInteractions() {
  document.body.addEventListener('click', async (event) => {
    const button = event.target.closest('.copy-contact-btn');
    if (!button) return;
    const value = button.dataset.copy || '';
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
      } else {
        const temp = document.createElement('textarea');
        temp.value = value;
        temp.style.position = 'fixed';
        temp.style.left = '-9999px';
        document.body.appendChild(temp);
        temp.select();
        document.execCommand('copy');
        temp.remove();
      }

      button.classList.add('is-copied');
      const stateLabel = button.querySelector('.copy-state-label');
      const originalText = stateLabel ? stateLabel.textContent : '';
      if (stateLabel) stateLabel.textContent = 'Copiado! ✓';
      showToast('Contato copiado para a área de transferência! 📋');

      window.setTimeout(() => {
        button.classList.remove('is-copied');
        if (stateLabel) stateLabel.textContent = originalText;
      }, 2000);
    } catch (error) {
      showToast('Não foi possível copiar o contato.', 'error');
    }
  });
}

function normalizeSelectSearch(value) {
  return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function initCustomSelects() {
  document.querySelectorAll('select').forEach((select) => {
    if (select.closest('.custom-select') || select.dataset.customSelectReady === 'true') return;
    select.dataset.customSelectReady = 'true';
    select.classList.add('custom-select-native');

    const wrapper = document.createElement('div');
    wrapper.className = 'custom-select';
    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'custom-select-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    const menu = document.createElement('div');
    menu.className = 'custom-select-menu';
    menu.hidden = true;
    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'custom-select-search';
    search.placeholder = 'Pesquisar...';
    search.setAttribute('aria-label', 'Pesquisar opções');
    const options = document.createElement('div');
    options.className = 'custom-select-options';
    menu.append(search, options);
    select.parentNode.insertBefore(wrapper, select);
    wrapper.append(select, trigger, menu);

    const refresh = () => {
      const selected = select.options[select.selectedIndex];
      trigger.textContent = selected?.textContent || 'Selecione';
      trigger.disabled = select.disabled;
      options.innerHTML = '';
      Array.from(select.options).forEach((option) => {
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'custom-select-option';
        item.textContent = option.textContent;
        item.dataset.value = option.value;
        item.hidden = option.hidden;
        item.disabled = option.disabled;
        item.setAttribute('role', 'option');
        item.setAttribute('aria-selected', String(option.selected));
        item.addEventListener('click', () => {
          select.value = option.value;
          select.dispatchEvent(new Event('change', { bubbles: true }));
          close();
        });
        options.appendChild(item);
      });
      // feito ocultacao do campo de busca em selects com 6 opcoes ou menos porque menus curtos ficavam excessivamente altos e poluidos e resolvemos ativando apenas quando valeBuscar for verdadeiro
            const valeBuscar = select.options.length > 6;
      search.hidden = !valeBuscar;
      search.setAttribute('aria-hidden', String(!valeBuscar));
      menu.classList.toggle('custom-select-menu--curto', !valeBuscar);
    };
    const close = () => {
      menu.hidden = true;
      wrapper.classList.remove('is-open');
      search.value = '';
      options.querySelectorAll('.custom-select-option').forEach((item) => { item.hidden = false; });
    };
    trigger.addEventListener('click', () => {
      if (select.disabled) return;
      const willOpen = menu.hidden;
      document.querySelectorAll('.custom-select-menu:not([hidden])').forEach((openMenu) => { openMenu.hidden = true; openMenu.parentElement.classList.remove('is-open'); });
      menu.hidden = !willOpen;
      wrapper.classList.toggle('is-open', willOpen);
      if (willOpen) {
        if (search.hidden) {
          const atual = options.querySelector('.custom-select-option[aria-selected="true"]')
            || options.querySelector('.custom-select-option:not([hidden])');
          atual?.focus();
        } else {
          search.focus();
        }
      }
    });
    search.addEventListener('input', () => {
      const query = normalizeSelectSearch(search.value);
      options.querySelectorAll('.custom-select-option').forEach((item) => {
        item.hidden = !normalizeSelectSearch(item.textContent).includes(query);
      });
    });
    select.addEventListener('change', refresh);
    select.addEventListener('customselect:refresh', refresh);
    new MutationObserver(refresh).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });
    refresh();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.custom-select')) {
      document.querySelectorAll('.custom-select-menu:not([hidden])').forEach((menu) => {
        menu.hidden = true;
        menu.parentElement.classList.remove('is-open');
      });
    }
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      document.querySelectorAll('.custom-select-menu:not([hidden])').forEach((menu) => {
        menu.hidden = true;
        menu.parentElement.classList.remove('is-open');
        menu.parentElement.querySelector('.custom-select-trigger')?.focus();
      });
    }
  });
}

async function checkSharedPostOnLoad() {
  const postId = new URLSearchParams(window.location.search).get('post');
  if (!postId || !document.getElementById('adoptionModal')) return;
  if (!isUuid(postId)) return;
  try {
    const { data: post, error } = await getSupabaseClient()
      .from('posts')
      .select('*, profiles(full_name, username, avatar_url)')
      .eq('id', postId)
      .single();
    if (post && !error) openAdoptionModal(post);
  } catch (error) {
    console.error('Erro ao carregar o post compartilhado:', error);
  }
}

// feito geracao de codigo com crypto.getRandomValues e rejeicao de bias porque Math.random e previsivel para recuperacao de conta e resolvemos com CSPRNG de 6 digitos uniforme
function generateRecoveryCode() {
  const limite = 900000;
  const maximo = Math.floor(4294967296 / limite) * limite;
  const buffer = new Uint32Array(1);
  let valor;
  do {
    crypto.getRandomValues(buffer);
    valor = buffer[0];
  } while (valor >= maximo);
  return String(100000 + (valor % limite));
}

function showRecoveryCodeModal(code, redirect) {
  const modal = createDynamicModal(`<h2>Anote seu código de recuperação</h2><p>Guarde este código em um local seguro. Ele será necessário para redefinir sua senha.</p><div class="recovery-code">${escapeHTML(code)}</div><button type="button" class="btn btn-primary full" id="acknowledgeRecoveryCode" disabled>Entendi e anotei <span>(5)</span></button>`, 'recovery-code-modal');
  const button = modal.querySelector('#acknowledgeRecoveryCode');
  let seconds = 5;
  const timer = window.setInterval(() => {
    seconds -= 1;
    button.querySelector('span').textContent = seconds ? `(${seconds})` : '';
    if (!seconds) {
      window.clearInterval(timer);
      button.disabled = false;
    }
  }, 1000);
  button.addEventListener('click', () => { closeDynamicModal(modal); window.location.href = redirect; });
}

function setupPasswordRecovery() {
  document.getElementById('forgotPasswordButton')?.addEventListener('click', () => {
    const modal = createDynamicModal(`<h2>Recuperar senha</h2>
      <p>Informe seu e-mail ou nome de usuário e o código de recuperação de 6 dígitos que você anotou ao criar a conta.</p>
      <form id="recoveryCodeForm">
        <label>E-mail ou nome de usuário
          <input type="text" id="recoveryIdentifier" placeholder="seu@email.com ou seu_usuario" required />
        </label>
        <label>Código de recuperação
          <input type="text" id="recoveryCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000" required />
        </label>
        <button class="btn btn-primary full" type="submit">Continuar</button>
      </form>
      <p class="recovery-hint">Perdeu o código? Entre em contato com a administração.</p>`);

    const campoIdentificador = modal.querySelector('#recoveryIdentifier');
    const campoCodigo = modal.querySelector('#recoveryCode');

    const emailLoginInput = document.getElementById('loginEmail')?.value.trim();
    if (emailLoginInput && campoIdentificador) {
      campoIdentificador.value = emailLoginInput;
    }

    campoCodigo.addEventListener('input', (inputEvent) => {
      inputEvent.target.value = inputEvent.target.value.replace(/\D/g, '').slice(0, 6);
    });

    modal.querySelector('#recoveryCodeForm').addEventListener('submit', (codeEvent) => {
      codeEvent.preventDefault();
      const identifier = campoIdentificador.value.trim();
      const code = campoCodigo.value;
      if (!identifier) return showToast('Informe seu e-mail ou nome de usuário.', 'error');
      if (!/^\d{6}$/.test(code)) return showToast('Informe um código válido de 6 dígitos.', 'error');

      modal.querySelector('.dynamic-modal-panel').innerHTML = `<h2>Crie uma nova senha</h2>
        <p>Escolha uma senha forte para proteger sua conta.</p>
        <form id="recoveryPasswordForm">
          <label>Nova senha<input type="password" id="recoveryPassword" minlength="8" autocomplete="new-password" required /></label>
          <label>Confirmar senha<input type="password" id="recoveryPasswordConfirmation" minlength="8" autocomplete="new-password" required /></label>
          <button class="btn btn-primary full" type="submit">Redefinir senha</button>
        </form>`;

      modal.querySelector('#recoveryPasswordForm').addEventListener('submit', async (passwordEvent) => {
        passwordEvent.preventDefault();
        const newPass = modal.querySelector('#recoveryPassword').value;
        const confirmation = modal.querySelector('#recoveryPasswordConfirmation').value;
        if (newPass !== confirmation) return showToast('As senhas não coincidem.', 'error');
        if (getPasswordStrength(newPass).score < 2) return showToast('Escolha uma senha mais forte.', 'error');

        const client = getSupabaseClient();
        const { error } = await client.rpc('reset_password_with_code_v2', {
          p_recovery_code: code,
          p_new_password: newPass,
          p_identifier: identifier
        });
        if (error) {
          try {
            await client.rpc('log_falha_reset', { p_code: code });
          } catch (e) {
            console.warn('Não foi possível registrar a tentativa de reset:', e);
          }
          return showToast(error.message || 'Não foi possível redefinir a senha.', 'error');
        }
        closeDynamicModal(modal);
        showToast('Senha redefinida com sucesso. Faça login com a nova senha.');
      });
    });
  });
}

function cleanupAuthUrlParams() {
  try {
    if (window.location.hash && (window.location.hash.includes('access_token=') || window.location.hash.includes('refresh_token='))) {
      const cleanUrl = window.location.href.split('#')[0];
      window.history.replaceState(null, document.title, cleanUrl);
    }
    if (window.location.search && (window.location.search.includes('code=') || window.location.search.includes('error='))) {
      const url = new URL(window.location.href);
      url.searchParams.delete('code');
      url.searchParams.delete('state');
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      window.history.replaceState(null, document.title, url.href);
    }
  } catch (e) {
    console.warn('Falha ao limpar parâmetros sensíveis de autenticação da URL:', e);
  }
}

async function signInWithGoogle() {
  const client = getSupabaseClient();
  if (!client) {
    showToast('Cliente Supabase indisponível no momento.', 'error');
    return;
  }

  const base = document.baseURI || window.location.href;
  const redirectUrl = new URL('index.html', base).href;

  try {
    const { data, error } = await client.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectUrl
      }
    });

    if (error) throw error;
  } catch (error) {
    console.error('Erro ao autenticar com Google:', error);
    showToast(mensagemDeErroSegura(error, 'Não foi possível conectar com o Google. Verifique a configuração do OAuth.'), 'error');
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const emailOrUser = document.getElementById('loginEmail')?.value.trim();
  const password = document.getElementById('loginPassword')?.value.trim();
  const submitButton = event.target.querySelector('button[type="submit"]');
  const originalButtonText = submitButton ? submitButton.textContent : 'Entrar';

  if (!emailOrUser) return showToast('Informe seu e-mail ou nome de usuário.', 'error');
  if (!password) return showToast('Informe sua senha.', 'error');

  try {
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = 'Entrando...';
    }
    const user = await loginWithSupabase(emailOrUser, password);
    saveSession(user);
    resetVerificacao();
    showToast('Login realizado com sucesso!');
    setTimeout(() => {
      window.location.href = 'index.html';
    }, 450);
  } catch (error) {
    console.error('Erro ao efetuar login:', error);
    showToast(error.message || 'Erro ao entrar. Verifique suas credenciais.', 'error');
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.textContent = originalButtonText;
    }
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('registerName').value.trim();
  const username = document.getElementById('registerUsername').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const birthDateValue = document.getElementById('registerBirthDate').value.trim();
  const birthDateParts = birthDateValue.split('/');
  const isoDate = birthDateParts.length === 3
    ? `${birthDateParts[2]}-${birthDateParts[1]}-${birthDateParts[0]}`
    : '';
  const avatarFile = document.getElementById('registerAvatar').files[0];
  const password = document.getElementById('registerPassword').value.trim();
  const confirm = document.getElementById('registerConfirmPassword').value.trim();
  const termsAccepted = document.getElementById('registerTerms').checked;
  const parsedBirthDate = new Date(`${isoDate}T00:00:00`);
  if (avatarFile) {
    const avatarError = validateImageFile(avatarFile);
    if (avatarError) return showToast(avatarError, 'error');
  }
  if (!/^\d{2}\/\d{2}\/\d{4}$/.test(birthDateValue) || Number.isNaN(parsedBirthDate.getTime()) || parsedBirthDate.getDate() !== Number(birthDateParts[0]) || parsedBirthDate.getMonth() + 1 !== Number(birthDateParts[1]) || parsedBirthDate.getFullYear() !== Number(birthDateParts[2])) {
    return showToast('Informe uma data de nascimento válida no formato DD/MM/AAAA.', 'error');
  }
  if (!termsAccepted) return showToast('Você precisa concordar com os Termos de Uso e Privacidade.', 'error');
  if (password !== confirm) return showToast('As senhas não coincidem.', 'error');
  try {
    const recoveryCode = generateRecoveryCode();
    const user = await registerWithSupabase(name, username, email, password, isoDate, avatarFile, recoveryCode);
    const { data: sessionData } = await getSupabaseClient().auth.getSession();
    if (sessionData?.session || user.has_session) {
      saveSession(user);
      saveVerifiedSession({ ...user, role: 'user', status: 'active' });
    }
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    showRecoveryCodeModal(recoveryCode, redirect || 'index.html');
  } catch (error) {
    showToast(error.message || 'Erro ao criar conta.', 'error');
  }
}

async function handleProfileUsernameSubmit(event) {
  event.preventDefault();
  const session = redirectIfLoggedOut();
  if (!session) return;
  const normalizedUsername = normalizeUsername(document.getElementById('profileUsername').value);
  if (!normalizedUsername) return showToast('Informe um nome de usuário válido.', 'error');
  try {
    await garantirUsernameLivre(getSupabaseClient(), normalizedUsername, session.userId);

    const { error } = await getSupabaseClient().from('profiles').update({ username: normalizedUsername }).eq('id', session.userId);
    if (error) {
      // feito validacao defensiva do erro 23505 com garantirUsernameLivre porque conflitos em outros campos geravam falso positivo de username e resolvemos testando especificamente a unicidade
      if (error.code === '23505') {
        await garantirUsernameLivre(getSupabaseClient(), normalizedUsername, session.userId);
      }
      throw new Error(mensagemDeErroSegura(error));
    }
    saveSession({ ...session, id: session.userId, username: normalizedUsername });
    document.getElementById('profileUsername').value = normalizedUsername;
    showToast('Nome de usuário atualizado com sucesso.');
  } catch (error) {
    showToast(mensagemDeErroSegura(error, 'Não foi possível atualizar o nome de usuário.'));
  }
}

function setupRegisterBirthDateMask() {
  const field = document.getElementById('registerBirthDate');
  if (!field) return;
  field.addEventListener('input', (event) => {
    const digits = event.target.value.replace(/\D/g, '').slice(0, 8);
    const parts = [];
    if (digits.length > 0) parts.push(digits.slice(0, 2));
    if (digits.length > 2) parts.push(digits.slice(2, 4));
    if (digits.length > 4) parts.push(digits.slice(4, 8));
    event.target.value = parts.join('/');
  });
}

async function handleAvatarUpdate(event) {
  event.preventDefault();
  const file = document.getElementById('profileAvatarInput').files[0];
  const session = redirectIfLoggedOut();
  if (!session || !file) return showToast('Selecione uma foto para continuar.', 'error');
  const oldAvatarUrl = session.avatar_url;
  let newAvatarUrl = null;
  try {
    newAvatarUrl = await uploadAvatar(file, session.userId);
    const { error } = await getSupabaseClient().from('profiles').update({ avatar_url: newAvatarUrl }).eq('id', session.userId);
    if (error) {
      // feito rollback imediato com deleteStorageImageByUrl porque falhas no update de profiles geravam avatares orfaos e resolvemos desfazendo o upload se o banco falhar
      if (newAvatarUrl) await deleteStorageImageByUrl(newAvatarUrl);
      throw new Error(mensagemDeErroSegura(error));
    }
    // feito expurgo de oldAvatarUrl no Storage porque acumulo de avatares antigos estourava a cota do bucket e resolvemos removendo o arquivo substituido
    if (oldAvatarUrl && oldAvatarUrl !== newAvatarUrl) {
      deleteStorageImageByUrl(oldAvatarUrl);
    }
    saveSession({ ...session, id: session.userId, avatar_url: newAvatarUrl });
    document.getElementById('profileAvatarPreview').src = newAvatarUrl;
    showToast('Foto de perfil atualizada com sucesso.');
  } catch (error) {
    showToast(`Não foi possível atualizar a foto: ${mensagemDeErroSegura(error)}`, 'error');
  }
}

async function handleProfileEmailSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('profileEmail').value.trim().toLowerCase();
  if (!isValidEmail(email)) return showToast('Informe um e-mail válido.', 'error');

  try {
    const { data, error } = await getSupabaseClient().auth.updateUser({ email });
    if (error) throw new Error(mensagemDeErroSegura(error));

    const session = getSession();
    await getSupabaseClient().from('profiles').update({ email }).eq('id', session.userId);
    saveSession({ ...session, id: session.userId, email: data.user?.email || email });

    showToast('Solicitação enviada. Verifique os e-mails para confirmar a alteração.');
  } catch (error) {
    showToast(`Não foi possível atualizar o e-mail: ${mensagemDeErroSegura(error)}`, 'error');
  }
}

async function handleProfilePasswordSubmit(event) {
  event.preventDefault();
  const password = document.getElementById('profilePassword').value;
  const confirmation = document.getElementById('profilePasswordConfirmation').value;
  if (password !== confirmation) return showToast('As senhas não coincidem.', 'error');
  if (getPasswordStrength(password).score < 2) return showToast('A senha deve ter pelo menos 8 caracteres e ser mais forte.', 'error');
  try {
    const { error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw new Error(mensagemDeErroSegura(error));
    event.currentTarget.reset();
    showToast('Senha atualizada com sucesso.');
  } catch (error) {
    showToast(`Não foi possível atualizar a senha: ${mensagemDeErroSegura(error)}`, 'error');
  }
}

async function deleteAccount() {
  const session = redirectIfLoggedOut();
  if (!session || !confirm('Excluir sua conta é permanente. Deseja continuar?')) return;
  try {
    const { error } = await getSupabaseClient().rpc('delete_user');
    if (error) throw new Error(mensagemDeErroSegura(error));
    await getSupabaseClient().auth.signOut();
    clearSession();
    window.location.href = 'index.html';
  } catch (error) {
    showToast(`Não foi possível excluir a conta. Configure a função RPC delete_user no Supabase: ${mensagemDeErroSegura(error)}`, 'error');
  }
}

async function updatePostStatus(postId, newStatus = 'adopted') {
  const session = getSession();
  if (!session) return;
  const { error } = await getSupabaseClient()
    .from('posts')
    .update({ status: newStatus })
    .eq('id', postId)
    .eq('user_id', session.userId);

  if (error) {
    showToast(`Não foi possível atualizar a publicação: ${mensagemDeErroSegura(error)}`, 'error');
    return;
  }

  if (newStatus === 'adopted') {
    showToast('Parabéns! Que alegria ver mais um pet encontrando um lar! 🎉');
  } else if (newStatus === 'in_process') {
    showToast('Publicação atualizada: Em processo de adoção ⏳');
  } else {
    showToast('Publicação reaberta como Disponível.');
  }
  renderUserPosts();
}

async function renderUserPosts() {
  const target = document.getElementById('userPosts');
  const session = getSession();
  if (!target || !session) return;
  target.innerHTML = '<div class="empty-state">Carregando suas publicações...</div>';
  const { data, error } = await getSupabaseClient()
    .from('posts')
    .select(POST_CARD_COLUMNS)
    .eq('user_id', session.userId)
    .order('created_at', { ascending: false });

  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar suas publicações: ${escapeHTML(error.message)}</div>`;
    return;
  }
  if (!data?.length) {
    target.innerHTML = '<div class="empty-state">Você ainda não criou nenhuma publicação.</div>';
    return;
  }

  registerPostsInGlobalCache(data);
  target.innerHTML = data.map((post) => {
    const isAdopted = post.status === 'adopted';
    const isInProcess = post.status === 'in_process';
    const isActive = post.status === 'active';
    const isPending = post.status === 'pending';
    const isRejected = post.status === 'rejected';

    let actionButtons = '';
    let statusNotice = '';
    if (isPending) {
      statusNotice = '<p class="my-post-notice" style="font-size: 0.8rem; color: #b45309; margin: 4px 0 0 0;">⏳ Em análise pela moderação. Ficará visível para o público assim que aprovada.</p>';
    } else if (isRejected) {
      statusNotice = '<p class="my-post-notice" style="font-size: 0.8rem; color: #b91c1c; margin: 4px 0 0 0;">❌ Publicação não autorizada pela moderação. Entre em contato com o suporte para orientações.</p>';
    } else if (isActive) {
      actionButtons = `
        <button class="btn btn-secondary" type="button" data-change-status="in_process" data-post-id="${escapeHTML(post.id)}">Pausar (Em entrevista ⏳)</button>
        <button class="btn btn-primary" type="button" data-change-status="adopted" data-post-id="${escapeHTML(post.id)}">Marcar como Adotado! 🎉</button>
      `;
    } else if (isInProcess) {
      actionButtons = `
        <button class="btn btn-secondary" type="button" data-change-status="active" data-post-id="${escapeHTML(post.id)}">Voltar para Disponível</button>
        <button class="btn btn-primary" type="button" data-change-status="adopted" data-post-id="${escapeHTML(post.id)}">Confirmar: Adotado! 🎉</button>
      `;
    } else if (isAdopted) {
      actionButtons = `
        <button class="btn btn-secondary" type="button" data-change-status="active" data-post-id="${escapeHTML(post.id)}">Reabrir publicação</button>
      `;
    }

    return `
      <article class="profile-post-card ${isAdopted ? 'adopted-card' : ''}">
        <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
        ${isAdopted ? '<div class="adopted-ribbon">Adotado! 🎉</div>' : ''}
        ${isInProcess ? '<div class="adopted-ribbon" style="background: #f59e0b;">Em processo</div>' : ''}
        ${isPending ? '<div class="adopted-ribbon" style="background: #f59e0b;">Em moderação ⏳</div>' : ''}
        ${isRejected ? '<div class="adopted-ribbon" style="background: #ef4444;">Recusado ❌</div>' : ''}
        ${generateImageCarouselHTML(post.image_urls, post.title)}
        <div class="profile-post-card-body">
          ${renderAuthorBar(post.profiles)}
          <div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 6px;">
            <span class="mini-tag">${escapeHTML(formatAnimalType(post.animal_type))}</span>
            ${renderSupportTypeBadge(post.support_type)}
          </div>
          <h3>${escapeHTML(post.title)}</h3>
          <p><svg class="pin-icon" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20 10c0 5.2-8 12-8 12s-8-6.8-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="2.6"/></svg> ${escapeHTML(formatPostLocation(post))}</p>

        <div class="my-post-status-box">
            <div class="my-post-status-header">
              <span>Status atual:</span>
              ${renderPostStatusBadge(post.status)}
            </div>
            ${statusNotice}
            <div class="my-post-status-actions">
              <button class="btn btn-secondary" type="button" data-post-details="${escapeHTML(post.id)}">Ver anúncio e Story 🎨</button>
              ${actionButtons}
              ${adminPostActions(post.id, true)}
            </div>
          </div>
        </div>
      </article>
    `;
  }).join('');

  const postsById = new Map(data.map((post) => [String(post.id), post]));
  target.querySelectorAll('[data-post-details]').forEach((button) => {
    button.addEventListener('click', () => {
      const post = postsById.get(button.dataset.postDetails);
      if (post) openAdoptionModal(post);
    });
  });

  target.querySelectorAll('[data-change-status]').forEach((button) => {
    button.addEventListener('click', () => {
      const postId = button.dataset.postId;
      const newStatus = button.dataset.changeStatus;
      if (postId && newStatus) updatePostStatus(postId, newStatus);
    });
  });
}

async function renderProfileFavorites() {
  return renderFavorites();
}

function setupProfilePage() {
  const session = redirectIfLoggedOut();
  if (!session) return;
  const avatarPreview = document.getElementById('profileAvatarPreview');
  avatarPreview.src = session.avatar_url || DEFAULT_AVATAR_URL;
  document.getElementById('profileName').textContent = session.name;
  document.getElementById('profileEmail').value = session.email || '';
  document.getElementById('profileUsername').value = session.username || '';
  document.getElementById('profileUsernameForm')?.addEventListener('submit', handleProfileUsernameSubmit);
  document.getElementById('profileAvatarForm')?.addEventListener('submit', handleAvatarUpdate);
  document.getElementById('profileEmailForm')?.addEventListener('submit', handleProfileEmailSubmit);
  document.getElementById('profilePasswordForm')?.addEventListener('submit', handleProfilePasswordSubmit);
  document.getElementById('deleteAccountButton')?.addEventListener('click', deleteAccount);
}

// feito verificacao autoritativa unica via getVerificacaoAtual porque consultar o servidor a cada componente causava cascata de rede e resolvemos centralizando no ciclo de inicializacao da pagina
async function initializePage() {
  const verificacao = await getVerificacaoAtual();
  const data = { user: verificacao?.user || null };

  if (data.user) {
    const profile = verificacao.profile;
    const localFavoriteIds = readStorage(STORAGE_KEYS.favorites, []);
    const favoritePosts = [...new Set([...(profile?.favorite_posts || []), ...(Array.isArray(localFavoriteIds) ? localFavoriteIds : [])].map((id) => String(id)))];
    if (localFavoriteIds?.length) {
      await getSupabaseClient().from('profiles').update({ favorite_posts: favoritePosts }).eq('id', data.user.id);
      localStorage.removeItem(STORAGE_KEYS.favorites);
    }
    saveSession({
      id: data.user.id,
      email: data.user.email,
      name: profile?.full_name || data.user.user_metadata?.full_name || data.user.email,
      username: profile?.username || null,
      birth_date: profile?.birth_date || null,
      avatar_url: profile?.avatar_url || null,
      favorite_posts: favoritePosts
    });
    saveVerifiedSession({
      id: data.user.id,
      email: data.user.email,
      name: profile?.full_name || data.user.user_metadata?.full_name || data.user.email,
      username: profile?.username || null,
      role: profile?.role || 'user',
      status: profile?.status || 'active',
      birth_date: profile?.birth_date || null,
      avatar_url: profile?.avatar_url || null,
      favorite_posts: favoritePosts
    });
  } else {
    clearSession();
    sessionStorage.removeItem(AUTHORITATIVE_SESSION_KEY);
  }

  const page = document.body.dataset.page;

  if (data.user && verificacao.status === 'banned') {
    await getSupabaseClient().auth.signOut();
    clearSession();
    resetVerificacao();
    showToast('Esta conta está banida. Entre em contato com a administração.', 'error');
    if (page !== 'home') {
      window.location.href = 'index.html';
      return;
    }
  }

  setupImageFallbacks();
  setupPWA();
  setupMobileNavCurrent();
  setupScrollReveal();
  setupPostCarouselNavigation();
  setupFavoriteInteractionsV7();
  setupShareInteractions();
  setupCopyContactInteractions();
  bindAdminActions();
  await updateHomeUserActions();
  initCustomSelects();
  setupGlobalModalHandlers();
  initCookieConsent();
  // feito leitura de petamor_flash_toast em sessionStorage porque redirecionamentos de pagina limpavam o estado dos toasts e resolvemos exibindo a mensagem apos a nova carga
  try {
    const flashToast = sessionStorage.getItem('petamor_flash_toast');
    if (flashToast) {
      sessionStorage.removeItem('petamor_flash_toast');
      const parsed = JSON.parse(flashToast);
      if (parsed?.msg) {
        showToast(parsed.msg, parsed.type || 'success');
      }
    }
  } catch (_) {}

  // feito remocao de parametros sensiveis da URL via cleanupAuthUrlParams porque tokens de OAuth ficavam expostos no historico do navegador e resolvemos limpando apos o handshake
  cleanupAuthUrlParams();
  document.getElementById('googleAuthButton')?.addEventListener('click', signInWithGoogle);

  if (page === 'home') {
    loadSiteStatistics();
    loadHomeRealStats();
    setupDonationRedirect();
    setupSupportModal();
    renderRecentPosts();
    setupAdoptionCarousel();
    setupFeedFilters();
  } else if (page === 'category') {
    setupCategoryPage();
  } else if (page === 'login') {
    if (getSession()) {
      window.location.href = 'index.html';
      return;
    }
    document.getElementById('loginForm')?.addEventListener('submit', handleLoginSubmit);
    setupPasswordRecovery();
  } else if (page === 'register') {
    if (getSession()) {
      window.location.href = 'index.html';
      return;
    }
    setupRegisterBirthDateMask();
    document.getElementById('registerForm')?.addEventListener('submit', handleRegisterSubmit);
    const registerPasswordInput = document.getElementById('registerPassword');
    if (registerPasswordInput) {
      registerPasswordInput.addEventListener('input', (event) => {
        updatePasswordStrength(event.target.value);
      });
    }
  } else if (page === 'create-post' && redirectIfLoggedOut()) {
    setupCreatePostForm();
  } else if (page === 'profile') {
    setupProfilePage();
  } else if (page === 'my-posts' && redirectIfLoggedOut()) {
    renderUserPosts();
  } else if (page === 'favorites' && redirectIfLoggedOut()) {
    renderProfileFavorites();
  } else if (page === 'admin') {
    const { data: authData } = await getSupabaseClient().auth.getUser();
    if (authData?.user) {
      const profile = await fetchProfileByUserId(authData.user.id);
      if (profile?.role !== 'admin') {
        showToast('Acesso negado. Essa tentativa foi registrada.', 'error');
        return (window.location.href = 'index.html');
      }
    } else {
      return (window.location.href = 'conta/login.html');
    }

    document.getElementById('logoutButton')?.addEventListener('click', () => {
      getSupabaseClient().auth.signOut().then(() => { clearSession(); window.location.href = 'conta/login.html'; });
    });
    document.getElementById('adminAccountForm')?.addEventListener('submit', handleAdminAccountSubmit);
    setupStatisticsManagement();
    loadSiteStatistics();
    document.getElementById('adminUserSearchForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      searchAdminUsers(document.getElementById('adminUserSearch').value);
    });
    setupPostApprovalToggle();
    renderPendingPostsAdmin();
    document.getElementById('refreshPendingPostsBtn')?.addEventListener('click', renderPendingPostsAdmin);
    document.getElementById('refreshAnalyticsBtn')?.addEventListener('click', () => {
      showToast('Atualizando dados...');
      renderAdminDashboard();
    });
    document.getElementById('analyticsPeriodSelect')?.addEventListener('change', () => {
      renderAdminDashboard();
    });
    renderAdminDashboard();
  }
  await checkSharedPostOnLoad();
}

document.addEventListener('DOMContentLoaded', initializePage);
