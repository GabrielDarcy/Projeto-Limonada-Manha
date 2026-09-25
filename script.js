import { supabase } from './supabase.js';

const STORAGE_KEYS = {
  users: 'petamor_users',
  ads: 'petamor_ads',
  session: 'petamor_session',
  favorites: 'petamor_favorites'
};

const ALLOWED_EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com'];
const FEED_PAGE_SIZE = 10;
let feedCurrentPage = 0;

const DOG_BREEDS = [
  'Vira-lata (SRD)', 'Golden Retriever', 'Labrador Retriever', 'Pastor Alemão',
  'Bulldogue Francês', 'Bulldogue Inglês', 'Poodle', 'Shih-tzu', 'Yorkshire Terrier',
  'Rottweiler', 'Pitbull', 'Pinscher', 'Beagle', 'Boxer', 'Dachshund', 'Husky Siberiano',
  'Border Collie', 'Cocker Spaniel', 'Chihuahua', 'Basset Hound', 'Doberman', 'Maltês',
  'Akita', 'Pug', 'Schnauzer', 'Outra raça'
];

const CAT_BREEDS = [
  'Vira-lata (SRD)', 'Siamês', 'Persa', 'Maine Coon', 'Ragdoll', 'Angorá', 'Bengal',
  'British Shorthair', 'Sphynx', 'Scottish Fold', 'Abissínio', 'Birmanês', 'Azul Russo',
  'Exótico de Pelo Curto', 'Himalaio', 'American Shorthair', 'Outra raça'
];

const FARM_BREEDS = ['Cavalo', 'Vaca', 'Porco', 'Ovelha', 'Cabra', 'Galinha', 'Pato', 'Outro'];
const MARINE_BREEDS = ['Tartaruga', 'Peixe', 'Caranguejo', 'Outro'];

const BANNED_WORDS = [
  'merda', 'porra', 'caralho', 'puta', 'puto', 'viado', 'vadia', 'bosta', 'foder', 'fodase', 'desgracado', 'desgracada'
];

// --- SISTEMA DE SEGURANÇA (Prevenção de XSS) ---
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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

function closeDynamicModal(modal) {
  modal?.remove();
  document.body.classList.remove('modal-open');
}

function createDynamicModal(content, className = '') {
  const modal = document.createElement('div');
  modal.className = `dynamic-modal ${className}`;
  modal.innerHTML = `<div class="dynamic-modal-backdrop"></div><section class="dynamic-modal-panel" role="dialog" aria-modal="true">${content}</section>`;
  document.body.appendChild(modal);
  document.body.classList.add('modal-open');
  return modal;
}

function saveSession(user) {
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
  writeStorage(STORAGE_KEYS.session, payload);
}

function getSession() {
  return readStorage(STORAGE_KEYS.session, null);
}

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase().replace(/^@+/, '').replace(/[^a-z0-9._]/g, '');
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
  const nextFavorites = favorites.includes(normalizedId)
    ? favorites.filter((id) => id !== normalizedId)
    : [...favorites, normalizedId];
  if (session) {
    const { error } = await getSupabaseClient().from('profiles').update({ favorite_posts: nextFavorites }).eq('id', session.userId);
    if (error) throw new Error(`Não foi possível atualizar seus favoritos: ${error.message}`);
    saveSession({ ...session, id: session.userId, favorite_posts: nextFavorites });
  } else {
    writeStorage(STORAGE_KEYS.favorites, nextFavorites);
  }
  return nextFavorites.includes(normalizedId);
}

function favoriteButtonHTML(postId) {
  const favorite = isFavorite(postId);
    return `<button class="favorite-button${favorite ? ' is-favorite' : ''}" type="button" data-favorite-id="${escapeHTML(postId)}" aria-label="${favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" aria-pressed="${favorite}">${favorite ? '❤️' : '🤍'}</button>`;
}

function shareButtonHTML(post) {
  return `<button class="share-button" type="button" data-share-post="${escapeHTML(post.id)}" data-share-title="${escapeHTML(post.title || 'Pet Amor')}" data-share-text="${escapeHTML(post.description || '')}" aria-label="Compartilhar publicação" title="Compartilhar"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 8a3 3 0 1 0-2.83-4A3 3 0 0 0 15 5c0 .18.02.36.05.53L8.91 9.05A3 3 0 1 0 9 12c0-.18-.02-.36-.05-.53l6.14-3.52c.52.65 1.32 1.05 2.22 1.05Zm0 8a3 3 0 0 0-2.83 2L9.03 14.5A3 3 0 1 0 8 16c.18 0 .36-.02.53-.05l6.14 3.52A3 3 0 1 0 18 16Z"></path></svg></button>`;
}

function getPostPhone(post) {
  const directPhone = post.phone || post.contact_phone;
  if (directPhone) return String(directPhone).replace(/\D/g, '');
  const phoneMatch = String(post.contact_info || '').match(/(?:Tel|Telefone|WhatsApp):\s*([^|]+)/i);
  return phoneMatch ? phoneMatch[1].replace(/\D/g, '') : '';
}

function postActionButtonsHTML(post) {
  const phone = getPostPhone(post);
  const title = encodeURIComponent(`Olá, vi o post do ${post.title || 'animal'} no Pet Amor e gostaria de saber mais!`);
  const adoptionAction = phone
    ? `<a class="btn btn-primary" href="https://wa.me/55${phone}?text=${title}" target="_blank" rel="noopener noreferrer">Conversar no WhatsApp</a>`
    : `<button class="btn btn-primary" type="button" data-adoption-post="${escapeHTML(post.id)}">Quero Adotar!</button>`;
  return `${adoptionAction}${adminPostActions(post.id)}`;
}

function postActionHTML(post) {
  return `<div class="post-action-row">${postActionButtonsHTML(post)}</div>`;
}

function renderAuthorBar(profile) {
  const authorProfile = Array.isArray(profile) ? profile[0] : profile;
  const firstName = authorProfile?.full_name?.split(' ')[0] || 'Usuário';
  const username = authorProfile?.username ? `@${escapeHTML(authorProfile.username.replace(/^@/, ''))}` : '';
  const avatarUrl = authorProfile?.avatar_url || 'https://placehold.co/56x56/ffe8ce/7a3d16?text=🐾';
  return `<div class="post-author-bar"><img class="post-author-avatar" src="${escapeHTML(avatarUrl)}" alt="Foto de ${escapeHTML(firstName)}"><span class="post-author-name">${escapeHTML(firstName)}</span>${username ? `<span class="post-author-username">${escapeHTML(username)}</span>` : ''}</div>`;
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
  return ALLOWED_EMAIL_DOMAINS.includes(domain) || domain.endsWith('.com') || domain.endsWith('.net') || domain.endsWith('.org');
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

async function fetchProfileByUserId(userId) {
  const client = getSupabaseClient();
  if (client) {
    const { data, error } = await client.from('profiles').select('*').eq('id', userId).single();
    if (!error && data) return data;
  }
  return null;
}

async function loginWithSupabase(email, password) {
  const client = getSupabaseClient();
  const loginEmail = email.toLowerCase() === 'admin' ? 'admin@petamor.com' : email;
  const { data, error } = await client.auth.signInWithPassword({ email: loginEmail, password });
  if (error) throw new Error(error.message);

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
    if (error) throw error;

    if (authData.user) {
      await getSupabaseClient().from('profiles').update({ email: updates.email }).eq('id', authData.user.id);
      saveSession({ ...getSession(), id: authData.user.id, email: updates.email });
      emailField.value = updates.email;
      passwordField.value = '';
    }
    showToast('Credenciais atualizadas com sucesso.');
  } catch (error) {
    showToast(`Não foi possível atualizar as credenciais: ${error.message}`, 'error');
  }
}

