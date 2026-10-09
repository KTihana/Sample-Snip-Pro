export const DEFAULT_KEYS = [
  'q',
  'w',
  'e',
  'r',
  'a',
  's',
  'd',
  'f',
  'z',
  'x',
  'c',
  'v',
  '1',
  '2',
  '3',
  '4',
];
export const COLORS = [
  'amber',
  'violet',
  'cyan',
  'rose',
  'rose',
  'violet',
  'mint',
  'amber',
  'cyan',
  'amber',
  'rose',
  'violet',
  'violet',
  'cyan',
  'mint',
  'rose',
];
export const SESSION_LIMIT = 300;
export const SAMPLE_LIMIT = 60;
export function emptyPad(bank, index) {
  return {
    id: `${bank}:${index}`,
    bank,
    index,
    name: `Pad ${String(index + 1).padStart(2, '0')}`,
    key: DEFAULT_KEYS[index],
    color: COLORS[index],
    start: 0,
    end: 0,
    volume: 1,
    loop: false,
    data: null,
  };
}
export function assignKey(pads, index, rawKey) {
  const key = rawKey.toLowerCase();
  if (!/^[a-z0-9]$/.test(key)) throw new Error('Choose a letter or number.');
  const previous = pads[index].key;
  const conflict = pads.findIndex((pad, i) => i !== index && pad.key === key);
  pads[index].key = key;
  if (conflict >= 0) pads[conflict].key = previous;
  return conflict;
}
export function validTrim(start, end, duration) {
  const minimum = Math.min(0.01, duration);
  const from = Math.max(0, Math.min(Number(start) || 0, duration - minimum));
  const to = Math.max(from + minimum, Math.min(Number(end) || duration, duration));
  return { start: from, end: to };
}
export function time(seconds, decimal = false) {
  const value = Math.max(0, Number(seconds) || 0);
  return `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}${decimal ? '.' + String(Math.floor((value % 1) * 100)).padStart(2, '0') : ''}`;
}
export function filename(name) {
  return (name.replace(/[^a-z0-9 _-]/gi, '').trim() || 'sample-snip-pro').slice(0, 80);
}
