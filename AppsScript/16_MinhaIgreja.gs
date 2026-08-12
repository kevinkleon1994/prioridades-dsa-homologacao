/**
 * MINHA IGREJA + DEPARTAMENTOS/OFICIAIS
 *
 * PERFIL_IGREJA armazena dados estruturais da igreja.
 * DEPARTAMENTOS é o cadastro mestre.
 * IGREJA_DEPARTAMENTOS registra se há liderança e o nome do líder.
 *
 * Não usa os campos legado de oficiais_departamentos.
 */

function activeDepartments_() {
  return rows_(APP.SHEETS.DEPARTMENTS, 'departamento_id')
    .filter(x => bool_(x.ativo))
    .sort((a,b) => Number(a.ordem || 0) - Number(b.ordem || 0));
}


function churchProfileById_(churchId) {
  return rows_(APP.SHEETS.CHURCH_PROFILE, 'igreja_id')
    .find(x => String(x.igreja_id || '') === String(churchId || '')) || null;
}


function churchDepartments_(churchId) {
  const assignments = rows_(APP.SHEETS.CHURCH_DEPARTMENTS, 'igreja_departamento_id')
    .filter(x => String(x.igreja_id || '') === String(churchId || ''));

  const assignmentMap = {};
  assignments.forEach(x => {
    assignmentMap[String(x.departamento_id || '')] = x;
  });

  return activeDepartments_().map(dep => {
    const assignment = assignmentMap[String(dep.departamento_id || '')];

    return {
      departamento_id:String(dep.departamento_id || ''),
      departamento:String(dep.departamento || ''),
      categoria:String(dep.categoria || ''),
      ordem:Number(dep.ordem || 0),
      tem_lider:assignment ? bool_(assignment.tem_lider) : false,
      nome_lider:assignment ? String(assignment.nome_lider || '') : '',
      atualizado_em:assignment ? serializeValue_(assignment.atualizado_em) : null
    };
  });
}


function churchProfilePublic_(church, profile) {
  profile = profile || {};

  return {
    igreja_id:String(church.igreja_id || ''),
    igreja:String(church.igreja || ''),
    distrito_id:String(church.distrito_id || ''),

    quantidade_anciaos:Number(profile.quantidade_anciaos || 0),
    quantidade_familias:Number(profile.quantidade_familias || 0),
    quantidade_uapgs:Number(profile.quantidade_uapgs || 0),

    primeiro_anciao_diretor:String(profile.primeiro_anciao_diretor || ''),
    contato_primeiro_anciao_diretor:String(profile.contato_primeiro_anciao_diretor || ''),
    endereco:String(profile.endereco || ''),
    email:String(profile.email || ''),
    observacoes:String(profile.observacoes || ''),

    atualizado_em:serializeValue_(profile.atualizado_em),
    atualizado_por:String(profile.atualizado_por || '')
  };
}


/**
 * Retorna Minha Igreja.
 *
 * Ancião/Secretário → sua única igreja.
 * Pastor → igreja solicitada dentro do distrito.
 * Coordenador/Admin/Dev → igreja solicitada dentro do escopo.
 */
function getMyChurch_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.MY_CHURCH);

  const scope = territoryScope_(user);
  let churchId = String(input.igreja_id || user.igreja_id || '').trim();

  // Se perfil possui apenas uma igreja, resolve automaticamente.
  if (!churchId && scope.igrejas.length === 1) {
    churchId = String(scope.igrejas[0].igreja_id || '');
  }

  if (!churchId) {
    return {
      ok:true,
      requires_selection:true,
      churches:scope.igrejas
    };
  }

  requireChurch_(user, churchId);

  const church = scope.igrejas.find(
    x => String(x.igreja_id || '') === churchId
  );

  if (!church) throw new Error('Igreja não encontrada no escopo do usuário.');

  const profile = churchProfileById_(churchId);

  return {
    ok:true,
    requires_selection:false,
    profile:churchProfilePublic_(church, profile),
    departments:churchDepartments_(churchId)
  };
}


