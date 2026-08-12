/**
 * PLANNER + LINHA DO TEMPO
 *
 * Fonte única de dados: aba PLANNER.
 * Não existe tabela separada para Linha do Tempo.
 *
 * Cada tarefa pertence obrigatoriamente a uma igreja.
 * Exclusão é lógica: ativo=false + excluido_em/excluido_por.
 */

function plannerStatuses_() {
  return ['Não iniciado','Em andamento','Concluído','Cancelado'];
}


function plannerRowPublic_(row, requirementIndex, churchIndex, districtIndex) {
  const req = requirementIndex[String(row.requisito_id || '')] || {};
  const church = churchIndex[String(row.igreja_id || '')] || {};
  const district = (districtIndex || {})[String(church.distrito_id || '')] || {};

  return {
    tarefa_id:String(row.tarefa_id || ''),
    igreja_id:String(row.igreja_id || ''),
    igreja:String(church.igreja || ''),
    distrito_id:String(church.distrito_id || ''),
    distrito:String(district.distrito || ''),
    requisito_id:String(row.requisito_id || ''),
    requisito_codigo:String(req.codigo || ''),
    requisito_titulo:String(req.titulo || ''),
    prioridade:String(row.prioridade || req.prioridade || ''),
    titulo:String(row.titulo || ''),
    responsavel:String(row.responsavel || ''),
    prazo:serializeDateOnly_(row.prazo),
    data_conclusao:serializeDateOnly_(row.data_conclusao),
    status:String(row.status || ''),
    ordem:Number(row.ordem || 0),
    observacao:String(row.observacao || ''),
    ativo:bool_(row.ativo),
    criado_em:serializeValue_(row.criado_em),
    criado_por:String(row.criado_por || ''),
    excluido_em:serializeValue_(row.excluido_em),
    excluido_por:String(row.excluido_por || '')
  };
}


function plannerChurchIndex_(user) {
  const index = {};
  territoryScope_(user).igrejas.forEach(church => {
    index[String(church.igreja_id || '')] = church;
  });
  return index;
}


function plannerDistrictIndex_(user) {
  const index = {};
  territoryScope_(user).distritos.forEach(district => {
    index[String(district.distrito_id || '')] = district;
  });
  return index;
}


function plannerRequirementIndex_() {
  const index = {};
  activeRequirements_().forEach(req => {
    index[String(req.requisito_id || '')] = req;
  });
  return index;
}


/**
 * Lista tarefas dentro do contexto territorial.
 *
 * Filtros opcionais:
 * status
 * prioridade
 * requisito_id
 * somente_pendentes=true
 * somente_concluidos=true
 *
 * O período temporal no Planner é aplicado sobre PRAZO.
 * Na Linha do Tempo, o período pode ser aplicado sobre data_conclusao ou prazo,
 * conforme modo_timeline.
 */
function listPlanner_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.PLANNER);

  const context = normalizeContext_(user, input || {});
  const churches = contextualChurches_(user, context);
  const churchIds = new Set(churches.map(x => String(x.igreja_id || '')));

  const requirementIndex = plannerRequirementIndex_();
  const churchIndex = plannerChurchIndex_(user);
  const districtIndex = plannerDistrictIndex_(user);

  let rows = rows_(APP.SHEETS.PLANNER, 'tarefa_id')
    .filter(x => bool_(x.ativo))
    .filter(x => churchIds.has(String(x.igreja_id || '')));

  const status = String(input.status || '').trim();
  const priority = String(input.prioridade || '').trim();
  const requirementId = String(input.requisito_id || '').trim();

  if (status) {
    rows = rows.filter(x => String(x.status || '') === status);
  }

  if (priority) {
    rows = rows.filter(x => String(x.prioridade || '') === priority);
  }

  if (requirementId) {
    rows = rows.filter(x => String(x.requisito_id || '') === requirementId);
  }

  if (bool_(input.somente_pendentes)) {
    rows = rows.filter(x =>
      String(x.status || '') !== 'Concluído' &&
      String(x.status || '') !== 'Cancelado'
    );
  }

  if (bool_(input.somente_concluidos)) {
    rows = rows.filter(x =>
      String(x.status || '') === 'Concluído'
    );
  }

  // Para o Planner, só filtra por prazo quando solicitado explicitamente.
  if (bool_(input.filtrar_periodo)) {
    rows = rows.filter(x =>
      x.prazo && dateInPeriod_(x.prazo, context._period)
    );
  }

  rows.sort((a,b) => {
    const sa = plannerStatusOrder_(a.status);
    const sb = plannerStatusOrder_(b.status);
    if (sa !== sb) return sa - sb;

    const oa = Number(a.ordem || 0);
    const ob = Number(b.ordem || 0);
    if (oa !== ob) return oa - ob;

    const da = parseDateOnly_(a.prazo);
    const db = parseDateOnly_(b.prazo);

    if (da && db) return da.getTime() - db.getTime();
    if (da) return -1;
    if (db) return 1;
    return String(a.titulo || '').localeCompare(String(b.titulo || ''), 'pt-BR');
  });

  return {
    ok:true,
    context:{
      polo_id:context.polo_id,
      distrito_id:context.distrito_id,
      igreja_id:context.igreja_id,
      data_inicio:context.data_inicio,
      data_fim:context.data_fim
    },
    data:rows.map(x => plannerRowPublic_(x, requirementIndex, churchIndex, districtIndex))
  };
}


