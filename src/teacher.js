// Teacher dashboard
import { h, toast, modal, confirmBox, fmtDur, fmtTime, dayName, addDays, shortDate } from './ui.js';
import { todayStr } from './store.js';
import { rangeLabel, surahName, surahVerses, SURAH_ORDER, rangePages, verseIndex, arNum } from './data.js';
import { TYPES, TYPE_ORDER, targetOf, unitOf, modeOf, isPageMode } from './types.js';
import { breakdown } from './stats.js';
import { openReader } from './reader.js';
import { topbar } from './student.js';
import RULES from '../firestore.rules';

export function teacherHome(app) {
  if (app.reader) { app.reader.repaint?.(); return; }
  const T = app.t ||= { tab: 'grid', wk: 0, day: todayStr() };
  const today = todayStr();

  if (app.permError) return app.mount(h('div', { class: 'home' }, topbar(app), rulesCard(app)));

  const studentSel = h('select', { class: 'inp', 'aria-label': 'اختيار الطالبة', onchange: e => app.selectStudent(e.target.value) },
    app.students.map(s => h('option', { value: s.id, selected: s.id === app.sel }, s.name || s.email)));

  if (!app.students.length) {
    return app.mount(h('div', { class: 'home' }, topbar(app),
      h('div', { class: 'empty' }, h('div', { class: 'em' }, '👧'),
        h('h3', {}, 'لا توجد طالبات بعد'),
        h('p', {}, 'أرسل رابط التطبيق للطالبة، ودعها تنشئ حسابًا من خيار «حساب جديد». ستظهر هنا تلقائيًا.'),
        h('button', { class: 'btn primary', onclick: () => shareLink() }, '📤 مشاركة رابط التطبيق'))));
  }

  const stu = app.students.find(s => s.id === app.sel) || app.students[0];
  const days = breakdown(app.weekEvents || [], app.assignments, stu.resetAt || 0);
  const tabs = [['grid', 'المتابعة'], ['log', 'السجل'], ['assign', 'الواجبات'], ['tests', 'الاختبارات']];

  const body = { grid: gridTab, log: logTab, assign: assignTab, tests: testsTab }[T.tab](app, stu, days, today);
  app.mount(h('div', { class: 'home teacher' },
    topbar(app, studentSel),
    h('div', { class: 'tactions' },
      h('button', { class: 'btn ghost', onclick: () => openReader({ app, role: 'teacher', studentUid: stu.id, onBack: () => app.render() }) }, '🖍 تلوين كلمات للطالبة'),
      h('button', { class: 'btn ghost', onclick: () => shareReport(app, stu, days) }, '📤 مشاركة التقرير'),
      h('button', { class: 'btn ghost', onclick: () => shareLink() }, '🔗 رابط التطبيق')),
    h('nav', { class: 'tabs', role: 'tablist' }, tabs.map(([k, l]) =>
      h('button', { role: 'tab', 'aria-selected': T.tab === k, class: T.tab === k ? 'on' : '', onclick: () => { T.tab = k; app.render(); } }, l))),
    body));
}

function weekDays(T) { const end = addDays(todayStr(), -7 * T.wk); return [...Array(7)].map((_, i) => addDays(end, i - 6)); }
const status = (n, t, d, today, a) => d > today ? 'fut' : (a.start && d < a.start) || (a.end && d > a.end) ? 'na' : n >= t ? 'g' : n > 0 ? 'y' : d < today ? 'r' : 'e';

