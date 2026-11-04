// Mushaf data helpers (Madinah Mushaf 1441H layout, QCF4 glyph data)
export const FONT_CDN = 'https://cdn.jsdelivr.net/npm/quran-qcf4@1.1.0/fonts-woff2/';
export const SURAH_ORDER = [36, 43, 44, 45];

let M = null;
let VERSES = [];        // ordered verse keys of the 4 surahs
let VINDEX = {};        // vk -> index

export async function loadMushaf() {
  if (M) return M;
  const r = await fetch('data/mushaf.json');
  M = await r.json();
  VERSES = [];
  for (const s of SURAH_ORDER) {
    for (let v = 1; v <= M.surahs[s].verses; v++) VERSES.push(`${s}:${v}`);
  }
  VINDEX = Object.fromEntries(VERSES.map((k, i) => [k, i]));
  return M;
}

export const mushaf = () => M;
export const PAGE_LIST = [440, 441, 442, 443, 444, 445, 489, 490, 491, 492, 493, 494, 495, 496, 497, 498, 499, 500, 501, 502];

export function juzOf(p) {
  if (p >= 502) return 26;
  if (p >= 482) return 25;
  if (p >= 462) return 24;
  if (p >= 442) return 23;
  return 22;
}

export function surahName(s) { return M?.surahs?.[s]?.name || ''; }
export function surahVerses(s) { return M?.surahs?.[s]?.verses || 0; }

export function pageSurahNames(p) {
  const pg = M.pages[p];
  const set = new Set();
  for (const line of pg.lines) for (const w of line) {
    if (w[1] === 'h') set.add(+w[3]);
    else if (w[2]) set.add(+w[2].split(':')[0]);
  }
  return [...set];
}

export function versePage(vk) { return M.versePage[vk]; }
export function verseIndex(vk) { return VINDEX[vk] ?? -1; }
export function allVerses() { return VERSES; }

export function rangeVerses(from, to) {
  const a = verseIndex(from), b = verseIndex(to);
  if (a < 0 || b < 0) return [];
  return VERSES.slice(Math.min(a, b), Math.max(a, b) + 1);
}

export function inRange(vk, from, to) {
  const i = verseIndex(vk);
  if (i < 0) return false;
  const a = verseIndex(from), b = verseIndex(to);
  return i >= Math.min(a, b) && i <= Math.max(a, b);
}

export function rangePages(from, to) {
  const vs = rangeVerses(from, to);
  const set = new Set(vs.map(versePage));
  return PAGE_LIST.filter(p => set.has(p));
}

export function rangeWordCount(from, to) {
  return rangeVerses(from, to).reduce((n, vk) => n + (M.verseWords[vk] || 0), 0);
}

export function pageVerses(p) {
  const out = [];
  for (const line of M.pages[p].lines) for (const w of line) {
    if (w[1] === 'w' && w[2] && !out.includes(w[2])) out.push(w[2]);
  }
  return out;
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
export const arNum = n => String(n).replace(/\d/g, d => AR_DIGITS[d]);

export function rangeLabel(from, to) {
  const [s1, a1] = from.split(':'), [s2, a2] = to.split(':');
  if (s1 === s2) return `${surahName(+s1)} ${a1} – ${a2}`;
  return `${surahName(+s1)} ${a1} – ${surahName(+s2)} ${a2}`;
}

// words of the range that sit on page p
export function pageRangeWordCount(p, from, to) {
  let n = 0;
  for (const line of M.pages[p].lines) for (const w of line) if (w[1] === 'w' && w[2] && inRange(w[2], from, to)) n++;
  return n;
}

const SURAH_EN = { 36: 'Ya-Sin', 43: 'Az-Zukhruf', 44: 'Ad-Dukhan', 45: 'Al-Jathiyah' };
export const surahNameEn = s => SURAH_EN[s] || `Surah ${s}`;
export function rangeLabelEn(from, to) {
  const [s1, a1] = from.split(':'), [s2, a2] = to.split(':');
  if (s1 === s2) return `${surahNameEn(+s1)} ${a1}–${a2}`;
  return `${surahNameEn(+s1)} ${a1} – ${surahNameEn(+s2)} ${a2}`;
}
