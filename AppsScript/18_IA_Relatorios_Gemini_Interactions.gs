/**
 * PRIORIDADES DSA — IA PARA RELATÓRIOS
 * v1.6 R2 — Gemini 3.6 Flash + Interactions API
 *
 * API:
 * POST https://generativelanguage.googleapis.com/v1/interactions
 *
 * Segurança:
 * - GEMINI_API_KEY fica somente em Script Properties.
 * - A chave nunca é retornada ao frontend.
 * - store=false para não manter a interação no servidor.
 *
 * Integridade:
 * - Somente status="completed" pode ser salvo.
 * - status incomplete/failed/cancelled/budget_exceeded não é persistido.
 * - Todo texto de steps[type=model_output].content[type=text] é concatenado.
 */

const GEMINI_REPORT = Object.freeze({
  ENDPOINT: 'https://generativelanguage.googleapis.com/v1beta/interactions',
  DEFAULT_MODEL: 'gemini-3.6-flash',
  DEFAULT_MAX_OUTPUT_TOKENS: 7000,
  MAX_RETRIES: 3
});


/**
 * Configuração opcional por função.
 * Preferência: cadastrar diretamente em Propriedades do script.
 */
function configurarGemini(apiKey, model) {
  const key = String(apiKey || '').trim();
  const modelName = String(
    model || GEMINI_REPORT.DEFAULT_MODEL
  ).trim();

  if (!key) {
    throw new Error('Informe a chave da API Gemini.');
  }

  if (!modelName) {
    throw new Error('Informe o modelo Gemini.');
  }

  const props = PropertiesService.getScriptProperties();

  props.setProperty('GEMINI_API_KEY', key);
  props.setProperty('GEMINI_MODEL', modelName);

  if (!props.getProperty('GEMINI_MAX_OUTPUT_TOKENS')) {
    props.setProperty(
      'GEMINI_MAX_OUTPUT_TOKENS',
      String(GEMINI_REPORT.DEFAULT_MAX_OUTPUT_TOKENS)
    );
  }

  logSystem_(
    'CONFIGURAR_GEMINI',
    'SISTEMA',
    '',
    {
      model:modelName,
      api:'Interactions API',
      max_output_tokens:Number(
        props.getProperty('GEMINI_MAX_OUTPUT_TOKENS') ||
        GEMINI_REPORT.DEFAULT_MAX_OUTPUT_TOKENS
      )
    }
  );

  return {
    ok:true,
    provider:'Gemini',
    api:'Interactions API',
    model:modelName
  };
}


function configurarGeminiMaxOutputTokens(value) {
  const n = Number(value);

  if (!isFinite(n) || n < 1000 || n > 50000) {
    throw new Error(
      'GEMINI_MAX_OUTPUT_TOKENS deve estar entre 1000 e 50000.'
    );
  }

  PropertiesService
    .getScriptProperties()
    .setProperty(
      'GEMINI_MAX_OUTPUT_TOKENS',
      String(Math.floor(n))
    );

  return {
    ok:true,
    max_output_tokens:Math.floor(n)
  };
}


function geminiConfig_() {
  const props = PropertiesService.getScriptProperties();

  const key = String(
    props.getProperty('GEMINI_API_KEY') || ''
  ).trim();

  const model = String(
    props.getProperty('GEMINI_MODEL') ||
    GEMINI_REPORT.DEFAULT_MODEL
  ).trim();

  const maxTokens = Number(
    props.getProperty('GEMINI_MAX_OUTPUT_TOKENS') ||
    GEMINI_REPORT.DEFAULT_MAX_OUTPUT_TOKENS
  );

  if (!key) {
    throw new Error(
      'GEMINI_API_KEY não configurada. ' +
      'Cadastre-a em Configurações do projeto > Propriedades do script.'
    );
  }

  return {
    apiKey:key,
    model:model,
    maxOutputTokens:Math.max(
      1000,
      Math.floor(
        maxTokens ||
        GEMINI_REPORT.DEFAULT_MAX_OUTPUT_TOKENS
      )
    )
  };
}