function gridTab(app, stu, days, today) {
  const T = app.t;
  const wd = weekDays(T);
  const as = app.assignments.filter(a => (!a.start || a.start <= wd[6]) && (!a.end || a.end >= wd[0]))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  const total = wd.reduce((s, d) => s + (days[d]?.total || 0), 0);
  const activeDays = wd.filter(d => (days[d]?.total || 0) > 0 || Object.keys(days[d]?.counts || {}).length).length;
  const flags = wd.reduce((s, d) => s + (days[d]?.flags || 0), 0);
  const last = Math.max(0, ...Object.values(days).map(d => d.last || 0));
  return h('section', {},
    h('div', { class: 'pills' },
      pill('أيام القراءة', `${activeDays} / 7`),
      pill('مجموع الوقت', fmtDur(total)),
      pill('آخر نشاط', last ? `${todayStr(new Date(last)) === today ? 'اليوم' : shortDate(todayStr(new Date(last)))} ${fmtTime(last)}` : '—'),
      pill('تنبيهات', flags ? `⚠️ ${flags}` : '0', flags ? 'warn' : '')),
    h('div', { class: 'weeknav' },
      h('button', { class: 'icon-btn', 'aria-label': 'الأسبوع السابق', onclick: () => { T.wk++; app.render(); } }, '→'),
      h('b', {}, `${shortDate(wd[0])} – ${shortDate(wd[6])}`),
      h('button', { class: 'icon-btn', 'aria-label': 'الأسبوع التالي', disabled: T.wk === 0, onclick: () => { T.wk = Math.max(0, T.wk - 1); app.render(); } }, '←')),
    as.length ? h('div', { class: 'gridwrap' }, h('table', { class: 'grid' },
      h('colgroup', {}, h('col', { class: 'c1' }), wd.map(() => h('col'))),
      h('thead', {}, h('tr', {}, h('th', {}, 'الواجب'), wd.map(d => h('th', { class: d === today ? 'today' : '' }, dayName(d).replace('ال', ''), h('br'), h('small', {}, shortDate(d)))))),
      h('tbody', {},
        as.map(a => {
          const t = targetOf(a);
          return h('tr', {},
            h('th', { class: 'aname', style: { '--tc': TYPES[a.type].color } }, h('span', { class: 'tag sm' }, TYPES[a.type].short), h('div', {}, rangeLabel(a.from, a.to)), h('small', {}, `المطلوب ${t} ${unitOf(a)} يوميًا`)),
            wd.map(d => {
              const n = days[d]?.counts[a.id] || 0, sec = days[d]?.time[a.id] || 0;
              const st = status(n, t, d, today, a);
              return h('td', { class: 'c ' + st, onclick: () => { T.tab = 'log'; T.day = d; app.render(); } },
                st === 'fut' || st === 'na' ? '' : h('b', {}, n), sec ? h('small', {}, `${Math.round(sec / 60)} د`) : null);
            }));
        }),
        h('tr', { class: 'tot' }, h('th', {}, 'الوقت الكلي'), wd.map(d => h('td', {}, days[d]?.total ? `${Math.round(days[d].total / 60)} د` : (d > today ? '' : '—')))),
        h('tr', { class: 'tot' }, h('th', {}, 'منه استماع'), wd.map(d => h('td', {}, days[d]?.listen ? `${Math.round(days[d].listen / 60)} د` : ''))))))
      : h('div', { class: 'empty' }, h('p', {}, 'لا توجد واجبات لهذا الأسبوع.'), h('button', { class: 'btn primary', onclick: () => { T.tab = 'assign'; app.render(); } }, '+ إضافة واجب')),
    h('div', { class: 'legend' }, h('span', { class: 'lg g' }, 'أتمّت'), h('span', { class: 'lg y' }, 'ناقص'), h('span', { class: 'lg r' }, 'لم تقرأ'), h('small', { class: 'muted' }, 'اضغط على أي خانة لرؤية تفاصيل اليوم')),
    pagesTable(wd, days, 'الوقت على كل صفحة هذا الأسبوع'));
}

function pill(l, v, cls = '') { return h('div', { class: 'pill ' + cls }, h('small', {}, l), h('b', {}, v)); }

function pagesTable(daysList, days, title) {
  const pages = {};
  for (const d of daysList) for (const [p, s] of Object.entries(days[d]?.pages || {})) pages[p] = (pages[p] || 0) + s;
  const entries = Object.entries(pages).sort((a, b) => +a[0] - +b[0]);
  if (!entries.length) return null;
  const max = Math.max(...entries.map(e => e[1]));
  return h('section', { class: 'ptable' }, h('h4', {}, title),
    entries.map(([p, s]) => h('div', { class: 'prow2' }, h('span', { class: 'pn' }, `ص ${p}`), h('div', { class: 'pbar' }, h('i', { style: { width: (s / max * 100) + '%' } })), h('span', {}, fmtDur(s)))));
}

