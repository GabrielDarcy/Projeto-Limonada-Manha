/**
 * ==============================================================================
 * MÓDULO DE PROCESSAMENTO, VALIDAÇÃO E UPLOAD DE IMAGENS (SUPABASE STORAGE v2)
 * ==============================================================================
 * Especializado em:
 * 1. Compressão client-side de altíssima eficiência via HTML5 Canvas (WebP)
 * 2. Prevenção de vazamento de memória (Memory Leak-Free com URL.revokeObjectURL)
 * 3. Validação rígida de entrada (MIME, max 15 MB) e saída (Blob < 150 KB)
 * 4. Isolamento multitenant no Supabase Storage: `${userId}/${uuid}.webp`
 * 5. Rollback transacional e eliminação ativa de arquivos órfãos
 * ==============================================================================
 */

(function (global) {
  'use strict';

  // Configurações globais de armazenamento
  const STORAGE_CONFIG = {
    BUCKET_NAME: 'imagens-adocao',
    MAX_INPUT_BYTES: 15 * 1024 * 1024, // 15 MB
    MAX_OUTPUT_BYTES: 150 * 1024,      // 150 KB
    ALLOWED_INPUT_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    CACHE_CONTROL: '31536000',          // 1 ano de cache na CDN do Supabase
    MIME_OUTPUT: 'image/webp'
  };

  // Perfis de dimensionamento e qualidade
  const IMAGE_PROFILES = {
    perfil: {
      maxWidth: 300,
      maxHeight: 300,
      initialQuality: 0.75,
      aspectRatio: 'square' // Redimensionamento proporcional ajustado para foto de perfil
    },
    pet: {
      maxDimension: 900, // Máximo 900px no maior lado mantendo proporção original
      initialQuality: 0.80,
      aspectRatio: 'preserve'
    }
  };

  /**
   * Valida as propriedades de entrada do arquivo antes de qualquer carregamento.
   * @param {File} file - Arquivo recebido do input file
   */
  function validateInputFile(file) {
    if (!file || !(file instanceof File || file instanceof Blob)) {
      throw new Error('Nenhum arquivo válido fornecido para validação.');
    }

    if (!STORAGE_CONFIG.ALLOWED_INPUT_TYPES.includes(file.type)) {
      throw new Error('Formato inválido. Envie apenas imagens JPG, PNG ou WebP.');
    }

    if (file.size > STORAGE_CONFIG.MAX_INPUT_BYTES) {
      const tamanhoMB = (file.size / (1024 * 1024)).toFixed(1);
      throw new Error(`A imagem original é muito grande (${tamanhoMB} MB). O limite máximo permitido é 15 MB.`);
    }
  }

  /**
   * Calcula as novas dimensões baseadas no perfil de configuração.
   * @param {number} width - Largura original
   * @param {number} height - Altura original
   * @param {string} profileName - 'perfil' ou 'pet'
   * @returns {{ width: number, height: number }}
   */
  function calculateDimensions(width, height, profileName) {
    const profile = IMAGE_PROFILES[profileName] || IMAGE_PROFILES.pet;

    if (profileName === 'perfil') {
      const maxW = profile.maxWidth;
      const maxH = profile.maxHeight;
      let targetW = width;
      let targetH = height;

      if (width > maxW || height > maxH) {
        const ratio = Math.min(maxW / width, maxH / height);
        targetW = Math.round(width * ratio);
        targetH = Math.round(height * ratio);
      }
      return { width: Math.max(1, targetW), height: Math.max(1, targetH) };
    }

    // Perfil 'pet': maior lado limitado a 900px, preservando proporção
    const maxDim = profile.maxDimension;
    let targetW = width;
    let targetH = height;

    if (width > maxDim || height > maxDim) {
      if (width >= height) {
        targetW = maxDim;
        targetH = Math.round((height * maxDim) / width);
      } else {
        targetH = maxDim;
        targetW = Math.round((width * maxDim) / height);
      }
    }

    return { width: Math.max(1, targetW), height: Math.max(1, targetH) };
  }

  /**
   * Comprime e converte qualquer imagem para WebP via Canvas de maneira assíncrona,
   * garantindo liberação imediata de memória (URL.revokeObjectURL) e controle estrito de saída (< 150 KB).
   *
   * @param {File} file - Arquivo original
   * @param {'perfil' | 'pet'} [profileName='pet'] - Perfil de compressão
   * @returns {Promise<Blob>} - Blob no formato image/webp com tamanho < 150 KB
   */
  function compressAndValidateImage(file, profileName = 'pet') {
    return new Promise((resolve, reject) => {
      try {
        validateInputFile(file);
      } catch (validationErr) {
        return reject(validationErr);
      }

      const profile = IMAGE_PROFILES[profileName] || IMAGE_PROFILES.pet;
      const objectUrl = URL.createObjectURL(file);
      const img = new Image();

      // Função de limpeza à prova de vazamento de memória
      const cleanup = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (_) {}
      };

      img.onload = () => {
        cleanup(); // Revoga imediatamente após carregar na memória gráfica

        try {
          const { width: targetWidth, height: targetHeight } = calculateDimensions(
            img.naturalWidth || img.width,
            img.naturalHeight || img.height,
            profileName
          );

          const canvas = document.createElement('canvas');
          canvas.width = targetWidth;
          canvas.height = targetHeight;

          const ctx = canvas.getContext('2d', { alpha: false });
          if (!ctx) {
            canvas.width = 0;
            canvas.height = 0;
            return reject(new Error('Falha ao inicializar o contexto 2D do Canvas.'));
          }

          // Preenche fundo branco para evitar artefatos em imagens com transparência convertidas para WebP opaco
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetWidth, targetHeight);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

          // Função recursiva de compressão adaptativa caso a foto precise de ajuste de qualidade para atingir < 150 KB
          const attemptCompression = (currentQuality) => {
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  canvas.width = 0;
                  canvas.height = 0;
                  return reject(new Error('Falha na conversão de imagem via Canvas para WebP.'));
                }

                // Se couber abaixo de 150 KB, aprovado com sucesso
                if (blob.size <= STORAGE_CONFIG.MAX_OUTPUT_BYTES) {
                  canvas.width = 0;
                  canvas.height = 0;
                  return resolve(blob);
                }

                // Se excedeu e a qualidade ainda pode ser ajustada (limite mínimo 0.45)
                if (currentQuality > 0.45) {
                  const nextQuality = Math.max(0.40, currentQuality - 0.12);
                  return attemptCompression(Number(nextQuality.toFixed(2)));
                }

                // Caso extremo onde a imagem não atinge < 150 KB mesmo na qualidade mínima
                canvas.width = 0;
                canvas.height = 0;
                const finalSizeKb = (blob.size / 1024).toFixed(1);
                reject(
                  new Error(
                    `A imagem comprimida (${finalSizeKb} KB) excedeu o limite máximo de 150 KB permitido.`
                  )
                );
              },
              STORAGE_CONFIG.MIME_OUTPUT,
              currentQuality
            );
          };

          attemptCompression(profile.initialQuality);
        } catch (err) {
          reject(new Error(`Erro ao processar dimensões no canvas: ${err.message}`));
        }
      };

      img.onerror = () => {
        cleanup();
        reject(new Error('Não foi possível ler o arquivo de imagem enviado. O arquivo pode estar corrompido.'));
      };

      img.src = objectUrl;
    });
  }

  /**
   * Extrai o caminho relativo de um arquivo dentro do bucket a partir de sua URL pública.
   * Suporta URLs de buckets do Supabase v1 e v2.
   * @param {string} url - URL pública da imagem
   * @param {string} [bucketName='imagens-adocao']
   * @returns {string|null} - Caminho relativo do objeto (ex: "user-uuid/image-uuid.webp")
   */
  function extractStoragePathFromUrl(url, bucketName = STORAGE_CONFIG.BUCKET_NAME) {
    if (!url || typeof url !== 'string') return null;
    const cleanUrl = url.split('?')[0]; // Remove query strings como cache-busters ?t=...

    const marker = `/storage/v1/object/public/${bucketName}/`;
    if (cleanUrl.includes(marker)) {
      return decodeURIComponent(cleanUrl.split(marker)[1]);
    }

    // Suporte a URLs assinadas ou caminhos diretos
    const signMarker = `/storage/v1/object/sign/${bucketName}/`;
    if (cleanUrl.includes(signMarker)) {
      return decodeURIComponent(cleanUrl.split(signMarker)[1]);
    }

    return null;
  }

  /**
   * Remove uma imagem do Supabase Storage com base em sua URL pública ou caminho relativo.
   * @param {string} urlOrPath - URL pública ou path relativo
   * @param {object} supabaseClient - Instância do cliente Supabase (@supabase/supabase-js)
   * @param {string} [bucketName='imagens-adocao']
   * @returns {Promise<boolean>}
   */
  async function deleteStorageImage(urlOrPath, supabaseClient, bucketName = STORAGE_CONFIG.BUCKET_NAME) {
    if (!urlOrPath || !supabaseClient) return false;

    const path = urlOrPath.startsWith('http')
      ? extractStoragePathFromUrl(urlOrPath, bucketName)
      : urlOrPath;

    if (!path) return false;

    try {
      const { error } = await supabaseClient.storage.from(bucketName).remove([path]);
      if (error) {
        console.warn(`[Storage Anti-Orphan] Aviso ao remover arquivo ${path}:`, error.message);
        return false;
      }
      return true;
    } catch (err) {
      console.warn(`[Storage Anti-Orphan] Exceção ao remover arquivo ${path}:`, err);
      return false;
    }
  }

  /**
   * Envia o Blob WebP para o Supabase Storage organizando por pasta com o ID do usuário.
   * Caminho padronizado: `${userId}/${crypto.randomUUID()}.webp`
   *
   * @param {Blob} webpBlob - Imagem comprimida em formato WebP
   * @param {string} userId - UUID do usuário autenticado (auth.uid())
   * @param {object} supabaseClient - Instância do cliente Supabase
   * @returns {Promise<{ publicUrl: string, path: string }>}
   */
  async function uploadImageToStorage(webpBlob, userId, supabaseClient) {
    if (!userId) {
      throw new Error('Operação negada: ID do usuário autenticado é obrigatório para upload.');
    }
    if (!supabaseClient) {
      throw new Error('Instância do cliente Supabase não informada.');
    }

    const uuid = (global.crypto && typeof global.crypto.randomUUID === 'function')
      ? global.crypto.randomUUID()
      : `img-${Date.now()}-${Math.floor(Math.random() * 1e8)}`;

    const filePath = `${userId}/${uuid}.webp`;

    const { data, error } = await supabaseClient.storage
      .from(STORAGE_CONFIG.BUCKET_NAME)
      .upload(filePath, webpBlob, {
        contentType: STORAGE_CONFIG.MIME_OUTPUT,
        cacheControl: STORAGE_CONFIG.CACHE_CONTROL,
        upsert: false // Garante imutabilidade e integridade criptográfica do caminho
      });

    if (error) {
      throw new Error(`Falha no upload para o Supabase Storage: ${error.message}`);
    }

    const { data: publicData } = supabaseClient.storage
      .from(STORAGE_CONFIG.BUCKET_NAME)
      .getPublicUrl(data.path);

    if (!publicData?.publicUrl) {
      // Se não gerou URL pública, desfaz o upload imediatamente
      await deleteStorageImage(filePath, supabaseClient);
      throw new Error('Não foi possível obter a URL pública da imagem enviada.');
    }

    return {
      publicUrl: publicData.publicUrl,
      path: data.path
    };
  }

  /**
   * Fluxo Transacional Completo: Atualização de Foto de Perfil com Rollback e Limpeza de Órfão
   * 1. Valida e comprime a foto com perfil 'perfil' (< 150 KB, 300x300 máx)
   * 2. Envia para o Storage no caminho do usuário
   * 3. Atualiza a coluna avatar_url na tabela profiles (ou usuarios)
   * 4. Se o banco falhar -> Rollback (apaga imagem recém-enviada)
   * 5. Se o banco suceder -> Deleta foto de perfil antiga do Storage
   *
   * @param {object} params
   * @param {File} params.file - Arquivo de imagem
   * @param {string} params.userId - UUID do usuário
   * @param {string|null} params.oldAvatarUrl - URL do avatar anterior para limpeza
   * @param {object} params.supabaseClient - Cliente Supabase
   * @param {string} [params.tableName='profiles'] - Nome da tabela de perfis
   * @returns {Promise<{ avatarUrl: string }>}
   */
  async function updateUserAvatarWithRollback({
    file,
    userId,
    oldAvatarUrl,
    supabaseClient,
    tableName = 'profiles'
  }) {
    // 1. Compressão client-side
    const webpBlob = await compressAndValidateImage(file, 'perfil');

    // 2. Upload para o Supabase Storage
    const { publicUrl, path } = await uploadImageToStorage(webpBlob, userId, supabaseClient);

    try {
      // 3. Atualização no PostgreSQL
      const { error: dbError } = await supabaseClient
        .from(tableName)
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

      if (dbError) throw dbError;

      // 4. Sucesso: Limpeza assíncrona do avatar antigo (evita acúmulo no plano gratuito de 1 GB)
      if (oldAvatarUrl && oldAvatarUrl !== publicUrl) {
        deleteStorageImage(oldAvatarUrl, supabaseClient);
      }

      return { avatarUrl: publicUrl };
    } catch (dbErr) {
      // 5. ROLLBACK ATIVO: Se o banco falhar, elimina imediatamente o arquivo recém-criado
      console.error('[Rollback] Erro ao salvar avatar no banco. Revertendo upload no Storage:', dbErr.message);
      await deleteStorageImage(path, supabaseClient);
      throw new Error(`Não foi possível atualizar o perfil no banco: ${dbErr.message}`);
    }
  }

  /**
   * Fluxo Transacional Completo: Publicação de Pet com Múltiplas Fotos, Rollback e Prevenção de Órfãos
   * 1. Comprime todas as fotos em paralelo com perfil 'pet' (< 150 KB, máx 900px)
   * 2. Envia todas as fotos para o Storage guardando os caminhos criados
   * 3. Tenta o INSERT na tabela posts (ou pets)
   * 4. Se o INSERT falhar -> Rollback em lote (apaga todas as fotos enviadas nessa transação)
   *
   * @param {object} params
   * @param {File[]} params.imageFiles - Lista de arquivos selecionados pelo anunciante
   * @param {object} params.petData - Objeto contendo os dados do pet a serem inseridos
   * @param {string} params.userId - UUID do usuário anunciante
   * @param {object} params.supabaseClient - Cliente Supabase
   * @param {string} [params.tableName='posts'] - Nome da tabela (posts ou pets)
   * @returns {Promise<object>} - Registro criado no banco
   */
  async function createPetWithImagesAndRollback({
    imageFiles,
    petData,
    userId,
    supabaseClient,
    tableName = 'posts'
  }) {
    if (!Array.isArray(imageFiles) || imageFiles.length === 0) {
      throw new Error('Selecione pelo menos uma foto do pet para publicar.');
    }

    // 1. Compressão client-side em paralelo
    const webpBlobs = await Promise.all(
      imageFiles.map((file) => compressAndValidateImage(file, 'pet'))
    );

    // 2. Upload para o Supabase Storage rastreando os caminhos gerados
    const uploadedFiles = [];
    try {
      for (const blob of webpBlobs) {
        const uploadResult = await uploadImageToStorage(blob, userId, supabaseClient);
        uploadedFiles.push(uploadResult);
      }
    } catch (uploadErr) {
      // Se algum upload falhar no meio do caminho, desfaz os que já foram enviados
      if (uploadedFiles.length > 0) {
        const pathsToClean = uploadedFiles.map((f) => f.path);
        await supabaseClient.storage.from(STORAGE_CONFIG.BUCKET_NAME).remove(pathsToClean);
      }
      throw uploadErr;
    }

    const imageUrls = uploadedFiles.map((f) => f.publicUrl);
    const postPayload = {
      ...petData,
      user_id: userId,
      image_urls: imageUrls
    };

    // 3. Inserção no PostgreSQL
    const { data: createdRecord, error: insertError } = await supabaseClient
      .from(tableName)
      .insert([postPayload])
      .select()
      .single();

    if (insertError) {
      // 4. ROLLBACK ATIVO: Exclui todas as fotos recém-enviadas para não criar arquivos órfãos
      console.error('[Rollback] Falha na inserção do pet no banco. Apagando fotos enviadas:', insertError.message);
      const pathsToRollback = uploadedFiles.map((f) => f.path);
      await supabaseClient.storage.from(STORAGE_CONFIG.BUCKET_NAME).remove(pathsToRollback);
      throw new Error(`Falha ao registrar anúncio no banco de dados: ${insertError.message}`);
    }

    return createdRecord;
  }

  /**
   * Exclusão Completa de Pet: Remove o registro do PostgreSQL e expurga todas as imagens associadas no Storage.
   *
   * @param {object} params
   * @param {string} params.petId - ID da publicação do pet
   * @param {string} params.userId - ID do usuário (ou se for admin)
   * @param {object} params.supabaseClient - Cliente Supabase
   * @param {string} [params.tableName='posts']
   * @returns {Promise<boolean>}
   */
  async function deletePetWithStorageCleanup({
    petId,
    userId,
    supabaseClient,
    tableName = 'posts'
  }) {
    // 1. Busca as URLs das fotos antes de deletar a linha no banco
    const { data: pet, error: fetchError } = await supabaseClient
      .from(tableName)
      .select('id, user_id, image_urls')
      .eq('id', petId)
      .single();

    if (fetchError || !pet) {
      throw new Error(`Pet não encontrado para exclusão: ${fetchError?.message || ''}`);
    }

    // 2. Deleta o registro no PostgreSQL
    const { error: deleteError } = await supabaseClient
      .from(tableName)
      .delete()
      .eq('id', petId);

    if (deleteError) {
      throw new Error(`Não foi possível deletar o pet: ${deleteError.message}`);
    }

    // 3. Remove ativamente todos os arquivos correspondentes do Storage (prevenção de órfãos)
    const rawUrls = Array.isArray(pet.image_urls) ? pet.image_urls : [pet.image_urls];
    const pathsToRemove = rawUrls
      .map((url) => extractStoragePathFromUrl(url, STORAGE_CONFIG.BUCKET_NAME))
      .filter(Boolean);

    if (pathsToRemove.length > 0) {
      try {
        await supabaseClient.storage.from(STORAGE_CONFIG.BUCKET_NAME).remove(pathsToRemove);
      } catch (storageErr) {
        console.warn('[Storage Cleanup] Aviso ao expurgar fotos do pet deletado:', storageErr);
      }
    }

    return true;
  }

  // Exportação para o escopo global (Window / Browser) e suporte a módulos ES6/CommonJS
  const ImageService = {
    STORAGE_CONFIG,
    IMAGE_PROFILES,
    validateInputFile,
    calculateDimensions,
    compressAndValidateImage,
    extractStoragePathFromUrl,
    deleteStorageImage,
    uploadImageToStorage,
    updateUserAvatarWithRollback,
    createPetWithImagesAndRollback,
    deletePetWithStorageCleanup
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ImageService;
  } else {
    global.ImageService = ImageService;
  }

})(typeof window !== 'undefined' ? window : this);
