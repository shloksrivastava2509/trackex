/**
 * Google Sheet persistence. Each sheet is loaded once per run into memory,
 * mutated, and written back in a single flush (Sheets API calls are slow).
 */
const APP_HEADERS = ['Key', 'Company', 'Role', 'Type', 'Status', 'Applied On', 'Last Update',
  'Portal Link', 'Email Link', 'Last Email Subject', 'Notes'];
const DEADLINE_HEADERS = ['Key', 'Title', 'Organization', 'Kind', 'Starts', 'Ends', 'All Day',
  'Link', 'Email Link', 'Calendar Event Id', 'Added On'];
const STATE_HEADERS = ['Thread Id', 'Last Processed Ms'];

class Table {
  constructor(spreadsheet, name, headers) {
    this.headers = headers;
    this.sheet = spreadsheet.getSheetByName(name);
    if (!this.sheet) {
      this.sheet = spreadsheet.insertSheet(name);
      this.sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      this.sheet.setFrozenRows(1);
    }
    const lastRow = this.sheet.getLastRow();
    const values = lastRow > 1
      ? this.sheet.getRange(2, 1, lastRow - 1, headers.length).getValues()
      : [];
    this.rows = values.map(v => Object.fromEntries(headers.map((h, i) => [h, v[i]])));
    this.dirty = false;
  }

  add(obj) {
    this.rows.push(obj);
    this.dirty = true;
    return obj;
  }

  touch() { this.dirty = true; }

  flush() {
    if (!this.dirty || !this.rows.length) return;
    const values = this.rows.map(r => this.headers.map(h => (r[h] === undefined || r[h] === null) ? '' : r[h]));
    this.sheet.getRange(2, 1, values.length, this.headers.length).setValues(values);
    this.dirty = false;
  }
}

class Store {
  constructor() {
    const ss = SpreadsheetApp.getActiveSpreadsheet();  // the sheet this script is bound to
    this.apps = new Table(ss, 'Applications', APP_HEADERS);
    this.deadlines = new Table(ss, 'Deadlines', DEADLINE_HEADERS);
    this.state = new Table(ss, '_State', STATE_HEADERS);
    this.stateById = new Map(this.state.rows.map(r => [String(r['Thread Id']), r]));
  }

  lastProcessedMs(threadId) {
    const r = this.stateById.get(threadId);
    return r ? Number(r['Last Processed Ms']) : 0;
  }

  markProcessed(threadId, ms) {
    let r = this.stateById.get(threadId);
    if (!r) {
      r = this.state.add({ 'Thread Id': threadId, 'Last Processed Ms': ms });
      this.stateById.set(threadId, r);
    } else if (ms > Number(r['Last Processed Ms'])) {
      r['Last Processed Ms'] = ms;
      this.state.touch();
    }
  }

  /**
   * Rejection/interview emails often omit the role ("your application to Acme"),
   * so a role-less update attaches to the most recently active row for that company.
   */
  upsertApplication(app, meta) {
    const companyKey = norm_(app.company);
    if (!companyKey) return null;
    const roleKey = norm_(app.role);
    const key = companyKey + '|' + roleKey;
    const sameCompany = this.apps.rows.filter(r => String(r.Key).split('|')[0] === companyKey);

    let row = this.apps.rows.find(r => r.Key === key);
    if (!row && !roleKey && sameCompany.length) {
      row = sameCompany.sort((a, b) => new Date(b['Last Update']) - new Date(a['Last Update']))[0];
    }
    if (!row && roleKey) {
      row = sameCompany.find(r => String(r.Key).endsWith('|')); // earlier role-less row → adopt role
    }

    const status = STATUSES.includes(app.status) ? app.status : 'Applied';
    if (!row) {
      return this.apps.add({
        Key: key,
        Company: app.company,
        Role: app.role || '',
        Type: app.kind || '',
        Status: status,
        'Applied On': meta.date,
        'Last Update': meta.date,
        'Portal Link': app.portal_url || '',
        'Email Link': meta.emailLink,
        'Last Email Subject': meta.subject,
        Notes: ''
      });
    }

    if (roleKey && !row.Role) { row.Role = app.role; row.Key = key; }
    if (app.kind && !row.Type) row.Type = app.kind;
    if (app.portal_url && (!row['Portal Link'] || isAtsUrl_(app.portal_url))) row['Portal Link'] = app.portal_url;
    if (meta.date < new Date(row['Applied On'])) row['Applied On'] = meta.date;
    // Backfill walks newest → oldest, so only a *newer* email may change status.
    if (!row['Last Update'] || meta.date >= new Date(row['Last Update'])) {
      // A generic "we received it / still reviewing" note never demotes a later stage.
      const isWeak = status === 'Applied' || status === 'Under Review';
      if (!(isWeak && STATUSES.indexOf(row.Status) > STATUSES.indexOf(status))) row.Status = status;
      row['Last Update'] = meta.date;
      row['Email Link'] = meta.emailLink;
      row['Last Email Subject'] = meta.subject;
    }
    this.apps.touch();
    return row;
  }

  findDeadline(key) {
    return this.deadlines.rows.find(r => r.Key === key);
  }

  flush() {
    this.apps.flush();
    this.deadlines.flush();
    this.state.flush();
  }
}

function norm_(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|technologies|labs|pvt|private|limited)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function isAtsUrl_(url) {
  return ATS_DOMAINS.some(d => String(url).toLowerCase().includes(d));
}
