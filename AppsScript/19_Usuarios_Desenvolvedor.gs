/**
 * OPÇÕES DO DESENVOLVEDOR + GESTÃO DE USUÁRIOS
 *
 * Página/módulo exclusivo do perfil Desenvolvedor.
 *
 * Implementa:
 * - listar usuários
 * - criar usuário
 * - editar usuário
 * - ativar/inativar
 * - trocar senha
 * - permissões individuais por módulo
 * - escopo territorial
 * - foto_url preparada para futura integração com Drive
 * - exclusão lógica/inativação protegida por reautenticação
 */

function requireDeveloperModule_(user) {
  if (String(user.perfil || '') !== APP.ROLES.DEVELOPER) {
    throw new Error('Ação exclusiva do usuário Desenvolvedor.');
  }

  requireModule_(user, APP.MODULE_KEYS.DEVELOPER);

  return true;
}


function userPublicAdmin_(user) {
  return {
    usuario_id:String(user.usuario_id || ''),
    nome:String(user.nome || ''),
    login:String(user.login || ''),
    perfil:String(user.perfil || ''),
    polo_id:String(user.polo_id || ''),
    distrito_id:String(user.distrito_id || ''),
    igreja_id:String(user.igreja_id || ''),
    ativo:bool_(user.ativo),
    foto_url:String(user.foto_url || ''),
    modulos_legado:String(user.modulos_legado || ''),
    senha_configurada:!!String(user.senha_hash || '').trim()
  };
}


function listUsersAdmin_(user) {
  requireDeveloperModule_(user);

  const users = rows_(APP.SHEETS.USERS, 'usuario_id')
    .map(userPublicAdmin_)
    .sort((a,b) =>
      String(a.nome || '').localeCompare(
        String(b.nome || ''),
        'pt-BR'
      )
    );

  return {
    ok:true,
    data:users
  };
}


function getUserAdmin_(user, input) {
  requireDeveloperModule_(user);

  const id = String(input.usuario_id || '').trim();
  if (!id) throw new Error('usuario_id é obrigatório.');

  const target = userById_(id);
  if (!target) throw new Error('Usuário não encontrado.');

  return {
    ok:true,
    data:{
      user:userPublicAdmin_(target),
      modules:effectiveUserModulesAdmin_(target)
    }
  };
}


function allowedRolesAdmin_() {
  return [
    APP.ROLES.DEVELOPER,
    APP.ROLES.ADMIN,
    APP.ROLES.POLE_COORDINATOR,
    APP.ROLES.DISTRICT_PASTOR,
    APP.ROLES.ELDER,
    APP.ROLES.SECRETARY
  ];
}


function validateUserScopeForRole_(role, input) {
  const poleId = String(input.polo_id || '').trim();
  const districtId = String(input.distrito_id || '').trim();
  const churchId = String(input.igreja_id || '').trim();

  const poles = territoryBase_().polos;
  const districts = territoryBase_().distritos;
  const churches = territoryBase_().igrejas;

  if (role === APP.ROLES.POLE_COORDINATOR) {
    if (!poleId) {
      throw new Error('Coordenador do Polo exige polo_id.');
    }

    if (!poles.some(x => String(x.polo_id || '') === poleId)) {
      throw new Error('polo_id inválido.');
    }

    return {
      polo_id:poleId,
      distrito_id:'',
      igreja_id:''
    };
  }

  if (role === APP.ROLES.DISTRICT_PASTOR) {
    if (!districtId) {
      throw new Error('Pastor Distrital exige distrito_id.');
    }

    const district = districts.find(
      x => String(x.distrito_id || '') === districtId
    );

    if (!district) {
      throw new Error('distrito_id inválido.');
    }

    return {
      polo_id:String(district.polo_id || ''),
      distrito_id:districtId,
      igreja_id:''
    };
  }

  if (
    role === APP.ROLES.ELDER ||
    role === APP.ROLES.SECRETARY
  ) {
    if (!churchId) {
      throw new Error(role + ' exige igreja_id.');
    }

    const church = churches.find(
      x => String(x.igreja_id || '') === churchId
    );

    if (!church) {
      throw new Error('igreja_id inválido.');
    }

    const district = districts.find(
      x => String(x.distrito_id || '') === String(church.distrito_id || '')
    );

    return {
      polo_id:district ? String(district.polo_id || '') : '',
      distrito_id:String(church.distrito_id || ''),
      igreja_id:churchId
    };
  }

  // Desenvolvedor/Admin não precisam escopo fixo.
  if (
    role === APP.ROLES.DEVELOPER ||
    role === APP.ROLES.ADMIN
  ) {
    return {
      polo_id:'',
      distrito_id:'',
      igreja_id:''
    };
  }

  throw new Error('Perfil inválido.');
}


