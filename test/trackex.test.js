// Unit tests for the pure parts of Trackex, run under Node with the Apps Script
// files loaded into a shared VM context (mirroring Apps Script's single global scope).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const FILES = ['Config.gs', 'Store.gs', 'Heuristics.gs', 'Claude.gs', 'Scanner.gs', 'Deploy.gs'];

function load() {
  const ctx = vm.createContext({ console, Session: { getScriptTimeZone: () => 'UTC' } });
  for (const f of FILES) vm.runInContext(readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8'), ctx, { filename: f });
  // Top-level const/class bindings aren't properties of the context; fetch them by evaluation.
  ctx.get = name => vm.runInContext(name, ctx);
  return ctx;
}

const gs = load();
// Objects built inside the VM have that realm's prototypes; compare as plain data.
const plain = v => JSON.parse(JSON.stringify(v));
const SENT = new Date('2026-10-10T10:00:00Z');
const email = (from, subject, body, html = '') =>
  ({ from, subject, body, date: SENT, links: gs.extractLinks_(html), emailLink: 'https://mail.google.com/x' });

describe('extractWithHeuristics_', () => {
  test('application confirmation from an ATS → Applied, company from display name, portal link', () => {
    const r = gs.extractWithHeuristics_(email(
      '"Stripe Recruiting" <no-reply@greenhouse.io>', 'Thank you for applying to Stripe',
      'Hi, thank you for applying to the Software Engineering Intern role. We have received your application.',
      '<a href="https://example.com/unsubscribe">Unsubscribe</a><a href="https://my.greenhouse.io/applications/123">View your application status</a>'));
    assert.equal(r.category, 'job_application');
    assert.equal(r.application.company, 'Stripe');
    assert.equal(r.application.role, 'Software Engineering Intern');
    assert.equal(r.application.kind, 'Internship');
    assert.equal(r.application.status, 'Applied');
    assert.equal(r.application.portal_url, 'https://my.greenhouse.io/applications/123');
  });

  test('rejection without a role → Rejected, role not confused with company', () => {
    const r = gs.extractWithHeuristics_(email('"Google Careers" <careers@google.com>', 'Your application to Google',
      'Unfortunately, we have decided to move forward with other candidates.'));
    assert.equal(r.application.status, 'Rejected');
    assert.equal(r.application.company, 'Google');
    assert.equal(r.application.role, '');
  });

  test('online assessment with a dated deadline → Assessment + a calendar event', () => {
    const r = gs.extractWithHeuristics_(email('"Acme Talent" <talent@acme.io>', 'Online assessment: Backend Engineer',
      'Please complete the HackerRank coding challenge. The assessment is due by October 15, 2026 11:59 pm.',
      '<a href="https://www.hackerrank.com/test/abc">Start assessment</a>'));
    assert.equal(r.application.status, 'Assessment');
    assert.equal(r.events.length, 1);
    assert.equal(r.events[0].all_day, false);
    assert.equal(r.events[0].url, 'https://www.hackerrank.com/test/abc');
  });

  test('hackathon email → event category with submission deadline and start date', () => {
    const r = gs.extractWithHeuristics_(email('"Devpost" <support@devpost.com>', 'HackHarvard 2026: submissions close soon',
      'Reminder: the submission deadline is Oct 24 at 5:00 PM. Hacking begins 18 October 2026.',
      '<a href="https://hackharvard.devpost.com/">Submit project</a>'));
    assert.equal(r.category, 'hackathon_or_event');
    assert.deepEqual(plain(r.events.map(e => e.kind).sort()), ['event_start', 'submission_deadline']);
    assert.ok(!r.events.some(e => e.start_iso.startsWith('2026-10-20')), 'the year must not be read as a day');
  });

  test('job alert newsletter → ignored', () => {
    const r = gs.extractWithHeuristics_(email('"LinkedIn" <jobs-noreply@linkedin.com>', '10 new jobs for you',
      'Software Engineer at X. Apply now.'));
    assert.equal(r.category, 'other');
    assert.equal(r.events.length, 0);
  });

  test('date without a year that already passed rolls into next year', () => {
    const r = gs.extractWithHeuristics_(email('"MLH" <hi@mlh.io>', 'MLH Fellowship applications',
      'Applications close Jan 5. Apply early!'));
    assert.equal(new Date(r.events[0].start_iso).getFullYear(), 2027);
  });
});

describe('helpers', () => {
  test('norm_ strips legal suffixes and punctuation', () => {
    assert.equal(gs.norm_('Stripe, Inc.'), 'stripe');
    assert.equal(gs.norm_('Acme Technologies Pvt Ltd'), 'acme');
  });

  test('extractLinks_ keeps http(s) links once, decodes &amp;, drops mailto', () => {
    const links = gs.extractLinks_('<a href="https://a.com/x?y=1&amp;z=2">Go <b>now</b></a>' +
      '<a href="https://a.com/x?y=1&amp;z=2">dup</a><a href="mailto:x@y.z">mail</a>');
    assert.deepEqual(plain(links), [{ url: 'https://a.com/x?y=1&z=2', text: 'Go now' }]);
  });

  test('pickPortalLink_ prefers ATS / status links over generic ones', () => {
    const url = gs.pickPortalLink_([
      { text: 'Our blog', url: 'https://acme.com/blog' },
      { text: 'Check your status', url: 'https://acme.wd5.myworkdayjobs.com/candidate' }
    ]);
    assert.equal(url, 'https://acme.wd5.myworkdayjobs.com/candidate');
  });
});

describe('Store.upsertApplication', () => {
  const freshStore = () => {
    const Store = gs.get('Store');
    const store = Object.create(Store.prototype);
    store.apps = { rows: [], add(r) { this.rows.push(r); return r; }, touch() {} };
    return store;
  };
  const meta = (iso, subject = 's') => ({ date: new Date(iso), subject, emailLink: 'l' });

  test('older email (backfill order) never overwrites a newer status', () => {
    const s = freshStore();
    s.upsertApplication({ company: 'Acme', role: 'SWE', status: 'Rejected' }, meta('2026-10-10'));
    s.upsertApplication({ company: 'Acme', role: 'SWE', status: 'Applied' }, meta('2026-09-01'));
    assert.equal(s.apps.rows.length, 1);
    assert.equal(s.apps.rows[0].Status, 'Rejected');
    assert.equal(s.apps.rows[0]['Applied On'].toISOString().slice(0, 10), '2026-09-01');
  });

  test('a later generic "under review" note does not demote Interview', () => {
    const s = freshStore();
    s.upsertApplication({ company: 'Acme', role: 'SWE', status: 'Interview' }, meta('2026-10-01'));
    s.upsertApplication({ company: 'Acme', role: 'SWE', status: 'Under Review' }, meta('2026-10-05'));
    assert.equal(s.apps.rows[0].Status, 'Interview');
  });

  test('role-less update attaches to the existing row for that company', () => {
    const s = freshStore();
    s.upsertApplication({ company: 'Google', role: 'STEP Intern', status: 'Applied' }, meta('2026-09-01'));
    s.upsertApplication({ company: 'Google LLC', role: '', status: 'Rejected' }, meta('2026-10-01'));
    assert.equal(s.apps.rows.length, 1);
    assert.equal(s.apps.rows[0].Status, 'Rejected');
  });
});

describe('Claude structured-output schema', () => {
  // Structured outputs require every property to be listed in `required` and
  // additionalProperties: false on every object.
  const walk = (node, path = 'root') => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, `${path}: additionalProperties`);
      assert.deepEqual(plain([...node.required].sort()), plain(Object.keys(node.properties).sort()), `${path}: required`);
      for (const [k, v] of Object.entries(node.properties)) walk(v, `${path}.${k}`);
    } else if (node.type === 'array') {
      walk(node.items, `${path}[]`);
    }
  };

  test('schema is strict and status enum matches STATUSES', () => {
    const schema = gs.extractionSchema_();
    walk(schema);
    assert.deepEqual(plain(schema.properties.application.properties.status.enum), plain([...gs.get('STATUSES'), '']));
  });
});

