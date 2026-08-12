/**
 * RELATÓRIOS + DIFICULDADES + HISTÓRICO + EDIÇÃO + WHATSAPP
 *
 * A IA ainda NÃO é chamada nesta fase.
 * Esta camada cria a estrutura estável sobre a qual a IA será integrada depois.
 */

function activeDifficulties_() {
  return rows_(APP.SHEETS.DIFFICULTIES, 'dificuldade_id')
    .filter(x => bool_(x.ativo))
    .sort((a,b) => Number(a.ordem || 0) - Number(b.ordem || 0))
    .map(x => publicRow_(x));
}


function reportById_(reportId) {
  return findById_(
    APP.SHEETS.REPORTS,
    'relatorio_id',
    reportId
  );
}


function reportDifficulties_(reportId) {
  const selected = rows_(
    APP.SHEETS.REPORT_DIFFICULTIES,
    'relatorio_dificuldade_id'
  )
    .filter(x => String(x.relatorio_id || '') === String(reportId || ''))
    .filter(x => bool_(x.marcado));

  const difficultyMap = {};
  activeDifficulties_().forEach(d => {
    difficultyMap[String(d.dificuldade_id || '')] = d;
  });

  return selected.map(x => {
    const d = difficultyMap[String(x.dificuldade_id || '')] || {};

    return {
      relatorio_dificuldade_id:String(x.relatorio_dificuldade_id || ''),
      dificuldade_id:String(x.dificuldade_id || ''),
      categoria:String(d.categoria || ''),
      descricao:String(d.descricao || ''),
      prioridade_relacionada:String(d.prioridade_relacionada || ''),
      observacao:String(x.observacao || '')
    };
  });
}


function reportPublic_(row, churchIndex) {
  const church = churchIndex[String(row.igreja_id || '')] || {};

  return {
    relatorio_id:String(row.relatorio_id || ''),
    igreja_id:String(row.igreja_id || ''),
    igreja:String(church.igreja || ''),
    distrito_id:String(church.distrito_id || ''),

    data_inicio:serializeDateOnly_(row.data_inicio),
    data_fim:serializeDateOnly_(row.data_fim),
    ano_referencia:Number(row.ano_referencia || 0),

    titulo:String(row.titulo || ''),
    conteudo_completo:String(row.conteudo_completo || ''),
    resumo_whatsapp:String(row.resumo_whatsapp || ''),
    resultado_geral:Number(row.resultado_geral || 0),

    gerado_em:serializeValue_(row.gerado_em),
    gerado_por:String(row.gerado_por || ''),
    editado_em:serializeValue_(row.editado_em),
    editado_por:String(row.editado_por || ''),

    status:String(row.status || ''),
    versao:Number(row.versao || 1),
    observacoes:String(row.observacoes || '')
  };
}


function reportChurchIndex_(user) {
  const index = {};
  territoryScope_(user).igrejas.forEach(x => {
    index[String(x.igreja_id || '')] = x;
  });
  return index;
}


/**
 * Histórico de relatórios.
 * Sempre limitado ao escopo territorial.
 */
function listReports_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.REPORTS);

  const context = normalizeContext_(user, input || {});
  const churches = contextualChurches_(user, context);
  const churchIds = new Set(churches.map(x => String(x.igreja_id || '')));
  const churchIndex = reportChurchIndex_(user);

  let data = rows_(APP.SHEETS.REPORTS, 'relatorio_id')
    .filter(x => churchIds.has(String(x.igreja_id || '')))
    .filter(x => String(x.status || '') !== 'Arquivado');

  // Histórico pode ser filtrado pelo período do próprio relatório.
  if (bool_(input.filtrar_periodo)) {
    data = data.filter(x => {
      const start = parseDateOnly_(x.data_inicio);
      const end = parseDateOnly_(x.data_fim);

      if (!start || !end) return false;

      return (
        start.getTime() <= context._period.fim.getTime() &&
        end.getTime() >= context._period.inicio.getTime()
      );
    });
  }

  data.sort((a,b) => {
    const da = a.gerado_em instanceof Date ? a.gerado_em.getTime() : 0;
    const db = b.gerado_em instanceof Date ? b.gerado_em.getTime() : 0;
    return db - da;
  });

  return {
    ok:true,
    context:{
      igreja_id:context.igreja_id,
      data_inicio:context.data_inicio,
      data_fim:context.data_fim
    },
    data:data.map(x => {
      const item = reportPublic_(x, churchIndex);
      item.dificuldades = reportDifficulties_(item.relatorio_id);
      return item;
    })
  };
}


