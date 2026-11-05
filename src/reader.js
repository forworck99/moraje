// Mushaf reader: pages, audio bar, repetition, count slider, word marks
import { h, toast, modal, confirmBox, fmtTime } from './ui.js';
import {
  PAGE_LIST, versePage, pageVerses, rangeVerses, inRange, rangeLabel, surahName, surahVerses,
  SURAH_ORDER, allVerses, rangeWordCount, arNum, rangePages, pageRangeWordCount, surahNameEn, rangeLabelEn
} from './data.js';
import { renderPage, layoutPage, decorate, ensureFonts, fontsForPages } from './mushaf.js';
import { RECITERS } from './audio.js';
import { TYPES, isPageMode, isRecordMode, targetOf, unitOf, unitEn } from './types.js';
import { todayStr } from './store.js';

// where the student stopped in an assignment (kept on this device)
const POSKEY = id => `pos:${id}`;
export function savedPos(id) { try { return JSON.parse(localStorage.getItem(POSKEY(id))); } catch { return null; } }
function savePos(id, v) { try { localStorage.setItem(POSKEY(id), JSON.stringify(v)); } catch { } }
export function clearPos(id) { try { localStorage.removeItem(POSKEY(id)); } catch { } }

const MARK_COLORS = [
  { c: '#d32f2f', n: 'أحمر' }, { c: '#ef6c00', n: 'برتقالي' }, { c: '#1565c0', n: 'أزرق' }, { c: '#2e7d32', n: 'أخضر' }
];

