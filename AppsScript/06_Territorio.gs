/**
 * Escopo territorial: Campo → Polo → Distrito → Igreja → Usuário.
 */

function territoryBase_() {
  const cache = CacheService.getScriptCache();
  const cacheKey = 'territory:v1.2';
  const cached = cache.get(cacheKey);

  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (_err) {}
  }

  const data = {
    polos: rows_(APP.SHEETS.POLES, 'polo_id')
      .filter(x => bool_(x.ativo))
      .map(x => publicRow_(x)),

    distritos: rows_(APP.SHEETS.DISTRICTS, 'distrito_id')
      .filter(x => bool_(x.ativo))
      .map(x => publicRow_(x)),

    igrejas: rows_(APP.SHEETS.CHURCHES, 'igreja_id')
      .filter(x => bool_(x.ativo))
      .map(x => publicRow_(x))
  };

  cache.put(cacheKey, JSON.stringify(data), APP.CACHE_SECONDS);
  return data;
}


function clearTerritoryCache_() {
  CacheService.getScriptCache().remove('territory:v1.2');
}


function territoryScope_(user) {
  const base = territoryBase_();
  const role = String(user.perfil || '');

  let poles = [];
  let districts = [];
  let churches = [];

  if (role === APP.ROLES.DEVELOPER || role === APP.ROLES.ADMIN) {
    poles = base.polos;
    districts = base.distritos;
    churches = base.igrejas;

  } else if (role === APP.ROLES.POLE_COORDINATOR) {
    const poleId = String(user.polo_id || '');

    poles = base.polos.filter(x => String(x.polo_id || '') === poleId);
    districts = base.distritos.filter(x => String(x.polo_id || '') === poleId);

    const districtIds = new Set(
      districts.map(x => String(x.distrito_id || ''))
    );

    churches = base.igrejas.filter(
      x => districtIds.has(String(x.distrito_id || ''))
    );

  } else if (role === APP.ROLES.DISTRICT_PASTOR) {
    const districtId = String(user.distrito_id || '');

    districts = base.distritos.filter(
      x => String(x.distrito_id || '') === districtId
    );

    churches = base.igrejas.filter(
      x => String(x.distrito_id || '') === districtId
    );

    const poleIds = new Set(
      districts
        .map(x => String(x.polo_id || ''))
        .filter(Boolean)
    );

    poles = base.polos.filter(
      x => poleIds.has(String(x.polo_id || ''))
    );

  } else if (role === APP.ROLES.ELDER || role === APP.ROLES.SECRETARY) {
    const churchId = String(user.igreja_id || '');

    churches = base.igrejas.filter(
      x => String(x.igreja_id || '') === churchId
    );

    const districtIds = new Set(
      churches.map(x => String(x.distrito_id || ''))
    );

    districts = base.distritos.filter(
      x => districtIds.has(String(x.distrito_id || ''))
    );

    const poleIds = new Set(
      districts
        .map(x => String(x.polo_id || ''))
        .filter(Boolean)
    );

    poles = base.polos.filter(
      x => poleIds.has(String(x.polo_id || ''))
    );
  }

  return {
    perfil: role,

    filtros: territoryFilterRules_(role),

    polos: poles,
    distritos: districts,
    igrejas: churches
  };
}


function territoryFilterRules_(role) {
  return {
    mostrar_polo:
      role === APP.ROLES.DEVELOPER ||
      role === APP.ROLES.ADMIN,

    mostrar_distrito:
      role === APP.ROLES.DEVELOPER ||
      role === APP.ROLES.ADMIN ||
      role === APP.ROLES.POLE_COORDINATOR,

    mostrar_igreja:
      role !== APP.ROLES.ELDER &&
      role !== APP.ROLES.SECRETARY,

    igreja_fixa:
      role === APP.ROLES.ELDER ||
      role === APP.ROLES.SECRETARY,

    permitir_todos_polos:
      role === APP.ROLES.DEVELOPER ||
      role === APP.ROLES.ADMIN,

    permitir_todos_distritos:
      role === APP.ROLES.DEVELOPER ||
      role === APP.ROLES.ADMIN ||
      role === APP.ROLES.POLE_COORDINATOR,

    permitir_todas_igrejas:
      role === APP.ROLES.DEVELOPER ||
      role === APP.ROLES.ADMIN ||
      role === APP.ROLES.POLE_COORDINATOR ||
      role === APP.ROLES.DISTRICT_PASTOR
  };
}


function canAccessChurch_(user, churchId) {
  const id = String(churchId || '').trim();
  if (!id) return false;

  return territoryScope_(user).igrejas
    .some(x => String(x.igreja_id || '') === id);
}


function canAccessDistrict_(user, districtId) {
  const id = String(districtId || '').trim();
  if (!id) return false;

  return territoryScope_(user).distritos
    .some(x => String(x.distrito_id || '') === id);
}


function canAccessPole_(user, poleId) {
  const id = String(poleId || '').trim();
  if (!id) return false;

  return territoryScope_(user).polos
    .some(x => String(x.polo_id || '') === id);
}


function requireChurch_(user, churchId) {
  if (!canAccessChurch_(user, churchId)) {
    throw new Error('Usuário sem permissão para esta igreja.');
  }

  return true;
}
