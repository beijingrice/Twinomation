import { workOrderNextStep } from './workflow.js';
export { ACTIVE_WO, WO_STATUS, latestWO, notReady } from './workflow.js';
import { CloudLightning, Plane, PlaneLanding, Radio, Users, Wrench } from 'lucide-react';

export const REGIONS = [
  { code: 'JP', name: 'Japan', local: '日本' },
  { code: 'CN', name: 'China', local: '中国' },
  { code: 'TW', name: 'Taiwan', local: '台灣' },
  { code: 'KR', name: 'South Korea', local: '대한민국' },
  { code:'TH',name:'Thailand',local:'ประเทศไทย' }, {code:'PH',name:'Philippines',local:'Pilipinas'}
];

/** Demo outports (mirrors backend/db.py STATIONS) — used where no session exists yet, e.g. the workspace index. */
export const STATIONS = [
  { code: 'KIX', name: 'Osaka', region: 'JP' }, { code: 'NRT', name: 'Tokyo', region: 'JP' },
  { code: 'PVG', name: 'Shanghai', region: 'CN' }, { code: 'PEK', name: 'Beijing', region: 'CN' },
  { code: 'TPE', name: 'Taipei', region: 'TW' }, { code: 'KHH', name: 'Kaohsiung', region: 'TW' },
  { code: 'ICN', name: 'Seoul', region: 'KR' },
  {code:'BKK',name:'Bangkok',region:'TH'}, {code:'SYX',name:'Sanya',region:'CN'}, {code:'PKX',name:'Beijing Daxing',region:'CN'}, {code:'CRK',name:'Clark',region:'PH'}
];

/** Which client this page is. `/` is the workspace index; `/review` (v1 customer service) now lands there too. */
const PATH = window.location.pathname;
export const CARE_MODE=PATH.startsWith('/outport')&&new URLSearchParams(window.location.search).get('care')==='1';
export const MODE = PATH.startsWith('/passenger') ? 'passenger'
  : PATH.startsWith('/occ') ? 'occ'
  : PATH.startsWith('/outport') ? 'outport' : 'index';
export const WORKSPACE_PATH = { occ: '/occ', outport: '/outport' };
export const ME = { occ: 'occ', outport: 'station' }[MODE];

/* ---------- Work orders ---------- */

export const PRESET_ITEMS = [
  { key: 'fueling', label: 'Fueling' }, { key: 'ground_handling', label: 'Ground handling' }, { key: 'catering', label: 'Catering' },
  { key: 'gate', label: 'Gate' }, { key: 'counter', label: 'Counter' }, { key: 'crew', label: 'Crew' }
];
export const DEFAULT_ITEMS = ['fueling', 'ground_handling', 'catering', 'gate', 'counter'];
export const PRESET_OPTIONS = ['Ready', 'Pending', 'Unavailable'];
export const FLIGHT_STATUS = {
  ON_TIME:{label:'On time',tone:'good'},
  DISRUPTED: { label: 'Disrupted', tone: 'warn' }, DELAYED: { label: 'Delayed', tone: 'warn' },
  BOARDING: { label: 'Ready to board', tone: 'good' }, CANCELLED: { label: 'Cancelled', tone: 'bad' }
};

/** Tone for an item answer: "Ready" is good; custom answers stay neutral because only the station knows their meaning. */
export const answerTone = item => item.status == null ? 'none'
  : item.kind === 'custom' ? 'neutral'
  : item.status === 'Ready' ? 'good' : item.status === 'Unavailable' ? 'bad' : 'warn';

// Workload follows the workspace; displayed responsibility always names the team.
export const nextStep = c => workOrderNextStep(c, ME);

export const needsAction = c => nextStep(c).owner !== 'done';
export const waitingOn = (c, owner) => nextStep(c).owner === owner;
export const todoOf = list => list.filter(needsAction).length;
export const mineOf = list => list.filter(c => nextStep(c).mine).length;

/* ---------- Passenger feed ---------- */

/** Shared reason codes for operator forms; passenger wording lives in delayScenarios.js. */
export const CAUSES = {
  WEATHER: {icon: CloudLightning, title: 'Weather'},
  TECHNICAL: {icon: Wrench, title: 'Aircraft check'},
  ATC: {icon: Radio, title: 'Air traffic control'},
  LATE_AIRCRAFT: {icon: PlaneLanding, title: 'Late arriving aircraft'},
  CREW: {icon: Users, title: 'Crew scheduling'},
  OPERATIONAL: {icon: Plane, title: 'Operational reasons'}
};
export const CONNECTIONS = [['LHR', 'London'], ['SYD', 'Sydney'], ['SIN', 'Singapore'], ['BKK', 'Bangkok'], ['YVR', 'Vancouver']];

export const titleTopic = topic => ({ flight_status: 'Flight status', counter: 'Counter', gate: 'Gate', general: 'Message' }[topic] || 'Message');
export const humanize = value => (value || '').toLowerCase().replaceAll('_', ' ');
