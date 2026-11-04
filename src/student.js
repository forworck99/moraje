// Student screens
import { h, fmtDur, dayName, addDays, shortDate, confirmBox } from './ui.js';
import { todayStr } from './store.js';
import { rangeLabel, rangePages, arNum } from './data.js';
import { TYPES, TYPE_ORDER, targetOf, unitOf } from './types.js';
import { breakdown } from './stats.js';
import { openReader } from './reader.js';

export function activeAssignments(list, day = todayStr()) {
  return list
    .filter(a => a.active !== false && (!a.start || a.start <= day) && (!a.end || a.end >= day))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (a.from > b.from ? 1 : -1));
}

export function studentHome(app) {
  if (app.reader) { app.reader.updCounter?.(); app.reader.repaint?.(); return; }
  const today = todayStr();
  const days = breakdown(app.weekEvents || [], app.assignments);
  const act = activeAssignments(app.assignments, today);
  const week = [...Array(7)].map((_, i) => addDays(today, i - 6));

  const card = a => {
    const T = TYPES[a.type] || TYPES.review;
    const n = app.counts[a.id] || 0, t = targetOf(a);
    const sec = app.timeToday[a.id] || 0;
    const pages = rangePages(a.from, a.to);
    const done = n >= t;
    return h('article', { class: 'acard' + (done ? ' done' : ''), style: { '--tc': T.color } },
      h('div', { class: 'acard-top' },
        h('span', { class: 'tag' }, T.label),
        done ? h('span', { class: 'ok' }, 'أُنجز اليوم ✓') : null),
      h('h3', {}, rangeLabel(a.from, a.to)),
      h('div', { class: 'muted' }, `${pages.length > 1 ? 'الصفحات' : 'الصفحة'} ${pages.length > 4 ? pages[0] + '–' + pages[pages.length - 1] : pages.join('، ')}`),
      a.note ? h('p', { class: 'note' }, '📌 ', a.note) : null,
      h('div', { class: 'prog-row' },
        h('div', { class: 'big' }, h('b', {}, n), ` / ${t} ${unitOf(a)}`),
        h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, n / t * 100) + '%' } })),
        h('small', { class: 'muted' }, fmtDur(sec))),
      h('div', { class: 'week' }, week.map(d => {
        const c = days[d]?.counts[a.id] || 0;
        const st = d > today ? 'fut' : c >= t ? 'g' : c > 0 ? 'y' : (d < today && (!a.start || d >= a.start)) ? 'r' : 'e';
        return h('div', { class: 'wd ' + st, title: `${dayName(d)} ${shortDate(d)}: ${c}/${t}` }, h('i'), h('span', {}, dayName(d).replace('ال', '')));
      })),
      h('button', { class: 'btn primary block', onclick: () => openReader({ app, role: 'student', assignment: a, onBack: () => app.render() }) }, done ? 'قراءة إضافية' : 'ابدئي القراءة'));
  };

  const totalToday = Object.values(app.timeToday).reduce((x, y) => x + y, 0);
  app.mount(h('div', { class: 'home' },
    topbar(app),
    h('section', { class: 'hello' },
      h('h2', {}, `السلام عليكم، ${app.user.name || ''}`),
      h('p', { class: 'muted' }, `${dayName(today)} ${shortDate(today)} · وقت القراءة اليوم: ${fmtDur(totalToday)}`)),
    act.length ? h('section', { class: 'cards' }, act.map(card))
      : h('div', { class: 'empty' }, h('div', { class: 'em' }, '📖'), h('p', {}, 'لا توجد واجبات حالية. سيظهر واجبك هنا عندما يحدده المعلم.')),
    h('button', { class: 'btn ghost block', onclick: () => openReader({ app, role: 'student', onBack: () => app.render() }) }, '📖 تصفّح المصحف والاستماع'),
    h('p', { class: 'privacy' }, '🛡️ يسجّل التطبيق أوقات القراءة والعدّات ليطّلع عليها معلّمك فقط.')
  ));
}

export function topbar(app, extra) {
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, 'م'), h('b', {}, 'مُراجِع')),
    extra || null,
    h('button', { class: 'btn ghost sm', onclick: async () => { if (await confirmBox('تسجيل الخروج', 'هل تريد تسجيل الخروج؟', 'خروج')) app.logout(); } }, 'خروج'));
}
