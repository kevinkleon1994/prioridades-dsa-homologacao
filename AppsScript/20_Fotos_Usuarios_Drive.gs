/**
 * FOTOS DE USUÁRIOS — GOOGLE DRIVE
 *
 * Pasta padrão:
 * Prioridades DSA_Fotos_Usuarios
 *
 * Script Property:
 * USER_PHOTOS_FOLDER_ID
 *
 * Segurança:
 * - upload exclusivo do perfil Desenvolvedor;
 * - valida tipo e tamanho;
 * - imagens antigas podem ser enviadas para a lixeira ao substituir;
 * - foto_url é salva em USUARIOS;
 * - ação registrada em LOG.
 *
 * Observação:
 * Para a PWA conseguir exibir as imagens sem autenticação Google,
 * o arquivo é compartilhado como ANYONE_WITH_LINK / VIEW.
 */

const USER_PHOTOS = Object.freeze({
  FOLDER_NAME: 'Prioridades DSA_Fotos_Usuarios',
  MAX_BYTES: 2 * 1024 * 1024,

  ALLOWED_MIME: Object.freeze([
    'image/jpeg',
    'image/png',
    'image/webp'
  ])
});


/**
 * Cria/localiza a pasta das fotos e salva seu ID nas Script Properties.
 *
 * Pode ser executada manualmente pelo editor Apps Script
 * ou chamada automaticamente no primeiro upload.
 */
function configurarPastaFotosUsuarios() {
  const folder = userPhotosFolder_();

  return {
    ok:true,
    folder_id:folder.getId(),
    folder_name:folder.getName(),
    folder_url:folder.getUrl()
  };
}


function userPhotosFolder_() {
  const props = PropertiesService.getScriptProperties();

  const configuredId = String(
    props.getProperty('USER_PHOTOS_FOLDER_ID') || ''
  ).trim();

  if (configuredId) {
    try {
      const folder = DriveApp.getFolderById(configuredId);

      // Teste mínimo de acesso.
      folder.getName();

      return folder;

    } catch (_err) {
      props.deleteProperty('USER_PHOTOS_FOLDER_ID');
    }
  }

  const iterator = DriveApp.getFoldersByName(
    USER_PHOTOS.FOLDER_NAME
  );

  let folder;

  if (iterator.hasNext()) {
    folder = iterator.next();
  } else {
    folder = DriveApp.createFolder(
      USER_PHOTOS.FOLDER_NAME
    );
  }

  props.setProperty(
    'USER_PHOTOS_FOLDER_ID',
    folder.getId()
  );

  return folder;
}


/**
 * input:
 * usuario_id
 * arquivo_base64  -> somente base64 ou data URL
 * mime_type       -> image/jpeg | image/png | image/webp
 * nome_arquivo    -> opcional
 * remover_anterior -> default true
 */
function uploadUserPhotoAdmin_(user, input) {
  requireDeveloperModule_(user);

  const userId = String(
    input.usuario_id || ''
  ).trim();

  if (!userId) {
    throw new Error(
      'usuario_id é obrigatório.'
    );
  }

  const target = userById_(userId);

  if (!target) {
    throw new Error(
      'Usuário não encontrado.'
    );
  }

  let base64 = String(
    input.arquivo_base64 || ''
  ).trim();

  let mimeType = String(
    input.mime_type || ''
  ).trim().toLowerCase();

  if (!base64) {
    throw new Error(
      'arquivo_base64 é obrigatório.'
    );
  }

  // Aceita data URL:
  // data:image/png;base64,AAAA...
  const dataUrlMatch = base64.match(
    /^data:([^;]+);base64,(.+)$/s
  );

  if (dataUrlMatch) {
    if (!mimeType) {
      mimeType = String(
        dataUrlMatch[1] || ''
      ).toLowerCase();
    }

    base64 = dataUrlMatch[2];
  }

  if (!USER_PHOTOS.ALLOWED_MIME.includes(mimeType)) {
    throw new Error(
      'Formato inválido. Envie JPG, PNG ou WebP.'
    );
  }

  let bytes;

  try {
    bytes = Utilities.base64Decode(base64);
  } catch (_err) {
    throw new Error(
      'O conteúdo base64 da imagem é inválido.'
    );
  }

  if (!bytes || !bytes.length) {
    throw new Error(
      'Imagem vazia.'
    );
  }

  if (bytes.length > USER_PHOTOS.MAX_BYTES) {
    throw new Error(
      'A imagem excede o limite de 2 MB.'
    );
  }

  const extension = userPhotoExtension_(mimeType);

  const safeName = userPhotoSafeName_(
    String(target.nome || userId)
  );

  const fileName =
    String(input.nome_arquivo || '').trim() ||
    (
      safeName +
      '_' +
      userId +
      '_' +
      Utilities.formatDate(
        new Date(),
        appTimeZone_(),
        'yyyyMMdd_HHmmss'
      ) +
      '.' +
      extension
    );

  const folder = userPhotosFolder_();

  const blob = Utilities.newBlob(
    bytes,
    mimeType,
    fileName
  );

  const file = folder.createFile(blob);

  // Necessário para exibição na PWA hospedada fora do Google.
  file.setSharing(
    DriveApp.Access.ANYONE_WITH_LINK,
    DriveApp.Permission.VIEW
  );

  const fileId = file.getId();

  const photoUrl =
    'https://drive.google.com/uc?export=view&id=' +
    encodeURIComponent(fileId);

  const previousUrl = String(
    target.foto_url || ''
  ).trim();

  updateObjectRow_(
    APP.SHEETS.USERS,
    target._row,
    {
      foto_url:photoUrl
    }
  );

  const removePrevious =
    input.remover_anterior == null
      ? true
      : bool_(input.remover_anterior);

  let previousRemoved = false;

  if (
    removePrevious &&
    previousUrl &&
    previousUrl !== photoUrl
  ) {
    previousRemoved = trashPreviousUserPhoto_(
      previousUrl,
      fileId
    );
  }

  logUser_(
    user,
    'UPLOAD_FOTO_USUARIO',
    'USUARIO',
    userId,
    {
      file_id:fileId,
      file_name:fileName,
      mime_type:mimeType,
      bytes:bytes.length,
      foto_url:photoUrl,
      foto_anterior_removida:previousRemoved
    }
  );

  return {
    ok:true,
    usuario_id:userId,
    file_id:fileId,
    file_name:fileName,
    mime_type:mimeType,
    bytes:bytes.length,
    foto_url:photoUrl,
    anterior_removida:previousRemoved
  };
}


