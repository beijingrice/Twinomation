import test from 'node:test';
import assert from 'node:assert/strict';
import {hktInput,fromHkt,transferMargin} from '../src/timeInput.js';
import {connectionRows} from '../src/passengerGuidance.js';
import {passengerNoticeTemplate} from '../src/noticeTemplates.js';

test('HKT controls round-trip across UTC midnight, month and leap-day boundaries',()=>{
 for(const [iso,input] of [['2026-11-30T20:05:00Z','2026-12-01T04:05'],['2028-02-29T23:59:00Z','2028-03-01T07:59']]){
  assert.equal(hktInput(iso),input);assert.equal(Date.parse(fromHkt(input)),Date.parse(iso));
 }
 assert.equal(hktInput(null),'');assert.equal(fromHkt(''),null);
});
test('manual transfer calculation handles overnight deadlines, no margin and incomplete input',()=>{
 assert.equal(transferMargin('2026-11-15T23:30','2026-11-16T02:00',120),30);
 assert.equal(transferMargin('2026-11-15T23:30','2026-11-16T01:30',120),0);
 assert.equal(transferMargin('2026-11-15T23:30','2026-11-16T01:00',120),-30);
 assert.equal(transferMargin('','2026-11-16T01:00',120),null);
 assert.equal(transferMargin('2026-11-15T23:30','2026-11-16T01:00',0),null);
});
test('network rows with unconfirmed onward times stay neutral and on-time templates use approved fields',()=>{
 const result=connectionRows({flights:[{flight_no:'UO1',departure:null,status:'DELAYED'}],min_connection_minutes:60},{departure:'2026-11-15T01:00:00Z',block_minutes:120},new Date('2026-11-15T00:00:00Z'));
 assert.equal(result.rows[0].state,'unknown');assert.equal(result.rows[0].transferMinutes,null);
 const text=passengerNoticeTemplate('flight_update',{flight_no:'UO624',flight_status:'ON_TIME',public_departure:'2026-11-15T01:00:00Z',public_gate:'D1',reason:'private sentinel'});
 assert.match(text.text_zh,/按计划运行/);assert.match(text.text_en,/09:00 HKT/);assert.doesNotMatch(JSON.stringify(text),/sentinel/);
});
