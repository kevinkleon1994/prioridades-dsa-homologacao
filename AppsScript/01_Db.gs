/**
 * Acesso padronizado à Planilha-Mestre v1.2.
 */

var DB_CACHE_ = null;
var DB_TIME_ZONE_SYNCED_ = false;

function db_() {
  if (DB_CACHE_) return DB_CACHE_;

  const props = PropertiesService.getScriptProperties();
  const id = String(props.getProperty('SPREADSHEET_ID') || '').trim();

  if (id) {
    DB_CACHE_ = SpreadsheetApp.openById(id);
  } else {
    DB_CACHE_ = SpreadsheetApp.getActiveSpreadsheet();
  }

  if (!DB_CACHE_) {
    throw new Error(
      'SPREADSHEET_ID não configurado. Execute configurarProjeto() a partir da Planilha-Mestre v1.2.'
    );
  }

  // Uma única fonte de verdade para data/hora em todo o projeto.
  // Corrige automaticamente Planilhas criadas com fuso padrão diferente.
  if (!DB_TIME_ZONE_SYNCED_) {
    const current = String(DB_CACHE_.getSpreadsheetTimeZone() || '').trim();
    if (current !== APP.TIME_ZONE) {
      DB_CACHE_.setSpreadsheetTimeZone(APP.TIME_ZONE);
    }
    DB_TIME_ZONE_SYNCED_ = true;
  }

  return DB_CACHE_;
}


function sheet_(name) {
  const sh = db_().getSheetByName(name);
  if (!sh) throw new Error('Aba obrigatória não encontrada: ' + name);
  return sh;
}


function norm_(value) {
  return String(value == null ? '' : value)
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}


function bool_(value) {
  if (value === true) return true;
  const s = norm_(value);
  return s === 'true' || s === '1' || s === 'sim' || s === 'ativo' || s === 'yes';
}


function headers_(sheetName) {
  const sh = sheet_(sheetName);
  if (sh.getLastColumn() < 1) return [];

  return sh
    .getRange(1, 1, 1, sh.getLastColumn())
    .getValues()[0]
    .map(norm_);
}


function columnMap_(sheetName) {
  const headers = headers_(sheetName);
  const map = {};

  headers.forEach((h, index) => {
    if (h) map[h] = index + 1;
  });

  return map;
}


/**
 * Lê linhas filtrando pela chave primária.
 * Isto evita que fórmulas pré-preenchidas em linhas vazias sejam tratadas como registros.
 */
function rows_(sheetName, primaryKey) {
  const sh = sheet_(sheetName);
  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();

  if (lastRow < 2 || lastCol < 1) return [];

  const matrix = sh.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = matrix[0].map(norm_);
  const pk = norm_(primaryKey);
  const pkIndex = headers.indexOf(pk);

  if (pkIndex < 0) {
    throw new Error(`Chave primária "${primaryKey}" ausente em ${sheetName}.`);
  }

  return matrix.slice(1)
    .map((row, i) => {
      const obj = {_row: i + 2};
      headers.forEach((h, c) => {
        if (h) obj[h] = row[c];
      });
      return obj;
    })
    .filter(obj => String(obj[pk] == null ? '' : obj[pk]).trim() !== '');
}


function findById_(sheetName, primaryKey, id) {
  const target = String(id || '').trim();
  if (!target) return null;

  return rows_(sheetName, primaryKey)
    .find(x => String(x[norm_(primaryKey)] || '').trim() === target) || null;
}


function findByField_(sheetName, primaryKey, fieldName, value) {
  const target = norm_(value);
  if (!target) return null;

  const field = norm_(fieldName);

  return rows_(sheetName, primaryKey)
    .find(x => norm_(x[field]) === target) || null;
}


function primaryKeyForSheet_(sheetName) {
  const schema = REQUIRED_SCHEMA[String(sheetName || '')] || [];
  return norm_(schema[0] || '');
}


