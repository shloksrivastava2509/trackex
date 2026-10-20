/**
 * Install / uninstall. Users run these from the sheet menu (see Menu.gs); both are
 * idempotent, so clicking "Start tracking" twice never creates duplicates.
 */
function setup() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  setProp_('SHEET_ID', ss.getId());
  new Store().flush();                                   // creates the Applications/Deadlines/_State tabs
  const blank = ss.getSheetByName('Sheet1');
  if (blank && blank.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(blank);

  getTrackerCalendar_();
  if (!GmailApp.getUserLabelByName(CONFIG.TRACKED_LABEL)) GmailApp.createLabel(CONFIG.TRACKED_LABEL);

  removeTriggers_();
  ScriptApp.newTrigger('scanInbox').timeBased().everyMinutes(CONFIG.SCAN_EVERY_MINUTES).create();

  ss.toast('Scanning your inbox — the first run can take a few minutes…', APP_NAME, 10);
  const summary = scanInbox();
  return [
    `${APP_NAME} now checks your inbox every ${CONFIG.SCAN_EVERY_MINUTES} minutes. ${summary}`,
    `Deadlines go to the "${CONFIG.CALENDAR_NAME}" calendar.`,
    prop_('ANTHROPIC_API_KEY') ? 'Claude extraction: on.' : 'Tip: Trackex → Set Claude API key for much better deadline extraction.'
  ].join('\n');
}

function stopTracking() {
  removeTriggers_();
  return `${APP_NAME} stopped. Your sheet, calendar and labels are kept; Start tracking resumes.`;
}

/**
 * Clears the Applications sheet and scan state, then re-reads the whole lookback window
 * (e.g. after adding a Claude key). Deadlines are kept: that sheet is the calendar's
 * de-dup index, and clearing it would create duplicate events.
 */
function resetAndRescan() {
  const ss = spreadsheet_();
  ['Applications', '_State'].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  deleteProp_('BACKFILL_DONE');
  return scanInbox();
}

function removeTriggers_() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'scanInbox')
    .forEach(t => ScriptApp.deleteTrigger(t));
}

/**
 * Maintainers only: run once in the public template (Run ▶ prepareTemplate) to turn the
 * blank first tab into a "Start here" page. Touches only the sheet — no properties, no
 * triggers — so copies start clean.
 */
function prepareTemplate() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName('Start here') || ss.getSheets()[0].setName('Start here');
  sh.clear();
  const rows = [
    ['Trackex'],
    ['Your inbox, turned into an application tracker.'],
    [''],
    ['1.  Open the Trackex menu above (next to Help). It can take ~15 seconds to appear; if it doesn\'t, reload this page.'],
    ['2.  Click ▶ Start tracking and approve Google\'s permission prompt.'],
    ['     Google shows "hasn\'t verified this app" because the script runs as you, in your account: Advanced → Go to Trackex.'],
    ['3.  Save the personal Trackex link it gives you — it opens straight into your dashboard.'],
    [''],
    ['Optional: Trackex → 🔑 Set Claude API key for much better deadline extraction. Trackex scans every 30 minutes on its own.'],
    [''],
    ['Source, docs & issues: https://github.com/shloksrivastava2509/trackex']
  ];
  sh.getRange(1, 1, rows.length, 1).setValues(rows).setFontSize(12).setFontFamily('Roboto');
  sh.getRange('A1').setFontSize(28).setFontWeight('bold').setFontColor('#2563eb');
  sh.getRange('A2').setFontSize(13).setFontColor('#64748b');
  sh.getRange('A6').setFontColor('#64748b').setFontStyle('italic');
  sh.setColumnWidth(1, 900);
  sh.setHiddenGridlines(true);
  ss.setActiveSheet(sh);
}
