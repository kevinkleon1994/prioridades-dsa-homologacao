/**
 * Permissões de módulos.
 *
 * PERFIL_MODULOS define padrão.
 * USUARIO_MODULOS sobrescreve o padrão para um usuário específico.
 */

function activeModules_() {
  return rows_(APP.SHEETS.MODULES, 'modulo_id')
    .filter(x => bool_(x.ativo))
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));
}


function allowedModules_(user) {
  const active = activeModules_();

  if (String(user.perfil || '') === APP.ROLES.DEVELOPER) {
    return active.map(modulePublic_);
  }

  const profileRules = rows_(APP.SHEETS.PROFILE_MODULES, 'perfil_modulo_id')
    .filter(x => String(x.perfil || '') === String(user.perfil || ''));

  const userRules = rows_(APP.SHEETS.USER_MODULES, 'usuario_modulo_id')
    .filter(x => String(x.usuario_id || '') === String(user.usuario_id || ''));

  const profileMap = {};
  profileRules.forEach(rule => {
    profileMap[String(rule.modulo_id || '')] = bool_(rule.permitido);
  });

  const overrideMap = {};
  userRules.forEach(rule => {
    overrideMap[String(rule.modulo_id || '')] = bool_(rule.permitido);
  });

  return active
    .filter(module => {
      const id = String(module.modulo_id || '');

      if (Object.prototype.hasOwnProperty.call(overrideMap, id)) {
        return overrideMap[id];
      }

      return profileMap[id] === true;
    })
    .map(modulePublic_);
}


function modulePublic_(module) {
  return {
    modulo_id: String(module.modulo_id || ''),
    modulo: String(module.modulo || ''),
    titulo: String(module.titulo || ''),
    icone: String(module.icone || ''),
    ordem: Number(module.ordem || 0)
  };
}


function canAccessModule_(user, moduleKey) {
  if (String(user.perfil || '') === APP.ROLES.DEVELOPER) return true;

  return allowedModules_(user)
    .some(x => String(x.modulo || '') === String(moduleKey || ''));
}


function requireModule_(user, moduleKey) {
  if (!canAccessModule_(user, moduleKey)) {
    throw new Error('Acesso não autorizado ao módulo: ' + moduleKey);
  }

  return true;
}
