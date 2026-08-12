/**
 * Configuração e auditoria inicial.
 */

function configurarProjeto() {
  const active = SpreadsheetApp.getActiveSpreadsheet();

  if (!active) {
    throw new Error(
      'Abra a Planilha-Mestre v1.3 e use Extensões > Apps Script antes de executar configurarProjeto().'
    );
  }

  const props = PropertiesService.getScriptProperties();

  props.setProperty('SPREADSHEET_ID', active.getId());

  // Fuso oficial do sistema e da Planilha-Mestre.
  if (active.getSpreadsheetTimeZone() !== APP.TIME_ZONE) {
    active.setSpreadsheetTimeZone(APP.TIME_ZONE);
  }

  if (!props.getProperty('AUTH_PEPPER')) {
    props.setProperty('AUTH_PEPPER', Utilities.getUuid() + Utilities.getUuid());
  }

  if (!props.getProperty('TOKEN_SECRET')) {
    props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }

  validarSchemaV13_();

  const audit = auditarBase_();

  logSystem_('CONFIGURAR_PROJETO', 'SISTEMA', '', {
    version: APP.VERSION,
    dbVersion: APP.DB_VERSION,
    spreadsheetId: active.getId(),
    warnings: audit.warnings.length
  });

  return {
    ok: true,
    app: APP.NAME,
    version: APP.VERSION,
    db_version: APP.DB_VERSION,
    spreadsheet_id: active.getId(),
    planilha: active.getName(),
    fuso_horario: active.getSpreadsheetTimeZone(),
    auditoria: audit
  };
}


function validarSchemaV13_() {
  const ss = db_();

  Object.keys(REQUIRED_SCHEMA).forEach(sheetName => {
    const sh = ss.getSheetByName(sheetName);

    if (!sh) {
      throw new Error('Planilha-Mestre v1.3 inválida: aba ausente "' + sheetName + '".');
    }

    const actual = headers_(sheetName);

    REQUIRED_SCHEMA[sheetName].forEach(requiredField => {
      if (!actual.includes(norm_(requiredField))) {
        throw new Error(
          `Planilha-Mestre v1.3 inválida: ${sheetName} não possui o campo "${requiredField}".`
        );
      }
    });
  });

  const dbVersion = getConfig_('VERSAO_BANCO');
  if (String(dbVersion || '').trim() !== APP.DB_VERSION) {
    throw new Error(
      `Versão incompatível da Planilha-Mestre. Esperado ${APP.DB_VERSION}; encontrado "${dbVersion}".`
    );
  }

  return true;
}


function auditarBase_() {
  const warnings = [];
  const errors = [];

  const districts = rows_(APP.SHEETS.DISTRICTS, 'distrito_id');
  const churches = rows_(APP.SHEETS.CHURCHES, 'igreja_id');
  const users = rows_(APP.SHEETS.USERS, 'usuario_id');
  const poles = rows_(APP.SHEETS.POLES, 'polo_id');

  const districtIds = new Set(districts.map(x => String(x.distrito_id)));
  const churchIds = new Set(churches.map(x => String(x.igreja_id)));
  const poleIds = new Set(poles.map(x => String(x.polo_id)));

  const seenLogins = new Set();

  churches.forEach(church => {
    if (!districtIds.has(String(church.distrito_id || ''))) {
      errors.push(`Igreja ${church.igreja_id} referencia distrito inexistente: ${church.distrito_id}`);
    }
  });

  districts.forEach(district => {
    const poleId = String(district.polo_id || '').trim();
    if (poleId && !poleIds.has(poleId)) {
      errors.push(`Distrito ${district.distrito_id} referencia polo inexistente: ${poleId}`);
    }
  });

  users.forEach(user => {
    const login = norm_(user.login);

    if (!login) {
      errors.push(`Usuário ${user.usuario_id} sem login.`);
    } else if (seenLogins.has(login)) {
      errors.push(`Login duplicado: ${user.login}`);
    } else {
      seenLogins.add(login);
    }

    if (!bool_(user.ativo)) return;

    const role = String(user.perfil || '').trim();

    if (role === APP.ROLES.POLE_COORDINATOR) {
      if (!String(user.polo_id || '').trim()) {
        warnings.push(`Coordenador ${user.usuario_id} ainda não possui polo_id.`);
      }
    }

    if (role === APP.ROLES.DISTRICT_PASTOR) {
      const districtId = String(user.distrito_id || '').trim();
      if (!districtId) {
        errors.push(`Pastor Distrital ${user.usuario_id} sem distrito_id.`);
      } else if (!districtIds.has(districtId)) {
        errors.push(`Pastor Distrital ${user.usuario_id} usa distrito inexistente: ${districtId}`);
      }
    }

    if (role === APP.ROLES.ELDER || role === APP.ROLES.SECRETARY) {
      const churchId = String(user.igreja_id || '').trim();
      if (!churchId) {
        errors.push(`${role} ${user.usuario_id} sem igreja_id.`);
      } else if (!churchIds.has(churchId)) {
        errors.push(`${role} ${user.usuario_id} usa igreja inexistente: ${churchId}`);
      }
    }
  });

  return {
    ok: errors.length === 0,
    errors: errors,
    warnings: warnings,
    counts: {
      polos: poles.length,
      distritos: districts.length,
      igrejas: churches.length,
      usuarios: users.length
    }
  };
}


/**
 * Execute opcionalmente após configurarProjeto().
 * Configura a senha inicial do usuário Dev já existente na Planilha-Mestre.
 */
function configurarDevInicial() {
  return definirSenhaUsuario('Dev', 'dev1844');
}


function getConfig_(key) {
  const target = norm_(key);
  const row = rows_(APP.SHEETS.CONFIG, 'chave')
    .find(x => norm_(x.chave) === target);

  return row ? row.valor : '';
}