/**
 * Teste rápido da integração.
 *
 * Resultado esperado:
 * ok: true
 * status: completed
 * texto: OK
 * model: gemini-3.6-flash
 */
function testarGemini() {
  const interaction = callGeminiInteraction_({
    systemInstruction:
      'Responda exatamente ao que foi solicitado, sem explicações adicionais.',
    input:'Responda somente com a palavra OK.',
    maxOutputTokens:1024,
    thinkingLevel:'minimal'
  });

  const text = extractInteractionText_(interaction).trim();

  if (String(interaction.status || '') !== 'completed') {
    throw new Error(
      'Teste Gemini não foi concluído. Status: ' +
      String(interaction.status || 'desconhecido') +
      '. Detalhes: ' +
      JSON.stringify({
        error:interaction.error || null,
        usage:interaction.usage || null
      })
    );
  }

  if (!text) {
    throw new Error(
      'A Interactions API respondeu sem texto.'
    );
  }

  return {
    ok:true,
    provider:'Gemini',
    api:'Interactions API',
    status:String(interaction.status || ''),
    model:String(interaction.model || geminiConfig_().model),
    texto:text,
    usage:interaction.usage || null
  };
}


/**
 * Geração do relatório estratégico por IA.
 */
function generateAIReport_(user, input) {
  requireModule_(user, APP.MODULE_KEYS.REPORTS);

  const context = normalizeContext_(user, input || {});

  if (!context.igreja_id) {
    throw new Error(
      'Para gerar Relatório Completo por IA, selecione uma igreja específica.'
    );
  }

  requireChurch_(user, context.igreja_id);

  // R2 — registra a tentativa antes de iniciar qualquer processamento pesado.
  logUser_(
    user,
    'GERAR_RELATORIO_IA_INICIADO',
    'RELATORIO_IA',
    '',
    {
      igreja_id:context.igreja_id,
      data_inicio:context.data_inicio,
      data_fim:context.data_fim,
      provider:'Gemini',
      api:'Interactions API'
    }
  );

  const packageData = reportDataPackage_(
    user,
    Object.assign(
      {},
      input,
      {
        igreja_id:context.igreja_id,
        data_inicio:context.data_inicio,
        data_fim:context.data_fim
      }
    )
  );

  const selectedDifficulties =
    normalizeSelectedDifficultiesGemini_(
      input.dificuldades,
      packageData.dificuldades_disponiveis || []
    );

  const prompt = buildGeminiReportPrompt_(
    packageData,
    selectedDifficulties,
    String(input.observacoes_adicionais || '')
  );

  let interaction;

  try {
    interaction = callGeminiInteraction_({
      systemInstruction:geminiReportSystemInstructions_(),
      input:prompt
    });
  } catch (error) {
    logUser_(
      user,
      'GERAR_RELATORIO_IA_ERRO',
      'RELATORIO_IA',
      '',
      {
        igreja_id:context.igreja_id,
        data_inicio:context.data_inicio,
        data_fim:context.data_fim,
        provider:'Gemini',
        api:'Interactions API',
        model:String(geminiConfig_().model || ''),
        erro:String(error && error.message ? error.message : error)
      }
    );

    throw error;
  }

  const status = String(
    interaction.status || ''
  ).toLowerCase();

  // Interactions API possui status explícito.
  // Nunca salvar qualquer resultado que não esteja completed.
  if (status !== 'completed') {
    logUser_(
      user,
      'IA_RELATORIO_INCOMPLETO',
      'RELATORIO_IA',
      '',
      {
        igreja_id:context.igreja_id,
        provider:'Gemini',
        api:'Interactions API',
        model:String(interaction.model || ''),
        status:status || 'desconhecido',
        error:interaction.error || null
      }
    );

    throw new Error(
      'O Gemini não concluiu integralmente o relatório. ' +
      'Nenhum texto parcial foi salvo. Status: ' +
      (status || 'desconhecido')
    );
  }

  const fullText = extractInteractionText_(
    interaction
  ).trim();

  if (!fullText) {
    logUser_(
      user,
      'GERAR_RELATORIO_IA_ERRO',
      'RELATORIO_IA',
      '',
      {
        igreja_id:context.igreja_id,
        provider:'Gemini',
        api:'Interactions API',
        status:status,
        erro:'Gemini concluiu a interação sem retornar texto.'
      }
    );

    throw new Error(
      'O Gemini concluiu a interação, mas não retornou texto. ' +
      'Nenhum relatório foi salvo.'
    );
  }

  const dashboard = packageData.dashboard;

  const whatsapp = buildWhatsAppSummary_(
    user,
    Object.assign(
      {},
      input,
      {
        igreja_id:context.igreja_id,
        data_inicio:context.data_inicio,
        data_fim:context.data_fim
      }
    )
  );

  const title =
    String(input.titulo || '').trim() ||
    buildDefaultGeminiReportTitle_(packageData);

  const shouldSave = input.salvar == null
    ? true
    : bool_(input.salvar);

  let saved = null;

  if (shouldSave) {
    saved = saveReport_(
      user,
      {
        igreja_id:context.igreja_id,
        data_inicio:context.data_inicio,
        data_fim:context.data_fim,
        titulo:title,
        conteudo_completo:fullText,
        resumo_whatsapp:String(
          whatsapp.texto || ''
        ),
        resultado_geral:Number(
          dashboard &&
          dashboard.geral
            ? dashboard.geral.percentual || 0
            : 0
        ),
        observacoes:String(
          input.observacoes || ''
        ),
        dificuldades:selectedDifficulties.map(
          x => ({
            dificuldade_id:x.dificuldade_id,
            observacao:x.observacao || ''
          })
        )
      }
    );
  }

  logUser_(
    user,
    'GERAR_RELATORIO_IA',
    'RELATORIO_IA',
    saved
      ? String(saved.relatorio_id || '')
      : '',
    {
      igreja_id:context.igreja_id,
      data_inicio:context.data_inicio,
      data_fim:context.data_fim,
      provider:'Gemini',
      api:'Interactions API',
      model:String(
        interaction.model ||
        geminiConfig_().model
      ),
      interaction_id:String(
        interaction.id || ''
      ),
      status:status,
      caracteres:fullText.length,
      salvo:!!saved
    }
  );

  return {
    ok:true,
    provider:'Gemini',
    api:'Interactions API',
    saved:!!saved,

    relatorio_id:saved
      ? String(saved.relatorio_id || '')
      : '',

    titulo:title,
    conteudo_completo:fullText,

    resumo_whatsapp:String(
      whatsapp.texto || ''
    ),

    resultado_geral:Number(
      dashboard &&
      dashboard.geral
        ? dashboard.geral.percentual || 0
        : 0
    ),

    dificuldades:selectedDifficulties,

    ai:{
      interaction_id:String(
        interaction.id || ''
      ),
      model:String(
        interaction.model ||
        geminiConfig_().model
      ),
      status:status,
      usage:interaction.usage || null
    }
  };
}


