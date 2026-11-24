// Electrode position of each channel (CH1..CH16). Default: the OpenBCI GUI 16-channel
// montage; the user can change it in 设置 → 电极位置. Keep the default and the list of
// positions in sync with src/electrodes.ts and engine/decoding.py.
const DEFAULT = [
  'Fp1',
  'Fp2',
  'C3',
  'C4',
  'P7',
  'P8',
  'O1',
  'O2',
  'F7',
  'F8',
  'F3',
  'F4',
  'T7',
  'T8',
  'P3',
  'P4',
];
// 10-20 / 10-10 positions offered in the editor.
const POSITIONS = [
  ...DEFAULT,
  'Fpz',
  'AF3',
  'AF4',
  'AFz',
  'Fz',
  'FC1',
  'FC2',
  'FC5',
  'FC6',
  'FCz',
  'Cz',
  'CP1',
  'CP2',
  'CP5',
  'CP6',
  'CPz',
  'Pz',
  'POz',
  'PO3',
  'PO4',
  'PO7',
  'PO8',
  'Oz',
  'TP9',
  'TP10',
];
// Changed in place, so modules holding it see the current montage.
const electrodeNames = [...DEFAULT];

function validate(names) {
  if (
    !Array.isArray(names) ||
    names.length !== 16 ||
    new Set(names).size !== 16 ||
    !names.every((n) => POSITIONS.includes(n))
  )
    throw Error('电极位置需要 16 个互不相同的标准位置');
  return [...names];
}
function setMontage(names) {
  electrodeNames.splice(0, 16, ...validate(names));
  return [...electrodeNames];
}
const isDefault = () => electrodeNames.every((n, i) => n === DEFAULT[i]);

module.exports = { electrodeNames, DEFAULT, POSITIONS, validate, setMontage, isDefault };