function plannerStatusOrder_(status) {
  const order = {
    'Em andamento':1,
    'Não iniciado':2,
    'Concluído':3,
    'Cancelado':4
  };
  return order[String(status || '')] || 99;
}


/**
 * Cria ou atualiza tarefa.
 * Igreja é obrigatória.
 */
function savePlannerTask_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.PLANNER);

  const id = String(input.tarefa_id || '').trim();
  const churchId = String(input.igreja_id || '').trim();
  const requirementId = String(input.requisito_id || '').trim();
  const title = String(input.titulo || '').trim();
  const status = String(input.status || 'Não iniciado').trim();

  if (!churchId) throw new Error('igreja_id é obrigatório.');
  if (!title) throw new Error('Título da tarefa é obrigatório.');
  if (!plannerStatuses_().includes(status)) {
    throw new Error('Status inválido.');
  }

  requireChurch_(user, churchId);

  let requirement = null;
  if (requirementId) {
    requirement = findById_(
      APP.SHEETS.REQUIREMENTS,
      'requisito_id',
      requirementId
    );

    if (!requirement || !bool_(requirement.ativo)) {
      throw new Error('Requisito não encontrado ou inativo.');
    }
  }

  const previous = id
    ? findById_(APP.SHEETS.PLANNER, 'tarefa_id', id)
    : null;

  if (id && !previous) {
    throw new Error('Tarefa não encontrada.');
  }

  if (previous) {
    // Segurança:
    // o usuário precisa ter acesso tanto à igreja de origem
    // quanto à igreja de destino.
    requireChurch_(user, String(previous.igreja_id || ''));

    // A igreja de destino já foi validada por requireChurch_(user, churchId)
    // acima. Portanto, a R7 permite transferência dentro do escopo
    // territorial autorizado do usuário.
  }

  const now = new Date();

  let completionDate = parseDateOnly_(input.data_conclusao);

  if (status === 'Concluído' && !completionDate) {
    // Se acabou de concluir e não informou data, usa hoje.
    if (!previous || String(previous.status || '') !== 'Concluído') {
      completionDate = new Date();
    } else {
      completionDate = parseDateOnly_(previous.data_conclusao);
    }
  }

  if (status !== 'Concluído') {
    completionDate = '';
  }

  const patch = {
    igreja_id:churchId,
    requisito_id:requirementId,
    prioridade:String(
      input.prioridade ||
      (requirement ? requirement.prioridade : '') ||
      ''
    ),
    titulo:title,
    responsavel:String(input.responsavel || ''),
    prazo:parseDateOnly_(input.prazo) || '',
    data_conclusao:completionDate || '',
    status:status,
    ordem:Number(input.ordem || 0),
    observacao:String(input.observacao || ''),
    ativo:true
  };

  if (previous) {
    updateObjectRow_(APP.SHEETS.PLANNER, previous._row, patch);

    logUser_(
      user,
      'ATUALIZAR_TAREFA_PLANNER',
      'PLANNER',
      id,
      {
        igreja_id:churchId,
        igreja_origem_id:String(previous.igreja_id || ''),
        igreja_destino_id:churchId,
        transferida:String(previous.igreja_id || '') !== churchId,
        status:status,
        titulo:title
      }
    );

    return {ok:true,tarefa_id:id,updated:true};
  }

  const newId = nextId_(
    APP.SHEETS.PLANNER,
    'tarefa_id',
    'TAR'
  );

  patch.tarefa_id = newId;
  patch.criado_em = now;
  patch.criado_por = String(user.usuario_id || '');
  patch.excluido_em = '';
  patch.excluido_por = '';

  appendObject_(APP.SHEETS.PLANNER, patch);

  logUser_(
    user,
    'CRIAR_TAREFA_PLANNER',
    'PLANNER',
    newId,
    {
      igreja_id:churchId,
      status:status,
      titulo:title
    }
  );

  return {ok:true,tarefa_id:newId,created:true};
}


/**
 * Exclusão lógica protegida por reautenticação.
 */
function deletePlannerTask_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.PLANNER);
  requireReauth_(user, input.reauth_token);

  const id = String(input.tarefa_id || '').trim();
  if (!id) throw new Error('tarefa_id é obrigatório.');

  const task = findById_(APP.SHEETS.PLANNER, 'tarefa_id', id);
  if (!task || !bool_(task.ativo)) {
    throw new Error('Tarefa não encontrada ou já excluída.');
  }

  requireChurch_(user, String(task.igreja_id || ''));

  updateObjectRow_(APP.SHEETS.PLANNER, task._row, {
    ativo:false,
    excluido_em:new Date(),
    excluido_por:String(user.usuario_id || '')
  });

  logUser_(
    user,
    'EXCLUIR_TAREFA_PLANNER',
    'PLANNER',
    id,
    {
      igreja_id:String(task.igreja_id || ''),
      titulo:String(task.titulo || '')
    }
  );

  return {ok:true,tarefa_id:id,deleted:true};
}