async function uploadAvatar(file, userId) {
  const fileError = validateImageFile(file);
  if (fileError) throw new Error(fileError);
  
  const extension = file.name.split('.').pop().toLowerCase();
  // Usa sempre o mesmo nome base, forçando o Supabase a sobrescrever (upsert)
  const fileName = `${userId}/avatar.${extension}`; 
  
  const client = getSupabaseClient();
  const { data, error } = await client.storage.from('avatars').upload(fileName, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type
  });
  
  // adiciona um timestamp na URL gerada apenas no frontend para quebrar o cache do navegador
  if (error) throw new Error(`Não foi possível enviar a foto de perfil: ${error.message}`);
  const { data: publicUrlData } = client.storage.from('avatars').getPublicUrl(data.path);
  if (!publicUrlData?.publicUrl) throw new Error('Não foi possível obter a URL.');
  
  return `${publicUrlData.publicUrl}?t=${Date.now()}`;
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
  const { data: existingProfile, error: usernameCheckError } = await client.from('profiles').select('id').eq('username', normalizedUsername).maybeSingle();
  if (usernameCheckError) throw new Error(`Não foi possível validar o nome de usuário: ${usernameCheckError.message}`);
  if (existingProfile) throw new Error('Este nome de usuário já está em uso. Escolha outro.');

  const { data, error } = await client.auth.signUp({
    email,
    password,
    options: { data: { full_name: name.trim() } }
  });

  if (error) throw new Error(error.message);

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
      recovery_code: recoveryCode,
      status: 'active'
    }).eq('id', userId);
    if (profileError) {
      if (profileError.code === '23505') throw new Error('Este nome de usuário já está em uso. Escolha outro.');
      throw new Error(`Não foi possível salvar o perfil: ${profileError.message}`);
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
    favorite_posts: []
  };
}

function updateHomeUserActions() {
  const session = getSession();
  const heroSection = document.getElementById('inicio');
  if (heroSection) heroSection.style.display = session ? 'none' : 'block';
  const actionsNode = document.getElementById('homeUserActions');
  if (!actionsNode) return;

  if (!session) {
    actionsNode.innerHTML = `
      <a href="login.html" class="btn btn-secondary">Entrar</a>
      <a href="register.html" class="btn btn-primary">Cadastrar</a>
    `;
    return;
  }

  const isAdmin = String(session.role || '').toLowerCase() === 'admin';
  const avatarUrl = session.avatar_url || 'https://placehold.co/96x96/ffe8ce/7a3d16?text=🐾';
  actionsNode.innerHTML = `
    ${isAdmin ? '<a href="admin.html" class="btn btn-primary">Dashboard admin</a>' : ''}
    <a href="create-post.html" class="btn btn-primary">Criar publicação</a>
    <a href="my-posts.html" class="btn btn-secondary">Minhas publicações</a>
    <a href="favorites.html" class="header-favorites-link" aria-label="Abrir meus favoritos" title="Meus favoritos"><svg class="header-favorites-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"></path></svg></a>
    <a href="profile.html" class="profile-avatar-link" aria-label="Abrir meu perfil"><img class="profile-avatar" src="${escapeHTML(avatarUrl)}" alt="Foto de perfil de ${escapeHTML(session.name)}"></a>
    <button class="btn btn-secondary" id="homeLogoutButton">Sair</button>
  `;

  actionsNode.innerHTML = actionsNode.innerHTML.replace('header-favorites-link', 'header-favorite-link');
  const headerFavoriteLink = actionsNode.querySelector('.header-favorite-link');
  headerFavoriteLink?.classList.add('header-favorite-link');
  headerFavoriteLink?.querySelector('svg')?.setAttribute('fill', 'currentColor');

  document.getElementById('homeLogoutButton')?.addEventListener('click', () => {
    getSupabaseClient().auth.signOut().finally(() => {
      clearSession();
      updateHomeUserActions();
    });
  });
}

function setupDonationRedirect() {
  const button = document.getElementById('btnQueroDoar');
  if (!button) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    window.location.href = getSession() ? 'create-post.html' : 'register.html?redirect=create-post.html';
  });
}

function setupSupportModal() {
  const modal = document.getElementById('supportModal');
  const openButton = document.getElementById('helpSiteButton');
  if (modal && openButton) openButton.addEventListener('click', () => { modal.hidden = false; });
  document.querySelectorAll('[data-help-reason]').forEach((button) => {
    button.addEventListener('click', () => {
      const message = document.getElementById('supportModalMessage');
      if (message) message.textContent = `Que lindo! Sua ajuda com ${button.dataset.helpReason} mantém o Pet Amor vivo. Obrigado por cuidar com a gente!`;
      if (modal) modal.hidden = false;
    });
  });
  const contactModal = document.getElementById('contactModal');
  document.getElementById('supportContactLink')?.addEventListener('click', (event) => {
    event.preventDefault();
    if (contactModal) contactModal.hidden = false;
  });
  modal?.querySelectorAll('[data-support-close]').forEach((element) => {
    element.addEventListener('click', () => { modal.hidden = true; });
  });
  contactModal?.querySelectorAll('[data-contact-close]').forEach((element) => {
    element.addEventListener('click', () => { contactModal.hidden = true; });
  });
}

function redirectIfLoggedOut() {
  const session = getSession();
  if (!session) {
    window.location.href = 'login.html';
    return null;
  }
  return session;
}

async function renderAdminDashboard() {
  const postsTableBody = document.getElementById('postsTableBody');
  if (postsTableBody) {
    const { data: posts, error } = await getSupabaseClient()
      .from('posts')
      .select('id, title, animal_type, city')
      .order('created_at', { ascending: false });

    if (error) {
      postsTableBody.innerHTML = `<tr><td colspan="4">Não foi possível carregar os posts: ${escapeHTML(error.message)}</td></tr>`;
      return;
    }

    postsTableBody.innerHTML = (posts || []).map((post) => `
      <tr>
        <td>${escapeHTML(post.title)}</td>
        <td>${escapeHTML(post.animal_type || 'Não informado')}</td>
        <td>${escapeHTML(post.city || 'Não informada')}</td>
        <td><button class="admin-btn danger" data-action="delete-post" data-id="${escapeHTML(post.id)}">Excluir</button></td>
      </tr>
    `).join('') || '<tr><td colspan="4">Nenhum post publicado.</td></tr>';
  }
}