function ensureUniqueLogin_(login, exceptUserId) {
  const normalized = norm_(login);

  if (!normalized) {
    throw new Error('Login é obrigatório.');
  }

  const duplicate = rows_(APP.SHEETS.USERS, 'usuario_id')
    .find(x =>
      norm_(x.login) === normalized &&
      String(x.usuario_id || '') !== String(exceptUserId || '')
    );

  if (duplicate) {
    throw new Error('Já existe um usuário com este login.');
  }

  return true;
}


/**
 * Criação/edição.
 *
 * Ao editar:
 * senha vazia mantém a atual.
 *
 * Ao criar:
 * senha é obrigatória.
 */
function legacyModulesFromInput_(list) {
  const map = {};
  activeModules_().forEach(m => { map[String(m.modulo_id || '')] = String(m.modulo || ''); });
  return (Array.isArray(list) ? list : [])
    .filter(x => x && bool_(x.permitido))
    .map(x => map[String(x.modulo_id || '')] || '')
    .filter(Boolean)
    .join(',');
}


function saveUserAdmin_(user, input) {
  requireDeveloperModule_(user);

  const id = String(input.usuario_id || '').trim();
  const name = String(input.nome || '').trim();
  const login = String(input.login || '').trim();
  const role = String(input.perfil || '').trim();
  const password = String(input.senha || '');

  if (!name) throw new Error('Nome completo é obrigatório.');
  if (!login) throw new Error('Usuário/login é obrigatório.');

  if (!allowedRolesAdmin_().includes(role)) {
    throw new Error('Função/perfil inválido.');
  }

  ensureUniqueLogin_(login, id);

  const scope = validateUserScopeForRole_(role, input);

  const patch = {
    nome:name,
    login:login,
    perfil:role,
    polo_id:scope.polo_id,
    distrito_id:scope.distrito_id,
    igreja_id:scope.igreja_id,
    ativo:input.ativo == null ? true : bool_(input.ativo)
  };

  if (input.foto_url != null && String(input.foto_url || '').trim()) {
    patch.foto_url = String(input.foto_url || '').trim();
  }

  let targetId;
  let previous = null;

  if (id) {
    previous = userById_(id);

    if (!previous) {
      throw new Error('Usuário não encontrado.');
    }

    // Protege o usuário Dev atualmente logado contra auto-inativação.
    if (
      String(previous.usuario_id || '') === String(user.usuario_id || '') &&
      !patch.ativo
    ) {
      throw new Error('Você não pode inativar o próprio acesso enquanto está logado.');
    }

    targetId = id;

    updateObjectRow_(
      APP.SHEETS.USERS,
      previous._row,
      patch
    );

    // Senha vazia mantém a atual.
    if (password) {
      if (password.length < 6) {
        throw new Error('A senha deve possuir pelo menos 6 caracteres.');
      }

      updateObjectRow_(
        APP.SHEETS.USERS,
        previous._row,
        {
          senha_hash:hashPassword_(login, password)
        }
      );
    }

    logUser_(
      user,
      'EDITAR_USUARIO',
      'USUARIO',
      targetId,
      {
        nome:name,
        login:login,
        perfil:role,
        ativo:patch.ativo,
        polo_id:scope.polo_id,
        distrito_id:scope.distrito_id,
        igreja_id:scope.igreja_id,
        senha_alterada:!!password
      }
    );

  } else {
    if (password.length < 6) {
      throw new Error(
        'Ao criar usuário, informe senha com pelo menos 6 caracteres.'
      );
    }

    targetId = nextId_(
      APP.SHEETS.USERS,
      'usuario_id',
      'USR'
    );

    patch.usuario_id = targetId;
    patch.senha_hash = hashPassword_(login, password);

    patch.modulos_legado = legacyModulesFromInput_(input.modulos || []);

    appendObject_(
      APP.SHEETS.USERS,
      patch
    );

    logUser_(
      user,
      'CRIAR_USUARIO',
      'USUARIO',
      targetId,
      {
        nome:name,
        login:login,
        perfil:role,
        ativo:patch.ativo,
        polo_id:scope.polo_id,
        distrito_id:scope.distrito_id,
        igreja_id:scope.igreja_id
      }
    );
  }

  // Sincroniza módulos individuais quando fornecidos.
  if (input.modulos != null) {
    saveUserModulesAdmin_(user,{usuario_id:targetId,modulos:input.modulos});
    const refreshed = userById_(targetId);
    if (refreshed) {
      updateObjectRow_(APP.SHEETS.USERS,refreshed._row,{modulos_legado:legacyModulesFromInput_(input.modulos)});
    }
  }

  SpreadsheetApp.flush();

  logUser_(user,'SALVAR_USUARIO_COMPLETO','USUARIO',targetId,{
    nome:name,login:login,perfil:role,ativo:patch.ativo,
    polo_id:scope.polo_id,distrito_id:scope.distrito_id,igreja_id:scope.igreja_id,
    senha_alterada:!!password,modulos_legado:legacyModulesFromInput_(input.modulos || [])
  });

  clearTerritoryCache_();

  return {
    ok:true,
    usuario_id:targetId,
    created:!id,
    updated:!!id
  };
}


