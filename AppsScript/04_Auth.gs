/**
 * Autenticação e sessão.
 */

function userByLogin_(login) {
  return findByField_(
    APP.SHEETS.USERS,
    'usuario_id',
    'login',
    login
  );
}


function userById_(userId) {
  return findById_(
    APP.SHEETS.USERS,
    'usuario_id',
    userId
  );
}


function verifyUserPassword_(user, password) {
  if (!user) return false;

  const stored = String(user.senha_hash || '').trim();
  if (!stored) return false;

  return secureEquals_(
    stored,
    hashPassword_(user.login, password)
  );
}


function definirSenhaUsuario(login, newPassword) {
  const normalizedLogin = String(login || '').trim();
  const pwd = String(newPassword || '');

  if (!normalizedLogin) throw new Error('Informe o login.');
  if (pwd.length < 6) throw new Error('A senha deve possuir pelo menos 6 caracteres.');

  const user = userByLogin_(normalizedLogin);
  if (!user) throw new Error('Usuário não encontrado: ' + normalizedLogin);

  updateObjectRow_(APP.SHEETS.USERS, user._row, {
    senha_hash: hashPassword_(normalizedLogin, pwd)
  });

  logSystem_('DEFINIR_SENHA', 'USUARIO', String(user.usuario_id || ''), {
    login: normalizedLogin
  });

  return {
    ok: true,
    usuario_id: String(user.usuario_id || ''),
    login: normalizedLogin
  };
}


function autenticar_(login, password) {
  const user = userByLogin_(login);

  if (!user || !bool_(user.ativo) || !verifyUserPassword_(user, password)) {
    logSystem_('LOGIN_FALHA', 'USUARIO', '', {
      login: String(login || '')
    });

    return {ok:false, error:'Usuário ou senha inválidos.'};
  }

  const token = createSessionToken_(user);

  logUser_(user, 'LOGIN_OK', 'USUARIO', String(user.usuario_id || ''), {});

  return {
    ok: true,
    token: token,
    expires_in: APP.SESSION_SECONDS,
    user: publicUser_(user),
    modules: allowedModules_(user),
    scope: territoryScope_(user)
  };
}


function sessionUser_(token) {
  const rawToken = String(token || '').trim();
  if (!rawToken) return null;

  // Sessão R1: token opaco persistido.
  let payload = readOpaqueSession_(rawToken);

  // Compatibilidade temporária com tokens v1.11 já emitidos.
  if (!payload) {
    payload = verifySignedToken_(rawToken, 'session');
  }

  if (!payload) return null;

  let user = null;

  // Primeiro procura pelo ID, depois pelo login.
  // O fallback resolve bases onde usuario_id foi alterado/preenchido
  // após a criação inicial do usuário.
  if (payload.uid) user = userById_(String(payload.uid).trim());
  if (!user && payload.login) user = userByLogin_(payload.login);

  if (!user || !bool_(user.ativo)) return null;

  // Mantém proteção contra reutilização da sessão por outro login.
  if (
    payload.login &&
    norm_(user.login) !== norm_(payload.login)
  ) {
    return null;
  }

  return user;
}


function requireUser_(token) {
  const user = sessionUser_(token);
  if (!user) throw new Error('Sessão inválida ou expirada.');
  return user;
}


function publicUser_(user) {
  return {
    usuario_id: String(user.usuario_id || ''),
    nome: String(user.nome || ''),
    login: String(user.login || ''),
    perfil: String(user.perfil || ''),
    polo_id: String(user.polo_id || ''),
    distrito_id: String(user.distrito_id || ''),
    igreja_id: String(user.igreja_id || ''),
    ativo: bool_(user.ativo),
    foto_url: String(user.foto_url || '')
  };
}
