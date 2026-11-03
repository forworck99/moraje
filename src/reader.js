// Mushaf reader: pages, audio bar, repetition, count slider, word marks
import { h, toast, modal, confirmBox } from './ui.js';
import {
  PAGE_LIST, versePage, pageVerses, rangeVerses, inRange, rangeLabel, surahName, surahVerses,
  SURAH_ORDER, allVerses, rangeWordCount, arNum
} from './data.js';
import { renderPage, layoutPage, decorate, ensureFonts, fontsForPages } from './mushaf.js';
import { RECITERS } from './audio.js';
import { TYPES } from './types.js';

const MARK_COLORS = [
  { c: '#d32f2f', n: 'أحمر' }, { c: '#ef6c00', n: 'برتقالي' }, { c: '#1565c0', n: 'أزرق' }, { c: '#2e7d32', n: 'أخضر' }
];

export function openReader(ctx) {
  // ctx: { role, app, assignment?, startPage?, onBack }
  const { app, role } = ctx;
  const A = ctx.assignment || null;
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
  let cntNum, cntBar, cntTime;
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
  const title = A ? `${TYPES[A.type]?.label || 'واجب'} · ${rangeLabel(A.from, A.to)}` : 'المصحف';
  const pageSel = h('select', { class: 'pagesel', 'aria-label': 'اختيار الصفحة', onchange: e => go(viewOf(+e.target.value)) },
    SURAH_ORDER.map(s => h('optgroup', { label: surahName(s) },
      PAGE_LIST.filter(p => pageVerses(p).some(v => v.startsWith(s + ':'))).map(p => h('option', { value: p }, `صفحة ${p}`)))));
  const spread = h('div', { class: 'spread' });
  const stage = h('div', { class: 'stage' }, spread,
    h('button', { class: 'navbtn prev', 'aria-label': 'الصفحة السابقة', onclick: () => go(vi - 1) }, '›'),
    h('button', { class: 'navbtn next', 'aria-label': 'الصفحة التالية', onclick: () => go(vi + 1) }, '‹'));

  const counterEl = (A && role === 'student') ? buildCounter() : null;
  const playerEl = buildPlayer();
  const root = h('div', { class: 'reader' + (A ? ' has-a' : '') },
    h('header', { class: 'rbar' },
      h('button', { class: 'icon-btn', 'aria-label': 'رجوع', onclick: () => close() }, '→'),
      h('div', { class: 'rtitle' }, h('b', {}, title), role === 'teacher' ? h('small', {}, 'وضع المعلم: اضغط على أي كلمة لتلوينها') : null),
      pageSel),
    stage, counterEl, playerEl);
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
    spread.replaceChildren(...pages.map(renderPage));
    spread.classList.toggle('two', pages.length === 2);
    fit();
    paint();
    pageSel.value = pages[0];
    app.tracker?.setContext(pages, A?.id);
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
      h('div', { class: 'wm-ref' }, `${surahName(+su)} · الآية ${arNum(ay)}`),
      m && m.note ? h('div', { class: 'wm-note', style: { borderColor: m.color } }, '📝 ', m.note) : null,
      m && !m.note && role === 'student' ? h('div', { class: 'wm-note', style: { borderColor: m.color } }, 'انتبهي لقراءة هذه الكلمة') : null);
    const actions = [{ label: '▶ استماع من هنا', value: 'listen', kind: 'primary' }, { label: '🔁 تكرار الآية', value: 'rep', kind: 'ghost' }];
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
    modal({ title: 'الآية', body, actions }).then(v => { if (v === 'listen') listen(); else if (v === 'rep') repeatThis(); });
  }

  /* ---------- audio bar ---------- */
  function buildPlayer() {
    recBtn = h('button', { class: 'rec', onclick: () => { player.setReciter(player.reciter === 'alafasy' ? 'husary' : 'alafasy'); } }, '');
    playBtn = h('button', { class: 'play', 'aria-label': 'تشغيل', onclick: () => { if (!player.queue.length) setQueue(); follow = true; player.toggle(); } }, '▶');
    const jb = (d, lbl, aria) => h('button', { class: 'jump', 'aria-label': aria, onclick: () => { follow = true; player.jump(d); } }, lbl);
    statusEl = h('div', { class: 'pstatus' });
    scopeSel = h('select', { class: 'inp sm', onchange: () => { scope = scopeSel.value; syncScopeUI(); setQueue(); } },
      A ? h('option', { value: 'assignment' }, 'نطاق الواجب') : null,
      h('option', { value: 'page' }, 'الصفحة الحالية'),
      h('option', { value: 'surah' }, 'السورة كاملة'),
      h('option', { value: 'custom' }, 'من … إلى …'));
    const surSel = (onch) => h('select', { class: 'inp sm', onchange: onch }, SURAH_ORDER.map(s => h('option', { value: s }, surahName(s))));
    const ayNum = (onch) => h('input', { class: 'inp sm num', type: 'number', min: 1, inputmode: 'numeric', onchange: onch });
    const upd = () => { custom = { from: `${fromS.value}:${clampA(fromS.value, fromA.value)}`, to: `${toS.value}:${clampA(toS.value, toA.value)}` }; setQueue(); };
    fromS = surSel(upd); fromA = ayNum(upd); toS = surSel(upd); toA = ayNum(upd);
    customRow = h('div', { class: 'prow custom' }, h('span', {}, 'من'), fromS, fromA, h('span', {}, 'إلى'), toS, toA);
    ayahRepI = h('input', { class: 'inp sm num', type: 'number', min: 1, max: 99, value: A?.ayahRepeat || 1, inputmode: 'numeric', onchange: () => player.setRepeat(+ayahRepI.value || 1, null) });
    rangeRepI = h('input', { class: 'inp sm num', type: 'number', min: 0, max: 999, value: A?.rangeRepeat ?? 1, inputmode: 'numeric', onchange: () => player.setRepeat(null, +rangeRepI.value || 0) });
    const settings = h('div', { class: 'psettings' },
      h('div', { class: 'prow' }, h('label', {}, 'التشغيل:'), scopeSel),
      customRow,
      h('div', { class: 'prow' }, h('label', {}, 'تكرار كل آية'), ayahRepI, h('label', {}, 'تكرار النطاق'), rangeRepI, h('small', { class: 'muted' }, '(0 = بلا توقف)')));
    const gear = h('button', { class: 'icon-btn gear', 'aria-label': 'إعدادات التكرار', onclick: () => settings.classList.toggle('open') }, '⚙');
    return h('div', { class: 'player' },
      settings,
      h('div', { class: 'pmain' },
        recBtn,
        h('div', { class: 'pctrl' },
          jb(-2, '«٢', 'الرجوع آيتين'), jb(-1, '‹١', 'الرجوع آية'), playBtn, jb(1, '١›', 'تقديم آية'), jb(2, '٢»', 'تقديم آيتين')),
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
    if (scope === 'page') return views[vi].flatMap(pageVerses).filter((v, i, a) => a.indexOf(v) === i);
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
    recBtn.textContent = `🎙 ${RECITERS[player.reciter].name}`;
    playBtn.textContent = player.playing ? '❚❚' : '▶';
    playBtn.setAttribute('aria-label', player.playing ? 'إيقاف مؤقت' : 'تشغيل');
    const vk = player.current;
    if (vk) {
      const [s, a] = vk.split(':');
      const rep = player.ayahRep > 1 ? ` · تكرار ${player.ayahDone + 1}/${player.ayahRep}` : '';
      const rr = player.rangeRep !== 1 ? ` · دورة ${player.rangeDone + 1}${player.rangeRep ? '/' + player.rangeRep : ''}` : '';
      statusEl.textContent = `${player.bism ? 'البسملة · ' : ''}${surahName(+s)} ${arNum(a)}${rep}${rr}${player.loading && player.playing ? ' · جارٍ التحميل…' : ''}`;
    } else statusEl.textContent = 'اضغطي ▶ أو اختاري آية';
    if (player.error && player.error !== lastErr) { lastErr = player.error; toast('تعذّر تحميل التلاوة، تحقّقي من الإنترنت'); }
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
    const thumb = h('div', { class: 'thumb', 'aria-hidden': 'true' }, '✓');
    const track = h('div', { class: 'track', role: 'slider', 'aria-label': 'اسحبي لتسجيل قراءة', tabindex: 0 },
      h('span', { class: 'track-label' }, 'اسحبي لتسجيل قراءة  ←'), thumb);
    let startX = null, max = 0, dx = 0;
    const setX = x => { thumb.style.transform = `translateX(${-x}px)`; track.style.setProperty('--p', (x / max) || 0); };
    thumb.addEventListener('pointerdown', e => { startX = e.clientX; max = track.clientWidth - thumb.offsetWidth - 6; thumb.setPointerCapture(e.pointerId); track.classList.add('drag'); });
    thumb.addEventListener('pointermove', e => { if (startX == null) return; dx = Math.min(max, Math.max(0, startX - e.clientX)); setX(dx); });
    const end = async () => {
      if (startX == null) return;
      startX = null; track.classList.remove('drag');
      const done = dx >= max * 0.9;
      dx = 0; thumb.style.transition = 'transform .25s'; setX(0); setTimeout(() => thumb.style.transition = '', 260);
      if (done) await doCount();
    };
    thumb.addEventListener('pointerup', end); thumb.addEventListener('pointercancel', end);
    track.addEventListener('keydown', e => { if (e.key === 'Enter') doCount(); });
    const adj = h('button', { class: 'adj', 'aria-label': 'تعديل العدد', onclick: adjust }, '±');
    return h('div', { class: 'counter' },
      h('div', { class: 'cinfo' }, h('div', {}, cntNum, ` / ${A.target || 1}`, h('small', {}, ' اليوم')), cntBar, cntTime),
      track, adj);
  }
  const curCount = () => app.counts[A.id] || 0;
  async function doCount() {
    const n = curCount() + 1;
    const ok = await confirmBox('تسجيل قراءة', `هل أتممتِ قراءة «${rangeLabel(A.from, A.to)}» كاملة؟ ستُسجَّل القراءة رقم ${n}.`, 'نعم، أتممتها');
    if (!ok) return;
    const readSec = app.tracker.takeReadSec(A.id);
    const minSec = Math.max(15, Math.round(rangeWordCount(A.from, A.to) * 0.45));
    await app.store.logEvent(app.user.uid, 'count', { assignmentId: A.id, readSec, minSec, n });
    toast(n >= (A.target || 1) ? `أحسنتِ! أتممتِ ${n} قراءات اليوم 🌟` : `سُجِّلت القراءة ${n} ✓`);
  }
  async function adjust() {
    const n = curCount();
    const delta = await modal({ title: 'تعديل العدد', body: `العدد الحالي اليوم: ${n}. استخدمي هذا فقط إذا ضغطتِ بالخطأ.`, actions: [{ label: 'إلغاء', value: 0, kind: 'ghost' }, { label: '− إنقاص 1', value: -1, kind: 'ghost' }, { label: '+ زيادة 1', value: 1, kind: 'ghost' }] });
    if (!delta || (delta < 0 && n === 0)) return;
    const to = Math.max(0, n + delta);
    if (!await confirmBox('تأكيد التعديل', `تغيير العدد من ${n} إلى ${to}؟`, 'نعم')) return;
    if (!await confirmBox('تأكيد نهائي', 'هل أنتِ متأكدة فعلًا؟ سيُسجَّل هذا التعديل ويظهر للمعلم.', 'نعم، متأكدة', 'تراجع', 'danger')) return;
    await app.store.logEvent(app.user.uid, 'count_adjust', { assignmentId: A.id, delta, from: n, to });
    toast('عُدِّل العدد');
  }
  function updCounter() {
    if (!counterEl) return;
    const n = curCount(), t = A.target || 1;
    cntNum.textContent = n;
    cntBar.firstChild.style.width = Math.min(100, n / t * 100) + '%';
    counterEl.classList.toggle('done', n >= t);
    const sec = (app.timeToday[A.id] || 0) + (app.tracker?.peekReadSec(A.id) || 0);
    cntTime.textContent = `وقت القراءة اليوم: ${Math.floor(sec / 60)} د`;
  }
  ctx.updCounter = updCounter;
  if (app.tracker) { const prev = app.tracker.onTick; app.tracker.onTick = () => { prev?.(); updCounter(); }; cleanups.push(() => { app.tracker.onTick = prev; }); }

  /* ---------- start ---------- */
  function close() {
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
  const startP = ctx.startPage || (A ? versePage(A.from) : PAGE_LIST[0]);
  go(Math.max(0, viewOf(startP))).then(() => { setQueue(); updPlayer(); updCounter(); });
  if (A && role === 'student') app.store.logEvent(app.user.uid, 'assignment_open', { assignmentId: A.id });
  return ctx;
}