/**
 * Restauração de uma tarefa excluída.
 * Exclusiva do Desenvolvedor/Admin e exige reautenticação.
 */
function restorePlannerTask_(user, input) {
  const role = String(user.perfil || '');

  if (role !== APP.ROLES.DEVELOPER && role !== APP.ROLES.ADMIN) {
    throw new Error('Somente Desenvolvedor ou Administrador pode restaurar tarefa excluída.');
  }

  requireModule_(user, APP.MODULE_KEYS.PLANNER);
  requireReauth_(user, input.reauth_token);

  const id = String(input.tarefa_id || '').trim();
  const task = findById_(APP.SHEETS.PLANNER, 'tarefa_id', id);

  if (!task) throw new Error('Tarefa não encontrada.');

  requireChurch_(user, String(task.igreja_id || ''));

  updateObjectRow_(APP.SHEETS.PLANNER, task._row, {
    ativo:true,
    excluido_em:'',
    excluido_por:''
  });

  logUser_(
    user,
    'RESTAURAR_TAREFA_PLANNER',
    'PLANNER',
    id,
    {igreja_id:String(task.igreja_id || '')}
  );

  return {ok:true,tarefa_id:id,restored:true};
}


/**
 * LINHA DO TEMPO
 *
 * Derivada do Planner.
 * Por padrão usa data_conclusao para itens concluídos e prazo para itens abertos.
 *
 * modo_timeline:
 * - conclusao: somente concluídos, usa data_conclusao
 * - prazo: todos com prazo, usa prazo
 * - combinado: concluídos=data_conclusao; demais=prazo
 */
function timeline_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.TIMELINE);

  const context = normalizeContext_(user, input || {});
  const churches = contextualChurches_(user, context);
  const churchIds = new Set(churches.map(x => String(x.igreja_id || '')));

  const requirementIndex = plannerRequirementIndex_();
  const churchIndex = plannerChurchIndex_(user);
  const districtIndex = plannerDistrictIndex_(user);

  const mode = String(input.modo_timeline || 'combinado').trim();

  let tasks = rows_(APP.SHEETS.PLANNER, 'tarefa_id')
    .filter(x => bool_(x.ativo))
    .filter(x => churchIds.has(String(x.igreja_id || '')));

  const items = [];

  tasks.forEach(task => {
    let eventDate = null;
    let eventType = '';

    if (mode === 'conclusao') {
      if (String(task.status || '') !== 'Concluído') return;
      eventDate = parseDateOnly_(task.data_conclusao);
      eventType = 'Conclusão';

    } else if (mode === 'prazo') {
      eventDate = parseDateOnly_(task.prazo);
      eventType = 'Prazo';

    } else {
      if (String(task.status || '') === 'Concluído' && task.data_conclusao) {
        eventDate = parseDateOnly_(task.data_conclusao);
        eventType = 'Conclusão';
      } else {
        eventDate = parseDateOnly_(task.prazo);
        eventType = 'Prazo';
      }
    }

    if (!eventDate) return;
    if (!dateInPeriod_(eventDate, context._period)) return;

    const row = plannerRowPublic_(task, requirementIndex, churchIndex, districtIndex);

    row.evento_data = isoDate_(eventDate);
    row.evento_tipo = eventType;

    items.push(row);
  });

  items.sort((a,b) => {
    const da = parseDateOnly_(a.evento_data);
    const db = parseDateOnly_(b.evento_data);

    const desc = norm_(input.ordem_timeline) === 'desc';

    return desc
      ? db.getTime() - da.getTime()
      : da.getTime() - db.getTime();
  });

  return {
    ok:true,
    mode:mode,
    context:{
      polo_id:context.polo_id,
      distrito_id:context.distrito_id,
      igreja_id:context.igreja_id,
      data_inicio:context.data_inicio,
      data_fim:context.data_fim
    },
    data:items
  };
}


/**
 * Indicadores leves para cards do Planner.
 */
function plannerSummary_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.PLANNER);

  const result = listPlanner_(user, Object.assign({}, input || {}, {
    filtrar_periodo:false
  }));

  const data = result.data || [];

  const summary = {
    total:data.length,
    nao_iniciado:0,
    em_andamento:0,
    concluido:0,
    cancelado:0,
    atrasado:0
  };

  const today = parseDateOnly_(new Date());

  data.forEach(task => {
    if (task.status === 'Não iniciado') summary.nao_iniciado++;
    if (task.status === 'Em andamento') summary.em_andamento++;
    if (task.status === 'Concluído') summary.concluido++;
    if (task.status === 'Cancelado') summary.cancelado++;

    const due = parseDateOnly_(task.prazo);

    if (
      due &&
      due.getTime() < today.getTime() &&
      task.status !== 'Concluído' &&
      task.status !== 'Cancelado'
    ) {
      summary.atrasado++;
    }
  });

  return {
    ok:true,
    summary:summary
  };
}