function logTab(app, stu, days, today) {
  const T = app.t;
  const wd = [...Array(14)].map((_, i) => addDays(today, -i));
  const d = days[T.day];
  const aName = id => { const a = app.assignments.find(x => x.id === id); return a ? `${TYPES[a.type].short} · ${rangeLabel(a.from, a.to)}` : 'واجب محذوف'; };
  const items = (d?.log || []).slice().reverse().map(e => {
    if (e.kind === 'count') return h('li', { class: 'lg-count' + (e.suspicious ? ' sus' : '') },
      h('span', { class: 'lt' }, fmtTime(e.t)),
      h('div', {}, h('b', {}, `✅ قراءة رقم ${e.n}`), ` · ${aName(e.aid)}`,
        h('div', { class: 'muted' },
          e.interval != null ? `بعد ${fmtDur(e.interval)} من السابقة` : 'أول قراءة اليوم',
          e.readSec != null ? ` · وقت فعلي على الصفحة ${fmtDur(e.readSec)}` : '',
          e.suspicious ? h('span', { class: 'warn' }, ` · ⚠️ أسرع من المعقول (أقل من ${fmtDur(e.minSec)})`) : '',
          e.skew ? h('span', { class: 'warn' }, ' · سُجّلت دون إنترنت') : '')));
    if (e.kind === 'rec') {
      const player = h('div', { class: 'recplay' });
      const btn = h('button', {
        class: 'btn primary sm', onclick: async () => {
          btn.disabled = true; btn.textContent = '…جارٍ التحميل';
          try {
            const blob = await app.store.getRecording(e.recId);
            if (!blob) { toast('التسجيل غير موجود'); btn.remove(); return; }
            const au = h('audio', { controls: true, src: URL.createObjectURL(blob) });
            player.replaceChildren(au); au.play().catch(() => { });
          } catch (x) { console.warn(x); toast((x?.code || '').includes('permission') ? 'حدّث قواعد الأمان أولًا (تبويب الواجبات)' : 'تعذّر تحميل التسجيل'); btn.disabled = false; btn.textContent = '▶ استماع'; }
        }
      }, '▶ استماع');
      player.append(btn);
      return h('li', { class: 'lg-count' + (e.suspicious ? ' sus' : '') },
        h('span', { class: 'lt' }, fmtTime(e.t)),
        h('div', {}, h('b', {}, `🎙 تسميع رقم ${e.n}`), ` · ${aName(e.aid)}`,
          h('div', { class: 'muted' }, `مدة التسجيل ${fmtDur(e.sec)}`, e.suspicious ? h('span', { class: 'warn' }, ` · ⚠️ قصير جدًا (أقل من ${fmtDur(e.minSec)})`) : ''),
          player));
    }
    if (e.kind === 'page') return h('li', { class: 'lg-count' + (e.suspicious ? ' sus' : '') },
      h('span', { class: 'lt' }, fmtTime(e.t)),
      h('div', {}, h('b', {}, `📄 قرأت صفحة ${e.page}`), ` (${e.n}) · ${aName(e.aid)}`,
        h('div', { class: 'muted' },
          e.readSec != null ? `وقت فعلي على الصفحة ${fmtDur(e.readSec)}` : '',
          e.interval != null ? ` · بعد ${fmtDur(e.interval)} من السابقة` : '',
          e.again ? ' · سبق تسجيلها اليوم' : '',
          e.suspicious ? h('span', { class: 'warn' }, ` · ⚠️ أسرع من المعقول (أقل من ${fmtDur(e.minSec)})`) : '')));
    if (e.kind === 'pundo') return h('li', { class: 'lg-adj' }, h('span', { class: 'lt' }, fmtTime(e.t)), h('div', {}, h('b', {}, `✎ ألغت تسجيل صفحة ${e.page}`), ` · ${aName(e.aid)}`));
    if (e.kind === 'peek') return h('li', { class: 'lg-adj' }, h('span', { class: 'lt' }, fmtTime(e.t)), h('div', {}, `👁 أظهرت النص أثناء التسميع · ${aName(e.aid)}`));
    if (e.kind === 'pause') return h('li', { class: 'lg-open' }, h('span', { class: 'lt' }, fmtTime(e.t)), h('div', {}, `⏸ أوقفت الدرس عند صفحة ${e.page}${e.vk ? ` (آية ${e.vk.split(':')[1]})` : ''} · ${aName(e.aid)}`));
    if (e.kind === 'resume') return h('li', { class: 'lg-open' }, h('span', { class: 'lt' }, fmtTime(e.t)), h('div', {}, `▶ استأنفت الدرس من صفحة ${e.page} · ${aName(e.aid)}`));
    if (e.kind === 'adjust') return h('li', { class: 'lg-adj' }, h('span', { class: 'lt' }, fmtTime(e.t)), h('div', {}, h('b', {}, `✎ تعديل العدد من ${e.from} إلى ${e.to}`), ` · ${aName(e.aid)}`));
    if (e.kind === 'open') return h('li', { class: 'lg-open' }, h('span', { class: 'lt' }, fmtTime(e.t)), h('div', {}, '🔓 فتحت التطبيق'));
    if (e.kind === 'close') return h('li', { class: 'lg-open' }, h('span', { class: 'lt' }, fmtTime(e.t)), h('div', {}, `🔒 أغلقت التطبيق${e.sec ? ` (جلسة نشطة ${fmtDur(e.sec)})` : ''}`));
    if (e.kind === 'aopen') return h('li', { class: 'lg-open' }, h('span', { class: 'lt' }, fmtTime(e.t)), h('div', {}, `📖 فتحت ${aName(e.aid)}`));
    return null;
  });
  return h('section', {},
    h('div', { class: 'daychips' }, wd.map(x => h('button', { class: 'dchip' + (x === T.day ? ' on' : '') + ((days[x]?.total || days[x]?.log.length) ? ' has' : ''), onclick: () => { T.day = x; app.render(); } }, x === today ? 'اليوم' : dayName(x), h('small', {}, shortDate(x))))),
    d ? h('div', { class: 'pills' }, pill('وقت القراءة', fmtDur(d.total)), pill('استماع', fmtDur(d.listen)), pill('أول نشاط', fmtTime(d.first)), pill('آخر نشاط', fmtTime(d.last)), pill('تنبيهات', d.flags ? `⚠️ ${d.flags}` : '0', d.flags ? 'warn' : '')) : null,
    items.length ? h('ol', { class: 'log' }, items) : h('div', { class: 'empty' }, h('p', {}, 'لا يوجد نشاط في هذا اليوم.')),
    d ? pagesTable([T.day], days, 'الوقت على كل صفحة') : null);
}

