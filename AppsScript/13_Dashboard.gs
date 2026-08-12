/**
 * DASHBOARD
 *
 * Consolidação baseada em:
 * - território autorizado;
 * - contexto selecionado;
 * - data_realizacao dentro do período;
 * - meta efetiva da igreja/requisito/ano.
 */

function percent_(reached, goal) {
  reached = Number(reached || 0);
  goal = Number(goal || 0);

  if (goal <= 0) return 0;

  return Math.max(
    0,
    Math.min(100, (reached / goal) * 100)
  );
}


function statusFromPercent_(pct) {
  const value = Number(pct || 0);

  if (value >= 80) return 'Concluído';
  if (value >= 60) return 'Em andamento';
  return 'Atenção';
}


/**
 * Agrega resultados e metas no mesmo nível:
 * igreja + requisito + ano.
 */
function dashboardMatrix_(user, context) {
  const churches = contextualChurches_(user, context);
  const churchMap = {};
  churches.forEach(x => churchMap[String(x.igreja_id || '')] = x);

  const requirements = activeRequirements_();
  const reqMap = {};
  requirements.forEach(x => reqMap[String(x.requisito_id || '')] = x);

  const goals = effectiveGoals_(user, context);
  const goalMap = {};

  goals.forEach(x => {
    const key = [
      String(x.igreja_id || ''),
      String(x.requisito_id || ''),
      Number(x.ano || 0)
    ].join('|');

    goalMap[key] = x;
  });

  const reachedMap = {};

  filteredResults_(user, context).forEach(result => {
    const date = parseDateOnly_(result.data_realizacao);
    if (!date) return;

    const year = date.getFullYear();

    const key = [
      String(result.igreja_id || ''),
      String(result.requisito_id || ''),
      year
    ].join('|');

    reachedMap[key] = Number(reachedMap[key] || 0) +
                      Number(result.alcancado || 0);
  });

  return Object.keys(goalMap).map(key => {
    const goalRow = goalMap[key];
    const reached = Number(reachedMap[key] || 0);
    const goal = Number(goalRow.meta || 0);
    const pct = percent_(reached, goal);

    return {
      igreja_id:String(goalRow.igreja_id || ''),
      igreja:String(goalRow.igreja || ''),
      distrito_id:String(goalRow.distrito_id || ''),
      requisito_id:String(goalRow.requisito_id || ''),
      codigo:String(goalRow.codigo || ''),
      prioridade:String(goalRow.prioridade || ''),
      titulo:String(goalRow.titulo || ''),
      ano:Number(goalRow.ano || 0),
      meta:goal,
      alcancado:reached,
      percentual:pct,
      status:statusFromPercent_(pct)
    };
  });
}


function summarizeByPriority_(matrix) {
  const order = [
    'Identidade',
    'Liderança',
    'Novas Gerações',
    'Discipulado'
  ];

  const grouped = {};

  order.forEach(name => {
    grouped[name] = {
      prioridade:name,
      meta:0,
      alcancado:0,
      percentual:0,
      criterios:0,
      alertas:0
    };
  });

  (matrix || []).forEach(row => {
    const name = String(row.prioridade || '');
    if (!grouped[name]) {
      grouped[name] = {
        prioridade:name,
        meta:0,
        alcancado:0,
        percentual:0,
        criterios:0,
        alertas:0
      };
    }

    grouped[name].meta += Number(row.meta || 0);
    grouped[name].alcancado += Number(row.alcancado || 0);
    grouped[name].criterios += 1;

    if (String(row.status || '') === 'Atenção') {
      grouped[name].alertas += 1;
    }
  });

  return Object.keys(grouped)
    .map(name => {
      const item = grouped[name];
      item.percentual = percent_(
        item.alcancado,
        item.meta
      );
      item.status = statusFromPercent_(item.percentual);
      return item;
    })
    .sort((a, b) => {
      const ia = order.indexOf(a.prioridade);
      const ib = order.indexOf(b.prioridade);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    });
}


function dashboardAlerts_(matrix) {
  return (matrix || [])
    .filter(row => String(row.status || '') === 'Atenção')
    .sort((a, b) => Number(a.percentual || 0) - Number(b.percentual || 0))
    .slice(0, 20)
    .map(row => ({
      igreja_id:row.igreja_id,
      igreja:row.igreja,
      prioridade:row.prioridade,
      requisito_id:row.requisito_id,
      codigo:row.codigo,
      titulo:row.titulo,
      percentual:Number(row.percentual || 0)
    }));
}


function dashboardRanking_(matrix) {
  const grouped = {};

  (matrix || []).forEach(row => {
    const id = String(row.igreja_id || '');

    if (!grouped[id]) {
      grouped[id] = {
        igreja_id:id,
        igreja:String(row.igreja || ''),
        meta:0,
        alcancado:0
      };
    }

    grouped[id].meta += Number(row.meta || 0);
    grouped[id].alcancado += Number(row.alcancado || 0);
  });

  return Object.values(grouped)
    .map(item => {
      item.percentual = percent_(item.alcancado, item.meta);
      return item;
    })
    .sort((a, b) => Number(b.percentual || 0) - Number(a.percentual || 0))
    .map((item, index) => Object.assign(
      {posicao:index + 1},
      item
    ));
}


function dashboardRankingChurches_(user, context) {
  const role = String(user.perfil || '');
  const base = territoryBase_();

  // Liderança local: ranking deve exibir todas as igrejas do distrito
  // da igreja do usuário, mesmo que o filtro de igreja seja fixo.
  if (role === APP.ROLES.ELDER || role === APP.ROLES.SECRETARY) {
    const assigned = base.igrejas.find(
      x => String(x.igreja_id || '') === String(user.igreja_id || '')
    );
    const districtId = String(assigned?.distrito_id || '');
    return base.igrejas.filter(
      x => String(x.distrito_id || '') === districtId
    );
  }

  return contextualChurches_(user, context);
}


