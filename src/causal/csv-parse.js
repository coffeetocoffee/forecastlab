/**
 * ForecastLab Causal Module - CSV Parsing Utilities
 * 
 * Wide-format CSV parsing for aligned time-series data.
 */

/**
 * Split a CSV line handling quoted fields with escaped quotes.
 */
export function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quote = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; }
        else quote = false;
      } else cur += ch;
    } else if (ch === '"') {
      quote = true;
    } else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Parse a timestamp from raw string input.
 * Returns milliseconds since epoch.
 */
export function parseTimestamp(raw, lineNo) {
  const s = String(raw).trim();
  if (s === '') throw new Error(`Line ${lineNo}: empty timestamp`);
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) throw new Error(`Line ${lineNo}: bad epoch timestamp "${raw}"`);
    return s.length >= 13 ? n : n * 1000;
  }
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) throw new Error(`Line ${lineNo}: unparseable timestamp "${raw}"`);
  return ms;
}

/**
 * Parse a wide CSV (one time column + any number of value columns) into
 * aligned series. Rows with a missing value in any selected column are
 * skipped and counted, so every returned column has identical length.
 *
 * @param {string} text CSV text
 * @param {Object} [options]
 * @param {string} [options.timeColumn] header of the time column (default: first)
 * @param {string[]} [options.valueColumns] subset of value columns to keep (default: all others)
 * @returns {{ timeColumn: string, valueColumns: string[], times: number[], columns: Object<string, number[]>, skipped: number }}
 */
export function parseWideCsv(text, options = {}) {
  const lines = String(text).split(/\r?\n/);
  let headerIdx = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '') { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error('Empty CSV: no header row found');
  const headers = splitCsvLine(lines[headerIdx]).map((h) => h.trim());
  if (headers.length < 2) throw new Error('Wide CSV needs a time column plus at least one value column');

  const timeColumn = options.timeColumn ?? headers[0];
  const ti = headers.indexOf(timeColumn);
  if (ti === -1) throw new Error(`Time column "${timeColumn}" not found in ${headers.join(', ')}`);

  const valueColumns = (options.valueColumns ?? headers.filter((_, i) => i !== ti))
    .filter((c) => headers.includes(c));
  if (valueColumns.length === 0) throw new Error('No value columns selected');

  const times = [];
  const columns = Object.fromEntries(valueColumns.map((c) => [c, []]));
  let skipped = 0;

  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === '') continue;
    const lineNo = i + 1;
    const fields = splitCsvLine(line);
    if (fields.length !== headers.length) {
      throw new Error(`Line ${lineNo}: expected ${headers.length} fields, got ${fields.length}`);
    }
    let ok = true;
    const row = {};
    for (const c of valueColumns) {
      const raw = fields[headers.indexOf(c)].trim();
      if (raw === '') { ok = false; break; }
      const v = Number(raw);
      if (!Number.isFinite(v)) throw new Error(`Line ${lineNo}: value "${raw}" in column "${c}" is not a number`);
      row[c] = v;
    }
    if (!ok) { skipped++; continue; }
    times.push(parseTimestamp(fields[ti], lineNo));
    for (const c of valueColumns) columns[c].push(row[c]);
  }
  if (times.length === 0) throw new Error('No usable rows: every data row was empty or incomplete');

  const order = times.map((t, i) => [t, i]).sort((a, b) => a[0] - b[0]).map((p) => p[1]);
  return {
    timeColumn,
    valueColumns,
    times: order.map((i) => times[i]),
    columns: Object.fromEntries(valueColumns.map((c) => [c, order.map((i) => columns[c][i])])),
    skipped,
  };
}