export function openReader(ctx) {
  // ctx: { role, app, assignment?, startPage?, onBack }
  const { app, role } = ctx;
  const A = ctx.assignment || null;
  const EN = role === 'student';
  const L = (ar, en) => EN ? en : ar;
  const sName = s => EN ? surahNameEn(s) : surahName(s);
  const rLabel = (a, b) => EN ? rangeLabelEn(a, b) : rangeLabel(a, b);
  const nm = n => EN ? String(n) : arNum(n);
  const player = app.player;
  const wideMQ = matchMedia('(min-width: 860px) and (orientation: landscape)');
  let wide = wideMQ.matches;
  let views = [];
  let vi = 0;
  let scope = A ? 'assignment' : 'page';
  let custom = { from: A?.from || '36:1', to: A?.to || '36:12' };
  let follow = true;
  const cleanups = [];
  let scopeSel, fromS, fromA, toS, toA, ayahRepI, rangeRepI, recBtn, playBtn, statusEl, customRow;
  let cntNum, cntBar, cntTime, cntLabel, cntTrack, cntPages;
  const PM = A ? isPageMode(A) : false;
  const RM = A ? isRecordMode(A) : false;
  let rec = null, recChunks = [], recStart = 0, recTimer = null, recBlob = null, recSec = 0, recStream = null;
  let rBtn, rTime, rPreview, rSend, rRedo, rInfo;
  let lastErr = 0;

  const buildViews = () => {
    if (!wide) return PAGE_LIST.map(p => [p]);
    const out = []; const seen = new Set();
    for (const p of PAGE_LIST) {
      if (seen.has(p)) continue;
      const a = p % 2 ? p : p - 1, b = a + 1;
      const pair = [a, b].filter(x => PAGE_LIST.includes(x));
      pair.forEach(x => seen.add(x));
      out.push(pair);
    }
    return out;
  };
  const viewOf = p => views.findIndex(v => v.includes(p));

  /* ---------- DOM ---------- */
  const title = A ? `${L(TYPES[A.type]?.label, TYPES[A.type]?.en) || ''} · ${rLabel(A.from, A.to)}` : L('المصحف', 'Mushaf');
  const pageSel = h('select', { class: 'pagesel', 'aria-label': L('اختيار الصفحة', 'Choose page'), onchange: e => go(viewOf(+e.target.value)) },
    SURAH_ORDER.map(s => h('optgroup', { label: sName(s) },
      PAGE_LIST.filter(p => pageVerses(p).some(v => v.startsWith(s + ':'))).map(p => h('option', { value: p }, L(`صفحة ${p}`, `Page ${p}`))))));
  const spread = h('div', { class: 'spread' });
  const stage = h('div', { class: 'stage' }, spread,
    h('button', { class: 'navbtn prev', 'aria-label': L('الصفحة السابقة', 'Previous page'), onclick: () => go(vi - 1) }, '›'),
    h('button', { class: 'navbtn next', 'aria-label': L('الصفحة التالية', 'Next page'), onclick: () => go(vi + 1) }, '‹'));

  const counterEl = (A && role === 'student') ? (RM ? buildRecorder() : buildCounter()) : null;
  const playerEl = buildPlayer();
  const root = h('div', { class: 'reader' + (A ? ' has-a' : '') },
    h('header', { class: 'rbar' },
      h('button', { class: 'icon-btn', 'aria-label': L('رجوع', 'Back'), onclick: () => close() }, EN ? '←' : '→'),
      h('div', { class: 'rtitle' }, h('b', {}, title), role === 'teacher' ? h('small', {}, 'وضع المعلم: اضغط على أي كلمة لتلوينها') : null),
      (A && EN) ? h('button', { class: 'btn ghost sm pausebtn', onclick: () => pauseLesson() }, '⏸ Pause') : null,
      pageSel),
    stage, counterEl, playerEl);
  if (RM && EN) root.classList.add('hide-text');
  if (A) root.style.setProperty('--rg', TYPES[A.type]?.tint || 'rgba(46,125,50,.14)');

  app.mount(root);

  /* ---------- swipe ---------- */
  let sx = null, sy = null;
  stage.addEventListener('touchstart', e => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  stage.addEventListener('touchend', e => {
    if (sx == null) return;
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    sx = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4) { follow = false; go(vi + (dx > 0 ? 1 : -1)); }
  }, { passive: true });
  const onKey = e => { if (e.key === 'ArrowLeft') go(vi + 1); else if (e.key === 'ArrowRight') go(vi - 1); else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); player.toggle(); } };
  addEventListener('keydown', onKey); cleanups.push(() => removeEventListener('keydown', onKey));

  /* ---------- render pages ---------- */
  async function go(i, keepFollow) {
    if (i < 0 || i >= views.length) return;
    vi = i;
    const pages = views[vi];
    await ensureFonts(fontsForPages(pages));
    spread.replaceChildren(...pages.map(p => renderPage(p, EN)));
    spread.classList.toggle('two', pages.length === 2);
    fit();
    paint();
    pageSel.value = pages[0];
    app.tracker?.setContext(pages, A?.id);
    if (counterEl) updCounter();
    if (scope === 'page' && !player.playing) setQueue();
    if (!keepFollow && !player.playing) follow = true;
  }
  function fit() {
    const pagesEl = [...spread.children];
    if (!pagesEl.length) return;
    const sw = stage.clientWidth - 8, sh = stage.clientHeight - 8;
    const n = pagesEl.length;
    let w = Math.min(wide ? 620 : 700, (sw - (n - 1) * 10) / n);
    for (let k = 0; k < 3; k++) {
      pagesEl.forEach(p => { p.style.width = w + 'px'; layoutPage(p); });
      const ph = Math.max(...pagesEl.map(p => p.offsetHeight));
      if (!wide && innerWidth < 700) break;                 // phones: full width, scroll if needed
      if (ph <= sh || w < 260) break;
      w = Math.max(260, w * sh / ph * 0.99);
    }
  }
  const onResize = () => {
    const nw = wideMQ.matches;
    const cur = views[vi]?.[0];
    if (nw !== wide) { wide = nw; views = buildViews(); vi = Math.max(0, viewOf(cur)); go(vi, true); }
    else fit();
  };
  addEventListener('resize', onResize); cleanups.push(() => removeEventListener('resize', onResize));

  function paint() {
    decorate(spread, {
      inRangeFn: A ? vk => inRange(vk, A.from, A.to) : null,
      current: player.queue.length && (player.playing || player.audio.getAttribute('src') || player.qi > 0) ? player.current : null,
      marks: app.marks
    });
  }
  ctx.repaint = paint;

  /* ---------- word taps ---------- */
  spread.addEventListener('click', e => {
    const s = e.target.closest('.w');
    if (!s || !s.dataset.vk) return;
    wordMenu(s);
  });

  function wordMenu(s) {
    const vk = s.dataset.vk, pos = s.dataset.pos;
    const key = `${vk}:${pos}`;
    const m = app.marks.get(key);
    const [su, ay] = vk.split(':');
    const listen = () => {
      if (!player.queue.includes(vk)) {
        if (!allVerses().includes(vk)) player.setQueue([vk], vk);
        else { scope = 'surah-from'; custom = { from: vk, to: `${su}:${surahVerses(+su)}` }; syncScopeUI(); setQueue(vk); }
      }
      player.seek(vk); player.play(); follow = true;
    };
    const repeatThis = () => { scope = 'custom'; custom = { from: vk, to: vk }; syncScopeUI(); setQueue(vk); player.setRepeat(1, Math.max(3, player.rangeRep || 3)); repInputs(); player.play(); };
    const body = h('div', { class: 'wmenu' },
      h('div', { class: 'wm-ref' }, L(`${surahName(+su)} · الآية ${arNum(ay)}`, `${surahNameEn(+su)} · Ayah ${ay}`)),
      m && m.note ? h('div', { class: 'wm-note', style: { borderColor: m.color } }, '📝 ', m.note) : null,
      m && !m.note && role === 'student' ? h('div', { class: 'wm-note', style: { borderColor: m.color } }, 'Your teacher marked this word: read it carefully.') : null);
    const actions = [{ label: L('▶ استماع من هنا', '▶ Listen from here'), value: 'listen', kind: 'primary' }, { label: L('🔁 تكرار الآية', '🔁 Repeat ayah'), value: 'rep', kind: 'ghost' }];
    if (role === 'teacher') {
      let color = m?.color || MARK_COLORS[0].c;
      const note = h('input', { class: 'inp', placeholder: 'ملاحظة للطالبة (اختياري)', value: m?.note || '' });
      const chips = h('div', { class: 'chips' }, MARK_COLORS.map(mc => {
        const b = h('button', { class: 'chip' + (mc.c === color ? ' on' : ''), style: { '--c': mc.c }, 'aria-label': mc.n, onclick: () => { color = mc.c; chips.querySelectorAll('.chip').forEach(x => x.classList.remove('on')); b.classList.add('on'); } }, mc.n);
        return b;
      }));
      body.append(h('div', { class: 'wm-teacher' }, h('label', {}, 'تلوين الكلمة للتنبيه:'), chips, note));
      actions.unshift({ label: 'حفظ التلوين', value: 'save', kind: 'primary' });
      if (m) actions.unshift({ label: 'إزالة', value: 'del', kind: 'danger-ghost' });
      actions.splice(actions.findIndex(a => a.value === 'listen'), 1, { label: '▶ استماع', value: 'listen', kind: 'ghost' });
      modal({ title: 'كلمة', body, actions }).then(async v => {
        if (v === 'save') {
          await app.store.saveHighlight({ id: `${ctx.studentUid}_${vk.replace(':', '-')}_${pos}`, studentUid: ctx.studentUid, vk, pos: +pos, page: versePage(vk), color, note: note.value.trim(), word: s.dataset.t === 'w' ? s.textContent : '' });
          toast('تم تلوين الكلمة ✓');
        } else if (v === 'del') {
          await app.store.deleteHighlight(`${ctx.studentUid}_${vk.replace(':', '-')}_${pos}`); toast('أُزيل التلوين');
        } else if (v === 'listen') listen();
        else if (v === 'rep') repeatThis();
      });
      return;
    }
    modal({ title: 'Ayah', body, actions: [{ label: 'Close', value: 0, kind: 'ghost' }, ...actions] }).then(v => { if (v === 'listen') listen(); else if (v === 'rep') repeatThis(); });
  }

  /* ---------- audio bar ---------- */
  function buildPlayer() {
    recBtn = h('button', { class: 'rec', onclick: () => { player.setReciter(player.reciter === 'alafasy' ? 'husary' : 'alafasy'); } }, '');
    playBtn = h('button', { class: 'play', 'aria-label': L('تشغيل', 'Play'), onclick: () => { if (!player.queue.length) setQueue(); follow = true; player.toggle(); } }, '▶');
    const jb = (d, lbl, aria) => h('button', { class: 'jump', 'aria-label': aria, onclick: () => { follow = true; player.jump(d); } }, lbl);
    statusEl = h('div', { class: 'pstatus' });
    scopeSel = h('select', { class: 'inp sm', onchange: () => { scope = scopeSel.value; syncScopeUI(); setQueue(); } },
      A ? h('option', { value: 'assignment' }, L('نطاق الواجب', 'Assignment range')) : null,
      h('option', { value: 'page' }, L('الصفحة الحالية', 'Current page')),
      h('option', { value: 'surah' }, L('السورة كاملة', 'Whole surah')),
      h('option', { value: 'custom' }, L('من … إلى …', 'From … to …')));
    const surSel = (onch) => h('select', { class: 'inp sm', onchange: onch }, SURAH_ORDER.map(s => h('option', { value: s }, sName(s))));
    const ayNum = (onch) => h('input', { class: 'inp sm num', type: 'number', min: 1, inputmode: 'numeric', onchange: onch });
    const upd = () => { custom = { from: `${fromS.value}:${clampA(fromS.value, fromA.value)}`, to: `${toS.value}:${clampA(toS.value, toA.value)}` }; setQueue(); };
    fromS = surSel(upd); fromA = ayNum(upd); toS = surSel(upd); toA = ayNum(upd);
    customRow = h('div', { class: 'prow custom' }, h('span', {}, L('من', 'From')), fromS, fromA, h('span', {}, L('إلى', 'to')), toS, toA);
    ayahRepI = h('input', { class: 'inp sm num', type: 'number', min: 1, max: 99, value: A?.ayahRepeat || 1, inputmode: 'numeric', onchange: () => player.setRepeat(+ayahRepI.value || 1, null) });
    rangeRepI = h('input', { class: 'inp sm num', type: 'number', min: 0, max: 999, value: A?.rangeRepeat ?? 1, inputmode: 'numeric', onchange: () => player.setRepeat(null, +rangeRepI.value || 0) });
    const settings = h('div', { class: 'psettings' },
      h('div', { class: 'prow' }, h('label', {}, L('التشغيل:', 'Play:')), scopeSel),
      customRow,
      h('div', { class: 'prow' }, h('label', {}, L('تكرار كل آية', 'Repeat each ayah')), ayahRepI, h('label', {}, L('تكرار النطاق', 'Repeat range')), rangeRepI, h('small', { class: 'muted' }, L('(0 = بلا توقف)', '(0 = nonstop)'))));
    const gear = h('button', { class: 'icon-btn gear', 'aria-label': L('إعدادات التكرار', 'Repeat settings'), onclick: () => settings.classList.toggle('open') }, '⚙');
    return h('div', { class: 'player' },
      settings,
      h('div', { class: 'pmain' },
        recBtn,
        h('div', { class: 'pctrl' },
          jb(-2, L('«٢', '«2'), L('الرجوع آيتين', 'Back 2 ayahs')), jb(-1, L('‹١', '‹1'), L('الرجوع آية', 'Back 1 ayah')), playBtn, jb(1, L('١›', '1›'), L('تقديم آية', 'Forward 1 ayah')), jb(2, L('٢»', '2»'), L('تقديم آيتين', 'Forward 2 ayahs'))),
        gear),
      statusEl);
  }
  function repInputs() { ayahRepI.value = player.ayahRep; rangeRepI.value = player.rangeRep; }
  const clampA = (s, a) => Math.min(surahVerses(+s), Math.max(1, +a || 1));
  function syncScopeUI() {
    if ([...scopeSel.options].some(o => o.value === scope)) scopeSel.value = scope;
    else scopeSel.value = 'custom';
    if (scope === 'surah-from') scope = 'custom';
    customRow.style.display = scopeSel.value === 'custom' ? '' : 'none';
    const [fs, fa] = custom.from.split(':'), [ts, ta] = custom.to.split(':');
    fromS.value = fs; fromA.value = fa; toS.value = ts; toA.value = ta;
  }
  function queueFor() {
    if (scope === 'assignment' && A) return rangeVerses(A.from, A.to);
    if (scope === 'page') return views[vi].flatMap(pageVerses).filter((v, i, a) => a.indexOf(v) === i && allVerses().includes(v));
    if (scope === 'surah') {
      const s = (player.current || views[vi].flatMap(pageVerses).find(v => allVerses().includes(v)) || '36:1').split(':')[0];
      return rangeVerses(`${s}:1`, `${s}:${surahVerses(+s)}`);
    }
    return rangeVerses(custom.from, custom.to);
  }
  function setQueue(start) {
    const q = queueFor();
    const keep = start || (q.includes(player.current) ? player.current : q[0]);
    player.setQueue(q, keep);
  }
  function updPlayer() {
    recBtn.textContent = `🎙 ${L(RECITERS[player.reciter].name, RECITERS[player.reciter].en)}`;
    playBtn.textContent = player.playing ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', player.playing ? L('إيقاف مؤقت', 'Pause') : L('تشغيل', 'Play'));
    const vk = player.current;
    if (vk) {
      const [s, a] = vk.split(':');
      const rep = player.ayahRep > 1 ? ` · ${L('تكرار', 'repeat')} ${player.ayahDone + 1}/${player.ayahRep}` : '';
      const rr = player.rangeRep !== 1 ? ` · ${L('دورة', 'round')} ${player.rangeDone + 1}${player.rangeRep ? '/' + player.rangeRep : ''}` : '';
      statusEl.textContent = `${player.bism ? L('البسملة · ', 'Basmala · ') : ''}${sName(+s)} ${nm(a)}${rep}${rr}${player.loading && player.playing ? L(' · جارٍ التحميل…', ' · loading…') : ''}`;
    } else statusEl.textContent = L('اضغطي ▶ أو اختاري آية', 'Press ▶ or tap an ayah');
    if (player.error && player.error !== lastErr) { lastErr = player.error; toast(L('تعذّر تحميل التلاوة، تحقّقي من الإنترنت', 'Could not load the recitation. Check your internet.')); }
    app.tracker?.setAudio(player.playing);
    // follow the recitation across pages
    if (vk && follow && (player.playing)) {
      const p = versePage(vk);
      if (p && !views[vi].includes(p)) { go(viewOf(p), true); return; }
    }
    paint();
  }
  cleanups.push(player.on(updPlayer));

  /* ---------- counter ---------- */
  function buildCounter() {
    cntNum = h('b', {}, '0');
    cntBar = h('div', { class: 'bar' }, h('i'));
    cntTime = h('small', {});
    cntLabel = h('span', { class: 'track-label' }, 'Swipe to log a reading  ←');
    const thumb = h('div', { class: 'thumb', 'aria-hidden': 'true' }, '✓');
    const track = cntTrack = h('div', { class: 'track', role: 'slider', 'aria-label': PM ? 'Swipe after finishing the page' : 'Swipe to log a reading', tabindex: 0 }, cntLabel, thumb);
    let startX = null, max = 0, dx = 0;
    const setX = x => { thumb.style.transform = `translateX(${-x}px)`; track.style.setProperty('--p', (x / max) || 0); };
    thumb.addEventListener('pointerdown', e => { if (track.classList.contains('off')) return; startX = e.clientX; max = track.clientWidth - thumb.offsetWidth - 6; thumb.setPointerCapture(e.pointerId); track.classList.add('drag'); });
    thumb.addEventListener('pointermove', e => { if (startX == null) return; dx = Math.min(max, Math.max(0, startX - e.clientX)); setX(dx); });
    const end = async () => {
      if (startX == null) return;
      startX = null; track.classList.remove('drag');
      const done = dx >= max * 0.9;
      dx = 0; thumb.style.transition = 'transform .25s'; setX(0); setTimeout(() => thumb.style.transition = '', 260);
      if (done) await doCount();
    };
    thumb.addEventListener('pointerup', end); thumb.addEventListener('pointercancel', end);
    track.addEventListener('keydown', e => { if (e.key === 'Enter' && !track.classList.contains('off')) doCount(); });
    const adj = h('button', { class: 'adj', 'aria-label': PM ? 'Undo a page' : 'Correct the count', onclick: adjust }, '±');
    cntPages = PM ? h('div', { class: 'pdots' }) : null;
    return h('div', { class: 'counter' + (PM ? ' pm' : '') },
      h('div', { class: 'cinfo' }, h('div', {}, cntNum, ` / ${targetOf(A)}`, h('small', {}, PM ? ' pages' : ' today')), cntBar, cntTime),
      track, adj, cntPages);
  }
  const curCount = () => app.counts[A.id] || 0;
  const doneSet = () => app.doneToday?.[A.id] || new Set();
  const rangeP = PM ? rangePages(A.from, A.to) : [];
  // the page the slider will mark: first visible page of the range not yet marked today
  const pageToMark = () => { const ds = doneSet(); return (views[vi] || []).filter(p => rangeP.includes(p) && !ds.has(p)).sort((a, b) => a - b)[0] ?? null; };

  async function doCount() {
    if (PM) {
      const p = pageToMark();
      if (p == null) return;
      const ok = await confirmBox('Log page', `Did you finish reading page ${p} completely?`, 'Yes, finished', 'Cancel');
      if (!ok) return;
      const readSec = app.tracker.takePageSec(A.id, p);
      const minSec = Math.max(15, Math.round(pageRangeWordCount(p, A.from, A.to) * 0.45));
      await app.store.logEvent(app.user.uid, 'page_done', { assignmentId: A.id, page: p, readSec, minSec });
      const n = doneSet().size + (doneSet().has(p) ? 0 : 1), t = targetOf(A);
      toast(n >= t ? `Well done! Review complete: ${n} pages 🌟` : `Page ${p} logged ✓ (${n}/${t})`);
      // move on to the next unread page of the range
      const next = rangeP.find(x => x > p && !doneSet().has(x) && x !== p);
      if (next && !views[vi].includes(next)) setTimeout(() => go(viewOf(next)), 500);
      return;
    }
    const n = curCount() + 1;
    const ok = await confirmBox('Log reading', `Did you finish reading ${rangeLabelEn(A.from, A.to)} completely? This will be reading #${n}.`, 'Yes, finished', 'Cancel');
    if (!ok) return;
    const readSec = app.tracker.takeReadSec(A.id);
    const minSec = Math.max(15, Math.round(rangeWordCount(A.from, A.to) * 0.45));
    await app.store.logEvent(app.user.uid, 'count', { assignmentId: A.id, readSec, minSec, n });
    toast(n >= targetOf(A) ? `Well done! ${n} readings today 🌟` : `Reading ${n} logged ✓`);
  }
  async function adjust() {
    if (PM) {
      const ds = [...doneSet()].sort((a, b) => a - b);
      if (!ds.length) { toast('No pages logged today'); return; }
      const p = await modal({ title: 'Undo a page', body: 'Choose the page you logged by mistake:', actions: [{ label: 'Cancel', value: 0, kind: 'ghost' }, ...ds.map(x => ({ label: `Page ${x}`, value: x, kind: 'ghost' }))] });
      if (!p) return;
      if (!await confirmBox('Confirm', `Undo page ${p}?`, 'Yes', 'Cancel')) return;
      if (!await confirmBox('Final check', 'Are you really sure? This is recorded and your teacher will see it.', 'Yes, I am sure', 'Go back', 'danger')) return;
      await app.store.logEvent(app.user.uid, 'page_undo', { assignmentId: A.id, page: p });
      toast(`Page ${p} undone`);
      return;
    }
    const n = curCount();
    const delta = await modal({ title: 'Correct the count', body: `Today's count: ${n}. Use this only if you logged by mistake.`, actions: [{ label: 'Cancel', value: 0, kind: 'ghost' }, { label: '− 1', value: -1, kind: 'ghost' }, { label: '+ 1', value: 1, kind: 'ghost' }] });
    if (!delta || (delta < 0 && n === 0)) return;
    const to = Math.max(0, n + delta);
    if (!await confirmBox('Confirm', `Change the count from ${n} to ${to}?`, 'Yes', 'Cancel')) return;
    if (!await confirmBox('Final check', 'Are you really sure? This change is recorded and your teacher will see it.', 'Yes, I am sure', 'Go back', 'danger')) return;
    await app.store.logEvent(app.user.uid, 'count_adjust', { assignmentId: A.id, delta, from: n, to });
    toast('Count corrected');
  }
  /* ---------- recitation recorder (only for the recitation type) ---------- */
  function pickMime() {
    for (const m of ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'])
      if (window.MediaRecorder && MediaRecorder.isTypeSupported?.(m)) return m;
    return '';
  }
  const mmss = t => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
  function buildRecorder() {
    cntNum = h('b', {}, '0');
    cntBar = h('div', { class: 'bar' }, h('i'));
    cntTime = h('small', {});
    rTime = h('span', { class: 'rtime' }, '0:00');
    rBtn = h('button', { class: 'recbtn', onclick: () => rec ? stopRec() : startRec() }, '● Record');
    rPreview = h('audio', { controls: true, class: 'rprev' });
    rSend = h('button', { class: 'btn primary sm', onclick: sendRec }, '✓ Send to teacher');
    rRedo = h('button', { class: 'btn ghost sm', onclick: () => { recBlob = null; showRecUI(); } }, '↺ Record again');
    rInfo = h('div', { class: 'rinfo' }, '🎙 Recite from memory, then tap Record. Your recording goes to your teacher.');
    const peek = h('button', { class: 'btn ghost sm peek', onclick: () => { const on = root.classList.toggle('hide-text'); peek.textContent = on ? '👁 Show text' : '🙈 Hide text'; app.store.logEvent(app.user.uid, on ? 'text_hidden' : 'text_shown', { assignmentId: A.id }); } }, '👁 Show text');
    rInfo.append(' ', peek);
    const box = h('div', { class: 'counter recorder' },
      h('div', { class: 'cinfo' }, h('div', {}, cntNum, ` / ${targetOf(A)}`, h('small', {}, ' today')), cntBar, cntTime),
      h('div', { class: 'rmain' }, rBtn, rTime),
      h('div', { class: 'rafter' }, rPreview, h('div', { class: 'ract' }, rRedo, rSend)),
      rInfo);
    return box;
  }
  function showRecUI() {
    const after = counterEl.querySelector('.rafter');
    after.style.display = recBlob ? '' : 'none';
    counterEl.querySelector('.rmain').style.display = recBlob ? 'none' : '';
    rBtn.textContent = rec ? '■ Stop' : '● Record';
    rBtn.classList.toggle('on', !!rec);
    if (!rec && !recBlob) rTime.textContent = '0:00';
  }
  async function startRec() {
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { toast('Recording is not supported on this browser'); return; }
    try { recStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
    catch { toast('Please allow the microphone to record'); return; }
    player.pause();
    const mime = pickMime();
    rec = new MediaRecorder(recStream, mime ? { mimeType: mime, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 });
    recChunks = [];
    rec.ondataavailable = e => { if (e.data.size) recChunks.push(e.data); };
    rec.onstop = () => {
      recBlob = new Blob(recChunks, { type: rec.mimeType || mime || 'audio/mp4' });
      recSec = Math.round((Date.now() - recStart) / 1000);
      recStream.getTracks().forEach(t => t.stop());
      rec = null; clearInterval(recTimer);
      rPreview.src = URL.createObjectURL(recBlob);
      showRecUI();
    };
    rec.start(1000);
    recStart = Date.now();
    app.tracker?.setAudio(true);
    recTimer = setInterval(() => {
      const t = (Date.now() - recStart) / 1000;
      rTime.textContent = mmss(t);
      if (t > 15 * 60) stopRec();          // safety limit: 15 minutes
    }, 250);
    showRecUI();
  }
  function stopRec() { if (rec && rec.state !== 'inactive') rec.stop(); app.tracker?.setAudio(false); }
  async function sendRec() {
    if (!recBlob) return;
    const minSec = Math.max(15, Math.round(rangeWordCount(A.from, A.to) * 0.45));
    if (!await confirmBox('Send recitation', `Send this ${mmss(recSec)} recording of ${rangeLabelEn(A.from, A.to)} to your teacher?`, 'Yes, send', 'Cancel')) return;
    rSend.disabled = true; rSend.textContent = 'Sending…';
    try {
      const id = await app.store.saveRecording({ studentUid: app.user.uid, assignmentId: A.id, sec: recSec, mime: recBlob.type, from: A.from, to: A.to }, recBlob);
      await app.store.logEvent(app.user.uid, 'recording', { assignmentId: A.id, recId: id, sec: recSec, size: recBlob.size, minSec });
      const n = curCount() + 1;
      toast(n >= targetOf(A) ? 'Sent ✓ Well done! 🌟' : `Recording ${n} sent ✓`);
      recBlob = null; showRecUI();
    } catch (e) {
      console.warn(e);
      toast(`Could not send (${e?.code || e?.message || 'error'}). Try again.`, 6000);
    }
    rSend.disabled = false; rSend.textContent = '✓ Send to teacher';
  }
  cleanups.push(() => { try { stopRec(); recStream?.getTracks().forEach(t => t.stop()); } catch { } clearInterval(recTimer); });

  function updCounter() {
    if (!counterEl) return;
    const n = curCount(), t = targetOf(A);
    cntNum.textContent = n;
    cntBar.firstChild.style.width = Math.min(100, n / t * 100) + '%';
    counterEl.classList.toggle('done', n >= t);
    const sec = (app.timeToday[A.id] || 0) + (app.tracker?.peekReadSec(A.id) || 0);
    cntTime.textContent = `Reading time today: ${Math.floor(sec / 60)} min`;
    if (PM) {
      const p = pageToMark();
      const vis = (views[vi] || []).filter(x => rangeP.includes(x));
      cntTrack.classList.toggle('off', p == null);
      cntLabel.textContent = p != null ? `Page ${p} ←`
        : vis.length ? `✓ ${vis.length > 1 ? 'Both pages read' : 'Page read'}` : 'This page is not in the assignment';
      const ds = doneSet();
      cntPages.replaceChildren(...rangeP.map(x => h('button', { class: 'pdot' + (ds.has(x) ? ' ok' : '') + ((views[vi] || []).includes(x) ? ' cur' : ''), title: `Page ${x}`, onclick: () => go(viewOf(x)) }, x)));
    }
  }
  ctx.updCounter = updCounter;
  if (app.tracker) { const prev = app.tracker.onTick; app.tracker.onTick = () => { prev?.(); updCounter(); }; cleanups.push(() => { app.tracker.onTick = prev; }); }

  /* ---------- pause & resume ---------- */
  function position() { return { page: views[vi]?.[0], vk: player.current, day: todayStr(), at: Date.now() }; }
  async function pauseLesson() {
    const pos = position();
    savePos(A.id, pos);
    app.store.logEvent(app.user.uid, 'pause', { assignmentId: A.id, page: pos.page, vk: pos.vk || null });
    paused = true;
    close();
    toast(`Paused. You will continue from page ${pos.page}.`, 3500);
  }
  let paused = false;

  /* ---------- start ---------- */
  async function close() {
    if (RM && (rec || recBlob)) {
      if (!await confirmBox('Leave?', rec ? 'You are still recording. Leave and lose it?' : 'Your recording is not sent yet. Leave without sending?', 'Leave', 'Stay', 'danger')) return;
    }
    if (A && EN && !paused) savePos(A.id, position());
    cleanups.forEach(f => f());
    player.stop();
    app.tracker?.setContext([], null);
    app.reader = null;
    ctx.onBack?.();
  }
  ctx.close = close;
  app.reader = ctx;
  views = buildViews();
  player.setRepeat(A?.ayahRepeat || 1, A?.rangeRepeat ?? 1);
  syncScopeUI();
  const resume = ctx.resume || null;
  const startP = resume?.page || ctx.startPage || (A ? versePage(A.from) : PAGE_LIST[0]);
  go(Math.max(0, viewOf(startP))).then(() => {
    setQueue(resume?.vk || undefined);
    updPlayer(); updCounter();
    if (RM && counterEl) showRecUI();
  });
  if (A && role === 'student') {
    app.store.logEvent(app.user.uid, resume ? 'resume' : 'assignment_open', { assignmentId: A.id, page: startP });
    if (resume) toast(`Welcome back! Continuing from page ${startP}${resume.vk ? `, ayah ${resume.vk.split(':')[1]}` : ''}.`, 3500);
  }
  return ctx;
}
