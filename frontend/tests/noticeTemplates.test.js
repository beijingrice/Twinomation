import test from 'node:test';
import assert from 'node:assert/strict';
import {NOTICE_TEMPLATES,passengerNoticeTemplate,publishedNoticeForEvent} from '../src/noticeTemplates.js';

const record={flight_no:'TW602',flight_status:'DISRUPTED',reason:'INTERNAL-SECRET',proposed_departure:'2026-11-15T07:00:00Z',public_departure:null,public_gate:null,delay_cause:null,work_orders:[{items:[{note:'Gate 99 INTERNAL-SECRET'}]}]};
test('templates never copy internal events, proposals or unapproved gates into passenger notices',()=>{
  for(const [id] of NOTICE_TEMPLATES) {
    const copy=passengerNoticeTemplate(id,record);
    assert.equal(typeof copy.text_zh,'string');assert.equal(typeof copy.text_en,'string');
    assert.doesNotMatch(JSON.stringify(copy),/INTERNAL-SECRET|99|15:00/);
    if(id!=='custom') assert.ok(copy.text_zh.includes('TW602') && copy.text_en.includes('TW602'));
  }
  assert.deepEqual(passengerNoticeTemplate('custom',record),{text_zh:'',text_en:''});
});
test('flight arrangement templates use only published delay, boarding and cancellation facts',()=>{
  const delayed=passengerNoticeTemplate('flight_update',{...record,flight_status:'DELAYED',public_departure:'2026-11-15T04:30:00Z',public_gate:'18',delay_cause:'WEATHER'});
  assert.match(delayed.text_zh,/天气影响.*12:30.*登机口：18/);
  assert.match(delayed.text_en,/weather.*12:30 HKT.*Gate: 18/);
  const pending=passengerNoticeTemplate('flight_update',{...record,flight_status:'DELAYED'});
  assert.match(pending.text_zh,/起飞时间仍待确认/);
  assert.doesNotMatch(pending.text_zh,/15:00/);
  assert.match(passengerNoticeTemplate('flight_update',{...record,flight_status:'BOARDING'}).text_en,/ready to board/);
  assert.match(passengerNoticeTemplate('flight_update',{...record,flight_status:'CANCELLED'}).text_zh,/已取消/);
});
test('further editing reuses published text linked to the event, never an internal pending draft',()=>{
  const updates=[{id:5,status:'PENDING',source_event_id:1,draft_text:'internal'}, {id:4,status:'PUBLISHED',source_event_id:2,final_text:'Public notice'}];
  assert.equal(publishedNoticeForEvent({updates},{id:1,type:'NOTE_ADDED',payload:{}}),undefined);
  assert.equal(publishedNoticeForEvent({updates},{id:2,type:'NOTE_ADDED',payload:{}}).id,4);
  assert.equal(publishedNoticeForEvent({updates},{id:3,type:'PASSENGER_NOTICE_PUBLISHED',payload:{update_id:4}}).id,4);
});