describe('parseDeployResult_', () => {
  test('success → the web-app URL and deployment id', () => {
    const body = JSON.stringify({
      deploymentId: 'AKfy123',
      entryPoints: [{ entryPointType: 'WEB_APP', webApp: { url: 'https://script.google.com/macros/s/AKfy123/exec' } }]
    });
    assert.deepEqual(plain(gs.parseDeployResult_(200, body)),
      { ok: true, url: 'https://script.google.com/macros/s/AKfy123/exec', deploymentId: 'AKfy123' });
  });

  test('Apps Script API switched off → needsApiToggle', () => {
    const body = JSON.stringify({ error: { code: 403, message: 'User has not enabled the Apps Script API. Enable it by visiting https://script.google.com/home/usersettings' } });
    const r = gs.parseDeployResult_(403, body);
    assert.equal(r.ok, false);
    assert.equal(r.needsApiToggle, true);
  });

  test('missing manifest scopes → needsManifest', () => {
    const body = JSON.stringify({ error: { code: 403, message: 'Request had insufficient authentication scopes.' } });
    const r = gs.parseDeployResult_(403, body);
    assert.equal(r.needsManifest, true);
    assert.equal(r.needsApiToggle, undefined);
  });

  test('other errors are reported, not treated as the toggle', () => {
    const r = gs.parseDeployResult_(500, '<html>Server error</html>');
    assert.equal(r.ok, false);
    assert.equal(r.needsApiToggle, undefined);
    assert.match(r.error, /500/);
  });

  test('200 without a web-app entry point is an error', () => {
    assert.equal(gs.parseDeployResult_(200, JSON.stringify({ deploymentId: 'x', entryPoints: [] })).ok, false);
  });
});
