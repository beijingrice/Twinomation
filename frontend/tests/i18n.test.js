import test from 'node:test';
import assert from 'node:assert/strict';
import { initialLanguage, translate, setLanguage, getLanguage, itemLabel, itemAnswer, eventText, errorText } from '../src/i18n.js';

test('saved language overrides the browser; Chinese browser variants select Chinese', () => {
  assert.equal(initialLanguage(null, 'zh-HK'), 'zh');
  assert.equal(initialLanguage(null, 'zh-TW'), 'zh');
  assert.equal(initialLanguage(null, 'fr-FR'), 'en');
  assert.equal(initialLanguage('en', 'zh-CN'), 'en');
  assert.equal(initialLanguage('invalid', 'zh-CN'), 'zh');
});

test('bilingual messages interpolate without changing identifiers or interpreting user text', () => {
  assert.equal(translate('Work order v{0}', {0: 2}, 'zh'), '工单 v2');
  assert.equal(translate('Work order v{0}', {0: 2}, 'en'), 'Work order v2');
  assert.equal(translate('{0} shared.', {0: 'Gate {0}.txt'}, 'zh'), '已共享 Gate {0}.txt。');
  assert.equal(translate('An arbitrary note', {}, 'zh'), 'An arbitrary note');
  assert.equal(translate('constructor', {}, 'zh'), 'constructor');
});

test('switching localises presets while preserving custom labels, answers and notes', () => {
  setLanguage('zh');
  const preset = {kind: 'preset', label: 'Gate', status: 'Ready'};
  const custom = {kind: 'custom', label: 'Gate', status: 'Ready'};
  assert.equal(itemLabel(preset), '登机口');
  assert.equal(itemAnswer(preset), '已就绪');
  assert.equal(itemLabel(custom), 'Gate');
  assert.equal(itemAnswer(custom), 'Ready');
  assert.equal(eventText({type:'NOTE_ADDED', payload:{summary:'Passenger feed updated'}}), 'Passenger feed updated');
  assert.equal(eventText({type:'WORK_ORDER_SENT', payload:{summary:'Work order v2 sent'}}), '工单 v2 已发送');
  assert.equal(eventText({type:'FILE_SHARED', payload:{summary:'File shared: Gate.txt'}}), '已共享文件：Gate.txt');
  setLanguage('en');
  assert.equal(itemLabel(preset), 'Gate');
  assert.equal(getLanguage(), 'en');
});

test('errors retain a source key so their display can change language', () => {
  const message = errorText({code:'INVALID_TRANSITION',message:'Work order v2 is received.'}, 409);
  assert.match(translate(message, {}, 'zh'), /工单状态/);
  assert.match(translate(message, {}, 'en'), /current state/);
});
