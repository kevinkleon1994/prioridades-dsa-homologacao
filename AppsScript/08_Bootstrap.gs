/**
 * Bootstrap leve — v1.11 R7
 *
 * Objetivo:
 * retornar somente identidade, módulos e escopo territorial.
 *
 * Dashboard e demais módulos pesados NÃO são calculados aqui.
 * Eles são carregados separadamente pelo frontend, em background.
 */
function bootstrap_(user, input) {
  return {
    ok: true,

    app: {
      name: APP.NAME,
      field: APP.FIELD,
      version: APP.VERSION,
      db_version: APP.DB_VERSION
    },

    user: publicUser_(user),
    modules: allowedModules_(user),
    scope: territoryScope_(user),

    dashboard: null,
    bootstrap_mode: 'light'
  };
}
