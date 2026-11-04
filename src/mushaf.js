// Mushaf page rendering with exact Madinah line layout (QCF4 glyph fonts)
import { SURAH_ORDER, mushaf, FONT_CDN, juzOf, pageSurahNames, surahName, surahNameEn, arNum } from './data.js';
import { h } from './ui.js';

let fallback = false;
const loaded = new Set();

export function isFallback() { return fallback; }

export async function ensureFonts(names) {
  const css = [];
  for (const n of names) {
    if (loaded.has(n)) continue;
    loaded.add(n);
    const file = n === 'QCF4_QBSML' ? 'QCF4_QBSML.woff2' : `${n}_W.woff2`;
    css.push(`@font-face{font-family:'${n}';src:url('${FONT_CDN}${file}') format('woff2');font-display:block}`);
  }
  if (css.length) document.head.append(h('style', {}, css.join('\n')));
  try {
    const res = await Promise.race([
      Promise.all(names.map(n => document.fonts.load(`32px '${n}'`, ''))),
      new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 12000))
    ]);
    if (res.some(r => !r.length)) throw new Error('font missing');
    fallback = false;
  } catch (e) {
    console.warn('QCF font load failed, using text fallback', e);
    fallback = true;
    document.documentElement.classList.add('fallback');
  }
  return !fallback;
}

export function fontsForPages(pages) {
  const set = new Set(['QCF4_QBSML', 'QCF4_Hafs_01']);
  for (const p of pages) set.add(mushaf().pages[p].font);
  return [...set];
}

export function renderPage(p, en) {
  const pg = mushaf().pages[p];
  const inApp = su => SURAH_ORDER.includes(+su);
  const names = pageSurahNames(p).filter(inApp).map(en ? surahNameEn : surahName).filter(Boolean).join(' · ');
  const body = h('div', { class: 'page-body', style: { fontFamily: `'${pg.font}'` } });
  for (const line of pg.lines) {
    const t = line[0][1];
    if (t === 'h') {
      const w = line[0];
      body.append(h('div', { class: 'line hd' + (inApp(line[0][3]) ? '' : ' out') },
        h('div', { class: 'sframe' }, fallback
          ? h('span', { class: 'fb-head' }, `سورة ${surahName(+w[3])}`)
          : h('span', { class: 'glyph', style: { fontFamily: `'${w[2]}'` } }, w[0]))));
      continue;
    }
    if (t === 'b') {
      const w = line[0];
      body.append(h('div', { class: 'line bs' + (inApp(line[0][3]) ? '' : ' out') }, fallback
        ? h('span', { class: 'fb-bism' }, 'بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ')
        : h('span', { class: 'glyph', style: { fontFamily: `'${w[2]}'` } }, w[0])));
      continue;
    }
    const ln = h('div', { class: 'line t' });
    for (const w of line) {
      const [ch, type, vk, pos, text] = w;
      let content = ch;
      if (fallback) {
        if (type === 'w') content = text;
        else if (type === 'e') content = `﴿${arNum(vk.split(':')[1])}﴾`;
        else content = '۞';
      }
      ln.append(h('span', {
        class: 'w' + (type === 'e' ? ' end' : type === 'q' ? ' qtr' : '') + (vk && !inApp(vk.split(':')[0]) ? ' out' : ''),
        'data-vk': vk || '', 'data-pos': pos ?? '', 'data-t': type
      }, content));
    }
    body.append(ln);
  }
  return h('div', { class: 'page', 'data-page': p },
    h('div', { class: 'page-head' }, h('span', {}, en ? `Juz ${juzOf(p)}` : `الجزء ${arNum(juzOf(p))}`), h('span', {}, names)),
    body,
    h('div', { class: 'page-foot' }, en ? String(p) : arNum(p))
  );
}

// Fit 15 lines exactly to page width, distributing spacing between words (like the printed Mushaf)
export function layoutPage(pageEl) {
  const body = pageEl.querySelector('.page-body');
  const W = body.clientWidth;
  if (!W) return;
  const BASE = 40;
  body.style.setProperty('--fs', BASE + 'px');
  const lines = [...body.querySelectorAll('.line.t')];
  const spans = lines.map(l => [...l.children]);
  spans.flat().forEach(s => { s.style.paddingInlineStart = ''; s.style.paddingInlineEnd = ''; });
  lines.forEach(l => l.classList.add('measure'));
  const nat = spans.map(ss => ss.reduce((a, s) => a + s.getBoundingClientRect().width, 0));
  const maxW = Math.max(...nat, 1);
  const fs = Math.max(10, Math.min(80, BASE * (W * 0.992) / maxW));
  body.style.setProperty('--fs', fs.toFixed(2) + 'px');
  lines.forEach((l, i) => {
    l.classList.remove('measure');
    const ss = spans[i];
    const w = nat[i] * fs / BASE;
    const short = w < W * 0.72;
    const g = short ? fs * 0.18 : Math.max(0, (W - w - 1) / Math.max(1, ss.length - 1));
    l.classList.toggle('short', short);
    ss.forEach((s, j) => {
      s.style.paddingInlineStart = j === 0 ? '0px' : (g / 2) + 'px';
      s.style.paddingInlineEnd = j === ss.length - 1 ? '0px' : (g / 2) + 'px';
    });
  });
}

// Decorate words: assignment range, current audio ayah, teacher marks
export function decorate(root, { inRangeFn, rangeColor, current, marks }) {
  root.querySelectorAll('.w').forEach(s => {
    const vk = s.dataset.vk;
    s.classList.toggle('rg', !!(inRangeFn && vk && inRangeFn(vk)));
    s.classList.toggle('cur', !!current && vk === current);
    const m = marks && marks.get(`${vk}:${s.dataset.pos}`);
    s.classList.toggle('mk', !!m);
    if (m) s.style.setProperty('--mk', m.color); else s.style.removeProperty('--mk');
  });
  if (rangeColor) root.style.setProperty('--rg', rangeColor);
}