function normalizeSelectedDifficultiesGemini_(
  value,
  available
) {
  let list = value;

  if (list == null || list === '') {
    return [];
  }

  if (typeof list === 'string') {
    try {
      list = JSON.parse(list);
    } catch (_err) {
      list = [list];
    }
  }

  if (!Array.isArray(list)) {
    throw new Error(
      'dificuldades deve ser uma lista ou JSON válido.'
    );
  }

  const map = {};

  (available || []).forEach(d => {
    map[String(d.dificuldade_id || '')] = d;
  });

  return list.map(item => {
    const id = String(
      typeof item === 'string'
        ? item
        : item.dificuldade_id || ''
    );

    const base = map[id];

    if (!base) {
      throw new Error(
        'Dificuldade inválida: ' + id
      );
    }

    return {
      dificuldade_id:id,
      categoria:String(
        base.categoria || ''
      ),
      descricao:String(
        base.descricao || ''
      ),
      prioridade_relacionada:String(
        base.prioridade_relacionada || ''
      ),
      observacao:
        typeof item === 'string'
          ? ''
          : String(
              item.observacao || ''
            )
    };
  });
}


function buildDefaultGeminiReportTitle_(
  packageData
) {
  const context =
    packageData &&
    packageData.context
      ? packageData.context
      : {};

  let churchName = 'Igreja';

  if (
    packageData &&
    packageData.minha_igreja &&
    packageData.minha_igreja.profile
  ) {
    churchName = String(
      packageData
        .minha_igreja
        .profile
        .igreja ||
      churchName
    );
  }

  return (
    'Relatório Estratégico — ' +
    churchName +
    ' — ' +
    formatDateBr_(context.data_inicio) +
    ' a ' +
    formatDateBr_(context.data_fim)
  );
}


