import { supabase } from './supabase.js';

const STORAGE_KEYS = {
  users: 'petamor_users',
  ads: 'petamor_ads',
  session: 'petamor_session'
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
    name: user.name || user.full_name || user.email
  };
  writeStorage(STORAGE_KEYS.session, payload);
}

function getSession() {
  return readStorage(STORAGE_KEYS.session, null);
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
    status: profile?.status || 'active'
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

async function registerWithSupabase(name, email, password) {
  if (!name || !name.trim()) throw new Error('Informe seu nome completo.');
  if (!isValidEmail(email)) throw new Error('Use um e-mail válido com domínio conhecido.');

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
  if (userId) {
    // Corrigido para não infligir RLS de Upsert
    await client.from('profiles').update({
      email,
      full_name: name.trim(),
      status: 'active'
    }).eq('id', userId);
  }

  return {
    id: userId,
    email,
    name: name.trim(),
    role: 'user',
    status: 'active'
  };
}

function updateHomeUserActions() {
  const session = getSession();
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
  actionsNode.innerHTML = `
    ${isAdmin ? '<a href="admin.html" class="btn btn-primary">Dashboard admin</a>' : ''}
    <a href="create-post.html" class="btn btn-secondary">Criar publicação</a>
    <button class="btn btn-secondary" id="homeLogoutButton">Sair</button>
  `;

  document.getElementById('homeLogoutButton')?.addEventListener('click', () => {
    getSupabaseClient().auth.signOut().finally(() => {
      clearSession();
      updateHomeUserActions();
    });
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
      image_urls: imageUrls
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

  let query = getSupabaseClient().from('posts').select('*').order('created_at', { ascending: false });
  
  // Corrigido o bug do filtro de estado ser ignorado
  if (stateValue) query = query.eq('state', stateValue);
  if (cityValue) query = query.eq('city', cityValue);
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

    feedTarget.innerHTML = filteredPosts.map((post) => `
      <article class="feed-card">
        <img src="${escapeHTML(getPostImageUrl(post))}" alt="${escapeHTML(post.title)}" />
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
        </div>
      </article>
    `).join('');
  }).catch((error) => {
    feedTarget.innerHTML = `<div class="empty-state">Não foi possível carregar as publicações: ${escapeHTML(error.message)}</div>`;
  });
}

function renderRecentPosts() {
  const target = document.getElementById('recentPosts');
  if (!target) return;

  getSupabaseClient().from('posts').select('*').order('created_at', { ascending: false }).limit(3)
    .then(({ data, error }) => {
      if (error) throw error;
      target.innerHTML = (data || []).map((post) => `
        <article class="recent-post-card">
          <img src="${escapeHTML(getPostImageUrl(post))}" alt="${escapeHTML(post.title)}" />
          <div class="recent-post-body">
            <span class="mini-tag">${escapeHTML(post.animal_type)}</span>
            <h3>${escapeHTML(post.title)}</h3>
            <p>${escapeHTML(post.description)}</p>
            <span class="recent-post-location">📍 ${escapeHTML(post.city)}</span>
          </div>
        </article>
      `).join('');
    })
    .catch((error) => {
      target.innerHTML = `<div class="empty-state">Não foi possível carregar as publicações: ${escapeHTML(error.message)}</div>`;
    });
}

function setupFeedFilters() {
  const typeField = document.getElementById('feedType');
  const breedField = document.getElementById('feedBreed');
  const breedWrap = document.getElementById('breedFilterWrap');
  const stateField = document.getElementById('feedState');
  const cityField = document.getElementById('feedCity');

  if (!typeField || !breedField || !breedWrap || !stateField || !cityField) return;

  const loadStates = async () => {
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
  };

  const loadCities = async () => {
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
    } catch (error) {}
  };

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
  stateField.addEventListener('change', async () => { await loadCities(); renderFeed(); });
  cityField.addEventListener('change', renderFeed);
  typeField.addEventListener('change', renderFeed);
  loadStates();
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

function getPostContact(post) {
  const contacts = [post.phone, post.contact_phone, post.email, post.contact_email, post.contact_info].filter(Boolean);
  return contacts.length ? contacts.join(' | ') : 'Contato não informado';
}

async function renderCategoryFeed(animalType) {
  const target = document.getElementById('categoryPosts');
  if (!target) return;
  target.innerHTML = '<div class="empty-state">Carregando animais...</div>';
  const { data, error } = await getSupabaseClient().from('posts').select('*').eq('animal_type', animalType).order('created_at', { ascending: false });

  if (error) {
    target.innerHTML = `<div class="empty-state">Não foi possível carregar: ${escapeHTML(error.message)}</div>`;
    return;
  }
  if (!data?.length) {
    target.innerHTML = '<div class="empty-state">Ainda não temos animais publicados. Volte em breve para conhecer novos amigos.</div>';
    return;
  }

  target.innerHTML = data.map((post) => `
    <article class="category-pet-card">
      <img src="${escapeHTML(getPostImageUrl(post))}" alt="${escapeHTML(post.title)}" />
      <div class="category-pet-card-body">
        <h2>${escapeHTML(post.title)}</h2>
        <p class="category-pet-location">📍 ${escapeHTML(post.city || 'Localização não informada')}</p>
        <button class="btn btn-primary full" type="button" data-adoption-post="${post.id}">Quero Adotar!</button>
      </div>
    </article>
  `).join('');

  const postsById = new Map(data.map((post) => [String(post.id), post]));
  target.querySelectorAll('[data-adoption-post]').forEach((button) => {
    button.addEventListener('click', () => openAdoptionModal(postsById.get(button.dataset.adoptionPost)));
  });
}

function openAdoptionModal(post) {
  if (!post) return;
  const modal = document.getElementById('adoptionModal');
  document.getElementById('modalPostImage').src = getPostImageUrl(post);
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
  renderCategoryFeed('Cachorro');
  document.querySelectorAll('[data-modal-close]').forEach((element) => element.addEventListener('click', closeAdoptionModal));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeAdoptionModal(); });
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
  const password = document.getElementById('registerPassword').value.trim();
  const confirm = document.getElementById('registerConfirmPassword').value.trim();
  if (password !== confirm) return alert('As senhas não coincidem.');
  try {
    const user = await registerWithSupabase(name, email, password);
    const { data: sessionData } = await getSupabaseClient().auth.getSession();
    if (sessionData.session) saveSession(user);
    alert('Conta criada com sucesso!');
    window.location.href = 'index.html';
  } catch (error) {
    alert(error.message || 'Erro ao criar conta.');
  }
}

async function initializePage() {
  const { data } = await getSupabaseClient().auth.getUser();
  if (data.user) {
    const profile = await fetchProfileByUserId(data.user.id);
    saveSession({
      id: data.user.id,
      email: data.user.email,
      name: profile?.full_name || data.user.user_metadata?.full_name || data.user.email,
      role: profile?.role || 'user',
      status: profile?.status || 'active'
    });
  } else {
    clearSession();
  }

  const page = document.body.dataset.page;
  if (page === 'home') {
    updateHomeUserActions();
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
  } else if (page === 'admin' && redirectIfLoggedOut()) {
    const session = getSession();
    if (session.role !== 'admin') return (window.location.href = 'index.html');
    document.getElementById('logoutButton')?.addEventListener('click', () => {
      getSupabaseClient().auth.signOut().then(() => { clearSession(); window.location.href = 'login.html'; });
    });
    document.getElementById('adminAccountForm')?.addEventListener('submit', handleAdminAccountSubmit);
    bindAdminActions();
    renderAdminDashboard();
  }
}

document.addEventListener('DOMContentLoaded', initializePage);