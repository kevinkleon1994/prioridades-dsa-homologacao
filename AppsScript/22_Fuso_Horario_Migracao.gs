/**
 * v2.0 R1 — padronização global de data/hora.
 *
 * Execute UMA VEZ após publicar esta atualização:
 *   corrigirFusoHorarioGlobalV20R1()
 *
 * A função NÃO soma nem subtrai horas dos valores armazenados.
 * Ela corrige o fuso da Planilha-Mestre para America/Sao_Paulo e
 * reaplica os formatos de data/data-hora. Como células Date representam
 * instantes absolutos, a própria Planilha passa a mostrá-los corretamente.
 */
function corrigirFusoHorarioGlobalV20R1() {
  const ss = db_();
  const before = String(ss.getSpreadsheetTimeZone() || '');

  ss.setSpreadsheetTimeZone(APP.TIME_ZONE);

  const dateOnlyFields = new Set([
    'data_realizacao',
    'data_inicial',
    'data_inicio',
    'data_fim',
    'prazo',
    'data_conclusao'
  ]);

  const updated = [];

  Object.keys(REQUIRED_SCHEMA).forEach(function(sheetName) {
    const sh = ss.getSheetByName(sheetName);
    if (!sh || sh.getLastColumn() < 1 || sh.getMaxRows() < 2) return;

    const map = columnMap_(sheetName);
    const rowCount = Math.max(1, sh.getMaxRows() - 1);

    Object.keys(map).forEach(function(field) {
      const col = map[field];
      if (!col) return;

      let format = '';

      if (dateOnlyFields.has(field)) {
        format = APP.DATE_FORMAT;
      } else if (
        /_em$/.test(field) ||
        field === 'timestamp' ||
        field === 'data_hora'
      ) {
        format = APP.DATETIME_FORMAT;
      }

      if (!format) return;

      sh.getRange(2, col, rowCount, 1).setNumberFormat(format);
      updated.push(sheetName + '!' + field + ' → ' + format);
    });
  });

  SpreadsheetApp.flush();

  const after = String(ss.getSpreadsheetTimeZone() || '');

  logSystem_('CORRIGIR_FUSO_HORARIO_GLOBAL', 'SISTEMA', '', {
    fuso_anterior: before,
    fuso_atual: after,
    formato_data: APP.DATE_FORMAT,
    formato_data_hora: APP.DATETIME_FORMAT,
    colunas_formatadas: updated.length
  });

  return {
    ok: true,
    fuso_anterior: before,
    fuso_atual: after,
    esperado: APP.TIME_ZONE,
    formato_data: APP.DATE_FORMAT,
    formato_data_hora: APP.DATETIME_FORMAT,
    colunas_formatadas: updated
  };
}


/**
 * Diagnóstico sem alterar dados.
 */
function diagnosticarFusoHorarioV20R1() {
  const ss = db_();
  const now = new Date();

  return {
    ok: true,
    fuso_oficial: APP.TIME_ZONE,
    fuso_planilha: ss.getSpreadsheetTimeZone(),
    fuso_script: Session.getScriptTimeZone(),
    agora_oficial: Utilities.formatDate(now, APP.TIME_ZONE, APP.DATETIME_FORMAT),
    agora_iso_utc: now.toISOString()
  };
}
