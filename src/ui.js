// Small UI helpers
export function h(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.append(k.nodeType ? k : document.createTextNode(String(k)));
  }
  return e;
}

export function toast(msg, ms = 2600) {
  const t = h('div', { class: 'toast', role: 'status' }, msg);
  document.body.append(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, ms);
}

export function modal({ title, body, actions = [], dismissable = true }) {
  return new Promise(resolve => {
    const close = v => { back.classList.remove('show'); setTimeout(() => back.remove(), 200); resolve(v); };
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      title && h('h3', {}, title),
      body && (typeof body === 'string' ? h('p', {}, body) : body),
      h('div', { class: 'modal-actions' }, actions.map(a =>
        h('button', { class: 'btn ' + (a.kind || ''), onclick: () => close(a.value) }, a.label)))
    );
    const back = h('div', { class: 'modal-back', onclick: e => { if (dismissable && e.target === back) close(undefined); } }, box);
    document.body.append(back);
    requestAnimationFrame(() => back.classList.add('show'));
  });
}

export const confirmBox = (title, text, yes = 'نعم', no = 'إلغاء', kind = 'primary') =>
  modal({ title, body: text, actions: [{ label: no, value: false, kind: 'ghost' }, { label: yes, value: true, kind }] });

export function fmtDur(sec) {
  sec = Math.round(sec || 0);
  if (sec < 60) return `${sec} ث`;
  const m = Math.floor(sec / 60), s = sec % 60;
  if (m < 60) return s ? `${m} د ${s} ث` : `${m} د`;
  const hh = Math.floor(m / 60), mm = m % 60;
  return mm ? `${hh} س ${mm} د` : `${hh} س`;
}

export function fmtTime(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit', numberingSystem: 'latn' });
}

const DAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
export function dayName(dayStr) { const [y, m, d] = dayStr.split('-').map(Number); return DAYS[new Date(y, m - 1, d).getDay()]; }
export function addDays(dayStr, n) {
  const [y, m, d] = dayStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + n);
  const z = x => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${z(dt.getMonth() + 1)}-${z(dt.getDate())}`;
}
export const shortDate = dayStr => { const [, m, d] = dayStr.split('-'); return `${+d}/${+m}`; };
