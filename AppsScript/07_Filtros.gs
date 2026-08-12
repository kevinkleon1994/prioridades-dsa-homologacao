/**
 * Arquitetura temporal oficial.
 * Todo contexto temporal é convertido para data_inicio/data_fim.
 */

function appTimeZone_() {
  // Fuso oficial único. Não depende do navegador nem do fuso herdado da planilha.
  return APP.TIME_ZONE;
}


function dateAtNoon_(year, monthIndex, day) {
  return new Date(Number(year), Number(monthIndex), Number(day), 12, 0, 0, 0);
}


function parseDateOnly_(value) {
  if (!value) return null;

  let y, m, d;

  if (value instanceof Date && !isNaN(value.getTime())) {
    const iso = Utilities.formatDate(value, appTimeZone_(), 'yyyy-MM-dd');
    const parts = iso.split('-').map(Number);
    y = parts[0]; m = parts[1]; d = parts[2];
    return dateAtNoon_(y, m - 1, d);
  }

  const s = String(value || '').trim();

  // yyyy-MM-dd — preserva exatamente o dia informado.
  let match = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (match) return dateAtNoon_(match[1], Number(match[2]) - 1, match[3]);

  // ISO com horário — interpreta no fuso oficial do projeto.
  match = s.match(/^(\d{4})-(\d{2})-(\d{2})T/);
  if (match) {
    const parsed = new Date(s);
    if (!isNaN(parsed.getTime())) {
      const iso = Utilities.formatDate(parsed, appTimeZone_(), 'yyyy-MM-dd');
      const parts = iso.split('-').map(Number);
      return dateAtNoon_(parts[0], parts[1] - 1, parts[2]);
    }
  }

  // dd/MM/yyyy
  match = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (match) return dateAtNoon_(match[3], Number(match[2]) - 1, match[1]);

  return null;
}


function isoDate_(date) {
  const parsed = parseDateOnly_(date);
  if (!parsed) return '';
  return Utilities.formatDate(parsed, appTimeZone_(), 'yyyy-MM-dd');
}


function formatDateBr_(value) {
  const iso = isoDate_(value);
  if (!iso) return '';
  const p = iso.split('-');
  return p[2] + '/' + p[1] + '/' + p[0];
}


function endOfMonth_(year, monthNumber) {
  return dateAtNoon_(Number(year), Number(monthNumber), 0);
}


function resolvePeriod_(input) {
  input = input || {};

  let start = parseDateOnly_(input.data_inicio);
  let end = parseDateOnly_(input.data_fim);

  if (!start || !end) {
    const mode = String(input.modo || '').trim();

    if (mode === 'ano') {
      const year = Number(input.ano);
      start = dateAtNoon_(year, 0, 1);
      end = dateAtNoon_(year, 11, 31);

    } else if (mode === 'anos') {
      const y1 = Number(input.ano_inicio);
      const y2 = Number(input.ano_fim);
      start = dateAtNoon_(y1, 0, 1);
      end = dateAtNoon_(y2, 11, 31);

    } else if (mode === 'mes') {
      const year = Number(input.ano);
      const month = Number(input.mes);
      start = dateAtNoon_(year, month - 1, 1);
      end = endOfMonth_(year, month);

    } else if (mode === 'meses') {
      const y1 = Number(input.ano_inicio);
      const m1 = Number(input.mes_inicio);
      const y2 = Number(input.ano_fim || input.ano_inicio);
      const m2 = Number(input.mes_fim);

      start = dateAtNoon_(y1, m1 - 1, 1);
      end = endOfMonth_(y2, m2);

    } else {
      const defaultYear = Number(getConfig_('ANO_INICIAL') || new Date().getFullYear());
      start = dateAtNoon_(defaultYear, 0, 1);
      end = dateAtNoon_(defaultYear, 11, 31);
    }
  }

  if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
    throw new Error('Período inválido.');
  }

  if (start.getTime() > end.getTime()) {
    throw new Error('data_inicio não pode ser posterior à data_fim.');
  }

  return {
    data_inicio: isoDate_(start),
    data_fim: isoDate_(end),
    inicio: start,
    fim: end
  };
}


function dateInPeriod_(value, period) {
  const date = parseDateOnly_(value);
  if (!date) return false;

  const time = date.getTime();

  return time >= period.inicio.getTime() &&
         time <= period.fim.getTime();
}


/**
 * Contexto territorial + temporal normalizado.
 * IDs "Todos"/"Todas"/vazio são convertidos para ausência de restrição extra,
 * mas jamais ampliam o território autorizado pelo usuário.
 */
function normalizeContext_(user, input) {
  input = input || {};

  const scope = territoryScope_(user);
  const period = resolvePeriod_(input);

  const requestedPole = cleanAll_(input.polo_id);
  const requestedDistrict = cleanAll_(input.distrito_id);
  const requestedChurch = cleanAll_(input.igreja_id);

  if (requestedPole && !canAccessPole_(user, requestedPole)) {
    throw new Error('Polo fora do escopo autorizado.');
  }

  if (requestedDistrict && !canAccessDistrict_(user, requestedDistrict)) {
    throw new Error('Distrito fora do escopo autorizado.');
  }

  if (requestedChurch && !canAccessChurch_(user, requestedChurch)) {
    throw new Error('Igreja fora do escopo autorizado.');
  }

  if (requestedChurch && requestedDistrict) {
    const church = scope.igrejas.find(
      x => String(x.igreja_id || '') === requestedChurch
    );

    if (!church || String(church.distrito_id || '') !== requestedDistrict) {
      throw new Error('A igreja selecionada não pertence ao distrito selecionado.');
    }
  }

  if (requestedDistrict && requestedPole) {
    const district = scope.distritos.find(
      x => String(x.distrito_id || '') === requestedDistrict
    );

    if (!district || String(district.polo_id || '') !== requestedPole) {
      throw new Error('O distrito selecionado não pertence ao polo selecionado.');
    }
  }

  return {
    polo_id: requestedPole,
    distrito_id: requestedDistrict,
    igreja_id: requestedChurch,
    data_inicio: period.data_inicio,
    data_fim: period.data_fim,
    _period: period
  };
}


function cleanAll_(value) {
  const s = String(value || '').trim();

  if (!s) return '';
  if (norm_(s) === 'todos' || norm_(s) === 'todas') return '';

  return s;
}