function getReport_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.REPORTS);

  const id = String(input.relatorio_id || '').trim();
  if (!id) throw new Error('relatorio_id é obrigatório.');

  const row = reportById_(id);
  if (!row) throw new Error('Relatório não encontrado.');

  requireChurch_(user, String(row.igreja_id || ''));

  const result = reportPublic_(
    row,
    reportChurchIndex_(user)
  );

  result.dificuldades = reportDifficulties_(id);

  return {
    ok:true,
    data:result
  };
}


/**
 * Salva relatório completo.
 *
 * Pode criar relatório manual ou salvar conteúdo posteriormente gerado por IA.
 * conteudo_completo nunca é truncado deliberadamente.
 */
function saveReport_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.REPORTS);

  const id = String(input.relatorio_id || '').trim();
  const churchId = String(input.igreja_id || '').trim();

  if (!churchId) throw new Error('igreja_id é obrigatório.');

  requireChurch_(user, churchId);

  const period = resolvePeriod_(input);

  const title = String(input.titulo || '').trim();
  const content = String(input.conteudo_completo || '');

  if (!title) throw new Error('Título do relatório é obrigatório.');

  const previous = id ? reportById_(id) : null;

  if (id && !previous) {
    throw new Error('Relatório não encontrado.');
  }

  if (previous) {
    requireChurch_(user, String(previous.igreja_id || ''));

    if (String(previous.igreja_id || '') !== churchId) {
      throw new Error('Não é permitido transferir um relatório para outra igreja.');
    }
  }

  const yearReference = period.inicio.getFullYear() === period.fim.getFullYear()
    ? period.inicio.getFullYear()
    : 0;

  const patch = {
    igreja_id:churchId,
    data_inicio:period.inicio,
    data_fim:period.fim,
    ano_referencia:yearReference,

    titulo:title,
    conteudo_completo:content,
    resumo_whatsapp:String(input.resumo_whatsapp || ''),
    resultado_geral:Number(input.resultado_geral || 0),

    status:String(input.status || 'Gerado'),
    observacoes:String(input.observacoes || '')
  };

  let reportId;

  if (previous) {
    reportId = id;

    patch.editado_em = new Date();
    patch.editado_por = String(user.usuario_id || '');
    patch.versao = Math.max(1, Number(previous.versao || 1)) + 1;

    updateObjectRow_(
      APP.SHEETS.REPORTS,
      previous._row,
      patch
    );

    logUser_(
      user,
      'EDITAR_RELATORIO',
      'RELATORIO',
      reportId,
      {
        igreja_id:churchId,
        versao:patch.versao,
        data_inicio:period.data_inicio,
        data_fim:period.data_fim
      }
    );

  } else {
    reportId = nextId_(
      APP.SHEETS.REPORTS,
      'relatorio_id',
      'REL'
    );

    patch.relatorio_id = reportId;
    patch.gerado_em = new Date();
    patch.gerado_por = String(user.usuario_id || '');
    patch.editado_em = '';
    patch.editado_por = '';
    patch.versao = 1;

    appendObject_(
      APP.SHEETS.REPORTS,
      patch
    );

    logUser_(
      user,
      'CRIAR_RELATORIO',
      'RELATORIO',
      reportId,
      {
        igreja_id:churchId,
        data_inicio:period.data_inicio,
        data_fim:period.data_fim
      }
    );
  }

  if (input.dificuldades != null) {
    saveReportDifficulties_(user, {
      relatorio_id:reportId,
      dificuldades:input.dificuldades
    });
  }

  return {
    ok:true,
    relatorio_id:reportId,
    version:patch.versao,
    created:!previous,
    updated:!!previous
  };
}


