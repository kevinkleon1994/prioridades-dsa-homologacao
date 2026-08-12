/**
 * Hash de senha, tokens assinados e reautenticação.
 *
 * A senha nunca é persistida em texto puro.
 */

function secret_(name) {
  const value = String(
    PropertiesService.getScriptProperties().getProperty(name) || ''
  ).trim();

  if (!value) {
    throw new Error(`Segredo ${name} não configurado. Execute configurarProjeto().`);
  }

  return value;
}


function bytesHex_(bytes) {
  return bytes.map(function(b) {
    const v = b < 0 ? b + 256 : b;
    return ('0' + v.toString(16)).slice(-2);
  }).join('');
}


function hashPassword_(login, password) {
  const normalizedLogin = norm_(login);
  const pwd = String(password || '');

  if (!normalizedLogin || !pwd) {
    throw new Error('Login e senha são obrigatórios para gerar hash.');
  }

  const pepper = secret_('AUTH_PEPPER');
  const data = normalizedLogin + '|' + pwd;

  return 'hmac256$' + bytesHex_(
    Utilities.computeHmacSha256Signature(data, pepper)
  );
}


function secureEquals_(a, b) {
  a = String(a || '');
  b = String(b || '');

  if (a.length !== b.length) return false;

  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return diff === 0;
}


/**
 * Sessão v1.11 R1
 *
 * A sessão principal passa a usar token opaco aleatório persistido em
 * Script Properties. Isso elimina dependência do token assinado anterior
 * entre execuções HTTP e permite revogação/expiração explícita.
 *
 * Formato público:
 *   ps1.<uuid>.<uuid>
 *
 * O valor bruto nunca é salvo na propriedade; somente SHA-256(token).
 */
function sessionPropertyKey_(token) {
  const digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(token || ''),
    Utilities.Charset.UTF_8
  );

  return 'SESSION_' + bytesHex_(digest);
}


function cleanupExpiredSessions_() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const now = Date.now();
  const remove = [];

  Object.keys(all).forEach(function(key) {
    if (key.indexOf('SESSION_') !== 0) return;

    try {
      const data = JSON.parse(all[key] || '{}');
      if (!data.exp || Number(data.exp) <= now) remove.push(key);
    } catch (_err) {
      remove.push(key);
    }
  });

  // Limita trabalho por login para não degradar o projeto.
  remove.slice(0, 100).forEach(function(key) {
    props.deleteProperty(key);
  });
}


function createOpaqueSessionToken_(user) {
  cleanupExpiredSessions_();

  const now = Date.now();
  const token = 'ps1.' + Utilities.getUuid() + '.' + Utilities.getUuid();

  const data = {
    typ: 'session',
    uid: String(user.usuario_id || '').trim(),
    login: String(user.login || '').trim(),
    iat: now,
    exp: now + APP.SESSION_SECONDS * 1000
  };

  if (!data.uid || !data.login) {
    throw new Error('Usuário sem usuario_id/login válido para criar sessão.');
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      sessionPropertyKey_(token),
      JSON.stringify(data)
    );

  return token;
}


function readOpaqueSession_(token) {
  token = String(token || '').trim();
  if (token.indexOf('ps1.') !== 0) return null;

  const props = PropertiesService.getScriptProperties();
  const key = sessionPropertyKey_(token);
  const raw = props.getProperty(key);

  if (!raw) return null;

  let data;
  try {
    data = JSON.parse(raw);
  } catch (_err) {
    props.deleteProperty(key);
    return null;
  }

  if (
    !data ||
    data.typ !== 'session' ||
    Number(data.exp || 0) <= Date.now()
  ) {
    props.deleteProperty(key);
    return null;
  }

  return data;
}


function revokeSessionToken_(token) {
  token = String(token || '').trim();
  if (!token) return;

  if (token.indexOf('ps1.') === 0) {
    PropertiesService
      .getScriptProperties()
      .deleteProperty(sessionPropertyKey_(token));
  }
}


function b64UrlEncode_(text) {
  return Utilities.base64EncodeWebSafe(
    String(text || ''),
    Utilities.Charset.UTF_8
  ).replace(/=+$/g, '');
}


function b64UrlDecode_(text) {
  const bytes = Utilities.base64DecodeWebSafe(String(text || ''));
  return Utilities.newBlob(bytes).getDataAsString(Utilities.Charset.UTF_8);
}


function signTokenPayload_(payload) {
  const body = b64UrlEncode_(JSON.stringify(payload));
  const signature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(body, secret_('TOKEN_SECRET'))
  ).replace(/=+$/g, '');

  return body + '.' + signature;
}


function verifySignedToken_(token, expectedType) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;

  const expectedSignature = Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(parts[0], secret_('TOKEN_SECRET'))
  ).replace(/=+$/g, '');

  if (!secureEquals_(parts[1], expectedSignature)) return null;

  let payload;

  try {
    payload = JSON.parse(b64UrlDecode_(parts[0]));
  } catch (_err) {
    return null;
  }

  if (!payload || Number(payload.exp || 0) <= Date.now()) return null;
  if (expectedType && payload.typ !== expectedType) return null;

  return payload;
}


function createSessionToken_(user) {
  return createOpaqueSessionToken_(user);
}


function createReauthToken_(user) {
  const now = Date.now();

  return signTokenPayload_({
    typ: 'reauth',
    uid: String(user.usuario_id || ''),
    iat: now,
    exp: now + APP.REAUTH_SECONDS * 1000,
    jti: Utilities.getUuid()
  });
}


function requireReauth_(user, reauthToken) {
  const payload = verifySignedToken_(reauthToken, 'reauth');

  if (!payload || String(payload.uid || '') !== String(user.usuario_id || '')) {
    throw new Error('Reautenticação inválida ou expirada.');
  }

  return true;
}


function reautenticarUsuario_(user, password) {
  if (!verifyUserPassword_(user, password)) {
    logUser_(user, 'REAUTENTICACAO_FALHA', 'USUARIO', String(user.usuario_id || ''), {});
    return {ok:false, error:'Senha inválida.'};
  }

  const token = createReauthToken_(user);

  logUser_(user, 'REAUTENTICACAO_OK', 'USUARIO', String(user.usuario_id || ''), {});

  return {
    ok: true,
    reauth_token: token,
    expires_in: APP.REAUTH_SECONDS
  };
}
