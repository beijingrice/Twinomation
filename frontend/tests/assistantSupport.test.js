import test from 'node:test';
import assert from 'node:assert/strict';
import {supportQuestions} from '../src/assistantSupport.js';
import {DELAY_SCENARIOS} from '../src/delayScenarios.js';

const now=new Date('2026-11-15T09:00:00Z');
const status=Object.freeze({departure:'2026-11-15T08:00:00Z',block_minutes:120});
const connection=Object.freeze({booked:'TW801',min_connection_minutes:60,flights:[{flight_no:'TW801',departure:'2026-11-15T10:20:00Z'}]});

test('comfort questions stay bilingual, use the actual cause and do not invent a connection',()=>{
  for(const cause of Object.keys(DELAY_SCENARIOS)) {
    for(const language of ['zh','en']) {
      const questions=supportQuestions(cause,status,null,now,language);
      assert.equal(questions.length,2);
      assert.ok(questions.every(pair=>pair.length===2 && pair.every(s=>s.length>5)));
      assert.ok(questions[0][1].includes(DELAY_SCENARIOS[cause][language].next));
      assert.doesNotMatch(questions.flat().join(' '),/TW801/);
    }
  }
});

test('connection reassurance distinguishes a tight connection, a viable estimate and missing arrival',()=>{
  const tight=supportQuestions('TECHNICAL',status,connection,now,'zh')[1][1];
  assert.match(tight,/TW801.*可能赶不上/);
  const possible={...connection,flights:[{flight_no:'TW801',departure:'2026-11-15T11:30:00Z'}]};
  assert.match(supportQuestions('TECHNICAL',status,possible,now,'zh')[1][1],/暂有衔接余量/);
  assert.match(supportQuestions('TECHNICAL',{...status,departure:null},connection,now,'zh')[1][1],/还缺少可确认/);
  assert.doesNotMatch(supportQuestions('TECHNICAL',{...status,departure:null},connection,now,'zh')[1][1],/暂有衔接余量/);
  const cancelled={...connection,flights:[{...connection.flights[0],status:'CANCELLED'}]};
  assert.match(supportQuestions('TECHNICAL',status,cancelled,now,'en')[1][1],/TW801 as cancelled/);
  assert.equal(connection.flights[0].departure,'2026-11-15T10:20:00Z');
});