async function loadSiteStatistics() {
  const { data, error } = await getSupabaseClient()
    .from('site_statistics')
    .select('total_lares, base_diaria')
    .eq('id', 1)
    .single();
  if (error) {
    showToast(`Não foi possível carregar as estatísticas: ${error.message}`, 'error');
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

async function updateSiteStatistics(totalHomes, reset = false) {
  const updates = reset ? { total_lares: 0, base_diaria: 0 } : { total_lares: Number(totalHomes) };
  const { error } = await getSupabaseClient().from('site_statistics').update(updates).eq('id', 1);
  if (error) {
    showToast(`Não foi possível atualizar as estatísticas: ${error.message}`, 'error');
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

async function deletePost(postId) {
  const { error } = await getSupabaseClient().from('posts').delete().eq('id', postId);
  if (error) {
    showToast(`Não foi possível excluir o post: ${error.message}`, 'error');
    return;
  }
  renderAdminDashboard();
}

async function searchAdminUsers(queryValue) {
  const target = document.getElementById('adminUserResults');
  const query = String(queryValue || '').trim();
  if (!target || !query) return;
  const { data: users, error } = await getSupabaseClient().from('profiles')
    .select('id, email, full_name, username, birth_date, status, role')
    .or(`email.ilike.%${query}%,full_name.ilike.%${query}%,username.ilike.%${query}%`)
    .limit(10);
  if (error) {
    target.innerHTML = `<p class="admin-search-message">Não foi possível buscar usuários: ${escapeHTML(error.message)}</p>`;
    return;
  }
  if (!users?.length) {
    target.innerHTML = '<p class="admin-search-message">Nenhum usuário encontrado.</p>';
    return;
  }
  target.innerHTML = users.map((user) => `<article class="admin-user-result" data-user-id="${escapeHTML(user.id)}"><div><strong>${escapeHTML(user.full_name || 'Sem nome')}</strong><span>${escapeHTML(user.email || '')} · @${escapeHTML(user.username || 'sem username')}</span><span>Nascimento: ${escapeHTML(user.birth_date || 'Não informado')}</span><span>Status: ${escapeHTML(user.status || 'active')}</span></div><button class="admin-btn danger" type="button" data-action="ban-user" data-id="${escapeHTML(user.id)}" ${user.status === 'banned' ? 'disabled' : ''}>${user.status === 'banned' ? 'Banido' : 'Banir'}</button><div class="admin-user-posts" data-posts-for="${escapeHTML(user.id)}"><span>Carregando publicações...</span></div></article>`).join('');
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
  target.innerHTML = posts?.length ? `<strong>Publicações</strong>${posts.map((post) => `<span>${escapeHTML(post.title)} · ${escapeHTML(post.status || 'active')}</span>`).join('')}` : '<span>Nenhuma publicação.</span>';
}

async function banAdminUser(userId) {
  const { error } = await getSupabaseClient().rpc('admin_ban_user', { p_user_id: userId });
  if (error) return showToast(`Não foi possível banir o usuário: ${error.message}`, 'error');
  showToast('Usuário banido com sucesso.');
  searchAdminUsers(document.getElementById('adminUserSearch')?.value);
}

function bindAdminActions() {
  document.body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'delete-post') {
      deletePost(button.dataset.id);
    }
    if (button.dataset.action === 'ban-user') {
      banAdminUser(button.dataset.id);
    }
  });
}

function validateImageFile(file) {
  if (!file) return 'Selecione uma imagem.';
  const name = file.name.toLowerCase();
  const allowedExtensions = /\.(jpe?g|png|webp)$/i;
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp'];
  if (!allowedExtensions.test(name) || !allowedTypes.includes(file.type)) {
    return 'Só aceitamos fotos JPG/PNG/WebP de até 8MB.';
  }
  if (file.size > 8 * 1024 * 1024) {
    return 'Só aceitamos fotos JPG/PNG/WebP de até 8MB.';
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

function renderContactItems(post) {
  return getContactItems(post).map((item) => `<span>${escapeHTML(item)}</span>`).join('');
}

function adminPostActions(postId) {
  return String(getSession()?.role || '').toLowerCase() === 'admin'
    ? `<button class="btn btn-danger admin-feed-delete" type="button" data-action="delete-post" data-id="${escapeHTML(postId)}">Deletar Post</button>`
    : '';
}

async function uploadPostImage(file) {
  const client = getSupabaseClient();
  const fileError = validateImageFile(file);
  if (fileError) throw new Error(fileError);
  const extension = file.name.split('.').pop().toLowerCase();
  // Corrigido suporte a UUID em Live Previews HTTP para evitar telas brancas silenciosas
  const uuid = crypto?.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.round(Math.random() * 1e9);
  const fileName = `${uuid}.${extension}`;
  
  const { data, error } = await client.storage.from('pet_images').upload(fileName, file, {
    cacheControl: '3600',
    upsert: false,
    contentType: file.type
  });

  if (error) throw new Error(`Não foi possível enviar a imagem: ${error.message}`);
  const { data: publicUrlData } = client.storage.from('pet_images').getPublicUrl(data.path);
  if (!publicUrlData?.publicUrl) throw new Error('Não foi possível obter a URL da imagem.');

  return publicUrlData.publicUrl;
}

function populateBreedSelect(select, breeds, placeholder) {
  select.innerHTML = '';
  const options = breeds || ['Não sei informar'];
  options.forEach((breed) => {
    select.insertAdjacentHTML('beforeend', `<option value="${escapeHTML(breed)}">${escapeHTML(breed)}</option>`);
  });
  if (placeholder) {
    select.insertAdjacentHTML('afterbegin', `<option value="" selected>${escapeHTML(placeholder)}</option>`);
  }
}

function setupCreatePostForm() {
  const form = document.getElementById('createPostForm');
  const typeField = form?.elements.animalType;
  const stateField = form?.elements.state;
  const cityField = form?.elements.city;
  const geneticsFields = document.getElementById('postGeneticsFields');
  const speciesField = document.getElementById('postSpeciesField');
  const speciesInput = document.getElementById('postSpecies');
  const sizeFieldWrap = document.getElementById('postSizeField');
  const sizeField = document.getElementById('postSize');
  const breedField = document.getElementById('postBreed');
  const motherBreedField = document.getElementById('postMotherBreed');
  const fatherBreedField = document.getElementById('postFatherBreed');
  const photoInput = document.getElementById('photoInput');
  const photoAddButton = document.getElementById('photoAddButton');
  const photoGallery = document.getElementById('photoGallery');
  const photoCount = document.getElementById('photoCount');

  if (!form || !typeField || !stateField || !cityField || !geneticsFields || !speciesField || !sizeFieldWrap || !sizeField || !photoInput || !photoAddButton || !photoGallery) return;

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

  const loadCities = async () => {
    cityField.innerHTML = '<option value="">Selecione a cidade</option>';
    cityField.disabled = !stateField.value;
    if (!stateField.value) return;

    try {
      const response = await fetch(`https://servicodados.ibge.gov.br/api/v1/localidades/estados/${stateField.value}/municipios`);
      const cities = await response.json();
      cities.forEach((city) => {
        cityField.insertAdjacentHTML('beforeend', `<option value="${escapeHTML(city.nome)}">${escapeHTML(city.nome)}</option>`);
      });
    } catch (error) {
      cityField.innerHTML = '<option value="">Cidades indisponíveis</option>';
    }
  };

  const updateBreedFields = () => {
    const isGeneticType = typeField.value === 'Cachorro' || typeField.value === 'Gato';
    const isSpeciesSelectType = typeField.value === 'Fazenda' || typeField.value === 'Marinho';
    const isDog = typeField.value === 'Cachorro';
    geneticsFields.hidden = !isGeneticType;
    speciesField.hidden = isGeneticType || !typeField.value;
    speciesInput.disabled = isGeneticType || !isSpeciesSelectType;
    sizeFieldWrap.hidden = !isDog;
    sizeField.disabled = !isDog;
    sizeField.required = isDog;
    breedField.disabled = !isGeneticType;
    motherBreedField.disabled = !isGeneticType;
    fatherBreedField.disabled = !isGeneticType;

    if (isGeneticType) {
      const breeds = typeField.value === 'Cachorro' ? DOG_BREEDS : CAT_BREEDS;
      populateBreedSelect(breedField, breeds);
      populateBreedSelect(motherBreedField, ['Não sei informar', ...breeds.filter((breed) => breed !== 'Vira-lata (SRD)')]);
      populateBreedSelect(fatherBreedField, ['Não sei informar', ...breeds.filter((breed) => breed !== 'Vira-lata (SRD)')]);
    } else if (isSpeciesSelectType) {
      const species = typeField.value === 'Fazenda' ? FARM_BREEDS : MARINE_BREEDS;
      populateBreedSelect(speciesInput, species, 'Selecione a espécie');
      populateBreedSelect(breedField, ['Não se aplica']);
      populateBreedSelect(motherBreedField, ['Não se aplica']);
      populateBreedSelect(fatherBreedField, ['Não se aplica']);
    } else {
      populateBreedSelect(breedField, ['Não sei informar']);
      populateBreedSelect(motherBreedField, ['Não sei informar']);
      populateBreedSelect(fatherBreedField, ['Não sei informar']);
    }
  };

  stateField.addEventListener('change', loadCities);
  typeField.addEventListener('change', updateBreedFields);
  updateBreedFields();
  loadStates();
  form.addEventListener('submit', handleCreatePostSubmit);
}

async function handleCreatePostSubmit(event) {
  event.preventDefault();
  
  // formulário em memória ANTES de pausar o código com o await
  const form = event.currentTarget;
  
  const { data: userData } = await getSupabaseClient().auth.getUser();
  if (!userData.user) {
    showToast('Você precisa fazer login para criar uma publicação.', 'error');
    window.location.href = 'login.html';
    return;
  }

  const title = form.title.value.trim();
  const description = form.description.value.trim();
  const animalType = form.animalType.value;
  const isGeneticType = animalType === 'Cachorro' || animalType === 'Gato';
  const isDog = animalType === 'Cachorro';
  const breed = isGeneticType ? form.breed.value.trim() : form.species.value.trim();
  const size = isDog ? form.size.value.trim() : null;
  const motherBreed = isGeneticType ? form.motherBreed.value.trim() : null;
  const fatherBreed = isGeneticType ? form.fatherBreed.value.trim() : null;
  const state = form.state.value.trim();
  const city = form.city.value.trim();
  const phone = form.phone.value.trim();
  const email = form.email.value.trim();
  const instagram = form.instagram.value.trim();
  const photoFiles = form.__selectedFiles || [];

  if (!photoFiles.length) {
    showToast('Adicione pelo menos uma foto do animal.', 'error');
    return;
  }

  if (containsBannedWord(title) || containsBannedWord(description)) {
    showToast('Vamos manter um linguajar respeitoso para todos. Revise o título e a descrição antes de publicar.', 'error');
    return;
  }

  if (!isValidInstagram(instagram)) {
    showToast('Informe apenas letras, números, pontos e underlines no Instagram.', 'error');
    return;
  }

  if (!title || !description || !animalType || !state || !city || !breed || (isDog && !size)) {
    showToast('Preencha todos os campos obrigatórios.', 'error');
    return;
  }

  if (!phone && !email && !instagram) {
    showToast('Informe pelo menos um meio de contato externo.', 'error');
    return;
  }

  try {
    const imageUrls = await Promise.all(photoFiles.map((file) => uploadPostImage(file)));
    const contatoFinal = [phone && `Tel: ${phone}`, email && `Email: ${email}`, instagram && `IG: @${instagram}`].filter(Boolean).join(' | ');

      const post = {
      user_id: userData.user.id,
      title,
      description,
      contact_info: contatoFinal,
      state,
      city,
      animal_type: animalType,
      breed: breed || 'Não informado',
      size,
      mother_breed: motherBreed,
      father_breed: fatherBreed,
      image_urls: imageUrls,
      status: 'active'
    };

    const { error } = await getSupabaseClient().from('posts').insert([post]).select().single();
    if (error) throw new Error(error.message);
    
    showToast('Publicação criada com sucesso.');
    window.location.href = 'index.html';
  } catch (error) {
    showToast(error.message || 'Erro ao criar a publicação.', 'error');
  }
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
    feedTarget.innerHTML = '';
  }
  const page = feedCurrentPage;
  const stateValue = (stateField?.value || '').trim();
  const cityValue = (cityField?.value || '').trim();
  const typeValue = typeField?.value || 'Todos';
  const breedValue = (breedField?.value || '').trim().toLowerCase();
  const breedLabel = breedField?.selectedOptions[0]?.textContent || breedValue;

  let query = getSupabaseClient().from('posts').select('*, profiles(full_name, username, avatar_url)').eq('status', 'active').order('created_at', { ascending: false }).range(page * FEED_PAGE_SIZE, (page + 1) * FEED_PAGE_SIZE - 1);
  
  if (stateValue) query = query.eq('state', stateValue);
  if (typeValue !== 'Todos') query = query.eq('animal_type', typeValue);
  if (breedValue) query = query.ilike('breed', `%${breedValue}%`);

  query.then(({ data, error }) => {
    if (error) throw error;
    const filteredPosts = data || [];

    if (!filteredPosts.length && !append) {
      feedTarget.innerHTML = breedValue
        ? `<div class="empty-state">Poxa! No momento não temos nenhum ${escapeHTML(breedLabel)} precisando de um lar. Que tal dar uma chance a um Vira-lata ou conhecer outros animais incríveis?</div>`
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
              <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
              <h3>${escapeHTML(post.title)}</h3>
            </div>
            <span class="feed-location">📍 ${escapeHTML(formatPostLocation(post))}</span>
          </div>
          <p>${escapeHTML(truncateText(post.description))}</p>
          <div class="feed-meta">
            <span><strong>Raça:</strong> ${escapeHTML(post.breed || 'Não informado')}</span>
          </div>
          <div class="feed-contact-list">${renderContactItems(post)}</div>
          ${postActionButtonsHTML(post)}
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
  }).catch((error) => {
    feedTarget.innerHTML = `<div class="empty-state">Não foi possível carregar as publicações: ${escapeHTML(error.message)}</div>`;
  });
}

function renderRecentPosts() {
  const target = document.getElementById('recentPosts');
  if (!target) return;

  getSupabaseClient().from('posts').select('*, profiles(full_name, username, avatar_url)').eq('status', 'active').order('created_at', { ascending: false }).limit(12)
    .then(({ data, error }) => {
      if (error) throw error;
      target.innerHTML = (data || []).map((post) => `
        <article class="recent-post-card ${post.status === 'adopted' ? 'adopted-card' : ''}">
          <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
            ${post.status === 'adopted' ? '<div class="adopted-ribbon">Já fui adotado! 🐾</div>' : ''}
          ${generateImageCarouselHTML(post.image_urls, post.title)}
          <div class="recent-post-body">
            ${renderAuthorBar(post.profiles)}
            <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
            <h3>${escapeHTML(post.title)}</h3>
            <p>${escapeHTML(truncateText(post.description))}</p>
            <span class="recent-post-location">📍 ${escapeHTML(formatPostLocation(post))}</span>
            ${post.status === 'active' ? postActionHTML(post) : ''}
          </div>
        </article>
      `).join('');

      const postsById = new Map((data || []).map((post) => [String(post.id), post]));
      target.querySelectorAll('[data-adoption-post]').forEach((button) => {
        button.addEventListener('click', () => openAdoptionModal(postsById.get(button.dataset.adoptionPost)));
      });
    })
    .catch((error) => {
      target.innerHTML = `<div class="empty-state">Não foi possível carregar as publicações: ${escapeHTML(error.message)}</div>`;
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

  const toggleBreedFilter = () => {
    const isVisible = typeField.value === 'Cachorro' || typeField.value === 'Gato';
    breedWrap.style.display = isVisible ? 'grid' : 'none';
    breedField.disabled = !isVisible;
    breedField.innerHTML = '<option value="">Selecione o tipo primeiro</option>';
    if (isVisible) {
      const breeds = typeField.value === 'Cachorro' ? DOG_BREEDS : CAT_BREEDS;
      breedField.innerHTML = '';
      breeds.forEach((breed) => {
        breedField.insertAdjacentHTML('beforeend', `<option value="${escapeHTML(breed)}">${escapeHTML(breed)}</option>`);
      });
    }
  };

  typeField.addEventListener('change', toggleBreedFilter);
  toggleBreedFilter();
  document.getElementById('applyFiltersBtn')?.addEventListener('click', renderFeed);
  breedField.addEventListener('change', renderFeed);
  stateField.addEventListener('change', async () => { await loadCities(stateField, cityField); renderFeed(); });
  cityField.addEventListener('change', renderFeed);
  typeField.addEventListener('change', renderFeed);
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
  return image || 'https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80';
}

function getOptimizedImageUrl(url) {
  if (!url || !String(url).includes('/storage/v1/object/public/pet_images/')) return url;
  const path = decodeURIComponent(String(url).split('/storage/v1/object/public/pet_images/')[1].split('?')[0]);
  const { data } = getSupabaseClient().storage.from('pet_images').getPublicUrl(path);
  return data?.publicUrl || url;
}

function formatPostLocation(post) {
  const city = String(post?.city || '').trim();
  const state = String(post?.state || post?.estado || '').trim().toUpperCase();
  if (!city && !state) return 'Localização não informada';
  return [city, state].filter(Boolean).join(', ');
}

function generateImageCarouselHTML(imageUrls, altText) {
  const normalizedUrls = (Array.isArray(imageUrls) ? imageUrls : imageUrls ? [imageUrls] : []).filter(Boolean);
  const safeAltText = escapeHTML(altText || 'Imagem do animal');
  const urls = normalizedUrls.length
    ? normalizedUrls.map(getOptimizedImageUrl)
    : ['https://images.unsplash.com/photo-1517849845537-4d257902454a?auto=format&fit=crop&w=900&q=80'];

  if (urls.length === 1) {
    return `<img class="post-single-image" src="${escapeHTML(urls[0])}" alt="${safeAltText}" />`;
  }

  return `
    <div class="post-carousel" data-carousel-index="0">
      <div class="post-carousel-track">
        ${urls.map((url, index) => `<img class="post-carousel-image" src="${escapeHTML(url)}" alt="${safeAltText} - imagem ${index + 1}" />`).join('')}
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

async function renderCategoryFeed(animalType) {
  const target = document.getElementById('categoryPosts');
  if (!target) return;
  const stateField = document.getElementById('categoryState');
  const cityField = document.getElementById('categoryCity');
  const breedField = document.getElementById('categoryBreed');
  const sizeField = document.getElementById('categorySize');
  target.innerHTML = '<div class="empty-state">Carregando animais...</div>';
  let query = getSupabaseClient().from('posts').select('*, profiles(full_name, username, avatar_url)').eq('animal_type', animalType).eq('status', 'active').order('created_at', { ascending: false });
  if (stateField?.value) query = query.eq('state', stateField.value);
  if (breedField?.value) query = query.ilike('breed', `%${breedField.value}%`);
  if (animalType === 'Cachorro' && sizeField?.value) query = query.eq('size', sizeField.value);
  const { data, error } = await query;

  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar: ${escapeHTML(error.message)}</div>`;
    return;
  }
  if (!data?.length) {
    const emptyImage = animalType === 'Outro'
      ? 'https://images.unsplash.com/photo-1585110396000-c9ffd4e4b308?auto=format&fit=crop&w=800&q=80'
      : 'https://images.unsplash.com/photo-1425082661705-1834bfd09dca?auto=format&fit=crop&w=800&q=80';
    target.innerHTML = `<div class="empty-state category-empty-state"><img src="${emptyImage}" alt="Animal fofo aguardando uma nova família"><p>Ainda não temos animais publicados. Volte em breve para conhecer novos amigos.</p></div>`;
    return;
  }

  target.innerHTML = renderProximityDivider(data, cityField?.value || '', (post) => `
    <article class="category-pet-card">
      <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="category-pet-card-body">
        ${renderAuthorBar(post.profiles)}
        <h2>${escapeHTML(post.title)}</h2>
        <p class="category-pet-location">📍 ${escapeHTML(formatPostLocation(post))}</p>
        <p class="category-pet-breed"><strong>Raça:</strong> ${escapeHTML(post.breed || 'Não informado')}${post.animal_type === 'Cachorro' && post.size ? ` · <strong>Porte:</strong> ${escapeHTML(post.size)}` : ''}</p>
        <div class="post-action-row">
          <button class="btn btn-secondary" type="button" data-post-details="${escapeHTML(post.id)}">Ver detalhes</button>
          ${postActionButtonsHTML(post)}
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

  const { data, error } = await getSupabaseClient().from('posts').select('*, profiles(full_name, username, avatar_url)').in('id', favoriteIds);
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
  target.innerHTML = orderedPosts.map((post) => `
    <article class="recent-post-card ${post.status === 'adopted' ? 'adopted-card' : ''}">
      <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
      ${post.status === 'adopted' ? '<div class="adopted-ribbon">Já fui adotado! 🐾</div>' : ''}
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="recent-post-body">
        ${renderAuthorBar(post.profiles)}
        <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
        <h3>${escapeHTML(post.title)}</h3>
        <p>${escapeHTML(truncateText(post.description))}</p>
        <span class="recent-post-location">📍 ${escapeHTML(formatPostLocation(post))}</span>
        ${post.status === 'active' ? postActionHTML(post) : ''}
      </div>
    </article>
  `).join('');
  bindAdoptionButtons(target, orderedPosts.filter((post) => post.status === 'active'));
}

function openAdoptionModal(post) {
  if (!post) return;
  const modal = document.getElementById('adoptionModal');
  document.getElementById('modalImageContainer').innerHTML = generateImageCarouselHTML(post.image_urls, post.title);
  // NOTA: Usar textContent já é seguro nativamente contra XSS
  document.getElementById('modalPostTitle').textContent = post.title;
  document.getElementById('modalPostLocation').textContent = `📍 ${formatPostLocation(post)}`;
  document.getElementById('modalPostDescription').textContent = post.description || 'Descrição não informada.';
  document.getElementById('modalBreed').textContent = post.breed || 'SRD';
  document.getElementById('modalMotherBreed').textContent = post.mother_breed || 'Não informado';
  document.getElementById('modalFatherBreed').textContent = post.father_breed || 'Não informado';
  const modalSize = document.getElementById('modalSize');
  const modalSizeSection = document.getElementById('modalSizeSection');
  if (modalSize && modalSizeSection) {
    modalSize.textContent = post.size || '';
    modalSizeSection.hidden = !post.size;
  }
  document.getElementById('modalPostContact').textContent = getPostContact(post);
  const additionalSection = document.getElementById('modalAdditionalDetails');
  const additionalDetails = document.getElementById('modalPostAdditionalDetails');
  const excludedFields = new Set(['id', 'user_id', 'profiles', 'image_urls', 'title', 'description', 'animal_type', 'state', 'city', 'breed', 'mother_breed', 'father_breed', 'phone', 'contact_phone', 'contact_info', 'status', 'created_at', 'updated_at']);
  if (additionalSection && additionalDetails) {
    const details = Object.entries(post).filter(([key, value]) => !excludedFields.has(key) && value !== null && value !== undefined && value !== '');
    additionalDetails.innerHTML = details.map(([key, value]) => `<div><dt>${escapeHTML(key.replace(/_/g, ' '))}</dt><dd>${escapeHTML(Array.isArray(value) ? value.join(', ') : value)}</dd></div>`).join('');
    additionalSection.hidden = !details.length;
  }
  modal.hidden = false;
  document.body.classList.add('modal-open');
}

function closeAdoptionModal() {
  const modal = document.getElementById('adoptionModal');
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove('modal-open');
}

function setupCategoryPage() {
  const animalType = document.body.dataset.animalType;
  const stateField = document.getElementById('categoryState');
  const cityField = document.getElementById('categoryCity');
  const breedField = document.getElementById('categoryBreed');
  if (!animalType) return;
  if (breedField) {
    const breeds = animalType === 'Cachorro'
      ? DOG_BREEDS
      : animalType === 'Gato'
        ? CAT_BREEDS
        : animalType === 'Fazenda'
          ? FARM_BREEDS
          : animalType === 'Marinho'
            ? MARINE_BREEDS
            : [];
    const label = animalType === 'Cachorro' || animalType === 'Gato' ? 'Todas as raças' : 'Todas as espécies';
    breedField.innerHTML = `<option value="">${label}</option>`;
    breeds.forEach((breed) => {
      breedField.insertAdjacentHTML('beforeend', `<option value="${escapeHTML(breed)}">${escapeHTML(breed)}</option>`);
    });
  }
  if (stateField && cityField) {
    stateField.addEventListener('change', async () => {
      await loadCities(stateField, cityField);
      renderCategoryFeed(animalType);
    });
    cityField.addEventListener('change', () => renderCategoryFeed(animalType));
    loadStates(stateField, cityField);
  }
  breedField?.addEventListener('change', () => renderCategoryFeed(animalType));
  document.getElementById('categorySize')?.addEventListener('change', () => renderCategoryFeed(animalType));
  renderCategoryFeed(animalType);
  document.querySelectorAll('[data-modal-close]').forEach((element) => element.addEventListener('click', closeAdoptionModal));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAdoptionModal(); });
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
      document.querySelectorAll(`[data-favorite-id="${button.dataset.favoriteId}"]`).forEach((favoriteButton) => {
        favoriteButton.classList.toggle('is-favorite', favorite);
        favoriteButton.innerHTML = favorite ? '❤️' : '🤍';
        favoriteButton.setAttribute('aria-pressed', String(favorite));
      });
      if (!getSession()) showToast('Favorito salvo neste dispositivo. Faça login para sincronizar seus favoritos.');
      if (document.getElementById('profileFavoritePosts')) renderProfileFavorites();
    } catch (error) {
      showToast(error.message, 'error');
    }
  });
}

function setupShareInteractions() {
  document.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-share-post]');
    if (!button) return;
    const shareData = { title: button.dataset.shareTitle, text: button.dataset.shareText, url: window.location.href };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        showToast('Link copiado!');
      }
    } catch (error) {
      if (error?.name !== 'AbortError') showToast('Não foi possível compartilhar a publicação.', 'error');
    }
  });
}

function generateRecoveryCode() {
  return String(Math.floor(100000 + Math.random() * 900000));
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
    const modal = createDynamicModal(`<h2>Recuperar senha</h2><p>Informe o e-mail usado no cadastro.</p><form id="recoveryEmailForm"><label>E-mail<input type="email" id="recoveryEmail" required autocomplete="email"></label><button class="btn btn-primary" type="submit">Continuar</button></form>`);
    modal.querySelector('#recoveryEmailForm').addEventListener('submit', (event) => {
      event.preventDefault();
      const email = modal.querySelector('#recoveryEmail').value.trim().toLowerCase();
      if (!isValidEmail(email)) return showToast('Informe um e-mail válido.', 'error');
      modal.querySelector('.dynamic-modal-panel').innerHTML = `<h2>Digite seu código</h2><p>Informe o código de 6 dígitos recebido no cadastro.</p><form id="recoveryCodeForm"><label>Código<input type="text" id="recoveryCode" inputmode="numeric" maxlength="6" required></label><button class="btn btn-primary" type="submit">Continuar</button></form>`;
      modal.querySelector('#recoveryCode').addEventListener('input', (inputEvent) => { inputEvent.target.value = inputEvent.target.value.replace(/\D/g, '').slice(0, 6); });
      modal.querySelector('#recoveryCodeForm').addEventListener('submit', (codeEvent) => {
        codeEvent.preventDefault();
        const code = modal.querySelector('#recoveryCode').value;
        if (!/^\d{6}$/.test(code)) return showToast('Informe um código válido de 6 dígitos.', 'error');
        modal.querySelector('.dynamic-modal-panel').innerHTML = `<h2>Crie uma nova senha</h2><p>Escolha uma senha forte para proteger sua conta.</p><form id="recoveryPasswordForm"><label>Nova senha<input type="password" id="recoveryPassword" minlength="8" required></label><label>Confirmar senha<input type="password" id="recoveryPasswordConfirmation" minlength="8" required></label><button class="btn btn-primary" type="submit">Redefinir senha</button></form>`;
        modal.querySelector('#recoveryPasswordForm').addEventListener('submit', async (passwordEvent) => {
          passwordEvent.preventDefault();
          const newPass = modal.querySelector('#recoveryPassword').value;
          const confirmation = modal.querySelector('#recoveryPasswordConfirmation').value;
          if (newPass !== confirmation) return showToast('As senhas não coincidem.', 'error');
          if (getPasswordStrength(newPass).score < 2) return showToast('Escolha uma senha mais forte.', 'error');
          const { error } = await getSupabaseClient().rpc('reset_password_with_code', { p_email: email, p_code: code, p_new_password: newPass });
          if (error) return showToast(error.message || 'Não foi possível redefinir a senha.', 'error');
          closeDynamicModal(modal);
          showToast('Senha redefinida com sucesso.');
        });
      });
    });
  });
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  if (email.toLowerCase() !== 'admin' && !isValidEmail(email)) return showToast('Informe um e-mail válido.', 'error');
  try {
    const user = await loginWithSupabase(email, password);
    saveSession(user);
    window.location.href = 'index.html';
  } catch (error) {
    showToast(error.message || 'Erro ao entrar.', 'error');
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
    if (sessionData.session) saveSession(user);
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
    const { data: existingProfile, error: usernameCheckError } = await getSupabaseClient()
      .from('profiles')
      .select('id')
      .eq('username', normalizedUsername)
      .neq('id', session.userId)
      .maybeSingle();
    if (usernameCheckError) throw usernameCheckError;
    if (existingProfile) return showToast('Este nome de usuário já está em uso. Escolha outro.', 'error');

    const { error } = await getSupabaseClient().from('profiles').update({ username: normalizedUsername }).eq('id', session.userId);
    if (error) {
      if (error.code === '23505') throw new Error('Este nome de usuário já está em uso. Escolha outro.');
      throw error;
    }
    saveSession({ ...session, id: session.userId, username: normalizedUsername });
    document.getElementById('profileUsername').value = normalizedUsername;
    showToast('Nome de usuário atualizado com sucesso.');
  } catch (error) {
    showToast(`Não foi possível atualizar o nome de usuário: ${error.message}`, 'error');
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
  try {
    const avatarUrl = await uploadAvatar(file, session.userId);
    const { error } = await getSupabaseClient().from('profiles').update({ avatar_url: avatarUrl }).eq('id', session.userId);
    if (error) throw error;
    saveSession({ ...session, id: session.userId, avatar_url: avatarUrl });
    document.getElementById('profileAvatarPreview').src = avatarUrl;
    showToast('Foto de perfil atualizada com sucesso.');
  } catch (error) {
    showToast(`Não foi possível atualizar a foto: ${error.message}`, 'error');
  }
}

async function handleProfileEmailSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('profileEmail').value.trim().toLowerCase();
  if (!isValidEmail(email)) return showToast('Informe um e-mail válido.', 'error');
  
  try {
    const { data, error } = await getSupabaseClient().auth.updateUser({ email });
    if (error) throw error;
    
    const session = getSession();
    await getSupabaseClient().from('profiles').update({ email }).eq('id', session.userId);
    saveSession({ ...session, id: session.userId, email: data.user?.email || email });
    
    showToast('Solicitação enviada. Verifique os e-mails para confirmar a alteração.');
  } catch (error) {
    showToast(`Não foi possível atualizar o e-mail: ${error.message}`, 'error');
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
    if (error) throw error;
    event.currentTarget.reset();
    showToast('Senha atualizada com sucesso.');
  } catch (error) {
    showToast(`Não foi possível atualizar a senha: ${error.message}`, 'error');
  }
}

async function deleteAccount() {
  const session = redirectIfLoggedOut();
  if (!session || !confirm('Excluir sua conta é permanente. Deseja continuar?')) return;
  try {
    const { error } = await getSupabaseClient().rpc('delete_user');
    if (error) throw error;
    await getSupabaseClient().auth.signOut();
    clearSession();
    window.location.href = 'index.html';
  } catch (error) {
    showToast(`Não foi possível excluir a conta. Configure a função RPC delete_user no Supabase: ${error.message}`, 'error');
  }
}

async function updatePostStatus(postId) {
  const { error } = await getSupabaseClient().from('posts').update({ status: 'adopted' }).eq('id', postId).eq('user_id', getSession().userId);
  if (error) {
    showToast(`Não foi possível concluir a publicação: ${error.message}`, 'error');
    return;
  }
  renderUserPosts();
}

async function renderUserPosts() {
  const target = document.getElementById('userPosts');
  const session = getSession();
  if (!target || !session) return;
  target.innerHTML = '<div class="empty-state">Carregando suas publicações...</div>';
  const { data, error } = await getSupabaseClient().from('posts').select('*, profiles(full_name, username, avatar_url)').eq('user_id', session.userId).order('created_at', { ascending: false });
  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar suas publicações: ${escapeHTML(error.message)}</div>`;
    return;
  }
  if (!data?.length) {
    target.innerHTML = '<div class="empty-state">Você ainda não criou nenhuma publicação.</div>';
    return;
  }
  target.innerHTML = data.map((post) => `
    <article class="profile-post-card ${post.status === 'adopted' ? 'adopted-card' : ''}">
      <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
      ${post.status === 'adopted' ? '<div class="adopted-ribbon">Concluído 🐾</div>' : ''}
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="profile-post-card-body">
        ${renderAuthorBar(post.profiles)}
        <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
        <h3>${escapeHTML(post.title)}</h3>
        <p>📍 ${escapeHTML(formatPostLocation(post))}</p>
        ${post.status === 'active' ? `<div class="post-status-actions"><button class="btn btn-secondary" type="button" data-mark-adopted="${escapeHTML(post.id)}">Já doei</button><button class="btn btn-secondary" type="button" data-mark-adopted="${escapeHTML(post.id)}">Decidi ficar com ele</button></div>` : '<span class="completed-label">Concluído</span>'}
      </div>
    </article>
  `).join('');
  target.querySelectorAll('[data-mark-adopted]').forEach((button) => {
    button.addEventListener('click', () => updatePostStatus(button.dataset.markAdopted));
  });
}

async function renderProfileFavorites() {
  const target = document.getElementById('profileFavoritePosts');
  const session = getSession();
  if (!target || !session) return;
  const favoriteIds = getFavoriteIds();
  if (!favoriteIds.length) {
    target.innerHTML = '<div class="empty-state">Você ainda não favoritou nenhum animal.</div>';
    return;
  }
  const { data, error } = await getSupabaseClient().from('posts').select('*, profiles(full_name, username, avatar_url)').in('id', favoriteIds);
  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar seus favoritos: ${escapeHTML(error.message)}</div>`;
    return;
  }
  const orderedPosts = favoriteIds.map((id) => data?.find((post) => String(post.id) === id)).filter(Boolean);
  const validFavoriteIds = orderedPosts.map((post) => String(post.id));
  if (validFavoriteIds.length !== favoriteIds.length) await persistFavoriteIds(validFavoriteIds);
  target.innerHTML = orderedPosts.map((post) => `
    <article class="profile-post-card ${post.status === 'adopted' ? 'adopted-card' : ''}">
      <div class="card-utility-actions">${favoriteButtonHTML(post.id)}${shareButtonHTML(post)}</div>
      ${post.status === 'adopted' ? '<div class="adopted-ribbon">Já fui adotado! 🐾</div>' : ''}
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="profile-post-card-body">
        ${renderAuthorBar(post.profiles)}
        <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
        <h3>${escapeHTML(post.title)}</h3>
        <p>📍 ${escapeHTML(formatPostLocation(post))}</p>
        ${post.status === 'active' ? postActionHTML(post) : ''}
      </div>
    </article>
  `).join('');
  bindAdoptionButtons(target, orderedPosts.filter((post) => post.status === 'active'));
}

function setupProfilePage() {
  const session = redirectIfLoggedOut();
  if (!session) return;
  const avatarPreview = document.getElementById('profileAvatarPreview');
  avatarPreview.src = session.avatar_url || 'https://placehold.co/160x160/ffe8ce/7a3d16?text=🐾';
  document.getElementById('profileName').textContent = session.name;
  document.getElementById('profileEmail').value = session.email || '';
  document.getElementById('profileUsername').value = session.username || '';
  document.getElementById('profileUsernameForm')?.addEventListener('submit', handleProfileUsernameSubmit);
  document.getElementById('profileAvatarForm')?.addEventListener('submit', handleAvatarUpdate);
  document.getElementById('profileEmailForm')?.addEventListener('submit', handleProfileEmailSubmit);
  document.getElementById('profilePasswordForm')?.addEventListener('submit', handleProfilePasswordSubmit);
  document.getElementById('deleteAccountButton')?.addEventListener('click', deleteAccount);
}

async function initializePage() {
  // atualiza a sessão local com os dados reais do banco ao abrir a página
  const { data } = await getSupabaseClient().auth.getUser();
  if (data.user) {
    const profile = await fetchProfileByUserId(data.user.id);
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
      role: profile?.role || 'user',
      status: profile?.status || 'active',
      birth_date: profile?.birth_date || null,
      avatar_url: profile?.avatar_url || null,
      favorite_posts: favoritePosts
    });
  } else {
    clearSession();
  }

  // configurações visuais e listeners globais
  setupPostCarouselNavigation();
  setupFavoriteInteractionsV7();
  setupShareInteractions();
  bindAdminActions();
  const page = document.body.dataset.page;
  updateHomeUserActions();

  // roteamento e Inicialização por Página
  if (page === 'home') {
    loadSiteStatistics();
    setupDonationRedirect();
    setupSupportModal();
    document.querySelectorAll('[data-modal-close]').forEach((element) => element.addEventListener('click', closeAdoptionModal));
    renderRecentPosts();
    setupAdoptionCarousel();
    setupFeedFilters();
  } else if (page === 'category') {
    setupCategoryPage();
  } else if (page === 'login' && !getSession()) {
    document.getElementById('loginForm')?.addEventListener('submit', handleLoginSubmit);
    setupPasswordRecovery();
  } else if (page === 'register') {
    setupRegisterBirthDateMask();
    document.getElementById('registerForm')?.addEventListener('submit', handleRegisterSubmit);
  } else if (page === 'create-post' && redirectIfLoggedOut()) {
    setupCreatePostForm();
  } else if (page === 'profile') {
    setupProfilePage();
  } else if (page === 'my-posts' && redirectIfLoggedOut()) {
    renderUserPosts();
  } else if (page === 'favorites' && redirectIfLoggedOut()) {
    document.querySelectorAll('[data-modal-close]').forEach((element) => element.addEventListener('click', closeAdoptionModal));
    renderProfileFavorites();
  } else if (page === 'admin') {
    // verificação em tempo real direto no banco
    const { data: authData } = await getSupabaseClient().auth.getUser();
    if (authData?.user) {
      const profile = await fetchProfileByUserId(authData.user.id);
      if (profile?.role !== 'admin') {
        showToast('Acesso negado. Essa tentativa foi registrada.', 'error');
        return (window.location.href = 'index.html');
      }
    } else {
      return (window.location.href = 'login.html');
    }

    // se passou pela segurança, inicializa o painel
    document.getElementById('logoutButton')?.addEventListener('click', () => {
      getSupabaseClient().auth.signOut().then(() => { clearSession(); window.location.href = 'login.html'; });
    });
    document.getElementById('adminAccountForm')?.addEventListener('submit', handleAdminAccountSubmit);
    setupStatisticsManagement();
    loadSiteStatistics();
    document.getElementById('adminUserSearchForm')?.addEventListener('submit', (event) => {
      event.preventDefault();
      searchAdminUsers(document.getElementById('adminUserSearch').value);
    });
    renderAdminDashboard();
  }
}

document.addEventListener('DOMContentLoaded', initializePage);