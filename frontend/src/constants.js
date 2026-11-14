import { Fuel, Plane, Ticket, Truck, Utensils } from 'lucide-react';

export const CONDITION_META = [
  { key: 'fueling', title: 'Fueling', short: 'Fuel', icon: Fuel },
  { key: 'ground_handling', title: 'Ground handling', short: 'Ground', icon: Truck },
  { key: 'catering', title: 'Catering', short: 'Catering', icon: Utensils },
  { key: 'gate', title: 'Gate availability', short: 'Gate', icon: Plane },
  { key: 'counter', title: 'Counter availability', short: 'Counter', icon: Ticket }
];

export const REGIONS = [
  { code: 'JP', name: 'Japan', local: '日本' },
  { code: 'CN', name: 'China', local: '中国' },
  { code: 'TW', name: 'Taiwan', local: '台灣' },
  { code: 'KR', name: 'South Korea', local: '대한민국' }
];

/** Demo outports (mirrors backend/db.py STATIONS) — used where no session exists yet, e.g. the workspace index. */
export const STATIONS = [
  { code: 'KIX', name: 'Osaka', region: 'JP' }, { code: 'NRT', name: 'Tokyo', region: 'JP' },
  { code: 'PVG', name: 'Shanghai', region: 'CN' }, { code: 'PEK', name: 'Beijing', region: 'CN' },
  { code: 'TPE', name: 'Taipei', region: 'TW' }, { code: 'KHH', name: 'Kaohsiung', region: 'TW' },
  { code: 'ICN', name: 'Seoul', region: 'KR' }
];

/** Which workspace this page is: `/` is the workspace index; each role has its own entry path. */
const PATH = window.location.pathname;
export const MODE = PATH.startsWith('/passenger') ? 'passenger'
  : PATH.startsWith('/occ') ? 'occ'
  : PATH.startsWith('/outport') ? 'outport'
  : PATH.startsWith('/review') ? 'cs' : 'index';
export const WORKSPACE_PATH = { occ: '/occ', outport: '/outport', cs: '/review' };

export const countReady = c => Object.values(c.conditions).filter(x => x.status === 'CONFIRMED').length;

export const OWNER_LABEL = { station: 'Station', occ: 'Operations', cs: 'Customer service', done: 'Done' };

const pendingOf = c => c.pending_updates ?? c.updates?.filter(u => u.status === 'PENDING').length ?? 0;
const listWords = items => items.length <= 2 ? items.join(' and ') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

/** The role the current viewer acts as, in owner terms. */
export const ME = { occ: 'occ', outport: 'station', cs: 'cs' }[MODE];

/**
 * Everything an open case is waiting for, in workflow order. Work is parallel: customer service can review
 * drafts while the station is still confirming resources, so a case can wait on several owners at once.
 */
export function openSteps(c) {
  if (c.status === 'CLOSED') return [];
  const steps = [];
  if (!c.acknowledged) steps.push({ owner: 'station', who: c.station, text: 'acknowledge the case' });
  const blocked = CONDITION_META.filter(m => c.conditions[m.key].status === 'UNAVAILABLE');
  if (blocked.length) steps.push({ owner: 'occ', who: 'Operations', text: `coordinate — ${listWords(blocked.map(m => m.short.toLowerCase()))} unavailable` });
  const missing = CONDITION_META.filter(m => c.conditions[m.key].status === 'PENDING');
  if (c.acknowledged && missing.length) steps.push({ owner: 'station', who: c.station, text: `confirm ${listWords(missing.map(m => m.short.toLowerCase()))}` });
  const pending = pendingOf(c);
  if (pending) steps.push({ owner: 'cs', who: 'Customer service', text: `review ${pending} passenger update${pending === 1 ? '' : 's'}` });
  return steps;
}

/**
 * The one step to show for a case: the viewer's own task if they have one, otherwise the earliest outstanding step.
 * `who` reads "You" when the step is the viewer's.
 */
export function nextStep(c, me = ME) {
  if (c.status === 'CLOSED') return { owner: 'done', who: '', text: 'Case closed' };
  const steps = openSteps(c);
  const step = steps.find(s => s.owner === me) || steps[0];
  if (!step) return { owner: 'done', who: '', text: 'All set — nothing waiting' };
  return { ...step, mine: step.owner === me, who: step.owner === me ? 'You' : step.who, more: steps.length - 1 };
}

/** An open case needs attention while anyone still has work on it. */
export const needsAction = c => openSteps(c).length > 0;
export const waitingOn = (c, owner) => openSteps(c).some(s => s.owner === owner);

export const titleTopic = topic => ({ flight_status: 'Flight status', counter: 'Counter', gate: 'Gate', general: 'Passenger message' }[topic] || 'Passenger message');

export const humanize = value => (value || '').toLowerCase().replaceAll('_', ' ');

export const todoOf = list => list.filter(needsAction).length;
