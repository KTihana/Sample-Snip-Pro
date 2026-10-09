export const BANK_COUNT = 5;
const NAMES_KEY = 'snip-pro-bank-names';

export function validBank(bank) {
  return Number.isInteger(bank) && bank >= 0 && bank < BANK_COUNT;
}
export function bankName(bank, raw = '') {
  return (
    (typeof raw === 'string' ? raw.trim().slice(0, 40) : '') ||
    `Bank ${String(bank + 1).padStart(2, '0')}`
  );
}
function savedNames(storage) {
  try {
    const saved = JSON.parse(storage.getItem(NAMES_KEY));
    return Array.isArray(saved) ? saved : [];
  } catch {
    return [];
  }
}
export function readBankNames(storage) {
  const saved = savedNames(storage);
  return Array.from({ length: BANK_COUNT }, (_, bank) => bankName(bank, saved?.[bank]));
}
export function renameBank(storage, bank, raw) {
  if (!validBank(bank)) throw new Error('Choose a valid sample bank.');
  const names = readBankNames(storage);
  names[bank] = bankName(bank, raw);
  // Keep previously saved labels for unavailable banks alongside their stored audio.
  const saved = savedNames(storage);
  names.forEach((name, index) => {
    saved[index] = name;
  });
  storage.setItem(NAMES_KEY, JSON.stringify(saved));
  return names;
}
