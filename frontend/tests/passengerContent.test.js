import test from 'node:test';
import assert from 'node:assert/strict';
import {DESTINATIONS, MARKETS, destinationForFlight, promotionCards, OFFICIAL_LINKS} from '../src/travelContent.js';
import {DELAY_SCENARIOS, COMMON_PASSENGER_QA, scenarioStatus, scenarioNotice, scenarioCopy} from '../src/delayScenarios.js';
import {passengerPreviewPath, parsePassengerPreview} from '../src/passengerPreview.js';

test('the supplied guide retains all 35 cities, 36 distinct airports and bilingual content', () => {
  assert.equal(DESTINATIONS.length,35);
  assert.equal(new Set(DESTINATIONS.map(d=>d.id)).size,35);
  assert.equal(new Set(DESTINATIONS.flatMap(d=>d.airports)).size,36);
  assert.equal(new Set(DESTINATIONS.map(d=>d.market)).size,8);
  for (const d of DESTINATIONS) {
    assert.ok(MARKETS.some(m=>m.id===d.market && m.region===d.region));
    assert.equal(d.copy.en.attractions.length,d.copy.zh.attractions.length);
    for (const lang of ['zh','en']) {
      const copy=d.copy[lang];
      assert.ok(copy.description && copy.food && copy.tip && copy.stay && d.name[lang]);
      assert.ok(copy.attractions.length>=3 && copy.tags.length>=2);
      assert.ok(copy.attractions.every(s=>s.length>5));
    }
    assert.equal(new URL(d.photo.source).hostname,'commons.wikimedia.org');
    assert.ok(d.photo.credit);
  }
});

test('airport matching distinguishes Tokyo airports, Daxing and Subang', () => {
  for (const airport of ['HND','NRT']) assert.equal(destinationForFlight({destination:airport}).id,'tokyo');
  assert.equal(destinationForFlight({station:'KIX',destination:'HKG'}).id,'osaka');
  assert.equal(destinationForFlight({destination:'PKX'}).id,'beijing');
  assert.notEqual(destinationForFlight({destination:'PEK'}).id,'beijing');
  assert.equal(destinationForFlight({destination:'SZB'}).id,'kuala-lumpur');
  assert.notEqual(destinationForFlight({destination:'KUL'}).id,'kuala-lumpur');
  assert.equal(DESTINATIONS.find(d=>d.id==='ishigaki').seasonal,true);
});

test('every market has working-shaped official HTTPS outbound CTAs, with contextual rail providers', () => {
  const hosts = new Set(['www.hkexpress.com','www.highspeed.mtr.com.hk','www.mtr.com.hk','en.thsrc.com.tw','smart-ex.jp']);
  for (const market of MARKETS) {
    const cards=promotionCards(market.id);
    assert.equal(cards.length,3);
    assert.equal(new Set(cards.map(c=>c.id)).size,3);
    for (const card of cards) {
      const url=new URL(card.url);
      assert.equal(url.protocol,'https:');
      assert.ok(hosts.has(url.hostname));
      assert.equal(url.search,'');
      for (const lang of ['zh','en']) assert.ok(card.title[lang] && card.text[lang] && card.action[lang]);
    }
  }
  assert.equal(promotionCards('JP')[2].url,OFFICIAL_LINKS.japanRail);
  assert.equal(promotionCards('TW')[2].url,OFFICIAL_LINKS.taiwanRail);
  assert.equal(promotionCards('MY')[2].url,OFFICIAL_LINKS.airportExpress);
});

test('all six reasons have clear bilingual explanations, next steps, passenger actions and FAQ', () => {
  assert.equal(Object.keys(DELAY_SCENARIOS).length,6);
  for (const code of Object.keys(DELAY_SCENARIOS)) {
    for (const lang of ['zh','en']) {
      const copy=scenarioCopy(code,lang);
      assert.ok(copy.title && copy.welcome && copy.brief && copy.summary && copy.next && copy.action);
      assert.ok(copy.qa.length>=2);
      assert.ok(copy.qa.every(pair=>pair.length===2 && pair.every(s=>s.length>5)));
    }
  }
  assert.equal(COMMON_PASSENGER_QA.en.length,COMMON_PASSENGER_QA.zh.length);
  assert.match(COMMON_PASSENGER_QA.en[0][1],/cannot confirm vouchers or compensation/);
});

test('scenario overlays are local and do not mutate published status, gate or scheduled time', () => {
  const actual=Object.freeze({status:'AWAITING',cause:null,scheduled:'2026-11-15T06:15:00+00:00',departure:null,gate:null});
  for (const [code,scenario] of Object.entries(DELAY_SCENARIOS)) {
    const preview=scenarioStatus(actual,code);
    assert.equal(preview.status,'DELAYED');
    assert.equal(preview.cause,code);
    assert.equal(new Date(preview.departure)-new Date(actual.scheduled),scenario.minutes*60000);
    assert.equal(preview.gate,null);
    assert.equal(preview.scheduled,actual.scheduled);
  }
  assert.equal(actual.status,'AWAITING');
  assert.equal(scenarioStatus(actual,null),actual);
  assert.equal(scenarioStatus(actual,'UNKNOWN'),actual);
  assert.equal(scenarioStatus(actual,'constructor'),actual);
  assert.equal(scenarioCopy('constructor','en'),undefined);
});

test('a bookmark restores the flight, connection and scenario; invalid scenarios are ignored', () => {
  for (const scenario of Object.keys(DELAY_SCENARIOS)) {
    const url=passengerPreviewPath(2,'LHR',scenario);
    assert.deepEqual(parsePassengerPreview(url.slice(url.indexOf('?'))),{caseId:2,connection:'LHR',scenario});
  }
  assert.equal(parsePassengerPreview('?scenario=constructor').scenario,null);
  assert.equal(parsePassengerPreview('?scenario=UNKNOWN').scenario,null);
  assert.equal(passengerPreviewPath(1,null,'UNKNOWN'),'/passenger?case=1');
});

test('notice examples use Hong Kong time and never invent a publication time', () => {
  const departure='2026-11-15T08:00:00Z';
  assert.match(scenarioNotice('TW602','WEATHER',departure,'en'),/TW602.*weather.*16:00 HKT/);
  assert.match(scenarioNotice('TW602','TECHNICAL',departure,'zh'),/TW602.*飞机技术检查.*香港时间 16:00/);
  assert.doesNotMatch(scenarioNotice('TW602','WEATHER',departure,'en'),/published|voucher|guarantee/i);
});
