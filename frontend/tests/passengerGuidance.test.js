import test from 'node:test';
import assert from 'node:assert/strict';
import {guidanceMode,connectionRows} from '../src/passengerGuidance.js';
import {AIRPORT_DIRECTORIES} from '../src/airportContent.js';

test('guidance follows the 120-minute delay boundary; unknown times never become invented forecasts',()=>{
  const base={status:'DELAYED',scheduled:'2026-11-15T08:00:00Z'};
  assert.equal(guidanceMode({...base,departure:'2026-11-15T09:59:59Z'}),'short');
  assert.equal(guidanceMode({...base,departure:'2026-11-15T10:00:00Z'}),'long');
  assert.equal(guidanceMode({...base,departure:null}),'pending');
  for(const status of ['BOARDING','AWAITING','CANCELLED']) assert.equal(guidanceMode({...base,status}),'none');
});

const connection={booked:'TW801',min_connection_minutes:60,flights:[
  {flight_no:'TW800',departure:'2026-11-15T09:00:00Z'},
  {flight_no:'TW801',departure:'2026-11-15T10:59:59Z'},
  {flight_no:'TW802',departure:'2026-11-15T11:00:00Z'},
  {flight_no:'TW803',departure:'2026-11-15T12:00:00Z',status:'CANCELLED'}
]};
const status={departure:'2026-11-15T08:00:00Z',block_minutes:120};

test('read-only connection feasibility observes departure, cancellation and minimum transfer boundaries',()=>{
  const result=connectionRows(connection,status,new Date('2026-11-15T09:00:00Z'));
  assert.equal(result.arrival.toISOString(),'2026-11-15T10:00:00.000Z');
  assert.deepEqual(result.rows.map(r=>r.state),['departed','limited','possible','cancelled']);
  assert.deepEqual(result.rows.map(r=>r.unavailable),[true,true,false,true]);
  assert.equal(result.rows[1].booked,true);
});

test('the clock changes green to yellow to red after arrival, then marks departure',()=>{
  const before=connectionRows(connection,status,new Date('2026-11-15T09:00:00Z'));
  const warning=connectionRows(connection,status,new Date('2026-11-15T10:15:00Z'));
  const urgent=connectionRows(connection,status,new Date('2026-11-15T10:30:00Z'));
  const after=connectionRows(connection,status,new Date('2026-11-15T11:00:00Z'));
  assert.equal(before.rows[2].state,'possible');
  assert.equal(warning.rows[2].state,'limited');
  assert.equal(warning.rows[2].transferMinutes,45);
  assert.equal(urgent.rows[2].state,'tight');
  assert.equal(urgent.rows[2].transferMinutes,30);
  assert.equal(after.rows[2].state,'departed');
  assert.equal(after.rows[2].unavailable,true);
  assert.equal(connection.flights[2].status,undefined);
});

test('30 minutes is red, more than 30 and less than 60 is yellow, 60 minutes is green',()=>{
  const minutes=[-1,0,29.99,30,30.01,59.99,60,60.01];
  const flights=minutes.map((m,i)=>({flight_no:`TW${i}`,departure:new Date(Date.parse('2026-11-15T10:00:00Z')+m*60000).toISOString()}));
  const result=connectionRows({...connection,flights},status,new Date('2026-11-15T09:00:00Z'));
  assert.deepEqual(result.rows.map(r=>r.state),['tight','tight','tight','tight','limited','limited','possible','possible']);
  assert.deepEqual(result.rows.map(r=>r.transferMinutes),minutes);
});

test('unknown arrival never claims a viable connection; revised onward estimates are respected',()=>{
  const result=connectionRows(connection,{...status,departure:null},new Date('2026-11-15T09:00:00Z'));
  assert.equal(result.arrival,null);
  assert.equal(result.rows[2].state,'unknown');
  const revised=connectionRows({...connection,flights:[{...connection.flights[0],estimated_departure:'2026-11-15T11:30:00Z'}]},status,new Date('2026-11-15T09:00:00Z'));
  assert.equal(revised.rows[0].state,'possible');
});

test('waiting recommendations cover every demo departure airport using its own official directories',()=>{
  assert.deepEqual(Object.keys(AIRPORT_DIRECTORIES).sort(),['BKK','CRK','HKG','ICN','KHH','KIX','NRT','PEK','PKX','PVG','SYX','TPE']);
  for(const airport of Object.values(AIRPORT_DIRECTORIES)) {
    assert.ok(airport.zh && airport.en);
    assert.equal(new URL(airport.dining).protocol,'https:');
    assert.equal(new URL(airport.shopping).protocol,'https:');
  }
  assert.match(AIRPORT_DIRECTORIES.PEK.dining,/bcia/);
  assert.doesNotMatch(AIRPORT_DIRECTORIES.KIX.dining,/hongkongairport/);
});
