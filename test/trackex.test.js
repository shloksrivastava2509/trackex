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

  for (const phrase of [
    "We won't be moving forward with your application.",
    'We have chosen to proceed with other applicants whose experience more closely matches.',
    'After careful consideration, we will not be progressing your application.',
    'You are no longer being considered for this role.'
  ]) {
    test(`rejection phrasing → Rejected: "${phrase.slice(0, 40)}…"`, () => {
      const r = gs.extractWithHeuristics_(email('"Acme Careers" <jobs@acme.com>', 'Update on your Acme application', `Hi, thanks for applying. ${phrase}`));
      assert.equal(r.application.status, 'Rejected');
    });
  }

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

  test('extractLinks_ keeps http(s) links once, decodes &amp;, drops mailto, records context', () => {
    const links = gs.extractLinks_('<p>To see where things stand, <a href="https://a.com/x?y=1&amp;z=2">Go <b>now</b></a></p>' +
      '<a href="https://a.com/x?y=1&amp;z=2">dup</a><a href="mailto:x@y.z">mail</a>');
    assert.deepEqual(plain(links), [{ url: 'https://a.com/x?y=1&z=2', text: 'Go now', context: 'To see where things stand,' }]);
  });
});

describe('pickPortalLink_ (status portal link)', () => {
  const html = body => gs.extractLinks_(body);

  test('"To track your application, click here" beats the careers site', () => {
    const pick = gs.pickPortalLink_(html(
      '<p>Visit our <a href="https://careers.acme.com/">careers site</a> for more roles.</p>' +
      '<p>To track your application, <a href="https://acme.example-ats.com/r/abc123">click here</a>.</p>'));
    assert.equal(pick.url, 'https://acme.example-ats.com/r/abc123');
    assert.equal(pick.kind, 'application_status');
  });

  test('explicit "Track your application" link text wins', () => {
    const pick = gs.pickPortalLink_(html(
      '<a href="https://careers.globex.com/jobs">Careers</a><a href="https://globex.com/u/9f">Track your application</a>'));
    assert.equal(pick.url, 'https://globex.com/u/9f');
    assert.equal(pick.kind, 'application_status');
  });

  test('no tracking link → falls back to the careers portal', () => {
    const pick = gs.pickPortalLink_(html('<a href="https://twitter.com/acme">Twitter</a><a href="https://careers.acme.com/">Acme Careers</a>'));
    assert.equal(pick.url, 'https://careers.acme.com/');
    assert.equal(pick.kind, 'careers_portal');
  });

  test('job-alert and "similar jobs" links are never picked', () => {
    const pick = gs.pickPortalLink_(html('<a href="https://careers.acme.com/search">See similar jobs</a>'));
    assert.equal(pick.url, '');
  });
});

describe('refinePortal_', () => {
  const email = { links: gs.extractLinks_('<a href="https://careers.acme.com/">Careers</a>' +
    '<p>You can check your application status <a href="https://acme.ats.io/s/1">here</a>.</p>') };
  const data = (url, kind) => ({ category: 'job_application', application: { company: 'Acme', portal_url: url, portal_kind: kind } });

  test('a careers link from Claude is upgraded to the tracking link', () => {
    assert.equal(gs.refinePortal_(data('https://careers.acme.com/', 'careers_portal'), email).application.portal_url, 'https://acme.ats.io/s/1');
  });

  test('a URL that is not in the email is never kept', () => {
    assert.equal(gs.refinePortal_(data('https://made-up.example.com/', 'application_status'), email).application.portal_url, 'https://acme.ats.io/s/1');
  });
});