/**
 * Permissões individuais.
 *
 * Lista pode conter:
 * [
 *  {modulo_id:"MOD-001",permitido:true},
 *  ...
 * ]
 *
 * USUARIO_MODULOS sobrescreve PERFIL_MODULOS.
 */
function saveUserModulesAdmin_(user, input) {
  requireDeveloperModule_(user);

  const userId = String(input.usuario_id || '').trim();

  if (!userId) {
    throw new Error('usuario_id é obrigatório.');
  }

  const target = userById_(userId);
  if (!target) throw new Error('Usuário não encontrado.');

  let list = input.modulos;

  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (_err) {
      throw new Error('modulos deve ser JSON válido.');
    }
  }

  if (!Array.isArray(list)) {
    throw new Error('modulos deve ser uma lista.');
  }

  const activeModules = activeModules_();
  const validIds = new Set(
    activeModules.map(x => String(x.modulo_id || ''))
  );

  list.forEach(item => {
    if (!validIds.has(String(item.modulo_id || ''))) {
      throw new Error('Módulo inválido: ' + String(item.modulo_id || ''));
    }
  });

  const existing = rows_(
    APP.SHEETS.USER_MODULES,
    'usuario_modulo_id'
  ).filter(x =>
    String(x.usuario_id || '') === userId
  );

  const existingMap = {};
  existing.forEach(x => {
    existingMap[String(x.modulo_id || '')] = x;
  });

  // Atualiza/cria somente regras fornecidas.
  list.forEach(item => {
    const moduleId = String(item.modulo_id || '');
    const permitted = bool_(item.permitido);
    const observation = String(item.observacao || '');

    const row = existingMap[moduleId];

    if (row) {
      updateObjectRow_(
        APP.SHEETS.USER_MODULES,
        row._row,
        {
          permitido:permitted,
          observacao:observation
        }
      );

    } else {
      appendObject_(
        APP.SHEETS.USER_MODULES,
        {
          usuario_modulo_id:nextId_(
            APP.SHEETS.USER_MODULES,
            'usuario_modulo_id',
            'UMO'
          ),
          usuario_id:userId,
          modulo_id:moduleId,
          permitido:permitted,
          observacao:observation
        }
      );
    }
  });

  logUser_(
    user,
    'ALTERAR_MODULOS_USUARIO',
    'USUARIO',
    userId,
    {
      quantidade:list.length
    }
  );

  return {
    ok:true,
    usuario_id:userId,
    updated:list.length
  };
}


function effectiveUserModulesAdmin_(target) {
  const active = activeModules_();

  const allowed = allowedModules_(target);
  const allowedIds = new Set(
    allowed.map(x => String(x.modulo_id || ''))
  );

  return active.map(module => ({
    modulo_id:String(module.modulo_id || ''),
    modulo:String(module.modulo || ''),
    titulo:String(module.titulo || ''),
    icone:String(module.icone || ''),
    ordem:Number(module.ordem || 0),
    permitido:allowedIds.has(String(module.modulo_id || ''))
  }));
}