/**
 * Quem pode editar Minha Igreja:
 * - Desenvolvedor
 * - Administrador
 * - Coordenador do Polo
 * - Pastor Distrital
 * - Ancião(ã)
 * - Secretário(a)
 *
 * Sempre limitado ao próprio escopo.
 */
function saveMyChurch_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.MY_CHURCH);

  const churchId = String(input.igreja_id || user.igreja_id || '').trim();
  if (!churchId) throw new Error('igreja_id é obrigatório.');

  requireChurch_(user, churchId);

  const patch = {
    quantidade_anciaos:nonNegativeInt_(input.quantidade_anciaos, 'Quantidade de anciãos'),
    quantidade_familias:nonNegativeInt_(input.quantidade_familias, 'Quantidade de famílias'),
    quantidade_uapgs:nonNegativeInt_(input.quantidade_uapgs, 'Quantidade de UAPGs'),

    primeiro_anciao_diretor:String(input.primeiro_anciao_diretor || '').trim(),
    contato_primeiro_anciao_diretor:String(input.contato_primeiro_anciao_diretor || '').trim(),
    endereco:String(input.endereco || '').trim(),
    email:String(input.email || '').trim(),
    observacoes:String(input.observacoes || ''),

    atualizado_em:new Date(),
    atualizado_por:String(user.usuario_id || '')
  };

  const existing = churchProfileById_(churchId);

  if (existing) {
    updateObjectRow_(APP.SHEETS.CHURCH_PROFILE, existing._row, patch);

  } else {
    patch.igreja_id = churchId;
    appendObject_(APP.SHEETS.CHURCH_PROFILE, patch);
  }

  logUser_(
    user,
    'ATUALIZAR_PERFIL_IGREJA',
    'PERFIL_IGREJA',
    churchId,
    {
      igreja_id:churchId,
      quantidade_anciaos:patch.quantidade_anciaos,
      quantidade_familias:patch.quantidade_familias,
      quantidade_uapgs:patch.quantidade_uapgs
    }
  );

  return {
    ok:true,
    igreja_id:churchId,
    saved:true
  };
}


function nonNegativeInt_(value, label) {
  const n = Number(value || 0);

  if (!isFinite(n) || n < 0 || Math.floor(n) !== n) {
    throw new Error((label || 'Valor') + ' deve ser um número inteiro igual ou maior que zero.');
  }

  return n;
}


/**
 * Atualiza um departamento/oficial da igreja.
 */
function saveChurchDepartment_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.MY_CHURCH);

  const churchId = String(input.igreja_id || user.igreja_id || '').trim();
  const departmentId = String(input.departamento_id || '').trim();

  if (!churchId) throw new Error('igreja_id é obrigatório.');
  if (!departmentId) throw new Error('departamento_id é obrigatório.');

  requireChurch_(user, churchId);

  const department = findById_(
    APP.SHEETS.DEPARTMENTS,
    'departamento_id',
    departmentId
  );

  if (!department || !bool_(department.ativo)) {
    throw new Error('Departamento inexistente ou inativo.');
  }

  const existing = rows_(
    APP.SHEETS.CHURCH_DEPARTMENTS,
    'igreja_departamento_id'
  ).find(x =>
    String(x.igreja_id || '') === churchId &&
    String(x.departamento_id || '') === departmentId
  );

  const patch = {
    igreja_id:churchId,
    departamento_id:departmentId,
    tem_lider:bool_(input.tem_lider),
    nome_lider:bool_(input.tem_lider)
      ? String(input.nome_lider || '').trim()
      : '',
    atualizado_em:new Date()
  };

  let id;

  if (existing) {
    id = String(existing.igreja_departamento_id || '');
    updateObjectRow_(
      APP.SHEETS.CHURCH_DEPARTMENTS,
      existing._row,
      patch
    );

  } else {
    id = nextId_(
      APP.SHEETS.CHURCH_DEPARTMENTS,
      'igreja_departamento_id',
      'IGD'
    );

    patch.igreja_departamento_id = id;

    appendObject_(
      APP.SHEETS.CHURCH_DEPARTMENTS,
      patch
    );
  }

  logUser_(
    user,
    'ATUALIZAR_DEPARTAMENTO_IGREJA',
    'IGREJA_DEPARTAMENTO',
    id,
    {
      igreja_id:churchId,
      departamento_id:departmentId,
      tem_lider:patch.tem_lider,
      nome_lider:patch.nome_lider
    }
  );

  return {
    ok:true,
    igreja_departamento_id:id,
    saved:true
  };
}


