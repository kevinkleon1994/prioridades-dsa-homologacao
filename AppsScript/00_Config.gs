/**
 * PRIORIDADES ESTRATÉGICAS | DSA
 * Apps Script definitivo — Fundação v1.0
 * Base de dados: Planilha-Mestre v1.2
 *
 * Não depende de V5/V8/V10 nem de qualquer arquivo histórico.
 */

const APP = Object.freeze({
  NAME: 'Prioridades Estratégicas | DSA',
  FIELD: 'Missão Oeste do Pará',
  VERSION: '2.1',
  DB_VERSION: '1.3',
  TIME_ZONE: 'America/Sao_Paulo',
  DATE_FORMAT: 'dd/MM/yyyy',
  DATETIME_FORMAT: 'dd/MM/yyyy HH:mm:ss',

  SESSION_SECONDS: 2 * 60 * 60,
  REAUTH_SECONDS: 5 * 60,
  CACHE_SECONDS: 5 * 60,

  SHEETS: Object.freeze({
    CONFIG: 'CONFIGURACOES',
    POLES: 'POLOS',
    DISTRICTS: 'DISTRITOS',
    CHURCHES: 'IGREJAS',
    USERS: 'USUARIOS',

    MODULES: 'MODULOS',
    PROFILE_MODULES: 'PERFIL_MODULOS',
    USER_MODULES: 'USUARIO_MODULOS',

    REQUIREMENTS: 'REQUISITOS',
    CHURCH_GOALS: 'METAS_IGREJAS',
    RESULTS: 'RESULTADOS',

    MEMBERS: 'MEMBROS',
    CHURCH_PROFILE: 'PERFIL_IGREJA',
    DEPARTMENTS: 'DEPARTAMENTOS',
    CHURCH_DEPARTMENTS: 'IGREJA_DEPARTAMENTOS',

    PLANNER: 'PLANNER',

    REPORTS: 'RELATORIOS',
    DIFFICULTIES: 'DIFICULDADES',
    REPORT_DIFFICULTIES: 'RELATORIO_DIFICULDADES',

    FOFA_ITEMS: 'FOFA_ITENS',
    FOFA_EVALUATIONS: 'FOFA_AVALIACOES',
    FOFA_RESPONSES: 'FOFA_RESPOSTAS',
    FOFA_CROSSES: 'FOFA_CRUZAMENTOS',
    FOFA_PRIORITIZATION: 'FOFA_PRIORIZACAO',
    FOFA_ACTION_PLANS: 'FOFA_PLANOS_ACAO',

    LOG: 'LOG',
    DATA_DICTIONARY: 'DICIONARIO_DADOS',
    TEMPORAL_ARCHITECTURE: 'ARQUITETURA_TEMPORAL'
  }),

  ROLES: Object.freeze({
    DEVELOPER: 'Desenvolvedor',
    ADMIN: 'Administrador',
    POLE_COORDINATOR: 'Coordenador do Polo',
    DISTRICT_PASTOR: 'Pastor Distrital',
    ELDER: 'Ancião(ã)',
    SECRETARY: 'Secretário(a)'
  }),

  MODULE_KEYS: Object.freeze({
    DASHBOARD: 'dashboard',
    PRIORITIES: 'prioridades',
    PLANNER: 'planner',
    TIMELINE: 'linha_tempo',
    REPORTS: 'relatorios',
    REQUIREMENTS: 'requisitos',
    MY_CHURCH: 'minha_igreja',
    DEVELOPER: 'desenvolvedor'
  })
});


