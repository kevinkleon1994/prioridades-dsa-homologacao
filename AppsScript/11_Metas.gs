/**
 * METAS
 *
 * Regra:
 * - REQUISITOS.meta_padrao = meta padrão do requisito.
 * - METAS_IGREJAS pode sobrescrever a meta por igreja e ano.
 * - Se não houver meta específica, usa meta_padrao.
 */

function activeRequirements_() {
  return rows_(APP.SHEETS.REQUIREMENTS, 'requisito_id')
    .filter(x => bool_(x.ativo))
    .sort((a, b) => {
      const pa = String(a.prioridade || '');
      const pb = String(b.prioridade || '');
      if (pa !== pb) return pa.localeCompare(pb, 'pt-BR');
      return Number(a.ordem || 0) - Number(b.ordem || 0);
    });
}


function churchGoalsForYear_(churchIds, year) {
  const ids = new Set((churchIds || []).map(String));
  const targetYear = Number(year);

  return rows_(APP.SHEETS.CHURCH_GOALS, 'meta_id')
    .filter(x => bool_(x.ativo))
    .filter(x => ids.has(String(x.igreja_id || '')))
    .filter(x => Number(x.ano || 0) === targetYear);
}


function goalForRequirementChurchYear_(requirement, churchId, year, goalsIndex) {
  const key = [
    String(churchId || ''),
    String(requirement.requisito_id || ''),
    Number(year)
  ].join('|');

  const specific = goalsIndex[key];

  if (specific && specific.meta !== '' && specific.meta != null) {
    return Number(specific.meta || 0);
  }

  return Number(requirement.meta_padrao || 0);
}


function buildGoalsIndex_(goals) {
  const index = {};

  (goals || []).forEach(x => {
    const key = [
      String(x.igreja_id || ''),
      String(x.requisito_id || ''),
      Number(x.ano || 0)
    ].join('|');

    index[key] = x;
  });

  return index;
}


/**
 * Retorna a meta efetiva de cada requisito por igreja/ano.
 */
function effectiveGoals_(user, context) {
  const churches = contextualChurches_(user, context);
  const requirements = activeRequirements_();
  const years = yearsInPeriod_(context._period);

  const churchIds = churches.map(x => String(x.igreja_id || ''));

  const goals = rows_(APP.SHEETS.CHURCH_GOALS, 'meta_id')
    .filter(x => bool_(x.ativo))
    .filter(x => churchIds.includes(String(x.igreja_id || '')))
    .filter(x => years.includes(Number(x.ano || 0)));

  const goalsIndex = buildGoalsIndex_(goals);

  const result = [];

  churches.forEach(church => {
    years.forEach(year => {
      requirements.forEach(req => {
        result.push({
          igreja_id: String(church.igreja_id || ''),
          igreja: String(church.igreja || ''),
          distrito_id: String(church.distrito_id || ''),
          requisito_id: String(req.requisito_id || ''),
          codigo: String(req.codigo || ''),
          prioridade: String(req.prioridade || ''),
          titulo: String(req.titulo || ''),
          ano: Number(year),
          meta: goalForRequirementChurchYear_(
            req,
            church.igreja_id,
            year,
            goalsIndex
          )
        });
      });
    });
  });

  return result;
}


/**
 * Salva/atualiza meta específica de uma igreja para um requisito/ano.
 *
 * Requer acesso ao módulo requisitos.
 * Administrador/Desenvolvedor podem configurar qualquer igreja de seu escopo.
 * Pastor/Coordenador também ficam limitados ao escopo territorial.
 */
function saveChurchGoal_(user, input) {
  requireRequirementAdmin_(user);

  const churchId = String(input.igreja_id || '').trim();
  const requirementId = String(input.requisito_id || '').trim();
  const year = Number(input.ano);
  const meta = Number(input.meta);

  if (!churchId) throw new Error('igreja_id é obrigatório.');
  if (!requirementId) throw new Error('requisito_id é obrigatório.');
  if (!year || year < 2000 || year > 2100) throw new Error('Ano inválido.');
  if (!isFinite(meta) || meta < 0) throw new Error('Meta inválida.');

  requireChurch_(user, churchId);

  const req = findById_(APP.SHEETS.REQUIREMENTS, 'requisito_id', requirementId);
  if (!req || !bool_(req.ativo)) {
    throw new Error('Requisito não encontrado ou inativo.');
  }

  const existing = rows_(APP.SHEETS.CHURCH_GOALS, 'meta_id')
    .find(x =>
      String(x.igreja_id || '') === churchId &&
      String(x.requisito_id || '') === requirementId &&
      Number(x.ano || 0) === year
    );

  if (existing) {
    updateObjectRow_(APP.SHEETS.CHURCH_GOALS, existing._row, {
      meta: meta,
      ativo: true
    });

    logUser_(
      user,
      'ATUALIZAR_META_IGREJA',
      'META_IGREJA',
      String(existing.meta_id || ''),
      {igreja_id:churchId,requisito_id:requirementId,ano:year,meta:meta}
    );

    return {ok:true, meta_id:String(existing.meta_id || ''), updated:true};
  }

  const id = nextId_(APP.SHEETS.CHURCH_GOALS, 'meta_id', 'META');

  appendObject_(APP.SHEETS.CHURCH_GOALS, {
    meta_id: id,
    igreja_id: churchId,
    requisito_id: requirementId,
    ano: year,
    meta: meta,
    ativo: true
  });

  logUser_(
    user,
    'CRIAR_META_IGREJA',
    'META_IGREJA',
    id,
    {igreja_id:churchId,requisito_id:requirementId,ano:year,meta:meta}
  );

  return {ok:true, meta_id:id, created:true};
}
