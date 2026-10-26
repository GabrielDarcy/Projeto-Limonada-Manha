(function (global) {
  'use strict';
  const STORAGE_CONFIG = {
    BUCKET_NAME: 'imagens-adocao',
    MAX_INPUT_BYTES: 15 * 1024 * 1024,
    MAX_OUTPUT_BYTES: 150 * 1024,
    ALLOWED_INPUT_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
    CACHE_CONTROL: '31536000',
    MIME_OUTPUT: 'image/webp'
  };
  const IMAGE_PROFILES = {
    perfil: {
      maxWidth: 300,
      maxHeight: 300,
      initialQuality: 0.75,
      aspectRatio: 'square'
    },
    pet: {
      maxDimension: 900,
      initialQuality: 0.80,
      aspectRatio: 'preserve'
    }
  };

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
      const cleanup = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch (_) {}
      };

      img.onload = () => {
        cleanup();

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
// feito preenchimento de fundo branco no canvas porque imagens PNG transparentes geravam artefatos escuros no WebP opaco e resolvemos com fillRect antes do drawImage
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, targetWidth, targetHeight);
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
// feito reducao adaptativa de qualidade porque imagens de alta densidade excediam 150 KB e resolvemos recalculando a compressao iterativamente
          const attemptCompression = (currentQuality) => {
            canvas.toBlob(
              (blob) => {
                if (!blob) {
                  canvas.width = 0;
                  canvas.height = 0;
                  return reject(new Error('Falha na conversão de imagem via Canvas para WebP.'));
                }
                if (blob.size <= STORAGE_CONFIG.MAX_OUTPUT_BYTES) {
                  canvas.width = 0;
                  canvas.height = 0;
                  return resolve(blob);
                }
                if (currentQuality > 0.45) {
                  const nextQuality = Math.max(0.40, currentQuality - 0.12);
                  return attemptCompression(Number(nextQuality.toFixed(2)));
                }
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

    function extractStoragePathFromUrl(url, bucketName = STORAGE_CONFIG.BUCKET_NAME) {
    if (!url || typeof url !== 'string') return null;
    const cleanUrl = url.split('?')[0];

    const marker = `/storage/v1/object/public/${bucketName}/`;
    if (cleanUrl.includes(marker)) {
      return decodeURIComponent(cleanUrl.split(marker)[1]);
    }
    const signMarker = `/storage/v1/object/sign/${bucketName}/`;
    if (cleanUrl.includes(signMarker)) {
      return decodeURIComponent(cleanUrl.split(signMarker)[1]);
    }

    return null;
  }

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
        upsert: false
      });

    if (error) {
      throw new Error(`Falha no upload para o Supabase Storage: ${error.message}`);
    }

    const { data: publicData } = supabaseClient.storage
      .from(STORAGE_CONFIG.BUCKET_NAME)
      .getPublicUrl(data.path);

    if (!publicData?.publicUrl) {
// feito delecao preventiva do arquivo porque falha na geracao da URL publica tornava a imagem inacessivel e resolvemos removendo o path recem-enviado
      await deleteStorageImage(filePath, supabaseClient);
      throw new Error('Não foi possível obter a URL pública da imagem enviada.');
    }

    return {
      publicUrl: publicData.publicUrl,
      path: data.path
    };
  }

    async function updateUserAvatarWithRollback({
    file,
    userId,
    oldAvatarUrl,
    supabaseClient,
    tableName = 'profiles'
  }) {
    const webpBlob = await compressAndValidateImage(file, 'perfil');
    const { publicUrl, path } = await uploadImageToStorage(webpBlob, userId, supabaseClient);

    try {
      const { error: dbError } = await supabaseClient
        .from(tableName)
        .update({ avatar_url: publicUrl })
        .eq('id', userId);

      if (dbError) throw dbError;
      if (oldAvatarUrl && oldAvatarUrl !== publicUrl) {
        deleteStorageImage(oldAvatarUrl, supabaseClient);
      }

      return { avatarUrl: publicUrl };
    } catch (dbErr) {
// feito rollback no Storage porque falha na persistencia do perfil deixava avatar orfao consumindo cota e resolvemos chamando deleteStorageImage no catch
      console.error('[Rollback] Erro ao salvar avatar no banco. Revertendo upload no Storage:', dbErr.message);
      await deleteStorageImage(path, supabaseClient);
      throw new Error(`Não foi possível atualizar o perfil no banco: ${dbErr.message}`);
    }
  }

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
    const webpBlobs = await Promise.all(
      imageFiles.map((file) => compressAndValidateImage(file, 'pet'))
    );
    const uploadedFiles = [];
    try {
      for (const blob of webpBlobs) {
        const uploadResult = await uploadImageToStorage(blob, userId, supabaseClient);
        uploadedFiles.push(uploadResult);
      }
    } catch (uploadErr) {
// feito remocao parcial de uploads porque interrupcao no envio de multiplas imagens deixava arquivos parciais no bucket e resolvemos com rollback imediato dos paths enviados
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
    const { data: createdRecord, error: insertError } = await supabaseClient
      .from(tableName)
      .insert([postPayload])
      .select()
      .single();

    if (insertError) {
// feito rollback em lote de fotos porque falha no insert do post deixava imagens orfas no Storage e resolvemos expurgando todos os paths gerados
      console.error('[Rollback] Falha na inserção do pet no banco. Apagando fotos enviadas:', insertError.message);
      const pathsToRollback = uploadedFiles.map((f) => f.path);
      await supabaseClient.storage.from(STORAGE_CONFIG.BUCKET_NAME).remove(pathsToRollback);
      throw new Error(`Falha ao registrar anúncio no banco de dados: ${insertError.message}`);
    }

    return createdRecord;
  }

    async function deletePetWithStorageCleanup({
    petId,
    userId,
    supabaseClient,
    tableName = 'posts'
  }) {
// feito consulta previa de image_urls porque deletar a linha do post antes impedia a identificacao dos arquivos no bucket e resolvemos buscando os paths antes do delete
    const { data: pet, error: fetchError } = await supabaseClient
      .from(tableName)
      .select('id, user_id, image_urls')
      .eq('id', petId)
      .single();

    if (fetchError || !pet) {
      throw new Error(`Pet não encontrado para exclusão: ${fetchError?.message || ''}`);
    }
    const { error: deleteError } = await supabaseClient
      .from(tableName)
      .delete()
      .eq('id', petId);

    if (deleteError) {
      throw new Error(`Não foi possível deletar o pet: ${deleteError.message}`);
    }
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