const REQUIRED_SCHEMA = Object.freeze({
  CONFIGURACOES: ['chave','valor','descricao'],
  POLOS: ['polo_id','polo','coordenador_usuario_id','ativo'],
  DISTRITOS: ['distrito_id','distrito','polo_id','pastor_usuario_id','ativo'],
  IGREJAS: ['igreja_id','igreja','distrito_id','ativo'],
  USUARIOS: ['usuario_id','nome','login','senha_hash','perfil','polo_id','distrito_id','igreja_id','ativo','foto_url','modulos_legado'],

  MODULOS: ['modulo_id','modulo','titulo','icone','ordem','ativo'],
  PERFIL_MODULOS: ['perfil_modulo_id','perfil','modulo_id','permitido'],
  USUARIO_MODULOS: ['usuario_modulo_id','usuario_id','modulo_id','permitido','observacao'],

  REQUISITOS: ['requisito_id','codigo','prioridade','titulo','direcionamento','pergunta','meta_padrao','ordem','ativo'],
  METAS_IGREJAS: ['meta_id','igreja_id','requisito_id','ano','meta','ativo'],
  RESULTADOS: ['resultado_id','igreja_id','requisito_id','data_realizacao','ano','mes_num','mes','trimestre','semestre','alcancado','plano_acao','responsavel','data_inicial','voto','material','atualizado_em','atualizado_por'],

  MEMBROS: ['registro_id','igreja_id','ano','mes','frequentes','nao_frequentes','a_transferir','a_resgatar','total','atualizado_em','atualizado_por'],
  PERFIL_IGREJA: ['igreja_id','quantidade_anciaos','quantidade_familias','quantidade_uapgs','primeiro_anciao_diretor','contato_primeiro_anciao_diretor','endereco','email','observacoes','oficiais_departamentos_legado','atualizado_em','atualizado_por'],
  DEPARTAMENTOS: ['departamento_id','departamento','categoria','ordem','ativo'],
  IGREJA_DEPARTAMENTOS: ['igreja_departamento_id','igreja_id','departamento_id','tem_lider','nome_lider','atualizado_em'],

  PLANNER: ['tarefa_id','igreja_id','requisito_id','prioridade','titulo','responsavel','prazo','data_conclusao','status','ordem','observacao','ativo','criado_em','criado_por','excluido_em','excluido_por'],

  RELATORIOS: ['relatorio_id','igreja_id','data_inicio','data_fim','ano_referencia','titulo','conteudo_completo','resumo_whatsapp','resultado_geral','gerado_em','gerado_por','editado_em','editado_por','status','versao','observacoes'],
  DIFICULDADES: ['dificuldade_id','categoria','descricao','prioridade_relacionada','ordem','ativo'],
  RELATORIO_DIFICULDADES: ['relatorio_dificuldade_id','relatorio_id','dificuldade_id','observacao','marcado'],

  FOFA_ITENS: ['fofa_item_id','eixo','tipo_fofa','ambiente','fator','pergunta_orientadora','objetivo_estrategico','meta_relacionada','impacto_padrao','urgencia_padrao','governabilidade_padrao','alinhamento_padrao','ordem','ativo'],
  FOFA_AVALIACOES: ['avaliacao_id','igreja_id','ano','tipo_ciclo','status','data_inicio','data_conclusao','indice_diagnostico_identidade','indice_diagnostico_lideranca','indice_diagnostico_novas_geracoes','indice_diagnostico_discipulado','indice_diagnostico_geral','indice_meta','indice_execucao','classificacao','criado_por','criado_em','concluido_por','concluido_em'],
  FOFA_RESPOSTAS: ['resposta_id','avaliacao_id','fofa_item_id','igreja_id','eixo','tipo_fofa','fator','nota','evidencia','fonte_evidencia','observacao','impacto','urgencia','governabilidade','alinhamento','indice_prioridade','classificacao','meta_relacionada','resultado_atual','meta','gap','avaliado_por','avaliado_em'],
  FOFA_CRUZAMENTOS: ['cruzamento_id','avaliacao_id','igreja_id','eixo','tipo_cruzamento','fator_1_id','fator_1','fator_2_id','fator_2','analise','estrategia_proposta','gerado_por_ia','validado','validado_por','gerado_em','validado_em'],
  FOFA_PRIORIZACAO: ['priorizacao_id','avaliacao_id','igreja_id','eixo','origem_tipo','origem_id','questao','impacto','urgencia','governabilidade','alinhamento','pontuacao','classificacao','ranking','selecionada','observacao','priorizado_por','priorizado_em'],
  FOFA_PLANOS_ACAO: ['plano_id','avaliacao_id','priorizacao_id','igreja_id','eixo','problema_oportunidade','evidencia','meta_mopa','objetivo','meta_local','acao','responsavel','equipe','data_inicial','data_final','material_necessario','recursos_financeiros','voto_comissao','indicador','resultado_inicial','meta_monitoramento','resultado_atual','percentual_execucao','planner_tarefa_id','status','criado_por','criado_em','atualizado_em'],

  LOG: ['data_hora','usuario_id','acao','entidade','registro_id','detalhes','ip_sessao'],
  DICIONARIO_DADOS: ['aba','campo','tipo sugerido','obrigatorio','descricao'],
  ARQUITETURA_TEMPORAL: ['modo_filtro','exemplo','data_inicio','data_fim','regra','uso']
});
