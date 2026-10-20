/**
 * Gives each user a personal one-click dashboard link by deploying this copy's script
 * as a web app (Execute as: me, Access: only myself) through the Apps Script API.
 * Re-running updates the same deployment, so the link never changes.
 */
const SCRIPT_API = 'https://script.googleapis.com/v1/projects/';
const API_SETTINGS_URL = 'https://script.google.com/home/usersettings';

/** @return {{ok: boolean, url?: string, needsApiToggle?: boolean, error?: string}} */
function ensureWebApp_() {
  const base = SCRIPT_API + ScriptApp.getScriptId();
  const call = (method, path, body) => UrlFetchApp.fetch(base + path, {
    method,
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true,
    payload: body ? JSON.stringify(body) : undefined
  });

  const version = call('post', '/versions', { description: `${APP_NAME} dashboard` });
  if (version.getResponseCode() !== 200) return parseDeployResult_(version.getResponseCode(), version.getContentText());
  const config = {
    scriptId: ScriptApp.getScriptId(),
    versionNumber: JSON.parse(version.getContentText()).versionNumber,
    manifestFileName: 'appsscript',
    description: `${APP_NAME} dashboard`
  };

  const existingId = prop_('WEBAPP_DEPLOYMENT_ID');
  let res = existingId ? call('put', '/deployments/' + existingId, { deploymentConfig: config }) : null;
  if (!res || res.getResponseCode() === 404) res = call('post', '/deployments', config);  // none yet, or deleted by hand

  const result = parseDeployResult_(res.getResponseCode(), res.getContentText());
  if (result.ok) {
    setProp_('WEBAPP_DEPLOYMENT_ID', result.deploymentId);
    setProp_('WEBAPP_URL', result.url);
  }
  return result;
}

/** Pure: turns an Apps Script API response into a result the dialog can render. */
function parseDeployResult_(code, text) {
  let body = {};
  try { body = JSON.parse(text); } catch { /* non-JSON error page */ }
  if (code === 200) {
    const web = (body.entryPoints || []).find(e => e.entryPointType === 'WEB_APP');
    if (web && web.webApp && web.webApp.url) return { ok: true, url: web.webApp.url, deploymentId: body.deploymentId };
    return { ok: false, error: 'The deployment has no web-app entry point.' };
  }
  const message = (body.error && body.error.message) || String(text).slice(0, 300);
  if (code === 403 && /apps script api|has not been used|is disabled|not enabled/i.test(message)) {
    return { ok: false, needsApiToggle: true, error: message };
  }
  if (code === 403 && /insufficient (authentication )?scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(message)) {
    // Single-file installs that skipped appsscript.json lack the script.projects/deployments scopes.
    return { ok: false, needsManifest: true, error: message };
  }
  return { ok: false, error: `Apps Script API ${code}: ${message}` };
}

/** Called from the link dialog's "Try again" button. */
function retryWebApp() {
  return ensureWebApp_();
}
