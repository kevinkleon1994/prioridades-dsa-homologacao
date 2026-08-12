/**
 * Auditoria.
 */

function logSystem_(action, entity, recordId, details) {
  return writeLog_('', action, entity, recordId, details, '');
}


function logUser_(user, action, entity, recordId, details, sessionFingerprint) {
  return writeLog_(
    String(user && user.usuario_id || ''),
    action,
    entity,
    recordId,
    details,
    sessionFingerprint || ''
  );
}


function writeLog_(userId, action, entity, recordId, details, sessionFingerprint) {
  try {
    appendObject_(APP.SHEETS.LOG, {
      data_hora: new Date(),
      usuario_id: String(userId || ''),
      acao: String(action || ''),
      entidade: String(entity || ''),
      registro_id: String(recordId || ''),
      detalhes: JSON.stringify(details || {}),
      ip_sessao: String(sessionFingerprint || '')
    });

    return true;

  } catch (err) {
    console.error('Falha ao registrar LOG:', err);
    return false;
  }
}