function firstWritableRow_(sheetName, primaryKey) {
  const sh = sheet_(sheetName);
  const map = columnMap_(sheetName);
  const pk = norm_(primaryKey || primaryKeyForSheet_(sheetName));
  const pkCol = map[pk];

  if (!pkCol) {
    throw new Error('Chave primária ausente para gravação em ' + sheetName + '.');
  }

  const maxRows = sh.getMaxRows();
  if (maxRows < 2) sh.insertRowsAfter(1, 1);

  const values = sh.getRange(2, pkCol, Math.max(1, sh.getMaxRows() - 1), 1).getDisplayValues();
  for (let i = 0; i < values.length; i++) {
    if (!String(values[i][0] || '').trim()) return i + 2;
  }

  sh.insertRowsAfter(sh.getMaxRows(), 1);
  return sh.getMaxRows();
}


function writeObjectRow_(sheetName, rowNumber, object) {
  const sh = sheet_(sheetName);
  const map = columnMap_(sheetName);
  const lastCol = sh.getLastColumn();
  const range = sh.getRange(rowNumber, 1, 1, lastCol);
  const values = range.getValues()[0];
  const formulas = range.getFormulas()[0];
  const row = values.slice();

  // Preserva fórmulas pré-existentes nas colunas derivadas.
  for (let c = 0; c < lastCol; c++) {
    if (formulas[c]) row[c] = formulas[c];
  }

  Object.keys(object || {}).forEach(key => {
    const col = map[norm_(key)];
    if (col) row[col - 1] = object[key];
  });

  range.setValues([row]);

  // Mantém o padrão visual da Planilha-Mestre:
  // campos de data simples => DD/MM/AAAA
  // campos de auditoria/data-hora => DD/MM/AAAA HH:MM:SS
  applyRowDateFormats_(sheetName, rowNumber, map);

  return rowNumber;
}


function applyRowDateFormats_(sheetName, rowNumber, map) {
  const sh = sheet_(sheetName);

  const dateOnlyFields = new Set([
    'data_realizacao',
    'data_inicial',
    'data_inicio',
    'data_fim',
    'prazo',
    'data_conclusao'
  ]);

  Object.keys(map || {}).forEach(function(field) {
    const col = map[field];
    if (!col) return;

    if (dateOnlyFields.has(field)) {
      sh.getRange(rowNumber, col).setNumberFormat(APP.DATE_FORMAT);
      return;
    }

    // Auditoria e timestamps devem continuar exibindo data + hora.
    if (
      /_em$/.test(field) ||
      field === 'timestamp' ||
      field === 'data_hora'
    ) {
      sh.getRange(rowNumber, col).setNumberFormat(APP.DATETIME_FORMAT);
    }
  });
}


function appendObject_(sheetName, object) {
  return withLock_(function() {
    const pk = primaryKeyForSheet_(sheetName);
    const rowNumber = firstWritableRow_(sheetName, pk);
    return writeObjectRow_(sheetName, rowNumber, object);
  });
}


function updateObjectRow_(sheetName, rowNumber, patch) {
  return withLock_(function() {
    return writeObjectRow_(sheetName, rowNumber, patch);
  });
}


function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);

  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}


function nextId_(sheetName, primaryKey, prefix) {
  const re = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '-(\\d+)$');
  let max = 0;

  rows_(sheetName, primaryKey).forEach(row => {
    const match = String(row[norm_(primaryKey)] || '').match(re);
    if (match) max = Math.max(max, Number(match[1]) || 0);
  });

  return prefix + '-' + String(max + 1).padStart(3, '0');
}


function publicRow_(row, excludedFields) {
  const blocked = new Set(
    (excludedFields || [])
      .concat(['_row', 'senha_hash'])
      .map(norm_)
  );

  const out = {};

  Object.keys(row || {}).forEach(key => {
    if (!blocked.has(norm_(key))) out[key] = serializeValue_(row[key]);
  });

  return out;
}


function serializeValue_(value) {
  if (value instanceof Date) return value.toISOString();
  return value;
}

function serializeDateOnly_(value) {
  if (!value) return '';
  const date = parseDateOnly_(value);
  return date ? isoDate_(date) : '';
}
