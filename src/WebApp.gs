/**
 * Dashboard. Normally opened from the sheet menu (Trackex → Open dashboard).
 * Optional: Deploy → New deployment → Web app (Execute as: Me, Access: Only myself)
 * gives a bookmarkable URL that serves the same page via doGet().
 */
function renderDashboard_() {
  const t = template_('Dashboard');
  // Escape "<" so an email subject containing "</script>" can't break out of the inline JSON.
  t.dataJson = JSON.stringify(getDashboardData()).replace(/</g, '\\u003c');
  return t.evaluate().setTitle(APP_NAME);
}

/**
 * The single-file build (dist/Code.gs) inlines the HTML as BUNDLED_HTML_, so a manual
 * install only needs Code.gs pasted; the clasp/template install uses the .html files.
 */
function template_(name) {
  return typeof BUNDLED_HTML_ !== 'undefined'
    ? HtmlService.createTemplate(BUNDLED_HTML_[name])
    : HtmlService.createTemplateFromFile(name);
}

function doGet() {
  return renderDashboard_().addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getDashboardData() {
  const store = new Store({ withState: false });
  const iso = v => (v instanceof Date ? v.toISOString() : (v ? String(v) : ''));
  const now = Date.now();
  return {
    applications: store.apps.rows.map(r => ({
      company: r.Company, role: r.Role, type: r.Type, status: r.Status,
      appliedOn: iso(r['Applied On']), lastUpdate: iso(r['Last Update']),
      portal: r['Portal Link'], email: r['Email Link'], subject: r['Last Email Subject'], notes: r.Notes
    })),
    deadlines: store.deadlines.rows
      .filter(r => new Date(r.Starts).getTime() > now - 24 * 3600 * 1000)
      .sort((a, b) => new Date(a.Starts) - new Date(b.Starts))
      .map(r => ({
        title: r.Title, org: r.Organization, kind: r.Kind, starts: iso(r.Starts),
        allDay: r['All Day'] === true || r['All Day'] === 'TRUE', link: r.Link, email: r['Email Link']
      })),
    sheetUrl: spreadsheet_().getUrl(),
    lastScan: prop_('LAST_SCAN') || '',
    appUrl: prop_('WEBAPP_URL') || '',
    claude: !!prop_('ANTHROPIC_API_KEY')
  };
}

/** Called from the dashboard's "Scan now" button. */
function scanNowFromDashboard() {
  const summary = scanInbox();
  return { summary, data: getDashboardData() };
}