/**
 * Atualização em lote dos checkboxes de departamentos.
 *
 * input.departamentos pode vir como array JSON:
 * [
 *   {departamento_id:"DEP-001",tem_lider:true,nome_lider:"..."},
 *   ...
 * ]
 */
function saveChurchDepartmentsBatch_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.MY_CHURCH);

  const churchId = String(input.igreja_id || user.igreja_id || '').trim();
  if (!churchId) throw new Error('igreja_id é obrigatório.');

  requireChurch_(user, churchId);

  let list = input.departamentos;

  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (_err) {
      throw new Error('departamentos deve ser um JSON válido.');
    }
  }

  if (!Array.isArray(list)) {
    throw new Error('departamentos deve ser uma lista.');
  }

  const activeIds = new Set(
    activeDepartments_().map(x => String(x.departamento_id || ''))
  );

  list.forEach(item => {
    const id = String(item.departamento_id || '');

    if (!activeIds.has(id)) {
      throw new Error('Departamento inválido: ' + id);
    }
  });

  const results = list.map(item =>
    saveChurchDepartment_(
      user,
      Object.assign({}, item, {igreja_id:churchId})
    )
  );

  return {
    ok:true,
    igreja_id:churchId,
    updated:results.length
  };
}


/**
 * Cadastro mestre de departamentos.
 * Exclusivo Desenvolvedor/Administrador.
 */
function saveDepartment_(user, input) {
  const role = String(user.perfil || '');

  if (role !== APP.ROLES.DEVELOPER && role !== APP.ROLES.ADMIN) {
    throw new Error('Somente Desenvolvedor ou Administrador pode alterar departamentos.');
  }

  requireModule_(user, APP.MODULE_KEYS.MY_CHURCH);

  const id = String(input.departamento_id || '').trim();
  const name = String(input.departamento || '').trim();

  if (!name) throw new Error('Nome do departamento é obrigatório.');

  const patch = {
    departamento:name,
    categoria:String(input.categoria || '').trim(),
    ordem:Number(input.ordem || 0),
    ativo:input.ativo == null ? true : bool_(input.ativo)
  };

  if (id) {
    const existing = findById_(
      APP.SHEETS.DEPARTMENTS,
      'departamento_id',
      id
    );

    if (!existing) throw new Error('Departamento não encontrado.');

    updateObjectRow_(APP.SHEETS.DEPARTMENTS, existing._row, patch);

    logUser_(
      user,
      'ATUALIZAR_DEPARTAMENTO',
      'DEPARTAMENTO',
      id,
      patch
    );

    return {ok:true,departamento_id:id,updated:true};
  }

  const newId = nextId_(
    APP.SHEETS.DEPARTMENTS,
    'departamento_id',
    'DEP'
  );

  patch.departamento_id = newId;

  appendObject_(
    APP.SHEETS.DEPARTMENTS,
    patch
  );

  logUser_(
    user,
    'CRIAR_DEPARTAMENTO',
    'DEPARTAMENTO',
    newId,
    patch
  );

  return {ok:true,departamento_id:newId,created:true};
}


/**
 * Lista cadastro mestre de departamentos.
 */
function listDepartments_(user) {
  requireModule_(user, APP.MODULE_KEYS.MY_CHURCH);

  return {
    ok:true,
    data:activeDepartments_().map(publicRow_)
  };
}