function userPhotoExtension_(mimeType) {
  if (mimeType === 'image/png') {
    return 'png';
  }

  if (mimeType === 'image/webp') {
    return 'webp';
  }

  return 'jpg';
}


function userPhotoSafeName_(value) {
  let s = String(value || 'usuario')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!s) {
    s = 'usuario';
  }

  return s.slice(0, 60);
}


/**
 * Remove foto anterior da pasta quando a URL contém um ID reconhecível.
 */
function trashPreviousUserPhoto_(url, currentFileId) {
  const id = driveFileIdFromUrl_(url);

  if (
    !id ||
    id === String(currentFileId || '')
  ) {
    return false;
  }

  try {
    const file = DriveApp.getFileById(id);

    const folderId = String(
      PropertiesService
        .getScriptProperties()
        .getProperty('USER_PHOTOS_FOLDER_ID') ||
      ''
    );

    // Só envia para a lixeira quando o arquivo realmente estiver
    // dentro da pasta controlada pelo sistema.
    if (folderId) {
      const parents = file.getParents();
      let belongs = false;

      while (parents.hasNext()) {
        if (parents.next().getId() === folderId) {
          belongs = true;
          break;
        }
      }

      if (!belongs) {
        return false;
      }
    }

    file.setTrashed(true);

    return true;

  } catch (_err) {
    return false;
  }
}


function driveFileIdFromUrl_(url) {
  const s = String(url || '');

  let match = s.match(
    /[?&]id=([a-zA-Z0-9_-]+)/
  );

  if (match) {
    return match[1];
  }

  match = s.match(
    /\/d\/([a-zA-Z0-9_-]+)/
  );

  if (match) {
    return match[1];
  }

  return '';
}


/**
 * Remove a foto atual de um usuário.
 * Exige reautenticação.
 */
function removeUserPhotoAdmin_(user, input) {
  requireDeveloperModule_(user);
  requireReauth_(user, input.reauth_token);

  const userId = String(
    input.usuario_id || ''
  ).trim();

  if (!userId) {
    throw new Error(
      'usuario_id é obrigatório.'
    );
  }

  const target = userById_(userId);

  if (!target) {
    throw new Error(
      'Usuário não encontrado.'
    );
  }

  const previousUrl = String(
    target.foto_url || ''
  ).trim();

  if (!previousUrl) {
    return {
      ok:true,
      usuario_id:userId,
      removed:false
    };
  }

  const fileId = driveFileIdFromUrl_(
    previousUrl
  );

  let trashed = false;

  if (fileId) {
    trashed = trashPreviousUserPhoto_(
      previousUrl,
      ''
    );
  }

  updateObjectRow_(
    APP.SHEETS.USERS,
    target._row,
    {
      foto_url:''
    }
  );

  logUser_(
    user,
    'REMOVER_FOTO_USUARIO',
    'USUARIO',
    userId,
    {
      file_id:fileId,
      arquivo_lixeira:trashed
    }
  );

  return {
    ok:true,
    usuario_id:userId,
    removed:true,
    arquivo_lixeira:trashed
  };
}


/**
 * Retorna informações públicas da configuração,
 * nunca credenciais.
 */
function userPhotosStatusAdmin_(user) {
  requireDeveloperModule_(user);

  const folder = userPhotosFolder_();

  return {
    ok:true,
    folder_id:folder.getId(),
    folder_name:folder.getName(),
    folder_url:folder.getUrl(),
    max_bytes:USER_PHOTOS.MAX_BYTES,
    allowed_mime:USER_PHOTOS.ALLOWED_MIME
  };
}