/**
 * Dificuldades selecionadas em um relatório.
 * Faz sincronização: marcadas permanecem; desmarcadas viram marcado=false.
 */
function saveReportDifficulties_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.REPORTS);

  const reportId = String(input.relatorio_id || '').trim();
  if (!reportId) throw new Error('relatorio_id é obrigatório.');

  const report = reportById_(reportId);
  if (!report) throw new Error('Relatório não encontrado.');

  requireChurch_(user, String(report.igreja_id || ''));

  let list = input.dificuldades;

  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (_err) {
      throw new Error('dificuldades deve ser JSON válido.');
    }
  }

  if (!Array.isArray(list)) {
    throw new Error('dificuldades deve ser uma lista.');
  }

  const activeIds = new Set(
    activeDifficulties_().map(x => String(x.dificuldade_id || ''))
  );

  const incoming = {};

  list.forEach(item => {
    const id = String(
      typeof item === 'string'
        ? item
        : item.dificuldade_id || ''
    );

    if (!activeIds.has(id)) {
      throw new Error('Dificuldade inválida: ' + id);
    }

    incoming[id] = {
      observacao: typeof item === 'string'
        ? ''
        : String(item.observacao || '')
    };
  });

  const existing = rows_(
    APP.SHEETS.REPORT_DIFFICULTIES,
    'relatorio_dificuldade_id'
  ).filter(x => String(x.relatorio_id || '') === reportId);

  const existingMap = {};
  existing.forEach(x => {
    existingMap[String(x.dificuldade_id || '')] = x;
  });

  // Atualiza existentes.
  existing.forEach(row => {
    const diffId = String(row.dificuldade_id || '');
    const selected = Object.prototype.hasOwnProperty.call(incoming, diffId);

    updateObjectRow_(
      APP.SHEETS.REPORT_DIFFICULTIES,
      row._row,
      {
        marcado:selected,
        observacao:selected ? incoming[diffId].observacao : ''
      }
    );
  });

  // Cria novos.
  Object.keys(incoming).forEach(diffId => {
    if (existingMap[diffId]) return;

    const id = nextId_(
      APP.SHEETS.REPORT_DIFFICULTIES,
      'relatorio_dificuldade_id',
      'RDI'
    );

    appendObject_(
      APP.SHEETS.REPORT_DIFFICULTIES,
      {
        relatorio_dificuldade_id:id,
        relatorio_id:reportId,
        dificuldade_id:diffId,
        observacao:incoming[diffId].observacao,
        marcado:true
      }
    );
  });

  logUser_(
    user,
    'ATUALIZAR_DIFICULDADES_RELATORIO',
    'RELATORIO',
    reportId,
    {quantidade:Object.keys(incoming).length}
  );

  return {
    ok:true,
    relatorio_id:reportId,
    quantidade:Object.keys(incoming).length
  };
}


/**
 * Cadastro mestre de dificuldades.
 * Somente Desenvolvedor/Admin.
 */
function saveDifficulty_(user, input) {
  const role = String(user.perfil || '');

  if (role !== APP.ROLES.DEVELOPER && role !== APP.ROLES.ADMIN) {
    throw new Error('Somente Desenvolvedor ou Administrador pode alterar dificuldades.');
  }

  requireModule_(user, APP.MODULE_KEYS.REPORTS);

  const id = String(input.dificuldade_id || '').trim();
  const description = String(input.descricao || '').trim();

  if (!description) throw new Error('Descrição da dificuldade é obrigatória.');

  const patch = {
    categoria:String(input.categoria || '').trim(),
    descricao:description,
    prioridade_relacionada:String(input.prioridade_relacionada || '').trim(),
    ordem:Number(input.ordem || 0),
    ativo:input.ativo == null ? true : bool_(input.ativo)
  };

  if (id) {
    const existing = findById_(
      APP.SHEETS.DIFFICULTIES,
      'dificuldade_id',
      id
    );

    if (!existing) throw new Error('Dificuldade não encontrada.');

    updateObjectRow_(APP.SHEETS.DIFFICULTIES, existing._row, patch);

    logUser_(
      user,
      'ATUALIZAR_DIFICULDADE',
      'DIFICULDADE',
      id,
      patch
    );

    return {ok:true,dificuldade_id:id,updated:true};
  }

  const newId = nextId_(
    APP.SHEETS.DIFFICULTIES,
    'dificuldade_id',
    'DIF'
  );

  patch.dificuldade_id = newId;

  appendObject_(
    APP.SHEETS.DIFFICULTIES,
    patch
  );

  logUser_(
    user,
    'CRIAR_DIFICULDADE',
    'DIFICULDADE',
    newId,
    patch
  );

  return {ok:true,dificuldade_id:newId,created:true};
}


