import { supabase } from './supabase.js';

const STORAGE_KEYS = {
  users: 'petamor_users',
  ads: 'petamor_ads',
  session: 'petamor_session',
  favorites: 'petamor_favorites'
};

const ALLOWED_EMAIL_DOMAINS = ['gmail.com', 'outlook.com', 'hotmail.com', 'yahoo.com', 'icloud.com', 'live.com'];

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

function saveSession(user) {
  const payload = {
    userId: user.id || user.user_id,
    role: user.role || 'user',
    email: user.email,
    name: user.name || user.full_name || user.email,
    birth_date: user.birth_date || null,
    avatar_url: user.avatar_url || null,
    favorite_posts: Array.isArray(user.favorite_posts) ? user.favorite_posts.map((id) => String(id)) : []
  };
  writeStorage(STORAGE_KEYS.session, payload);
}

function getSession() {
  return readStorage(STORAGE_KEYS.session, null);
}

function getFavoriteIds() {
  const session = getSession();
  if (session && Array.isArray(session.favorite_posts)) return session.favorite_posts.map((id) => String(id));
  const favorites = readStorage(STORAGE_KEYS.favorites, []);
  return Array.isArray(favorites) ? favorites.map((id) => String(id)) : [];
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
  return `<button class="favorite-button${favorite ? ' is-favorite' : ''}" type="button" data-favorite-id="${escapeHTML(postId)}" aria-label="${favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" aria-pressed="${favorite}"><svg class="favorite-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"></path></svg></button>`;
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
  return {
    id: data.user.id,
    email: data.user.email,
    name: profile?.full_name || data.user.user_metadata?.full_name || data.user.email,
    role: profile?.role || 'user',
    status: profile?.status || 'active',
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
    alert('Informe um e-mail válido ou use o usuário admin.');
    return;
  }

  if (passwordValue) {
    if (passwordValue.length < 8) {
      alert('A nova senha deve ter pelo menos 8 caracteres.');
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
    alert('Credenciais atualizadas com sucesso.');
  } catch (error) {
    alert(`Não foi possível atualizar as credenciais: ${error.message}`);
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

async function registerWithSupabase(name, email, password, birthDate, avatarFile) {
  if (!name || !name.trim()) throw new Error('Informe seu nome completo.');
  if (!isValidEmail(email)) throw new Error('Use um e-mail válido com domínio conhecido.');
  if (!birthDate) throw new Error('Informe sua data de nascimento.');
  if (new Date(`${birthDate}T00:00:00`) > new Date()) throw new Error('A data de nascimento não pode estar no futuro.');

  const strength = getPasswordStrength(password);
  if (strength.score < 2) {
    throw new Error('Sua senha é fraca. Use pelo menos 8 caracteres e misture letras, números e símbolos.');
  }

  const client = getSupabaseClient();
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
      birth_date: birthDate,
      avatar_url: avatarUrl,
      status: 'active'
    }).eq('id', userId);
    if (profileError) throw new Error(`Não foi possível salvar o perfil: ${profileError.message}`);
  }

  return {
    id: userId,
    email,
    name: name.trim(),
    role: 'user',
    status: 'active',
    birth_date: birthDate,
    avatar_url: avatarUrl,
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
  if (!modal || !openButton) return;
  openButton.addEventListener('click', () => { modal.hidden = false; });
  modal.querySelectorAll('[data-support-close]').forEach((element) => {
    element.addEventListener('click', () => { modal.hidden = true; });
  });
  document.getElementById('copySupportEmail')?.addEventListener('click', async () => {
    await navigator.clipboard.writeText(document.getElementById('supportEmail').textContent);
    document.getElementById('copySupportEmail').textContent = 'E-mail copiado';
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
        <td><button class="admin-btn danger" data-action="delete-post" data-id="${post.id}">Excluir</button></td>
      </tr>
    `).join('') || '<tr><td colspan="4">Nenhum post publicado.</td></tr>';
  }
}

async function deletePost(postId) {
  const { error } = await getSupabaseClient().from('posts').delete().eq('id', postId);
  if (error) {
    alert(`Não foi possível excluir o post: ${error.message}`);
    return;
  }
  renderAdminDashboard();
}

function bindAdminActions() {
  document.body.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;
    if (button.dataset.action === 'delete-post') {
      deletePost(button.dataset.id);
    }
  });
}

function validateImageFile(file) {
  if (!file) return 'Selecione uma imagem.';
  const name = file.name.toLowerCase();
  const allowedExtensions = /\.(jpe?g|png)$/i;
  const allowedTypes = ['image/jpeg', 'image/png'];
  if (!allowedExtensions.test(name) || !allowedTypes.includes(file.type)) {
    return 'Formato inválido. Envie apenas arquivos .jpg, .jpeg ou .png.';
  }
  if (file.size > 2 * 1024 * 1024) {
    return 'A imagem deve ter no máximo 2MB.';
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
  return /^(?:@[a-z0-9._]{1,30}|https?:\/\/(?:www\.)?instagram\.com\/[a-z0-9._]{1,30}\/?)(?:\?.*)?$/i.test(value);
}

async function uploadPostImage(file) {
  const client = getSupabaseClient();
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
  const breedField = document.getElementById('postBreed');
  const motherBreedField = document.getElementById('postMotherBreed');
  const fatherBreedField = document.getElementById('postFatherBreed');
  const photoInput = document.getElementById('photoInput');
  const photoAddButton = document.getElementById('photoAddButton');
  const photoGallery = document.getElementById('photoGallery');
  const photoCount = document.getElementById('photoCount');

  if (!form || !typeField || !stateField || !cityField || !geneticsFields || !speciesField || !photoInput || !photoAddButton || !photoGallery) return;

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
      else alert(error);
    });
    if (photoInput.files.length > availableSlots) alert('Você pode adicionar no máximo 4 fotos.');
    photoInput.value = '';
    renderPhotoGallery();
  });
  form.__selectedFiles = selectedFiles;

  form.elements.phone.addEventListener('input', (event) => {
    event.target.value = formatPhoneNumber(event.target.value);
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
    geneticsFields.hidden = !isGeneticType;
    speciesField.hidden = isGeneticType || !typeField.value;
    speciesInput.disabled = isGeneticType || !typeField.value;
    breedField.disabled = !isGeneticType;
    motherBreedField.disabled = !isGeneticType;
    fatherBreedField.disabled = !isGeneticType;

    if (isGeneticType) {
      const breeds = typeField.value === 'Cachorro' ? DOG_BREEDS : CAT_BREEDS;
      populateBreedSelect(breedField, breeds);
      populateBreedSelect(motherBreedField, ['Não sei informar', ...breeds.filter((breed) => breed !== 'Vira-lata (SRD)')]);
      populateBreedSelect(fatherBreedField, ['Não sei informar', ...breeds.filter((breed) => breed !== 'Vira-lata (SRD)')]);
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
    alert('Você precisa fazer login para criar uma publicação.');
    window.location.href = 'login.html';
    return;
  }

  const title = form.title.value.trim();
  const description = form.description.value.trim();
  const animalType = form.animalType.value;
  const isGeneticType = animalType === 'Cachorro' || animalType === 'Gato';
  const breed = isGeneticType ? form.breed.value.trim() : form.species.value.trim();
  const motherBreed = isGeneticType ? form.motherBreed.value.trim() : null;
  const fatherBreed = isGeneticType ? form.fatherBreed.value.trim() : null;
  const state = form.state.value.trim();
  const city = form.city.value.trim();
  const phone = form.phone.value.trim();
  const email = form.email.value.trim();
  const instagram = form.instagram.value.trim();
  const photoFiles = form.__selectedFiles || [];

  if (!photoFiles.length) {
    alert('Adicione pelo menos uma foto do animal.');
    return;
  }

  if (containsBannedWord(title) || containsBannedWord(description)) {
    alert('Vamos manter um linguajar respeitoso para todos. Revise o título e a descrição antes de publicar.');
    return;
  }

  if (!isValidInstagram(instagram)) {
    alert('Informe apenas um @usuário ou link válido do Instagram.');
    return;
  }

  if (!title || !description || !animalType || !state || !city || !breed) {
    alert('Preencha todos os campos obrigatórios.');
    return;
  }

  if (!phone && !email && !instagram) {
    alert('Informe pelo menos um meio de contato externo.');
    return;
  }

  try {
    const imageUrls = await Promise.all(photoFiles.map((file) => uploadPostImage(file)));
    const contatoFinal = `Tel: ${phone || 'Não informado'} | Email: ${email || 'Não informado'} | IG: ${instagram || 'Não informado'}`;

      const post = {
      user_id: userData.user.id,
      title,
      description,
      contact_info: contatoFinal,
      state,
      city,
      animal_type: animalType,
      breed: breed || 'Não informado',
      mother_breed: motherBreed,
      father_breed: fatherBreed,
      image_urls: imageUrls,
      status: 'active'
    };

    const { error } = await getSupabaseClient().from('posts').insert([post]).select().single();
    if (error) throw new Error(error.message);
    
    alert('Publicação criada com sucesso!');
    window.location.href = 'index.html';
  } catch (error) {
    alert(error.message || 'Erro ao criar a publicação.');
  }
}

function renderFeed() {
  const feedTarget = document.getElementById('feedPosts');
  const typeField = document.getElementById('feedType');
  const breedField = document.getElementById('feedBreed');
  const cityField = document.getElementById('feedCity');
  const stateField = document.getElementById('feedState');

  if (!feedTarget) return;

  const stateValue = (stateField?.value || '').trim();
  const cityValue = (cityField?.value || '').trim();
  const typeValue = typeField?.value || 'Todos';
  const breedValue = (breedField?.value || '').trim().toLowerCase();
  const breedLabel = breedField?.selectedOptions[0]?.textContent || breedValue;

  let query = getSupabaseClient().from('posts').select('*').eq('status', 'active').order('created_at', { ascending: false });
  
  if (stateValue) query = query.eq('state', stateValue);
  if (typeValue !== 'Todos') query = query.eq('animal_type', typeValue);
  if (breedValue) query = query.ilike('breed', `%${breedValue}%`);

  query.then(({ data, error }) => {
    if (error) throw error;
    const filteredPosts = data || [];

    if (!filteredPosts.length) {
      feedTarget.innerHTML = breedValue
        ? `<div class="empty-state">Poxa! No momento não temos nenhum ${escapeHTML(breedLabel)} precisando de um lar. Que tal dar uma chance a um Vira-lata ou conhecer outros animais incríveis?</div>`
        : '<div class="empty-state">Poxa! No momento não encontramos animais com esses filtros. Que tal tentar outra cidade ou conhecer outras categorias?</div>';
      return;
    }

    feedTarget.innerHTML = renderProximityDivider(filteredPosts, cityValue, (post) => `
      <article class="feed-card">
        ${favoriteButtonHTML(post.id)}
        ${generateImageCarouselHTML(post.image_urls, post.title)}
        <div class="feed-card-body">
          <div class="feed-card-header">
            <div>
              <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
              <h3>${escapeHTML(post.title)}</h3>
            </div>
            <span class="feed-location">📍 ${escapeHTML(post.city)}</span>
          </div>
          <p>${escapeHTML(post.description)}</p>
          <div class="feed-meta">
            <span><strong>Raça:</strong> ${escapeHTML(post.breed || 'Não informado')}</span>
            <span><strong>Contato:</strong> ${escapeHTML(post.contact_info || 'Não informado')}</span>
          </div>
          <div class="feed-contact-list">
            ${post.contact_info ? `<span>💬 ${escapeHTML(post.contact_info)}</span>` : ''}
          </div>
          <button class="btn btn-primary full" style="margin-top: 16px;" type="button" data-adoption-post="${post.id}">Quero Adotar!</button>
        </div>
      </article>
    `);
    bindAdoptionButtons(feedTarget, filteredPosts);
  }).catch((error) => {
    feedTarget.innerHTML = `<div class="empty-state">Não foi possível carregar as publicações: ${escapeHTML(error.message)}</div>`;
  });
}

function renderRecentPosts() {
  const target = document.getElementById('recentPosts');
  if (!target) return;

  getSupabaseClient().from('posts').select('*').eq('status', 'active').order('created_at', { ascending: false }).limit(3)
    .then(({ data, error }) => {
      if (error) throw error;
      target.innerHTML = (data || []).map((post) => `
        <article class="recent-post-card ${post.status === 'adopted' ? 'adopted-card' : ''}">
          ${favoriteButtonHTML(post.id)}
            ${post.status === 'adopted' ? '<div class="adopted-ribbon">Já fui adotado! 🐾</div>' : ''}
          ${generateImageCarouselHTML(post.image_urls, post.title)}
          <div class="recent-post-body">
            <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
            <h3>${escapeHTML(post.title)}</h3>
            <p>${escapeHTML(post.description)}</p>
            <span class="recent-post-location">📍 ${escapeHTML(post.city)}</span>
            ${post.status === 'active' ? `<button class="btn btn-primary full" style="margin-top: 16px;" type="button" data-adoption-post="${post.id}">Quero Adotar!</button>` : ''}
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

function generateImageCarouselHTML(imageUrls, altText) {
  const normalizedUrls = (Array.isArray(imageUrls) ? imageUrls : imageUrls ? [imageUrls] : []).filter(Boolean);
  const safeAltText = escapeHTML(altText || 'Imagem do animal');
  const urls = normalizedUrls.length
    ? normalizedUrls
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
  const contacts = [post.phone, post.contact_phone, post.email, post.contact_email, post.contact_info].filter(Boolean);
  return contacts.length ? contacts.join(' | ') : 'Contato não informado';
}

async function renderCategoryFeed(animalType) {
  const target = document.getElementById('categoryPosts');
  if (!target) return;
  const stateField = document.getElementById('categoryState');
  const cityField = document.getElementById('categoryCity');
  const breedField = document.getElementById('categoryBreed');
  target.innerHTML = '<div class="empty-state">Carregando animais...</div>';
  let query = getSupabaseClient().from('posts').select('*').eq('animal_type', animalType).eq('status', 'active').order('created_at', { ascending: false });
  if (stateField?.value) query = query.eq('state', stateField.value);
  if (breedField?.value) query = query.ilike('breed', `%${breedField.value}%`);
  const { data, error } = await query;

  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar: ${escapeHTML(error.message)}</div>`;
    return;
  }
  if (!data?.length) {
    target.innerHTML = '<div class="empty-state">Ainda não temos animais publicados. Volte em breve para conhecer novos amigos.</div>';
    return;
  }

  target.innerHTML = renderProximityDivider(data, cityField?.value || '', (post) => `
    <article class="category-pet-card">
      ${favoriteButtonHTML(post.id)}
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="category-pet-card-body">
        <h2>${escapeHTML(post.title)}</h2>
        <p class="category-pet-location">📍 ${escapeHTML(post.city || 'Localização não informada')}</p>
        <button class="btn btn-primary full" type="button" data-adoption-post="${post.id}">Quero Adotar!</button>
      </div>
    </article>
  `);
  bindAdoptionButtons(target, data);
}

async function renderFavorites() {
  const target = document.getElementById('profileFavoritePosts');
  if (!target) return;
  const favoriteIds = getFavoriteIds();
  if (!favoriteIds.length) {
    target.innerHTML = '<div class="empty-state">Você ainda não favoritou nenhum animal.</div>';
    return;
  }

  const { data, error } = await getSupabaseClient().from('posts').select('*').in('id', favoriteIds);
  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar seus favoritos: ${escapeHTML(error.message)}</div>`;
    return;
  }
  if (!data?.length) {
    target.innerHTML = '<div class="empty-state">Seus favoritos não estão mais disponíveis.</div>';
    return;
  }

  const orderedPosts = favoriteIds.map((id) => data.find((post) => String(post.id) === id)).filter(Boolean);
  target.innerHTML = orderedPosts.map((post) => `
    <article class="recent-post-card ${post.status === 'adopted' ? 'adopted-card' : ''}">
      ${favoriteButtonHTML(post.id)}
      ${post.status === 'adopted' ? '<div class="adopted-ribbon">Já fui adotado! 🐾</div>' : ''}
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="recent-post-body">
        <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
        <h3>${escapeHTML(post.title)}</h3>
        <p>${escapeHTML(post.description)}</p>
        <span class="recent-post-location">📍 ${escapeHTML(post.city || 'Localização não informada')}</span>
        ${post.status === 'active' ? `<button class="btn btn-primary full" style="margin-top: 16px;" type="button" data-adoption-post="${post.id}">Quero Adotar!</button>` : ''}
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
  document.getElementById('modalPostLocation').textContent = `📍 ${post.city || 'Localização não informada'}`;
  document.getElementById('modalPostDescription').textContent = post.description || 'Descrição não informada.';
  document.getElementById('modalBreed').textContent = post.breed || 'SRD';
  document.getElementById('modalMotherBreed').textContent = post.mother_breed || 'Não informado';
  document.getElementById('modalFatherBreed').textContent = post.father_breed || 'Não informado';
  document.getElementById('modalPostContact').textContent = getPostContact(post);
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
  if (breedField && (animalType === 'Cachorro' || animalType === 'Gato')) {
    const breeds = animalType === 'Cachorro' ? DOG_BREEDS : CAT_BREEDS;
    breedField.innerHTML = '<option value="">Todas as raças</option>';
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

function setupFavoriteInteractions() {
  document.body.addEventListener('click', async (event) => {
    const button = event.target.closest('[data-favorite-id]');
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    const postId = button.dataset.favoriteId;
    if (!getSession()) {
      const favorite = await toggleFavorite(postId);
      document.querySelectorAll('[data-favorite-id]').forEach((favoriteButton) => {
        if (favoriteButton.dataset.favoriteId !== postId) return;
        favoriteButton.classList.toggle('is-favorite', favorite);
        favoriteButton.innerHTML = '<svg class="favorite-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"></path></svg>';
        favoriteButton.setAttribute('aria-pressed', String(favorite));
        favoriteButton.setAttribute('aria-label', favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos');
      });
      alert('Favorito salvo neste dispositivo. Faça login para sincronizar seus favoritos.');
      return;
    }
    try {
      const favorite = await toggleFavorite(postId);
      document.querySelectorAll('[data-favorite-id]').forEach((favoriteButton) => {
      if (favoriteButton.dataset.favoriteId !== postId) return;
      favoriteButton.classList.toggle('is-favorite', favorite);
      favoriteButton.innerHTML = '<svg class="favorite-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78Z"></path></svg>';
      favoriteButton.setAttribute('aria-pressed', String(favorite));
      favoriteButton.setAttribute('aria-label', favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos');
      });
      if (document.getElementById('favoritePosts')) renderFavorites();
      if (document.getElementById('profileFavoritePosts')) renderProfileFavorites();
    } catch (error) {
      alert(error.message);
    }
  });
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value.trim();
  if (email.toLowerCase() !== 'admin' && !isValidEmail(email)) return alert('Informe um e-mail válido.');
  try {
    const user = await loginWithSupabase(email, password);
    saveSession(user);
    window.location.href = 'index.html';
  } catch (error) {
    alert(error.message || 'Erro ao entrar.');
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const name = document.getElementById('registerName').value.trim();
  const email = document.getElementById('registerEmail').value.trim();
  const birthDate = document.getElementById('registerBirthDate').value;
  const avatarFile = document.getElementById('registerAvatar').files[0];
  const password = document.getElementById('registerPassword').value.trim();
  const confirm = document.getElementById('registerConfirmPassword').value.trim();
  const termsAccepted = document.getElementById('registerTerms').checked;
  if (!termsAccepted) return alert('Você precisa concordar com os Termos de Uso e Privacidade.');
  if (password !== confirm) return alert('As senhas não coincidem.');
  try {
    const user = await registerWithSupabase(name, email, password, birthDate, avatarFile);
    const { data: sessionData } = await getSupabaseClient().auth.getSession();
    if (sessionData.session) saveSession(user);
    alert('Conta criada com sucesso!');
    const redirect = new URLSearchParams(window.location.search).get('redirect');
    window.location.href = redirect || 'index.html';
  } catch (error) {
    alert(error.message || 'Erro ao criar conta.');
  }
}

async function handleAvatarUpdate(event) {
  event.preventDefault();
  const file = document.getElementById('profileAvatarInput').files[0];
  const session = redirectIfLoggedOut();
  if (!session || !file) return alert('Selecione uma foto para continuar.');
  try {
    const avatarUrl = await uploadAvatar(file, session.userId);
    const { error } = await getSupabaseClient().from('profiles').update({ avatar_url: avatarUrl }).eq('id', session.userId);
    if (error) throw error;
    saveSession({ ...session, id: session.userId, avatar_url: avatarUrl });
    document.getElementById('profileAvatarPreview').src = avatarUrl;
    alert('Foto de perfil atualizada com sucesso.');
  } catch (error) {
    alert(`Não foi possível atualizar a foto: ${error.message}`);
  }
}

async function handleProfileEmailSubmit(event) {
  event.preventDefault();
  const email = document.getElementById('profileEmail').value.trim().toLowerCase();
  if (!isValidEmail(email)) return alert('Informe um e-mail válido.');
  
  try {
    const { data, error } = await getSupabaseClient().auth.updateUser({ email });
    if (error) throw error;
    
    const session = getSession();
    await getSupabaseClient().from('profiles').update({ email }).eq('id', session.userId);
    saveSession({ ...session, id: session.userId, email: data.user?.email || email });
    
    alert('Solicitação enviada! Por motivos de segurança, verifique a caixa de entrada do NOVO e do ANTIGO e-mail para confirmar a alteração. O login só mudará após a confirmação.');
  } catch (error) {
    alert(`Não foi possível atualizar o e-mail: ${error.message}`);
  }
}

async function handleProfilePasswordSubmit(event) {
  event.preventDefault();
  const password = document.getElementById('profilePassword').value;
  const confirmation = document.getElementById('profilePasswordConfirmation').value;
  if (password !== confirmation) return alert('As senhas não coincidem.');
  if (getPasswordStrength(password).score < 2) return alert('A senha deve ter pelo menos 8 caracteres e ser mais forte.');
  try {
    const { error } = await getSupabaseClient().auth.updateUser({ password });
    if (error) throw error;
    event.currentTarget.reset();
    alert('Senha atualizada com sucesso.');
  } catch (error) {
    alert(`Não foi possível atualizar a senha: ${error.message}`);
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
    alert(`Não foi possível excluir a conta. Configure a função RPC delete_user no Supabase: ${error.message}`);
  }
}

async function updatePostStatus(postId) {
  const { error } = await getSupabaseClient().from('posts').update({ status: 'adopted' }).eq('id', postId).eq('user_id', getSession().userId);
  if (error) {
    alert(`Não foi possível concluir a publicação: ${error.message}`);
    return;
  }
  renderUserPosts();
}

async function renderUserPosts() {
  const target = document.getElementById('userPosts');
  const session = getSession();
  if (!target || !session) return;
  target.innerHTML = '<div class="empty-state">Carregando suas publicações...</div>';
  const { data, error } = await getSupabaseClient().from('posts').select('*').eq('user_id', session.userId).order('created_at', { ascending: false });
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
      ${favoriteButtonHTML(post.id)}
      ${post.status === 'adopted' ? '<div class="adopted-ribbon">Concluído 🐾</div>' : ''}
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="profile-post-card-body">
        <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
        <h3>${escapeHTML(post.title)}</h3>
        <p>📍 ${escapeHTML(post.city || 'Localização não informada')}</p>
        ${post.status === 'active' ? `<div class="post-status-actions"><button class="btn btn-secondary" type="button" data-mark-adopted="${post.id}">Já doei</button><button class="btn btn-secondary" type="button" data-mark-adopted="${post.id}">Decidi ficar com ele</button></div>` : '<span class="completed-label">Concluído</span>'}
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
  const { data, error } = await getSupabaseClient().from('posts').select('*').in('id', favoriteIds);
  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar seus favoritos: ${escapeHTML(error.message)}</div>`;
    return;
  }
  const orderedPosts = favoriteIds.map((id) => data?.find((post) => String(post.id) === id)).filter(Boolean);
  target.innerHTML = orderedPosts.map((post) => `
    <article class="profile-post-card ${post.status === 'adopted' ? 'adopted-card' : ''}">
      ${favoriteButtonHTML(post.id)}
      ${post.status === 'adopted' ? '<div class="adopted-ribbon">Já fui adotado! 🐾</div>' : ''}
      ${generateImageCarouselHTML(post.image_urls, post.title)}
      <div class="profile-post-card-body">
        <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
        <h3>${escapeHTML(post.title)}</h3>
        <p>📍 ${escapeHTML(post.city || 'Localização não informada')}</p>
        ${post.status === 'active' ? `<button class="btn btn-primary full" type="button" data-adoption-post="${post.id}">Quero Adotar!</button>` : ''}
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
  setupFavoriteInteractions();
  const page = document.body.dataset.page;
  updateHomeUserActions();

  // roteamento e Inicialização por Página
  if (page === 'home') {
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
  } else if (page === 'register') {
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
        alert('Acesso negado. Essa tentativa foi registrada.');
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
    bindAdminActions();
    renderAdminDashboard();
  }
}

document.addEventListener('DOMContentLoaded', initializePage);