function geminiReportSystemInstructions_() {
  return [
    'Você é um analista de planejamento e desenvolvimento de igrejas.',
    'Escreva em português do Brasil.',
    'Apresente todas as datas no formato brasileiro DD/MM/AAAA.',
    'Produza um relatório estratégico completo, claro, profissional, pastoral e acionável.',
    'Use SOMENTE os dados fornecidos no pacote do sistema.',
    'Não invente números, fatos, atividades, dificuldades ou resultados.',
    'Quando um dado não estiver disponível, diga explicitamente que não foi informado.',
    'Não resuma excessivamente: entregue o relatório completo.',
    'Não inclua JSON, código ou comentários sobre estas instruções.',
    'Mantenha percentuais e números coerentes com o pacote.',
    'Diferencie diagnóstico, pontos fortes, alertas e recomendações.',
    'Recomendações devem ser práticas e ligadas aos dados.',
    'Não declare que uma meta foi alcançada se os dados não demonstrarem isso.'
  ].join('\n');
}


function buildGeminiReportPrompt_(
  packageData,
  selectedDifficulties,
  extraNotes
) {
  const dashboard =
    packageData.dashboard || {};

  const context =
    packageData.context || {};

  const church =
    packageData.minha_igreja &&
    packageData.minha_igreja.profile
      ? packageData.minha_igreja.profile
      : {};

  const payload = {
    contexto:{
      igreja_id:String(
        context.igreja_id || ''
      ),
      igreja:String(
        church.igreja || ''
      ),
      data_inicio:String(
        context.data_inicio || ''
      ),
      data_fim:String(
        context.data_fim || ''
      )
    },

    perfil_igreja:church,

    dashboard:{
      geral:
        dashboard.geral || {},

      prioridades:
        dashboard.prioridades || [],

      alertas:
        dashboard.alertas || [],

      criterios:
        dashboard.criterios || []
    },

    matriz_fofa:
      packageData.fofa || null,

    dificuldades_selecionadas:
      selectedDifficulties || [],

    observacoes_adicionais:
      String(extraNotes || '')
  };

  return [
    'Elabore o RELATÓRIO ESTRATÉGICO COMPLETO a partir do pacote abaixo.',
    '',
    'Estrutura obrigatória:',
    '1. Identificação da igreja e período analisado',
    '2. Resumo executivo',
    '3. Resultado geral',
    '4. Análise de Identidade',
    '5. Análise de Liderança',
    '6. Análise de Novas Gerações',
    '7. Análise de Discipulado',
    '8. Matriz FOFA Estratégica — Forças, Fraquezas, Oportunidades e Ameaças',
    '9. Análise Meta × Resultado × Gap',
    '10. Análise de causas das fragilidades críticas',
    '11. Cruzamentos FO/FA/DO/DA quando houver dados FOFA suficientes',
    '12. Priorização estratégica considerando Impacto × Urgência × Governabilidade × Alinhamento',
    '13. Principais dificuldades selecionadas',
    '14. Prioridades para os próximos 90 dias',
    '15. Plano de ação e indicadores de monitoramento',
    '16. Recomendações estratégicas práticas',
    '17. Conclusão',
    '',
    'Para cada prioridade, mencione percentuais, requisitos fortes e requisitos em alerta quando existirem.',
    'As recomendações devem estar vinculadas aos dados e não a suposições.',
    'Não omita seções por falta de dados; informe que não há informação suficiente quando necessário.',
    '',
    'PACOTE DE DADOS:',
    JSON.stringify(payload)
  ].join('\n');
}


