import test from 'node:test';
import assert from 'node:assert/strict';
import {passengerPreviewPath, parsePassengerPreview} from '../src/passengerPreview.js';

test('preview URLs are stable, bookmarkable and do not require a generated credential', () => {
  assert.equal(passengerPreviewPath(), '/passenger');
  assert.equal(passengerPreviewPath(2), '/passenger?case=2');
  assert.equal(passengerPreviewPath(2,'LHR'), '/passenger?case=2&connection=LHR');
  assert.equal(passengerPreviewPath(2), passengerPreviewPath(2));
  assert.doesNotMatch(passengerPreviewPath(2), /token|#|expires/);
});

test('a reload or history navigation restores the selected preview', () => {
  assert.deepEqual(parsePassengerPreview(''), {caseId:null,connection:null,scenario:null});
  assert.deepEqual(parsePassengerPreview('?case=2&connection=LHR'), {caseId:2,connection:'LHR',scenario:null});
  assert.deepEqual(parsePassengerPreview('?case=-2'), {caseId:null,connection:null,scenario:null});
  assert.deepEqual(parsePassengerPreview('?case=not-a-number'), {caseId:null,connection:null,scenario:null});
});
