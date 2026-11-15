import test from 'node:test';
import assert from 'node:assert/strict';
import {broadcastTargets,visibilityText} from '../src/stationServices.js';

test('broadcast audience resolves regions and explicit stations without duplicates',()=>{
  const stations=[{code:'KIX',region:'JP'},{code:'NRT',region:'JP'},{code:'ICN',region:'KR'}];
  assert.equal(broadcastTargets(stations,'all',[]).length,3);
  assert.deepEqual(broadcastTargets(stations,'regions',['JP','JP']).map(s=>s.code),['KIX','NRT']);
  assert.deepEqual(broadcastTargets(stations,'stations',['ICN']).map(s=>s.code),['ICN']);
  assert.deepEqual(broadcastTargets(stations,'stations',[]),[]);
});

test('visibility display distinguishes a genuine zero from missing data and keeps units',()=>{
  assert.equal(visibilityText(0),'0 m');
  assert.equal(visibilityText(800),'800 m');
  assert.equal(visibilityText(3500),'3.5 km');
  for(const value of [null,undefined,NaN,Infinity]) assert.equal(visibilityText(value),'—');
});
