import {DELAY_SCENARIOS} from './delayScenarios.js';

/** Stable local-demo addresses: no credential issuance or expiry. */
export function passengerPreviewPath(caseId, connection = null, scenario = null) {
  const query = new URLSearchParams();
  if (caseId != null) query.set('case', String(caseId));
  if (connection) query.set('connection', connection);
  if (scenario && Object.hasOwn(DELAY_SCENARIOS,scenario)) query.set('scenario',scenario);
  return '/passenger' + (query.size ? `?${query}` : '');
}
export function parsePassengerPreview(search) {
  const query = new URLSearchParams(search);
  const id = Number(query.get('case'));
  return {caseId: Number.isInteger(id) && id > 0 ? id : null, connection: query.get('connection') || null, scenario: Object.hasOwn(DELAY_SCENARIOS,query.get('scenario')) ? query.get('scenario') : null};
}