/**
 * Arquivamento exige reautenticação.
 * Mantém histórico, não apaga fisicamente.
 */
function archiveReport_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.REPORTS);
  requireReauth_(user, input.reauth_token);

  const id = String(input.relatorio_id || '').trim();
  const report = reportById_(id);

  if (!report) throw new Error('Relatório não encontrado.');

  requireChurch_(user, String(report.igreja_id || ''));

  updateObjectRow_(
    APP.SHEETS.REPORTS,
    report._row,
    {
      status:'Arquivado',
      editado_em:new Date(),
      editado_por:String(user.usuario_id || '')
    }
  );

  logUser_(
    user,
    'ARQUIVAR_RELATORIO',
    'RELATORIO',
    id,
    {igreja_id:String(report.igreja_id || '')}
  );

  return {ok:true,relatorio_id:id,archived:true};
}


/**
 * Cria resumo padrão para WhatsApp a partir do Dashboard.
 * Pode ser salvo junto ao relatório ou usado diretamente pelo frontend.
 */
function buildWhatsAppSummary_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.REPORTS);

  const dashboard = dashboard_(user, input);
  const context = dashboard.context;

  const scope = territoryScope_(user);

  let churchName = 'Todas as Igrejas';

  if (context.igreja_id) {
    const church = scope.igrejas.find(
      x => String(x.igreja_id || '') === String(context.igreja_id)
    );

    if (church) churchName = String(church.igreja || churchName);
  }

  const lines = [];

  lines.push('*Prioridades Estratégicas*');
  lines.push('');
  lines.push(`*${churchName}*`);
  lines.push(`${formatDateBr_(context.data_inicio)} a ${formatDateBr_(context.data_fim)}`);
  lines.push('');

  (dashboard.prioridades || []).forEach(item => {
    lines.push(
      `*${item.prioridade}:* ${formatPercentBr_(item.percentual)}`
    );
  });

  lines.push('');
  lines.push(
    `*Resultado geral:* ${formatPercentBr_(dashboard.geral.percentual)}`
  );

  const alerts = dashboard.alertas || [];

  if (alerts.length) {
    lines.push('');
    lines.push('*ALERTA — Pendências Prioritárias*');

    alerts.forEach(alert => {
      lines.push(
        `• ${alert.titulo} — ${formatPercentBr_(alert.percentual)}`
      );
    });
  }

  return {
    ok:true,
    texto:lines.join('\n'),
    dashboard:dashboard
  };
}


function formatPercentBr_(value) {
  return Number(value || 0)
    .toFixed(1)
    .replace('.', ',') + '%';
}


/**
 * Pacote de dados para futura geração por IA.
 * Não chama IA ainda.
 */
function reportDataPackage_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.REPORTS);

  const context = normalizeContext_(user, input || {});
  const dashboard = dashboard_(user, input);
  const myChurch = context.igreja_id
    ? getMyChurch_(user, {igreja_id:context.igreja_id})
    : null;

  const results = listResults_(user, input);

  return {
    ok:true,
    context:dashboard.context,
    dashboard:dashboard,
    resultados:results.data || [],
    minha_igreja:myChurch && myChurch.ok ? myChurch : null,
    fofa: context.igreja_id ? latestFofaForChurch_(user, context.igreja_id) : null,
    dificuldades_disponiveis:activeDifficulties_()
  };
}
