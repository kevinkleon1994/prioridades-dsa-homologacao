/**
 * RESULTADOS
 *
 * data_realizacao é a única fonte temporal oficial.
 */

function yearsInPeriod_(period) {
  const start = period.inicio.getFullYear();
  const end = period.fim.getFullYear();
  const years = [];

  for (let year = start; year <= end; year++) years.push(year);

  return years;
}


function contextualChurches_(user, context) {
  const scope = territoryScope_(user);

  let churches = scope.igrejas.slice();

  if (context.igreja_id) {
    churches = churches.filter(
      x => String(x.igreja_id || '') === String(context.igreja_id)
    );

  } else if (context.distrito_id) {
    churches = churches.filter(
      x => String(x.distrito_id || '') === String(context.distrito_id)
    );

  } else if (context.polo_id) {
    const districtIds = new Set(
      scope.distritos
        .filter(x => String(x.polo_id || '') === String(context.polo_id))
        .map(x => String(x.distrito_id || ''))
    );

    churches = churches.filter(
      x => districtIds.has(String(x.distrito_id || ''))
    );
  }

  return churches;
}


function filteredResults_(user, context) {
  const churches = contextualChurches_(user, context);
  const churchIds = new Set(
    churches.map(x => String(x.igreja_id || ''))
  );

  return rows_(APP.SHEETS.RESULTS, 'resultado_id')
    .filter(x => churchIds.has(String(x.igreja_id || '')))
    .filter(x => dateInPeriod_(x.data_realizacao, context._period));
}


function requirementIndex_() {
  const index = {};

  activeRequirements_().forEach(req => {
    index[String(req.requisito_id || '')] = req;
  });

  return index;
}


/**
 * Cria ou atualiza um resultado.
 *
 * Um resultado é identificado por:
 * igreja + requisito + data_realizacao.
 *
 * Não usa ano/mês digitados manualmente: a planilha deriva esses campos.
 */
function saveResult_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.PRIORITIES);

  const churchId = String(input.igreja_id || '').trim();
  const requirementId = String(input.requisito_id || '').trim();
  const date = parseDateOnly_(input.data_realizacao);
  const reached = Number(input.alcancado);

  if (!churchId) throw new Error('igreja_id é obrigatório.');
  if (!requirementId) throw new Error('requisito_id é obrigatório.');
  if (!date) throw new Error('data_realizacao inválida.');
  if (!isFinite(reached) || reached < 0) {
    throw new Error('alcancado deve ser um número igual ou maior que zero.');
  }

  requireChurch_(user, churchId);

  const req = findById_(
    APP.SHEETS.REQUIREMENTS,
    'requisito_id',
    requirementId
  );

  if (!req || !bool_(req.ativo)) {
    throw new Error('Requisito inexistente ou inativo.');
  }

  const iso = isoDate_(date);

  const existing = rows_(APP.SHEETS.RESULTS, 'resultado_id')
    .find(x =>
      String(x.igreja_id || '') === churchId &&
      String(x.requisito_id || '') === requirementId &&
      isoDate_(parseDateOnly_(x.data_realizacao)) === iso
    );

  const patch = {
    igreja_id: churchId,
    requisito_id: requirementId,
    data_realizacao: date,
    alcancado: reached,
    plano_acao: String(input.plano_acao || ''),
    responsavel: String(input.responsavel || ''),
    data_inicial: parseDateOnly_(input.data_inicial) || '',
    voto: String(input.voto || ''),
    material: String(input.material || ''),
    atualizado_em: new Date(),
    atualizado_por: String(user.usuario_id || '')
  };

  if (existing) {
    updateObjectRow_(
      APP.SHEETS.RESULTS,
      existing._row,
      patch
    );
    SpreadsheetApp.flush();

    const resultMap = columnMap_(APP.SHEETS.RESULTS);
    const persistedId = String(
      sheet_(APP.SHEETS.RESULTS)
        .getRange(existing._row, resultMap.resultado_id)
        .getDisplayValue() || ''
    ).trim();

    if (persistedId !== String(existing.resultado_id || '')) {
      throw new Error('Falha ao confirmar a atualização em RESULTADOS.');
    }

    logUser_(
      user,
      'ATUALIZAR_RESULTADO',
      'RESULTADO',
      String(existing.resultado_id || ''),
      {
        igreja_id: churchId,
        requisito_id: requirementId,
        data_realizacao: iso,
        alcancado: reached
      }
    );

    return {
      ok:true,
      resultado_id:String(existing.resultado_id || ''),
      updated:true
    };
  }

  const id = nextId_(
    APP.SHEETS.RESULTS,
    'resultado_id',
    'RES'
  );

  patch.resultado_id = id;

  const writtenRow = appendObject_(APP.SHEETS.RESULTS, patch);
  SpreadsheetApp.flush();

  const resultMap = columnMap_(APP.SHEETS.RESULTS);
  const persistedId = String(
    sheet_(APP.SHEETS.RESULTS)
      .getRange(writtenRow, resultMap.resultado_id)
      .getDisplayValue() || ''
  ).trim();

  if (persistedId !== id) {
    throw new Error('Falha ao confirmar a gravação em RESULTADOS.');
  }

  logUser_(
    user,
    'CRIAR_RESULTADO',
    'RESULTADO',
    id,
    {
      igreja_id: churchId,
      requisito_id: requirementId,
      data_realizacao: iso,
      alcancado: reached
    }
  );

  return {
    ok:true,
    resultado_id:id,
    created:true
  };
}


/**
 * Retorna resultados detalhados no contexto solicitado.
 */
function listResults_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.PRIORITIES);

  const context = normalizeContext_(user, input);
  const reqIndex = requirementIndex_();

  const data = filteredResults_(user, context)
    .map(row => {
      const req = reqIndex[String(row.requisito_id || '')] || {};

      return {
        resultado_id:String(row.resultado_id || ''),
        igreja_id:String(row.igreja_id || ''),
        requisito_id:String(row.requisito_id || ''),
        codigo:String(req.codigo || ''),
        prioridade:String(req.prioridade || ''),
        titulo:String(req.titulo || ''),
        data_realizacao:serializeDateOnly_(row.data_realizacao),
        ano:Number(row.ano || 0),
        mes_num:Number(row.mes_num || 0),
        mes:String(row.mes || ''),
        trimestre:String(row.trimestre || ''),
        semestre:String(row.semestre || ''),
        alcancado:Number(row.alcancado || 0),
        plano_acao:String(row.plano_acao || ''),
        responsavel:String(row.responsavel || ''),
        data_inicial:serializeDateOnly_(row.data_inicial),
        voto:String(row.voto || ''),
        material:String(row.material || ''),
        atualizado_em:serializeValue_(row.atualizado_em),
        atualizado_por:String(row.atualizado_por || '')
      };
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
    data:data
  };
}
