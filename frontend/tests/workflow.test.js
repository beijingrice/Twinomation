import test from 'node:test';
import assert from 'node:assert/strict';
import { workOrderNextStep, WO_STATUS } from '../src/workflow.js';
import { setLanguage } from '../src/i18n.js';

const flight = (state, items = []) => ({status:'OPEN',station:'KIX',flight_status:'DELAYED',work_order: state ? {status:state,number:1,items} : null});

test('responsibility is named consistently across workspaces; only workload ownership changes', () => {
  setLanguage('zh');
  for (const state of ['SENT','RECEIVED','RESPONDED']) {
    const occ = workOrderNextStep(flight(state), 'occ');
    const station = workOrderNextStep(flight(state), 'station');
    assert.equal(occ.text, station.text);
    assert.equal(occ.detail, station.detail);
    assert.notEqual(occ.mine, station.mine);
    assert.doesNotMatch(occ.text, /你|You/);
    assert.match(occ.text, state === 'RESPONDED' ? /OCC/ : /KIX 外站/);
  }
});

test('a replied work order calls for review, including custom items that do not count as ready', () => {
  setLanguage('zh');
  const result = workOrderNextStep(flight('RESPONDED', [
    {kind:'preset',status:'Ready'}, {kind:'custom',status:'Not available'}
  ]));
  assert.equal(result.owner, 'occ');
  assert.match(result.text, /OCC 审核/);
  assert.match(result.detail, /预设资源均已就绪/);
  assert.match(result.detail, /1 项自定义内容需人工复核/);
  const pending = workOrderNextStep(flight('RESPONDED',[{kind:'preset',status:'Pending'}]));
  assert.match(pending.text, /重新发起工单/);
  assert.match(pending.detail, /1 项预设资源尚未就绪/);
});

test('publication, stopping and flight cancellation keep distinct meanings', () => {
  setLanguage('zh');
  const published = workOrderNextStep(flight('AUTHORIZED'));
  assert.equal(published.owner, 'done');
  assert.equal(published.mine, false);
  assert.match(published.detail, /乘客页当前显示：延误/);
  const stopped = workOrderNextStep(flight('ABORTED'));
  assert.equal(stopped.owner, 'occ');
  assert.match(stopped.detail, /不代表取消航班/);
  const cancelled = workOrderNextStep({...flight('ABORTED'),status:'CLOSED',flight_status:'CANCELLED'});
  assert.equal(cancelled.owner, 'done');
  assert.match(cancelled.text, /航班已取消/);
});

test('English labels explain the workflow without viewer-dependent pronouns', () => {
  setLanguage('en');
  assert.equal(WO_STATUS.RESPONDED.label, 'Awaiting OCC review');
  assert.equal(WO_STATUS.AUTHORIZED.label, 'Approved and published');
  assert.match(workOrderNextStep(flight('SENT')).text, /KIX station acknowledges receipt/);
  assert.match(workOrderNextStep(flight(null)).text, /OCC creates and sends/);
});
