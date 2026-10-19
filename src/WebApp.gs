/**
 * Dashboard. Normally opened from the sheet menu (Trackex → Open dashboard).
 * Optional: Deploy → New deployment → Web app (Execute as: Me, Access: Only myself)
 * gives a bookmarkable URL that serves the same page via doGet().
 */
function renderDashboard_() {
  const t = HtmlService.createTemplateFromFile('Dashboard');
  // Escape "<" so an email subject containing "</script>" can't break out of the inline JSON.
  t.dataJson = JSON.stringify(getDashboardData()).replace(/</g, '\\u003c');
  return t.evaluate().setTitle(APP_NAME);
}

function doGet() {
  return renderDashboard_().addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function getDashboardData() {
  const store = new Store();
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
    sheetUrl: SpreadsheetApp.getActiveSpreadsheet().getUrl(),
    lastScan: prop_('LAST_SCAN') || '',
    claude: !!prop_('ANTHROPIC_API_KEY')
  };
}

/** Called from the dashboard's "Scan now" button. */
function scanNowFromDashboard() {
  const summary = scanInbox();
  return { summary, data: getDashboardData() };
}
