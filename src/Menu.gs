/**
 * The "Trackex" sheet menu — the whole user-facing setup flow lives here.
 * Handlers are public (no trailing _) because menus can't call private functions.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(APP_NAME)
    .addItem('▶ Start tracking', 'menuStart')
    .addItem('🔗 Get my Trackex link', 'menuLink')
    .addItem('📊 Open dashboard', 'menuDashboard')
    .addItem('🔄 Scan now', 'menuScan')
    .addSeparator()
    .addItem('🔑 Set Claude API key (optional)', 'menuSetKey')
    .addItem('♻ Re-check all emails', 'menuReset')
    .addItem('⏹ Stop tracking', 'menuStop')
    .addToUi();
}

function menuStart() {
  const summary = setup();
  showLinkDialog_(`${APP_NAME} is set up`, summary, safeEnsureWebApp_());
}

function menuLink() {
  const url = prop_('WEBAPP_URL');
  showLinkDialog_(`Your ${APP_NAME} link`, '', url ? { ok: true, url } : safeEnsureWebApp_());
}

function safeEnsureWebApp_() {
  try {
    return ensureWebApp_();
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function showLinkDialog_(title, summary, link) {
  const t = template_('LinkDialog');
  t.dataJson = JSON.stringify({ summary, link, settingsUrl: API_SETTINGS_URL, releaseUrl: 'https://github.com/shloksrivastava2509/trackex/releases/latest' }).replace(/</g, '\\u003c');
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(560).setHeight(summary ? 380 : 260), title);
}

function menuDashboard() {
  SpreadsheetApp.getUi().showModalDialog(renderDashboard_().setWidth(1100).setHeight(720), APP_NAME);
}

function menuScan() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.toast('Scanning…', APP_NAME, 5);
  ss.toast(scanInbox(), APP_NAME, 10);
}

function menuSetKey() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt(
    'Claude API key',
    'Paste an Anthropic API key (from console.anthropic.com) to use Claude for extraction.\n' +
    'It is stored only in your private user properties for this script. Leave empty to remove it.',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const key = res.getResponseText().trim();
  if (key) {
    setProp_('ANTHROPIC_API_KEY', key);
    ui.alert('Saved. Run "Re-check all emails" to re-read past emails with Claude.');
  } else {
    deleteProp_('ANTHROPIC_API_KEY');
    ui.alert('Key removed — using keyword heuristics.');
  }
}

function menuReset() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Re-check all emails?', `Re-reads the last ${CONFIG.INITIAL_LOOKBACK_DAYS} days of email and corrects ` +
    'statuses, portal links and duplicates in place. Your notes and calendar events are kept. ' +
    'Big inboxes finish over the next few automatic runs.', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  ui.alert(resetAndRescan());
}

function menuStop() {
  SpreadsheetApp.getUi().alert(stopTracking());
}
