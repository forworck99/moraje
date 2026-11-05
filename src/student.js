// Student screens (English interface)
import { h, fmtDur, fmtTime, dayName, addDays, shortDate, confirmBox } from './ui.js';
import { todayStr } from './store.js';
import { rangePages, rangeLabelEn } from './data.js';
import { TYPES, TYPE_ORDER, targetOf, unitEn } from './types.js';
import { breakdown } from './stats.js';
import { openReader, savedPos, clearPos } from './reader.js';

export function activeAssignments(list, day = todayStr()) {
  return list
    .filter(a => a.active !== false && (!a.start || a.start <= day) && (!a.end || a.end >= day))
    .sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type) || (a.from > b.from ? 1 : -1));
}

export function studentHome(app) {
  if (app.reader) { app.reader.updCounter?.(); app.reader.repaint?.(); return; }
  const today = todayStr();
  const days = breakdown(app.weekEvents || [], app.assignments, app.resetAll);
  const act = activeAssignments(app.assignments, today);
  const week = [...Array(7)].map((_, i) => addDays(today, i - 6));
  const open = (a, resume) => openReader({ app, role: 'student', assignment: a, resume, onBack: () => app.render() });

  const card = a => {
    const T = TYPES[a.type] || TYPES.review;
    const n = app.counts[a.id] || 0, t = targetOf(a);
    const sec = app.timeToday[a.id] || 0;
    const pages = rangePages(a.from, a.to);
    const done = n >= t;
    let pos = savedPos(a.id);
    // a teacher reset (this assignment or everything) also clears where she stopped
    if (pos && (pos.at || 0) < Math.max(a.resetAt || 0, app.resetAll || 0)) { clearPos(a.id); pos = null; }
    const canResume = pos && pos.page && pages.includes(pos.page) && !done;
    return h('article', { class: 'acard' + (done ? ' done' : ''), style: { '--tc': T.color } },
      h('div', { class: 'acard-top' },
        h('span', { class: 'tag' }, T.en),
        done ? h('span', { class: 'ok' }, 'Done today ✓') : null),
      h('h3', {}, rangeLabelEn(a.from, a.to)),
      h('div', { class: 'muted' }, `${pages.length > 1 ? 'Pages' : 'Page'} ${pages.length > 4 ? pages[0] + '–' + pages[pages.length - 1] : pages.join(', ')}`),
      a.note ? h('p', { class: 'note' }, '📌 ', a.note) : null,
      h('div', { class: 'prog-row' },
        h('div', { class: 'big' }, h('b', {}, n), ` / ${t} ${unitEn(a, t)}`),
        h('div', { class: 'bar' }, h('i', { style: { width: Math.min(100, n / t * 100) + '%' } })),
        h('small', { class: 'muted' }, fmtDur(sec, true))),
      h('div', { class: 'week' }, week.map(d => {
        const c = days[d]?.counts[a.id] || 0;
        const st = d > today ? 'fut' : c >= t ? 'g' : c > 0 ? 'y' : (d < today && (!a.start || d >= a.start)) ? 'r' : 'e';
        return h('div', { class: 'wd ' + st, title: `${dayName(d, true)} ${shortDate(d)}: ${c}/${t}` }, h('i'), h('span', {}, dayName(d, true)));
      })),
      canResume
        ? h('div', { class: 'resume' },
          h('div', { class: 'resume-info' }, `⏸ Stopped at page ${pos.page}${pos.vk ? `, ayah ${pos.vk.split(':')[1]}` : ''} · ${pos.day === today ? fmtTime(pos.at, true) : shortDate(pos.day)}`),
          h('button', { class: 'btn primary block', onclick: () => open(a, pos) }, `▶ Continue from page ${pos.page}`),
          h('button', { class: 'link', onclick: () => { clearPos(a.id); open(a); } }, 'Start from the beginning'))
        : h('button', { class: 'btn primary block', onclick: () => open(a) }, done ? (a.type === 'recite' ? 'Recite again' : 'Read again') : (a.type === 'recite' ? '🎙 Start recitation' : 'Start reading')));
  };

  const totalToday = Object.values(app.timeToday).reduce((x, y) => x + y, 0);
  app.mount(h('div', { class: 'home' },
    topbar(app),
    h('section', { class: 'hello' },
      h('h2', {}, `Assalamu alaikum, ${app.user.name || ''}`),
      h('p', { class: 'welcome' }, '👋 Welcome! Your teacher sees your progress live.'),
      h('p', { class: 'muted' }, `${dayName(today, true)} ${shortDate(today)} · Reading time today: ${fmtDur(totalToday, true)}`)),
    act.length ? h('section', { class: 'cards' }, act.map(card))
      : h('div', { class: 'empty' }, h('div', { class: 'em' }, '📖'), h('p', {}, 'No assignments yet. They will appear here when your teacher adds them.')),
    h('button', { class: 'btn ghost block', onclick: () => openReader({ app, role: 'student', onBack: () => app.render() }) }, '📖 Browse the Mushaf & listen')
  ));
}

export function topbar(app, extra) {
  const en = app.role === 'student';
  return h('header', { class: 'topbar' },
    h('div', { class: 'brand' }, h('span', { class: 'logo' }, 'م'), h('b', {}, en ? 'Moraje' : 'مُراجِع')),
    extra || null,
    h('button', {
      class: 'btn ghost sm', onclick: async () => {
        if (await confirmBox(en ? 'Sign out' : 'تسجيل الخروج', en ? 'Do you want to sign out?' : 'هل تريد تسجيل الخروج؟', en ? 'Sign out' : 'خروج', en ? 'Cancel' : 'إلغاء')) app.logout();
      }
    }, en ? 'Sign out' : 'خروج'));
}
