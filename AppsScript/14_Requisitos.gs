/**
 * REQUISITOS + METAS GLOBAIS/ESPECÍFICAS
 *
 * REQUISITOS.meta_padrao = padrão global.
 * METAS_IGREJAS = exceção por igreja + requisito + ano.
 * "Todas" altera a meta padrão global; uma igreja altera somente sua exceção.
 */

function listRequirements_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.REQUIREMENTS);
  const context = normalizeContext_(user, input || {});
  const requirements = activeRequirements_();
  const churchId = String(context.igreja_id || '');
  const years = yearsInPeriod_(context._period);

  let effective = {};
  if (churchId) {
    const goals = effectiveGoals_(user, context);
    goals.forEach(g => {
      effective[String(g.requisito_id)+'|'+Number(g.ano)] = Number(g.meta || 0);
    });
  }

  return {
    ok:true,
    context:{
      igreja_id:churchId,
      data_inicio:context.data_inicio,
      data_fim:context.data_fim
    },
    years:years,
    data:requirements.map(r => ({
      requisito_id:String(r.requisito_id || ''),
      codigo:String(r.codigo || ''),
      prioridade:String(r.prioridade || ''),
      titulo:String(r.titulo || ''),
      direcionamento:String(r.direcionamento || ''),
      pergunta:String(r.pergunta || ''),
      meta_padrao:Number(r.meta_padrao || 0),
      ordem:Number(r.ordem || 0),
      ativo:bool_(r.ativo),
      metas_efetivas: churchId ? years.map(year => ({
        ano:year,
        meta: effective[String(r.requisito_id)+'|'+year] != null
          ? effective[String(r.requisito_id)+'|'+year]
          : Number(r.meta_padrao || 0)
      })) : []
    }))
  };
}

function requireRequirementAdmin_(user) {
  const role=String(user.perfil || '');
  if (role !== APP.ROLES.DEVELOPER && role !== APP.ROLES.ADMIN) {
    throw new Error('Somente Desenvolvedor ou Administrador pode alterar o cadastro mestre de requisitos.');
  }
  requireModule_(user, APP.MODULE_KEYS.REQUIREMENTS);
}

function saveRequirement_(user, input) {
  requireRequirementAdmin_(user);

  const id=String(input.requisito_id || '').trim();
  const title=String(input.titulo || '').trim();
  const priority=String(input.prioridade || '').trim();
  const defaultGoal=Number(input.meta_padrao);

  if (!title) throw new Error('Título do requisito é obrigatório.');
  if (!['Identidade','Liderança','Novas Gerações','Discipulado'].includes(priority))
    throw new Error('Prioridade inválida.');
  if (!isFinite(defaultGoal) || defaultGoal < 0) throw new Error('Meta padrão inválida.');

  const patch={
    codigo:String(input.codigo || '').trim(),
    prioridade:priority,
    titulo:title,
    direcionamento:String(input.direcionamento || ''),
    pergunta:String(input.pergunta || ''),
    meta_padrao:defaultGoal,
    ordem:Number(input.ordem || 0),
    ativo: input.ativo == null ? true : bool_(input.ativo)
  };

  if (id) {
    const existing=findById_(APP.SHEETS.REQUIREMENTS,'requisito_id',id);
    if (!existing) throw new Error('Requisito não encontrado.');
    updateObjectRow_(APP.SHEETS.REQUIREMENTS,existing._row,patch);
    logUser_(user,'ATUALIZAR_REQUISITO','REQUISITO',id,patch);
    return {ok:true,requisito_id:id,updated:true};
  }

  const newId=nextId_(APP.SHEETS.REQUIREMENTS,'requisito_id','REQ');
  patch.requisito_id=newId;
  appendObject_(APP.SHEETS.REQUIREMENTS,patch);
  logUser_(user,'CRIAR_REQUISITO','REQUISITO',newId,patch);
  return {ok:true,requisito_id:newId,created:true};
}

/**
 * Altera meta padrão global ("Todas").
 * Não apaga exceções já existentes em METAS_IGREJAS.
 */
function saveGlobalGoal_(user,input) {
  requireRequirementAdmin_(user);
  const id=String(input.requisito_id || '').trim();
  const meta=Number(input.meta);
  if (!id) throw new Error('requisito_id é obrigatório.');
  if (!isFinite(meta) || meta < 0) throw new Error('Meta inválida.');

  const req=findById_(APP.SHEETS.REQUIREMENTS,'requisito_id',id);
  if (!req) throw new Error('Requisito não encontrado.');

  updateObjectRow_(APP.SHEETS.REQUIREMENTS,req._row,{meta_padrao:meta});
  logUser_(user,'ATUALIZAR_META_GLOBAL','REQUISITO',id,{meta_padrao:meta});
  return {ok:true,requisito_id:id,meta_padrao:meta};
}

/**
 * Remove a exceção de uma igreja/ano, fazendo-a herdar novamente a meta global.
 */
function resetChurchGoal_(user,input) {
  requireModule_(user, APP.MODULE_KEYS.REQUIREMENTS);
  const churchId=String(input.igreja_id || '').trim();
  const reqId=String(input.requisito_id || '').trim();
  const year=Number(input.ano);
  requireChurch_(user,churchId);

  const row=rows_(APP.SHEETS.CHURCH_GOALS,'meta_id').find(x =>
    String(x.igreja_id || '')===churchId &&
    String(x.requisito_id || '')===reqId &&
    Number(x.ano || 0)===year &&
    bool_(x.ativo)
  );

  if (!row) return {ok:true,reset:false};

  updateObjectRow_(APP.SHEETS.CHURCH_GOALS,row._row,{ativo:false});
  logUser_(user,'REMOVER_EXCECAO_META','META_IGREJA',String(row.meta_id || ''),{
    igreja_id:churchId,requisito_id:reqId,ano:year
  });
  return {ok:true,reset:true,meta_id:String(row.meta_id || '')};
}

function requirementGoalView_(user,input) {
  requireModule_(user, APP.MODULE_KEYS.REQUIREMENTS);
  const context=normalizeContext_(user,input || {});
  const churches=contextualChurches_(user,context);
  const requirements=activeRequirements_();
  const years=yearsInPeriod_(context._period);
  const effective=effectiveGoals_(user,context);

  return {
    ok:true,
    context:{
      polo_id:context.polo_id,
      distrito_id:context.distrito_id,
      igreja_id:context.igreja_id,
      data_inicio:context.data_inicio,
      data_fim:context.data_fim
    },
    requirements:requirements.map(r => publicRow_(r)),
    churches:churches,
    years:years,
    effective_goals:effective
  };
}