/* ---------- assignments ---------- */
function assignTab(app, stu, days, today) {
  const list = app.assignments.slice().sort((a, b) => (b.start || '').localeCompare(a.start || '') || TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  return h('section', {},
    h('button', { class: 'btn primary block', onclick: () => editAssignment(app, stu) }, '+ واجب جديد'),
    list.length ? h('button', { class: 'btn ghost block', onclick: () => scheduleAll(app, list) }, '📅 جدولة كل الواجبات (تاريخ البداية وعدد الأيام)') : null,
    h('button', { class: 'btn ghost block', onclick: () => resetAll(app, stu) }, '⟲ تصفير كل شيء لهذه الطالبة'),
    h('button', { class: 'btn ghost block', onclick: () => modal({ title: 'قواعد الأمان', body: rulesCard(app), actions: [{ label: 'إغلاق', value: 0, kind: 'ghost' }] }) }, '🛡️ تحديث قواعد الأمان'),
    stu.resetAt ? h('p', { class: 'muted center' }, `آخر تصفير كامل: ${shortDate(todayStr(new Date(stu.resetAt)))} ${fmtTime(stu.resetAt)}`) : null,
    h('div', { class: 'alist' }, list.map(a => {
      const T = TYPES[a.type];
      const cur = a.active !== false && (!a.start || a.start <= today) && (!a.end || a.end >= today);
      return h('div', { class: 'aitem' + (cur ? '' : ' off'), style: { '--tc': T.color } },
        h('div', {}, h('span', { class: 'tag sm' }, T.label), cur ? h('span', { class: 'live' }, 'جارٍ') : h('span', { class: 'muted' }, a.active === false ? ' موقوف' : ' خارج المدة'),
          h('h4', {}, rangeLabel(a.from, a.to)),
          h('small', { class: 'muted' }, `${isPageMode(a) ? `كل صفحة مرة (${targetOf(a)} صفحة)` : `${targetOf(a)} ${unitOf(a)}`} يوميًا${a.resetAt ? ` · صُفِّر ${shortDate(todayStr(new Date(a.resetAt)))}` : ''} · ${a.start ? shortDate(a.start) : ''} – ${a.end ? shortDate(a.end) : '…'} · صفحات ${(p => p.length > 4 ? p[0] + '–' + p[p.length - 1] : p.join('، '))(rangePages(a.from, a.to))}`)),
        h('div', { class: 'aact' },
          h('button', { class: 'btn ghost sm', onclick: () => editAssignment(app, stu, a) }, 'تعديل'),
          h('button', { class: 'btn ghost sm', onclick: () => resetCounters(app, [a]) }, 'تصفير'),
          h('button', { class: 'btn danger-ghost sm', onclick: async () => { if (await confirmBox('حذف الواجب', 'سيُحذف الواجب، ويبقى سجل قراءاته محفوظًا.', 'حذف', 'إلغاء', 'danger')) { await app.store.deleteAssignment(a.id); toast('حُذف'); } } }, 'حذف')));
    })),
    h('details', { class: 'help' }, h('summary', {}, 'كيف أضبط الواجبات؟'),
      h('ul', {},
        h('li', {}, 'الحفظ الجديد: نصف صفحة، 15 مرة يوميًا طوال الأسبوع.'),
        h('li', {}, 'الحفظ القديم: صفحة، 15 مرة يوميًا.'),
        h('li', {}, 'الحفظ الحديث والمراجعة: تسحب الطالبة بعد إكمال كل صفحة، فتعرف كم صفحة قرأت من النطاق.'),
        h('li', {}, '«تصفير» بجانب الواجب: يصفّر عدّاده ووقته وسجله. «تصفير كل شيء»: يصفّر كل النتائج، ومنها أوقات الدخول والخروج.'))));
}

async function scheduleAll(app, list) {
  const tomorrow = addDays(todayStr(), 1);
  const st = h('input', { class: 'inp', type: 'date', value: tomorrow });
  const n = h('input', { class: 'inp num', type: 'number', min: 1, max: 60, value: 5, inputmode: 'numeric' });
  const info = h('div', { class: 'preview' });
  const upd = () => { const k = Math.max(1, +n.value || 1); info.textContent = `من ${shortDate(st.value)} إلى ${shortDate(addDays(st.value, k - 1))} · ${k} أيام · ${list.length} واجبات`; };
  st.addEventListener('input', upd); n.addEventListener('input', upd); upd();
  const ok = await modal({ title: 'جدولة كل الواجبات', dismissable: false,
    body: h('div', { class: 'form' }, h('label', {}, 'تبدأ من', st), h('label', {}, 'عدد الأيام', n), info, h('small', { class: 'muted' }, 'نفس الواجبات كل يوم، وتُفعَّل كلها.')),
    actions: [{ label: 'إلغاء', value: false, kind: 'ghost' }, { label: 'حفظ', value: true, kind: 'primary' }] });
  if (!ok) return;
  const k = Math.max(1, +n.value || 1);
  for (const a of list) await app.store.saveAssignment({ id: a.id, start: st.value, end: addDays(st.value, k - 1), active: true });
  toast('جُدولت الواجبات ✓');
}

async function resetAll(app, stu) {
  const ok = await confirmBox('تصفير كل شيء', `تصفير كل نتائج «${stu.name || ''}»؟ العدّات والأوقات والدخول والخروج وكل السجل قبل الآن لن تظهر بعد التصفير.`, 'تصفير', 'إلغاء', 'danger');
  if (!ok) return;
  if (!await confirmBox('تأكيد نهائي', 'هل أنت متأكد؟', 'نعم، صفّر', 'تراجع', 'danger')) return;
  await app.store.saveProfile(stu.id, { resetAt: Date.now() });
  toast('صُفِّر كل شيء ✓');
}

async function resetCounters(app, list) {
  const one = list.length === 1;
  const ok = await confirmBox('تصفير العداد', one
    ? `تصفير «${rangeLabel(list[0].from, list[0].to)}»؟ العدّات والأوقات وسجل هذا الواجب قبل الآن لن تظهر.`
    : 'تصفير عدّادات كل الواجبات؟ لن تُحسب القراءات والأوقات السابقة.', 'تصفير', 'إلغاء', 'danger');
  if (!ok) return;
  const now = Date.now();
  for (const a of list) await app.store.saveAssignment({ id: a.id, resetAt: now });
  toast('صُفِّر العداد ✓');
}

function editAssignment(app, stu, a) {
  const today = todayStr();
  const v = a ? { ...a } : { type: 'new', from: '36:1', to: '36:6', target: 15, ayahRepeat: 1, rangeRepeat: 1, start: today, end: addDays(today, 6), note: '' };
  const typeSel = h('select', { class: 'inp' }, TYPE_ORDER.map(k => h('option', { value: k, selected: v.type === k }, TYPES[k].label)));
  const sur = val => h('select', { class: 'inp' }, SURAH_ORDER.map(s => h('option', { value: s, selected: +val === s }, surahName(s))));
  const num = (val, min = 1, max = 999) => h('input', { class: 'inp num', type: 'number', inputmode: 'numeric', min, max, value: val });
  const [fs, fa] = v.from.split(':'), [ts, ta] = v.to.split(':');
  const fS = sur(fs), fA = num(fa), tS = sur(ts), tA = num(ta);
  const target = num(v.target), ar = num(v.ayahRepeat || 1), rr = num(v.rangeRepeat ?? 1, 0);
  const st = h('input', { class: 'inp', type: 'date', value: v.start || today });
  const en = h('input', { class: 'inp', type: 'date', value: v.end || addDays(today, 6) });
  const note = h('input', { class: 'inp', placeholder: 'ملاحظة للطالبة (اختياري)', value: v.note || '' });
  const active = h('input', { type: 'checkbox', checked: v.active !== false });
  const modeSel = h('select', { class: 'inp' },
    h('option', { value: 'range', selected: modeOf(v) === 'range' }, 'عدّ قراءة النطاق كاملًا (مثل 15 مرة)'),
    h('option', { value: 'page', selected: modeOf(v) === 'page' }, 'كل صفحة مرة: تسحب بعد إكمال كل صفحة'));
  const targetLbl = h('label', {}, 'المطلوب يوميًا', target);
  const modeLbl = h('label', {}, 'طريقة العدّ', modeSel);
  const syncMode = () => { const rc = typeSel.value === 'recite'; modeLbl.style.display = rc ? 'none' : ''; targetLbl.firstChild.textContent = rc ? 'عدد التسميعات المطلوبة يوميًا' : 'المطلوب يوميًا'; targetLbl.style.display = (!rc && modeSel.value === 'page') ? 'none' : ''; };
  modeSel.addEventListener('change', syncMode);
  const preview = h('div', { class: 'preview' });
  const read = () => {
    const c = (s, x) => Math.min(surahVerses(+s.value), Math.max(1, +x.value || 1));
    let from = `${fS.value}:${c(fS, fA)}`, to = `${tS.value}:${c(tS, tA)}`;
    if (verseIndex(from) > verseIndex(to)) [from, to] = [to, from];
    return { from, to };
  };
  const upd = () => { const r = read(); preview.textContent = `${rangeLabel(r.from, r.to)} · صفحات ${rangePages(r.from, r.to).join('، ')}`; };
  [fS, fA, tS, tA].forEach(x => x.addEventListener('input', upd));
  typeSel.addEventListener('change', () => { target.value = TYPES[typeSel.value].target; if (typeSel.value !== 'recite') modeSel.value = modeOf({ type: typeSel.value }); syncMode(); });
  syncMode();
  upd();
  const body = h('div', { class: 'form' },
    h('label', {}, 'النوع', typeSel),
    h('div', { class: 'frow' }, h('label', {}, 'من سورة', fS), h('label', {}, 'آية', fA)),
    h('div', { class: 'frow' }, h('label', {}, 'إلى سورة', tS), h('label', {}, 'آية', tA)),
    preview,
    modeLbl,
    h('div', { class: 'frow' }, targetLbl, h('label', {}, 'تكرار الآية في التلاوة', ar), h('label', {}, 'تكرار النطاق', rr)),
    h('div', { class: 'frow' }, h('label', {}, 'من تاريخ', st), h('label', {}, 'إلى تاريخ', en)),
    h('label', {}, 'ملاحظة', note),
    h('label', { class: 'check' }, active, ' واجب فعّال'));
  modal({ title: a ? 'تعديل الواجب' : 'واجب جديد', body, dismissable: false, actions: [{ label: 'إلغاء', value: false, kind: 'ghost' }, { label: 'حفظ', value: true, kind: 'primary' }] })
    .then(async ok => {
      if (!ok) return;
      const r = read();
      await app.store.saveAssignment({
        id: a?.id, studentUid: stu.id, type: typeSel.value, from: r.from, to: r.to,
        mode: typeSel.value === 'recite' ? 'record' : modeSel.value, target: Math.max(1, +target.value || 1), ayahRepeat: Math.max(1, +ar.value || 1), rangeRepeat: Math.max(0, +rr.value || 0),
        start: st.value || today, end: en.value || '', note: note.value.trim(), active: active.checked
      });
      toast('حُفظ الواجب ✓');
    });
}

/* ---------- tests ---------- */
function testsTab(app, stu, days, today) {
  const list = (app.tests || []).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  const add = () => {
    const date = h('input', { class: 'inp', type: 'date', value: today });
    const what = h('input', { class: 'inp', placeholder: 'ماذا اختبرت؟ مثال: يس 1–12' });
    const score = h('input', { class: 'inp num', type: 'number', min: 0, max: 10, step: 0.5, value: 10, inputmode: 'decimal' });
    const mistakes = h('input', { class: 'inp num', type: 'number', min: 0, value: 0, inputmode: 'numeric' });
    const notes = h('textarea', { class: 'inp', rows: 3, placeholder: 'الأخطاء والملاحظات' });
    modal({
      title: 'اختبار الأسبوع', dismissable: false, body: h('div', { class: 'form' },
        h('label', {}, 'التاريخ', date), h('label', {}, 'المحتوى', what),
        h('div', { class: 'frow' }, h('label', {}, 'الدرجة من 10', score), h('label', {}, 'عدد الأخطاء', mistakes)),
        h('label', {}, 'ملاحظات', notes),
        h('small', { class: 'muted' }, 'لتحديد كلمات الخطأ في المصحف استخدم «تلوين كلمات للطالبة».')),
      actions: [{ label: 'إلغاء', value: false, kind: 'ghost' }, { label: 'حفظ', value: true, kind: 'primary' }]
    }).then(async ok => {
      if (!ok) return;
      await app.store.saveTest({ studentUid: stu.id, date: date.value, what: what.value.trim(), score: +score.value, mistakes: +mistakes.value, notes: notes.value.trim() });
      toast('حُفظ الاختبار ✓');
    });
  };
  return h('section', {},
    h('button', { class: 'btn primary block', onclick: add }, '+ تسجيل اختبار'),
    list.length ? h('div', { class: 'alist' }, list.map(t => h('div', { class: 'aitem' },
      h('div', {}, h('h4', {}, `${t.what || 'اختبار'} · ${t.score}/10`), h('small', { class: 'muted' }, `${dayName(t.date)} ${shortDate(t.date)} · الأخطاء: ${t.mistakes}`), t.notes ? h('p', {}, t.notes) : null),
      h('div', { class: 'aact' }, h('button', { class: 'btn danger-ghost sm', onclick: async () => { if (await confirmBox('حذف', 'حذف هذا الاختبار؟', 'حذف', 'إلغاء', 'danger')) app.store.deleteTest(t.id); } }, 'حذف')))))
      : h('div', { class: 'empty' }, h('p', {}, 'لم تُسجَّل اختبارات بعد.')));
}

/* ---------- sharing ---------- */
function shareText(text) {
  if (navigator.share) return navigator.share({ text }).catch(() => { });
  navigator.clipboard?.writeText(text).then(() => toast('نُسخ النص، الصقه في واتساب'));
}
function shareLink() { shareText(`تطبيق مُراجِع لمراجعة القرآن:\n${location.origin}${location.pathname}`); }

function shareReport(app, stu, days) {
  const wd = weekDays(app.t);
  const today = todayStr();
  const lines = [`📖 تقرير مُراجِع — ${stu.name || ''}`, `الأسبوع ${shortDate(wd[0])} – ${shortDate(wd[6])}`, ''];
  for (const a of app.assignments.filter(a => (!a.start || a.start <= wd[6]) && (!a.end || a.end >= wd[0]))) {
    const t = targetOf(a);
    const marks = wd.filter(d => d <= today && (!a.start || d >= a.start) && (!a.end || d <= a.end))
      .map(d => { const n = days[d]?.counts[a.id] || 0; return `${dayName(d).replace('ال', '')}: ${n >= t ? '🟢' : n ? '🟡' : '🔴'}${n}`; });
    lines.push(`▪️ ${TYPES[a.type].label} (${rangeLabel(a.from, a.to)}) — المطلوب ${t} ${unitOf(a)} يوميًا`, marks.join(' | '), '');
  }
  const total = wd.reduce((s, d) => s + (days[d]?.total || 0), 0);
  const act = wd.filter(d => days[d]?.total).length;
  const flags = wd.reduce((s, d) => s + (days[d]?.flags || 0), 0);
  lines.push(`أيام القراءة: ${act}/7 · مجموع الوقت: ${fmtDur(total)}${flags ? ` · تنبيهات: ${flags}` : ''}`);
  const lastTest = (app.tests || []).filter(t => t.date >= wd[0] && t.date <= wd[6]).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (lastTest) lines.push(`اختبار الأسبوع: ${lastTest.score}/10 · الأخطاء: ${lastTest.mistakes}${lastTest.notes ? ' · ' + lastTest.notes : ''}`);
  shareText(lines.join('\n'));
}

/* ---------- first-time setup: security rules ---------- */
function rulesCard(app) {
  const pre = h('pre', { class: 'rules', dir: 'ltr' }, RULES);
  return h('section', { class: 'setup' },
    h('h2', {}, '🛡️ خطوة أخيرة: قواعد الأمان'),
    h('p', {}, 'قاعدة البيانات مغلقة حاليًا. انسخ القواعد التالية والصقها في Firebase مرة واحدة فقط:'),
    h('ol', {},
      h('li', {}, 'اضغط «نسخ القواعد».'),
      h('li', {}, 'اضغط «فتح صفحة القواعد».'),
      h('li', {}, 'احذف النص الموجود هناك، والصق المنسوخ، ثم اضغط Publish.'),
      h('li', {}, 'ارجع هنا واضغط «تحديث».')),
    h('div', { class: 'frow' },
      h('button', { class: 'btn primary', onclick: () => navigator.clipboard.writeText(RULES).then(() => toast('نُسخت القواعد ✓')) }, '📋 نسخ القواعد'),
      h('a', { class: 'btn ghost', href: 'https://console.firebase.google.com/project/moraji-87d63/firestore/databases/-default-/rules', target: '_blank', rel: 'noopener' }, '↗ فتح صفحة القواعد'),
      h('button', { class: 'btn ghost', onclick: () => location.reload() }, '⟳ تحديث')),
    pre);
}