/**
 * Inativação protegida por reautenticação.
 * Não apaga fisicamente.
 */
function deactivateUserAdmin_(user, input) {
  requireDeveloperModule_(user);
  requireReauth_(user, input.reauth_token);

  const userId = String(input.usuario_id || '').trim();
  if (!userId) throw new Error('usuario_id é obrigatório.');

  if (userId === String(user.usuario_id || '')) {
    throw new Error('Você não pode inativar o próprio usuário ativo.');
  }

  const target = userById_(userId);
  if (!target) throw new Error('Usuário não encontrado.');

  updateObjectRow_(
    APP.SHEETS.USERS,
    target._row,
    {ativo:false}
  );

  logUser_(
    user,
    'INATIVAR_USUARIO',
    'USUARIO',
    userId,
    {
      nome:String(target.nome || ''),
      login:String(target.login || '')
    }
  );

  clearTerritoryCache_();

  return {
    ok:true,
    usuario_id:userId,
    inactive:true
  };
}


function reactivateUserAdmin_(user, input) {
  requireDeveloperModule_(user);
  requireReauth_(user, input.reauth_token);

  const userId = String(input.usuario_id || '').trim();
  if (!userId) throw new Error('usuario_id é obrigatório.');

  const target = userById_(userId);
  if (!target) throw new Error('Usuário não encontrado.');

  updateObjectRow_(
    APP.SHEETS.USERS,
    target._row,
    {ativo:true}
  );

  logUser_(
    user,
    'REATIVAR_USUARIO',
    'USUARIO',
    userId,
    {}
  );

  clearTerritoryCache_();

  return {
    ok:true,
    usuario_id:userId,
    active:true
  };
}


/**
 * Troca de senha feita pelo Desenvolvedor.
 * Exige reautenticação do Dev.
 */
function resetUserPasswordAdmin_(user, input) {
  requireDeveloperModule_(user);
  requireReauth_(user, input.reauth_token);

  const userId = String(input.usuario_id || '').trim();
  const newPassword = String(input.nova_senha || '');

  if (!userId) throw new Error('usuario_id é obrigatório.');
  if (newPassword.length < 6) {
    throw new Error('A nova senha deve possuir pelo menos 6 caracteres.');
  }

  const target = userById_(userId);
  if (!target) throw new Error('Usuário não encontrado.');

  updateObjectRow_(
    APP.SHEETS.USERS,
    target._row,
    {
      senha_hash:hashPassword_(target.login, newPassword)
    }
  );

  logUser_(
    user,
    'REDEFINIR_SENHA_USUARIO',
    'USUARIO',
    userId,
    {}
  );

  return {
    ok:true,
    usuario_id:userId,
    password_reset:true
  };
}


/**
 * Dados auxiliares para formulário de Novo Usuário.
 */
function developerOptionsBootstrap_(user) {
  requireDeveloperModule_(user);

  const territory = territoryBase_();

  return {
    ok:true,

    perfis:allowedRolesAdmin_(),

    polos:territory.polos,
    distritos:territory.distritos,
    igrejas:territory.igrejas,

    modulos:activeModules_().map(modulePublic_),

    usuarios:rows_(
      APP.SHEETS.USERS,
      'usuario_id'
    ).map(userPublicAdmin_)
  };
}


/**
 * Foto de perfil:
 *
 * Nesta fase, foto_url pode ser salva diretamente.
 * Upload ao Drive será implementado separadamente para não misturar
 * gestão de usuários com upload binário.
 */
function saveUserPhotoUrlAdmin_(user, input) {
  requireDeveloperModule_(user);

  const userId = String(input.usuario_id || '').trim();
  const photoUrl = String(input.foto_url || '').trim();

  if (!userId) throw new Error('usuario_id é obrigatório.');

  const target = userById_(userId);
  if (!target) throw new Error('Usuário não encontrado.');

  updateObjectRow_(
    APP.SHEETS.USERS,
    target._row,
    {foto_url:photoUrl}
  );

  logUser_(
    user,
    'ATUALIZAR_FOTO_USUARIO',
    'USUARIO',
    userId,
    {foto_url:photoUrl}
  );

  return {
    ok:true,
    usuario_id:userId,
    foto_url:photoUrl
  };
}