function dashboardRankingMatrix_(user, context) {
  const churches = dashboardRankingChurches_(user, context);
  const churchIds = new Set(churches.map(x => String(x.igreja_id || '')));
  const requirements = activeRequirements_();
  const years = yearsInPeriod_(context._period);

  const goals = rows_(APP.SHEETS.CHURCH_GOALS, 'meta_id')
    .filter(x => bool_(x.ativo))
    .filter(x => churchIds.has(String(x.igreja_id || '')))
    .filter(x => years.includes(Number(x.ano || 0)));

  const goalsIndex = buildGoalsIndex_(goals);
  const reached = {};

  rows_(APP.SHEETS.RESULTS, 'resultado_id')
    .filter(x => churchIds.has(String(x.igreja_id || '')))
    .filter(x => dateInPeriod_(x.data_realizacao, context._period))
    .forEach(row => {
      const date = parseDateOnly_(row.data_realizacao);
      if (!date) return;
      const year = Number(Utilities.formatDate(date, appTimeZone_(), 'yyyy'));
      const key = [
        String(row.igreja_id || ''),
        String(row.requisito_id || ''),
        year
      ].join('|');
      reached[key] = Number(reached[key] || 0) + Number(row.alcancado || 0);
    });

  const churchIndex = {};
  churches.forEach(church => churchIndex[String(church.igreja_id || '')] = church);

  const rowsOut = [];
  churches.forEach(church => {
    years.forEach(year => {
      requirements.forEach(req => {
        const key = [String(church.igreja_id || ''), String(req.requisito_id || ''), year].join('|');
        rowsOut.push({
          igreja_id:String(church.igreja_id || ''),
          igreja:String(church.igreja || ''),
          distrito_id:String(church.distrito_id || ''),
          requisito_id:String(req.requisito_id || ''),
          meta:goalForRequirementChurchYear_(req, church.igreja_id, year, goalsIndex),
          alcancado:Number(reached[key] || 0)
        });
      });
    });
  });

  return rowsOut;
}


function dashboardRankingFlexible_(user, context, requestedLevel) {
  const role = String(user.perfil || '');
  const base = territoryBase_();
  const matrix = dashboardRankingMatrix_(user, context);

  let level = String(requestedLevel || 'igrejas').toLowerCase();

  if (role === APP.ROLES.POLE_COORDINATOR) {
    if (!['igrejas','distritos'].includes(level)) level = 'igrejas';
  } else if (
    role === APP.ROLES.DISTRICT_PASTOR ||
    role === APP.ROLES.ELDER ||
    role === APP.ROLES.SECRETARY
  ) {
    level = 'igrejas';
  } else if (role === APP.ROLES.DEVELOPER || role === APP.ROLES.ADMIN) {
    if (!['igrejas','polos','distritos'].includes(level)) level = 'igrejas';
  } else {
    level = 'igrejas';
  }

  const districtIndex = {};
  base.distritos.forEach(x => districtIndex[String(x.distrito_id || '')] = x);
  const poleIndex = {};
  base.polos.forEach(x => poleIndex[String(x.polo_id || '')] = x);

  const grouped = {};

  matrix.forEach(row => {
    const district = districtIndex[String(row.distrito_id || '')] || {};
    let id, label;

    if (level === 'polos') {
      id = String(district.polo_id || '');
      label = String(poleIndex[id]?.polo || 'Polo não informado');
    } else if (level === 'distritos') {
      id = String(row.distrito_id || '');
      label = String(district.distrito || 'Distrito não informado');
    } else {
      id = String(row.igreja_id || '');
      label = String(row.igreja || 'Igreja não informada');
    }

    if (!grouped[id]) grouped[id] = {id:id,nome:label,meta:0,alcancado:0};
    grouped[id].meta += Number(row.meta || 0);
    grouped[id].alcancado += Number(row.alcancado || 0);
  });

  return Object.values(grouped)
    .map(item => {
      item.percentual = percent_(item.alcancado, item.meta);
      return item;
    })
    .sort((a,b) => Number(b.percentual || 0) - Number(a.percentual || 0))
    .map((item,index) => ({
      posicao:index+1,
      nivel:level,
      entidade_id:item.id,
      nome:item.nome,
      meta:item.meta,
      alcancado:item.alcancado,
      percentual:item.percentual
    }));
}


function dashboard_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.DASHBOARD);

  const context = normalizeContext_(user, input);
  const matrix = dashboardMatrix_(user, context);

  const totalGoal = matrix.reduce(
    (sum, x) => sum + Number(x.meta || 0),
    0
  );

  const totalReached = matrix.reduce(
    (sum, x) => sum + Number(x.alcancado || 0),
    0
  );

  const overall = percent_(totalReached, totalGoal);

  return {
    ok:true,

    context:{
      polo_id:context.polo_id,
      distrito_id:context.distrito_id,
      igreja_id:context.igreja_id,
      data_inicio:context.data_inicio,
      data_fim:context.data_fim
    },

    geral:{
      meta:totalGoal,
      alcancado:totalReached,
      percentual:overall,
      status:statusFromPercent_(overall)
    },

    prioridades:summarizeByPriority_(matrix),
    alertas:dashboardAlerts_(matrix),
    ranking:dashboardRankingFlexible_(user, context, input?.ranking_nivel),
    ranking_nivel:String(input?.ranking_nivel || 'igrejas'),

    criterios:matrix
  };
}
