import type { Email, Extraction } from '@/lib/types';
import { pickPortalLink, portalFields, portalRank } from './heuristics';

/**
 * Keeps the portal link honest: it must be a link that is really in the email, and an
 * explicit "track your application" link found by the scorer beats anything weaker.
 */
export function refinePortal(data: Extraction, email: Email): Extraction {
  const app = data.application;
  if (data.category !== 'job_application' || !app) return data;
  const inEmail = new Set(email.links.map(l => l.url));
  if (app.portal_url && !inEmail.has(app.portal_url)) { app.portal_url = ''; app.portal_kind = ''; }
  const pick = pickPortalLink(email.links);
  if (pick.url && portalRank(pick.url, pick.kind) > portalRank(app.portal_url, app.portal_kind)) {
    Object.assign(app, portalFields(pick));
  }
  return data;
}
