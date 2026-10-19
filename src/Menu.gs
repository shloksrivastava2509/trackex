/**
 * The "Trackex" sheet menu — the whole user-facing setup flow lives here.
 * Handlers are public (no trailing _) because menus can't call private functions.
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu(APP_NAME)
    .addItem('▶ Start tracking', 'menuStart')
    .addItem('📊 Open dashboard', 'menuDashboard')
    .addItem('🔄 Scan now', 'menuScan')
    .addSeparator()
    .addItem('🔑 Set Claude API key (optional)', 'menuSetKey')
    .addItem('♻ Reset & rescan', 'menuReset')
    .addItem('⏹ Stop tracking', 'menuStop')
    .addToUi();
}

function menuStart() {
  SpreadsheetApp.getUi().alert(`${APP_NAME} is set up`, setup(), SpreadsheetApp.getUi().ButtonSet.OK);
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
    ui.alert('Saved. Run "Reset & rescan" to re-read past emails with Claude.');
  } else {
    deleteProp_('ANTHROPIC_API_KEY');
    ui.alert('Key removed — using keyword heuristics.');
  }
}

function menuReset() {
  const ui = SpreadsheetApp.getUi();
  if (ui.alert('Reset & rescan?', 'Clears the Applications tab and re-reads the last ' +
    `${CONFIG.INITIAL_LOOKBACK_DAYS} days of email. Calendar events are kept.`, ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;
  ui.alert(resetAndRescan());
}

function menuStop() {
  SpreadsheetApp.getUi().alert(stopTracking());
}