/**
 * Cliente REST da Gemini Interactions API.
 *
 * Request:
 * {
 *   model,
 *   input,
 *   system_instruction,
 *   store:false,
 *   generation_config:{
 *     max_output_tokens,
 *     thinking_level:"low",
 *     thinking_summaries:"none"
 *   }
 * }
 */
function callGeminiInteraction_(options) {
  options = options || {};

  const config = geminiConfig_();

  const body = {
    model:config.model,

    input:String(
      options.input || ''
    ),

    store:false,

    generation_config:{
      max_output_tokens:Number(
        options.maxOutputTokens ||
        config.maxOutputTokens
      ),

      // Relatórios precisam de análise,
      // mas priorizamos espaço para o texto final.
      thinking_level:String(
        options.thinkingLevel || 'low'
      ),

      thinking_summaries:'none'
    }
  };

  const systemInstruction = String(
    options.systemInstruction || ''
  ).trim();

  if (systemInstruction) {
    body.system_instruction =
      systemInstruction;
  }

  const requestOptions = {
    method:'post',

    contentType:
      'application/json',

    headers:{
      'x-goog-api-key':
        config.apiKey
    },

    payload:
      JSON.stringify(body),

    muteHttpExceptions:true,

    followRedirects:true
  };

  let lastError = null;

  for (
    let attempt = 1;
    attempt <= GEMINI_REPORT.MAX_RETRIES;
    attempt++
  ) {
    const response =
      UrlFetchApp.fetch(
        GEMINI_REPORT.ENDPOINT,
        requestOptions
      );

    const code =
      response.getResponseCode();

    const raw =
      response.getContentText();

    let parsed = null;

    try {
      parsed = JSON.parse(raw);
    } catch (_err) {}

    if (
      code >= 200 &&
      code < 300
    ) {
      if (!parsed) {
        throw new Error(
          'Resposta inválida da Gemini Interactions API.'
        );
      }

      return parsed;
    }

    const message =
      parsed &&
      parsed.error &&
      parsed.error.message
        ? parsed.error.message
        : raw.slice(0, 1000);

    lastError = new Error(
      'Gemini Interactions API HTTP ' +
      code +
      ': ' +
      message
    );

    if (
      attempt < GEMINI_REPORT.MAX_RETRIES &&
      (
        code === 408 ||
        code === 409 ||
        code === 429 ||
        code >= 500
      )
    ) {
      Utilities.sleep(
        Math.min(
          8000,
          1000 *
          Math.pow(
            2,
            attempt - 1
          )
        )
      );

      continue;
    }

    break;
  }

  throw (
    lastError ||
    new Error(
      'Falha desconhecida na Gemini Interactions API.'
    )
  );
}


/**
 * Novo schema da Interactions API:
 *
 * steps: [
 *   {
 *     type: "model_output",
 *     content: [
 *       {type:"text", text:"..."}
 *     ]
 *   }
 * ]
 *
 * Concatena TODOS os blocos text de TODOS os steps model_output.
 */
function extractInteractionText_(
  interaction
) {
  const steps =
    interaction &&
    Array.isArray(interaction.steps)
      ? interaction.steps
      : [];

  const parts = [];

  steps.forEach(step => {
    if (
      !step ||
      String(step.type || '') !==
        'model_output'
    ) {
      return;
    }

    const content =
      Array.isArray(step.content)
        ? step.content
        : [];

    content.forEach(item => {
      if (
        item &&
        String(item.type || '') ===
          'text' &&
        typeof item.text ===
          'string'
      ) {
        parts.push(
          item.text
        );
      }
    });
  });

  // Compatibilidade defensiva caso
  // a API venha a expor output_text agregado.
  if (
    !parts.length &&
    typeof interaction.output_text ===
      'string'
  ) {
    parts.push(
      interaction.output_text
    );
  }

  return parts
    .join('\n')
    .trim();
}