describe('Store.upsertApplication', () => {
  const freshStore = () => {
    const Store = gs.get('Store');
    const store = Object.create(Store.prototype);
    store.apps = { rows: [], add(r) { this.rows.push(r); return r; }, touch() {}, remove(r) { this.rows = this.rows.filter(x => x !== r); } };
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

  test('rejection naming the role differently updates the same row', () => {
    const s = freshStore();
    s.upsertApplication({ company: 'Stripe Recruiting', role: 'Software Engineering Intern', status: 'Applied' }, meta('2026-09-01'));
    s.upsertApplication({ company: 'Stripe, Inc.', role: 'Software Engineer Intern - Summer 2027', status: 'Rejected' }, meta('2026-10-01'));
    assert.equal(s.apps.rows.length, 1);
    assert.equal(s.apps.rows[0].Status, 'Rejected');
  });

  test('"SWE Intern" matches "Software Engineer Intern"', () => {
    const s = freshStore();
    s.upsertApplication({ company: 'Acme', role: 'Software Engineer Intern', status: 'Applied' }, meta('2026-09-01'));
    s.upsertApplication({ company: 'Acme', role: 'SWE Intern', status: 'Interview' }, meta('2026-10-01'));
    assert.equal(s.apps.rows.length, 1);
    assert.equal(s.apps.rows[0].Status, 'Interview');
  });

  test('different roles at one company stay separate', () => {
    const s = freshStore();
    s.upsertApplication({ company: 'Acme', role: 'Software Engineer Intern', status: 'Applied' }, meta('2026-09-01'));
    s.upsertApplication({ company: 'Acme', role: 'Data Engineer Intern', status: 'Applied' }, meta('2026-09-02'));
    assert.equal(s.apps.rows.length, 2);
  });

  test('a tracking link is not replaced by a later careers link', () => {
    const s = freshStore();
    s.upsertApplication({ company: 'Acme', role: 'SWE', status: 'Applied', portal_url: 'https://acme.ats.io/s/1', portal_kind: 'application_status' }, meta('2026-09-01'));
    s.upsertApplication({ company: 'Acme', role: 'SWE', status: 'Rejected', portal_url: 'https://careers.acme.com/', portal_kind: 'careers_portal' }, meta('2026-10-01'));
    assert.equal(s.apps.rows[0]['Portal Link'], 'https://acme.ats.io/s/1');
  });

  test('a tracking link replaces an earlier careers link', () => {
    const s = freshStore();
    s.upsertApplication({ company: 'Acme', role: 'SWE', status: 'Applied', portal_url: 'https://careers.acme.com/', portal_kind: 'careers_portal' }, meta('2026-09-01'));
    s.upsertApplication({ company: 'Acme', role: 'SWE', status: 'Assessment', portal_url: 'https://acme.ats.io/s/1', portal_kind: 'application_status' }, meta('2026-10-01'));
    assert.equal(s.apps.rows[0]['Portal Link'], 'https://acme.ats.io/s/1');
  });

  test('mergeDuplicateApplications folds split rows and keeps distinct roles', () => {
    const s = freshStore();
    const row = (Company, Role, Status, d, Notes = '') => ({ Company, Role, Status, 'Applied On': new Date(d), 'Last Update': new Date(d), Notes });
    s.apps.rows.push(
      row('Stripe', 'Software Engineering Intern', 'Applied', '2026-09-01', 'referral'),
      row('Stripe Recruiting', 'Software Engineer Intern - Summer 2027', 'Rejected', '2026-10-01'),
      row('Stripe', 'Data Engineer Intern', 'Applied', '2026-09-05'));
    assert.equal(s.mergeDuplicateApplications(), 1);
    assert.equal(s.apps.rows.length, 2);
    const swe = s.apps.rows.find(r => /Software/.test(r.Role));
    assert.equal(swe.Status, 'Rejected');
    assert.equal(swe.Notes, 'referral');
    assert.equal(swe['Applied On'].toISOString().slice(0, 10), '2026-09-01');
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

describe('parseClaudeResponse_', () => {
  test('429 and 5xx are retried', () => {
    assert.equal(gs.parseClaudeResponse_(429, '', 's').retry, true);
    assert.equal(gs.parseClaudeResponse_(529, '', 's').retry, true);
  });
  test('200 with JSON text → data', () => {
    const body = JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '{"category":"other"}' }] });
    assert.deepEqual(plain(gs.parseClaudeResponse_(200, body, 's')), { data: { category: 'other' } });
  });
  test('refusal or 401 → null data (heuristic fallback)', () => {
    assert.equal(gs.parseClaudeResponse_(200, JSON.stringify({ stop_reason: 'refusal', content: [] }), 's').data, null);
    assert.equal(gs.parseClaudeResponse_(401, '{}', 's').data, null);
  });
});
