/**
 * Puts extracted deadlines/events on a dedicated Google Calendar (so they can be
 * toggled or recoloured as a group) and records them in the Deadlines sheet,
 * which doubles as the de-duplication index.
 */
const KIND_PREFIX = {
  registration_deadline: '⏰ Register',
  submission_deadline: '⏰ Submit',
  application_deadline: '⏰ Apply',
  assessment_due: '📝 Assessment due',
  interview: '🎤 Interview',
  event_start: '🏁 Starts',
  event_end: '🏁 Ends',
  other: '📌'
};
const DEADLINE_KINDS = ['registration_deadline', 'submission_deadline', 'application_deadline', 'assessment_due'];

function getTrackerCalendar_() {
  const id = prop_('CALENDAR_ID');
  let cal = id && CalendarApp.getCalendarById(id);
  if (!cal) {
    cal = CalendarApp.getCalendarsByName(CONFIG.CALENDAR_NAME)[0] ||
      CalendarApp.createCalendar(CONFIG.CALENDAR_NAME, { color: '#D50000' });
    setProp_('CALENDAR_ID', cal.getId());
  }
  return cal;
}

/** @return {boolean} true if a new calendar event was created. */
function addEventToCalendar_(ev, email, store) {
  const start = new Date(ev.start_iso);
  if (!ev.title || isNaN(start)) return false;
  const end = ev.end_iso ? new Date(ev.end_iso) : null;

  // Same event announced by several emails (reminders, "48 hours left!") → one entry.
  const day = Utilities.formatDate(start, userTimeZone_(), 'yyyy-MM-dd');
  const key = `${norm_(ev.organization) || norm_(ev.title)}|${ev.kind}|${day}`;
  if (store.findDeadline(key)) return false;

  const row = store.deadlines.add({
    Key: key,
    Title: ev.title,
    Organization: ev.organization,
    Kind: ev.kind,
    Starts: start,
    Ends: end || '',
    'All Day': ev.all_day,
    Link: ev.url,
    'Email Link': email.emailLink,
    'Calendar Event Id': '',
    'Added On': new Date()
  });

  if (start.getTime() < Date.now() - 24 * 3600 * 1000) return false; // past: record only

  const cal = getTrackerCalendar_();
  const title = `${KIND_PREFIX[ev.kind] || '📌'}: ${ev.title}`;
  const description = [
    ev.url && `Link: ${ev.url}`,
    `Source email: ${email.emailLink}`,
    `Subject: ${email.subject}`,
    '',
    'Added automatically by Trackex — https://github.com/shloksrivastava2509/trackex'
  ].filter(x => x !== undefined && x !== '').join('\n');

  let event;
  if (ev.all_day) {
    event = end && end > start
      ? cal.createAllDayEvent(title, start, new Date(end.getTime() + 24 * 3600 * 1000), { description })
      : cal.createAllDayEvent(title, start, { description });
  } else if (DEADLINE_KINDS.includes(ev.kind) || !end || end <= start) {
    // A deadline is a moment; show it as the 30 minutes leading up to it.
    event = cal.createEvent(title, new Date(start.getTime() - 30 * 60 * 1000), start, { description });
  } else {
    event = cal.createEvent(title, start, end, { description });
  }
  event.removeAllReminders();
  CONFIG.REMINDERS_MIN.forEach(min => event.addPopupReminder(min));

  row['Calendar Event Id'] = event.getId();
  return true;
}
