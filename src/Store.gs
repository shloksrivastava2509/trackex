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
    this.written = this.rows.length;   // rows currently on the sheet, so removals can be cleared
    this.dirty = false;
  }

  remove(row) {
    this.rows = this.rows.filter(r => r !== row);
    this.dirty = true;
  }

  add(obj) {
    this.rows.push(obj);
    this.dirty = true;
    return obj;
  }

  touch() { this.dirty = true; }

  flush() {
    if (!this.dirty) return;
    const values = this.rows.map(r => this.headers.map(h => (r[h] === undefined || r[h] === null) ? '' : r[h]));
    if (values.length) this.sheet.getRange(2, 1, values.length, this.headers.length).setValues(values);
    const stale = this.written - values.length;   // rows merged away since the last write
    if (stale > 0) this.sheet.getRange(2 + values.length, 1, stale, this.headers.length).clearContent();
    this.written = values.length;
    this.dirty = false;
  }
}

class Store {
  /** @param {{withState?: boolean}} [opts] the dashboard skips the (large) scan-state tab */
  constructor({ withState = true } = {}) {
    const ss = spreadsheet_();
    this.apps = new Table(ss, 'Applications', APP_HEADERS);
    this.deadlines = new Table(ss, 'Deadlines', DEADLINE_HEADERS);
    this.state = withState ? new Table(ss, '_State', STATE_HEADERS) : { rows: [], flush() {} };
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
   * Finds the row an email belongs to. Company names are normalised ("Stripe Recruiting"
   * = "Stripe, Inc."), roles match fuzzily ("Software Engineer Intern – Summer 2027" =
   * "Software Engineering Intern"), and a role-less email ("your application to Acme")
   * goes to the most recently active row for that company.
   */
  findApplication_(app, status) {
    const ck = companyKey_(app.company);
    const same = this.apps.rows.filter(r => companyKey_(r.Company) === ck);
    if (!same.length) return null;
    const active = same.filter(r => isActiveStatus_(r.Status));
    const newest = list => list.slice().sort((a, b) => new Date(b['Last Update']) - new Date(a['Last Update']))[0];

    if (!roleTokens_(app.role).length) return newest(active.length ? active : same);
    let best = null, bestSim = 0;
    for (const r of same) {
      const sim = roleSimilarity_(app.role, r.Role);
      if (sim > bestSim) { best = r; bestSim = sim; }
    }
    if (bestSim >= ROLE_MATCH_THRESHOLD) return best;
    const roleless = same.find(r => !roleTokens_(r.Role).length);
    if (roleless) return roleless;
    // A rejection/interview/offer that names the role differently from the only open
    // application at that company is almost always about that application.
    const isProgress = !['Applied', 'Under Review'].includes(status);
    return isProgress && active.length === 1 ? active[0] : null;
  }

  upsertApplication(app, meta) {
    const companyKey = companyKey_(app.company);
    if (!companyKey) return null;
    const status = STATUSES.includes(app.status) ? app.status : 'Applied';
    const row = this.findApplication_(app, status);

    if (!row) {
      return this.apps.add({
        Key: companyKey + '|' + norm_(app.role),
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

    if (app.role && !roleTokens_(row.Role).length) { row.Role = app.role; row.Key = companyKey + '|' + norm_(app.role); }
    if (app.kind && !row.Type) row.Type = app.kind;
    // A real "track your application" link replaces a careers-site link, never the reverse.
    if (portalRank_(app.portal_url, app.portal_kind) > portalRank_(row['Portal Link'], '')) row['Portal Link'] = app.portal_url;
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

  /**
   * Merges rows for the same application that older versions (or odd emails) split up:
   * same company and a matching or missing role. Keeps the earliest "Applied On", the
   * newest status, the best portal link and all notes. @return {number} rows merged away
   */
  mergeDuplicateApplications() {
    let merged = 0;
    const byCompany = new Map();
    for (const r of this.apps.rows) {
      const ck = companyKey_(r.Company);
      if (!byCompany.has(ck)) byCompany.set(ck, []);
      byCompany.get(ck).push(r);
    }
    for (const rows of byCompany.values()) {
      for (let i = 0; i < rows.length; i++) {
        for (let j = i + 1; j < rows.length; j++) {
          const a = rows[i], b = rows[j];
          const roleless = !roleTokens_(a.Role).length || !roleTokens_(b.Role).length;
          if (!roleless && roleSimilarity_(a.Role, b.Role) < ROLE_MATCH_THRESHOLD) continue;
          mergeRowInto_(a, b);
          this.apps.remove(b);
          rows.splice(j--, 1);
          merged++;
        }
      }
    }
    return merged;
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

const ROLE_MATCH_THRESHOLD = 0.7;
const ROLE_ALIASES = {
  swe: 'software engineer', sde: 'software development engineer', sre: 'site reliability engineer',
  mle: 'machine learning engineer', ml: 'machine learning', fe: 'frontend', be: 'backend', pm: 'product manager'
};
const ROLE_STOPWORDS = new Set(['the', 'a', 'an', 'of', 'for', 'and', 'to', 'in', 'at', 'with', 'role', 'position',
  'opening', 'job', 'summer', 'winter', 'spring', 'fall', 'autumn', 'program', 'programme', 'full', 'time', 'fulltime']);

/** "Stripe Recruiting", "Stripe, Inc." and "Stripe Careers" → "stripe". */
function companyKey_(s) {
  return String(s || '').toLowerCase().replace(/&/g, ' and ')
    .replace(/\b(inc|llc|ltd|limited|corp|corporation|company|co|pvt|private|plc|gmbh|technologies|labs|careers?|jobs?|recruiting|recruitment|talent( acquisition)?|hiring|team|hr|university|campus|the)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

/** Role words with years, seasons and filler removed and crude stemming (engineering → engineer). */
function roleTokens_(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9+#]+/g, ' ').split(' ')
    .flatMap(w => (ROLE_ALIASES[w] || w).split(' '))
    .filter(w => w && !ROLE_STOPWORDS.has(w) && !/^(19|20)\d\d$/.test(w))
    .map(w => w.replace(/(ing|s)$/, ''));
}

/**
 * Jaccard similarity of role words (0–1). Deliberately strict: "Software Engineer Intern"
 * vs "Data Engineer Intern" is 0.5, so different roles at one company stay separate.
 */
function roleSimilarity_(a, b) {
  const A = new Set(roleTokens_(a)), B = new Set(roleTokens_(b));
  if (!A.size || !B.size) return 0;
  let common = 0;
  for (const w of A) if (B.has(w)) common++;
  return common / (A.size + B.size - common);
}

function isActiveStatus_(status) {
  return !['Rejected', 'Withdrawn', 'Offer'].includes(status);
}

/** Folds row b into row a (see Store.mergeDuplicateApplications). */
function mergeRowInto_(a, b) {
  const newer = new Date(b['Last Update']) > new Date(a['Last Update']) ? b : a;
  const applied = [a['Applied On'], b['Applied On']].filter(Boolean).map(d => new Date(d));
  if (applied.length) a['Applied On'] = new Date(Math.min(...applied));
  for (const f of ['Status', 'Last Update', 'Email Link', 'Last Email Subject']) a[f] = newer[f];
  if (roleTokens_(b.Role).length > roleTokens_(a.Role).length) { a.Role = b.Role; a.Key = b.Key; }
  if (!a.Type) a.Type = b.Type;
  if (portalRank_(b['Portal Link'], '') > portalRank_(a['Portal Link'], '')) a['Portal Link'] = b['Portal Link'];
  a.Notes = [...new Set([a.Notes, b.Notes].filter(Boolean))].join(' · ');
}

function norm_(s) {
  return String(s || '').toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|technologies|labs|pvt|private|limited)\b\.?/g, '')
    .replace(/[^a-z0-9]+/g, '');
}

function isAtsUrl_(url) {
  return ATS_DOMAINS.some(d => String(url).toLowerCase().includes(d));
}
