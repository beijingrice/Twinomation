import { t } from './i18n.js';

export const ACTIVE_WO = ['SENT', 'RECEIVED', 'RESPONDED'];
export const WO_STATUS = {
  SENT: { label: 'Awaiting station receipt', tone: 'warn' },
  RECEIVED: { label: 'Awaiting station reply', tone: 'warn' },
  RESPONDED: { label: 'Awaiting OCC review', tone: 'brand' },
  AUTHORIZED: { label: 'Approved and published', tone: 'good' },
  REISSUED: { label: 'Replaced by a new version', tone: 'muted' },
  ABORTED: { label: 'Work order stopped', tone: 'bad' }
};
export const latestWO = c => c.work_order ?? c.work_orders?.[0] ?? null;
export const notReady = items => items.filter(i => i.kind === 'preset' && i.status !== 'Ready');

/** Display the named responsible team, separately from the current viewer's workload. */
export function workOrderNextStep(c, viewer = 'occ') {
  const step = (owner, text, detail) => ({ owner, mine: owner !== 'done' && owner === viewer, text, detail });
  if (c.status === 'CLOSED') {
    return step('done', t(c.flight_status === 'CANCELLED' ? 'Flight cancelled' : 'Case closed'),
      t(c.flight_status === 'CANCELLED' ? 'Cancellation published to passengers.' : 'Internal coordination is closed. Published history is retained.'));
  }
  const wo = latestWO(c);
  if (!wo) return step('occ', t('Next: OCC creates and sends a work order'), t('Request resource confirmation from {0} station.', {0: c.station}));
  switch (wo.status) {
    case 'SENT':
      return step('station', t('Next: {0} station acknowledges receipt', {0: c.station}), t('The station has not acknowledged this work order yet.'));
    case 'RECEIVED':
      return step('station', t('Next: {0} station checks resources and replies', {0: c.station}), t('OCC is waiting for the station’s resource answers.'));
    case 'RESPONDED': {
      const gaps = notReady(wo.items).length;
      const custom = wo.items.filter(i => i.kind === 'custom').length;
      const readiness = gaps ? t(gaps === 1 ? 'One preset item is not ready.' : '{0} preset items are not ready.', {0: gaps}) : t('All preset items are ready.');
      return step('occ', t(gaps ? 'Next: OCC reissues the work order' : 'Next: OCC reviews the station reply'),
        readiness + (custom ? ' ' + t(custom === 1 ? 'One custom item needs manual review.' : '{0} custom items need manual review.', {0: custom}) : ''));
    }
    case 'AUTHORIZED': {
      const status = { ON_TIME:'On time', DELAYED: 'Delayed', BOARDING: 'Ready to board', CANCELLED: 'Cancelled' }[c.flight_status] || 'updated';
      return step('done', t('Passenger information is updated'), t('Passenger page currently shows: {0}', {0: t(status)}));
    }
    case 'ABORTED':
      return step('occ', t('Next: OCC decides whether to start a new work order'), t('This work order is stopped; the flight has not been cancelled by this action.'));
    case 'REISSUED':
      return step('done', t('This version has been replaced'), t('Continue coordination in the latest work order.'));
    default:
      return step('occ', t('Next: OCC checks the work order'), t('Refresh to view the latest coordination status.'));
  }
}
