import test from 'node:test';
import assert from 'node:assert/strict';
import { BANK_COUNT, bankName, readBankNames, renameBank, validBank } from '../banks.js';
import { emptyPad } from '../model.js';

function storage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => items.set(key, value),
  };
}
test('exactly five banks have independent pad identities and remain selectable', () => {
  assert.equal(BANK_COUNT, 5);
  const ids = new Set();
  for (let bank = 0; bank < BANK_COUNT; bank++) {
    assert.equal(validBank(bank), true);
    for (let pad = 0; pad < 16; pad++) ids.add(emptyPad(bank, pad).id);
  }
  assert.equal(ids.size, 80);
  for (const value of [-1, 5, 6, 7, 8, 9, 1.5, NaN, '4']) assert.equal(validBank(value), false);
});
test('bank renaming persists independently and leaves selected bank and samples untouched', () => {
  const sample = { ...emptyPad(3, 0), name: 'Recorded kick', data: 'saved audio' };
  const store = storage({
    'snip-pro-bank': '3',
    'saved-sample': JSON.stringify(sample),
    'snip-pro-bank-names':
      '["Kit",null,null,null,null,"Old percussion",null,null,"Old atmosphere"]',
  });
  renameBank(store, 3, '  Drum kit  ');
  renameBank(store, 4, 'Atmosphere');
  const reopened = readBankNames(store);
  assert.equal(reopened[3], 'Drum kit');
  assert.equal(reopened[4], 'Atmosphere');
  assert.equal(reopened[0], 'Kit');
  assert.equal(reopened.length, 5);
  const savedNames = JSON.parse(store.getItem('snip-pro-bank-names'));
  assert.equal(savedNames[5], 'Old percussion');
  assert.equal(savedNames[8], 'Old atmosphere');
  assert.equal(store.getItem('snip-pro-bank'), '3');
  assert.deepEqual(JSON.parse(store.getItem('saved-sample')), sample);
});
test('empty names reset the label and malformed saved names recover without losing valid names', () => {
  const store = storage({ 'snip-pro-bank-names': '{broken' });
  assert.equal(readBankNames(store)[4], 'Bank 05');
  renameBank(store, 0, 'A'.repeat(60));
  assert.equal(readBankNames(store)[0].length, 40);
  renameBank(store, 0, '  ');
  assert.equal(readBankNames(store)[0], 'Bank 01');
  assert.equal(bankName(2, 123), 'Bank 03');
  assert.throws(() => renameBank(store, 5, 'Invalid'));
  assert.deepEqual(
    readBankNames(storage({ 'snip-pro-bank-names': '["Kit",null,42]' })).slice(0, 3),
    ['Kit', 'Bank 02', 'Bank 03'],
  );
});
