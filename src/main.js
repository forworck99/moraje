// مُراجِع — app entry
import { store, isTeacherEmail, todayStr } from './store.js';
import { loadMushaf } from './data.js';
import { Player } from './audio.js';
import { Tracker } from './tracker.js';
import { h, toast } from './ui.js';
import { addDays } from './ui.js';
import { breakdown } from './stats.js';
import { studentHome } from './student.js';
import { teacherHome } from './teacher.js';

const root = document.getElementById('app');

const app = {
  store, player: new Player(), tracker: null, user: null, role: null,
  assignments: [], marks: new Map(), counts: {}, timeToday: {}, weekEvents: [],
  students: [], sel: null, tests: [], reader: null, permError: false, subs: [],
  mount(el) { root.replaceChildren(el); },
  render() { if (this.role === 'teacher') teacherHome(this); else if (this.role === 'student') studentHome(this); },
  async logout() { this.reader?.close?.(); this.unsub(); this.tracker?.flush(); await store.signOut(); location.reload(); },
  unsub() { this.subs.forEach(f => { try { f(); } catch { } }); this.subs = []; }
};
window.__app = app;

const errMsg = e => {
  const c = e?.code || '';
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'Wrong email or password';
  if (c.includes('email-already-in-use')) return 'This email already has an account. Choose "Sign in".';
  if (c.includes('weak-password')) return 'Password too short: use at least 6 characters';
  if (c.includes('invalid-email')) return 'Invalid email address';
  if (c.includes('network')) return 'No internet connection';
  if (c.includes('too-many-requests')) return 'Too many tries. Wait a little and try again.';
  return 'Error: ' + (e?.message || c);
};

const setLang = en => { document.documentElement.lang = en ? 'en' : 'ar'; document.documentElement.dir = en ? 'ltr' : 'rtl'; };

function authScreen(mode = 'login') {
  setLang(true);
  const name = h('input', { class: 'inp', placeholder: 'Your name', autocomplete: 'name' });
  const email = h('input', { class: 'inp', type: 'email', placeholder: 'Email', autocomplete: 'email', dir: 'ltr' });
  const pw = h('input', { class: 'inp', type: 'password', placeholder: 'Password (at least 6 characters)', autocomplete: mode === 'login' ? 'current-password' : 'new-password', dir: 'ltr' });
  const consent = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'err', role: 'alert' });
  const label = mode === 'login' ? 'Sign in' : 'Create account';
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, label);
  const form = h('form', {
    class: 'authform', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (mode === 'signup') {
        if (!name.value.trim()) return err.textContent = 'Please write your name';
        if (!consent.checked && !isTeacherEmail(email.value)) return err.textContent = 'Please accept to continue';
      }
      btn.disabled = true; btn.textContent = '…';
      try {
        if (mode === 'login') await store.signIn(email.value, pw.value);
        else await store.signUp(name.value.trim(), email.value, pw.value);
      } catch (x) { err.textContent = errMsg(x); btn.disabled = false; btn.textContent = label; }
    }
  },
    mode === 'signup' ? name : null, email, pw,
    mode === 'signup' ? h('label', { class: 'check consent' }, consent, ' I understand that my reading time and counts are shown live to my teacher.') : null,
    err, btn,
    mode === 'login' ? h('button', { type: 'button', class: 'link', onclick: async () => { if (!email.value) return err.textContent = 'Write your email first'; try { await store.resetPassword(email.value); toast('A reset link was sent to your email'); } catch (x) { err.textContent = errMsg(x); } } }, 'Forgot password?') : null);
  app.mount(h('div', { class: 'auth' },
    h('div', { class: 'auth-hero' }, h('div', { class: 'logo big' }, 'م'), h('h1', {}, 'Moraje'), h('p', {}, 'Quran review, day by day')),
    h('div', { class: 'seg' },
      h('button', { class: mode === 'login' ? 'on' : '', onclick: () => authScreen('login') }, 'Sign in'),
      h('button', { class: mode === 'signup' ? 'on' : '', onclick: () => authScreen('signup') }, 'New account')),
    form));
}

function verifyScreen(u) {
  setLang(false);
  app.mount(h('div', { class: 'auth' },
    h('div', { class: 'auth-hero' }, h('div', { class: 'logo big' }, 'م'), h('h1', {}, 'تأكيد بريد المعلم')),
    h('div', { class: 'card' },
      h('p', {}, `أرسلنا رابط تأكيد إلى ${u.email}. افتح بريدك واضغط الرابط، ثم ارجع واضغط «تمّ التأكيد».`),
      h('small', { class: 'muted' }, 'إن لم تجده، افحص مجلد Spam.'),
      h('button', { class: 'btn primary block', onclick: async () => { const nu = await store.refreshUser(); if (nu?.emailVerified) start(nu); else toast('لم يُؤكَّد بعد'); } }, 'تمّ التأكيد'),
      h('button', { class: 'btn ghost block', onclick: async () => { await store.resendVerify(); toast('أُعيد الإرسال'); } }, 'إعادة إرسال الرابط'),
      h('button', { class: 'link', onclick: () => app.logout() }, 'تسجيل الخروج'))));
}

const onErr = e => {
  console.warn(e);
  if ((e?.code || '').includes('permission-denied')) { app.permError = true; app.render(); }
};

function start(u) {
  app.unsub();
  app.user = u;
  if (isTeacherEmail(u.email)) {
    if (!u.emailVerified) return verifyScreen(u);
    app.role = 'teacher';
    setLang(false);
    // make sure the ID token carries email_verified=true before querying
    store.refreshUser().catch(() => { }).finally(() => app.role === 'teacher' && watchTeacher());
    app.render();
    return;
  } else {
    app.role = 'student';
    setLang(true);
    store.ensureProfile(u).catch(onErr);
    app.tracker = new Tracker(store, u.uid);
    watchStudent(u.uid);
    app.render();
  }
}

function watchTeacher() {
  {
    app.subs.push(store.watchStudents(list => {
      app.permError = false;
      app.students = list.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ar'));
      app.recompute?.();
      if (!app.sel || !list.some(s => s.id === app.sel)) {
        let saved = null; try { saved = localStorage.getItem('sel'); } catch { }
        app.selectStudent(list.some(s => s.id === saved) ? saved : list[0]?.id || null, true);
      }
      app.render();
    }, onErr));
  }
}

let studentSubs = [];
function watchStudent(uid) {
  studentSubs.forEach(f => f()); studentSubs = [];
  app.assignments = []; app.marks = new Map(); app.weekEvents = []; app.tests = []; app.counts = {}; app.timeToday = {}; app.doneToday = {};
  if (!uid) return;
  const today = todayStr();
  app.day = today;
  const rer = () => app.render();
  const recompute = () => {
    const ra = app.role === 'teacher' ? (app.students.find(s => s.id === uid)?.resetAt || 0) : (app.resetAll || 0);
    const d = breakdown(app.weekEvents, app.assignments, ra)[todayStr()] || { counts: {}, time: {}, done: {} };
    app.counts = d.counts; app.timeToday = d.time; app.doneToday = d.done || {};
  };
  studentSubs.push(store.watchAssignments(uid, l => { app.assignments = l; recompute(); rer(); }, onErr));
  studentSubs.push(store.watchHighlights(uid, l => { app.marks = new Map(l.map(x => [`${x.vk}:${x.pos}`, x])); rer(); }, onErr));
  const from = addDays(today, app.role === 'teacher' ? -60 : -6);
  studentSubs.push(store.watchEventsSince(uid, from, evs => {
    app.weekEvents = evs;
    recompute();
    rer();
  }, onErr));
  if (app.role === 'teacher') studentSubs.push(store.watchTests(uid, l => { app.tests = l; rer(); }, onErr));
  else studentSubs.push(store.watchProfile(uid, p => { app.resetAll = p?.resetAt || 0; recompute(); rer(); }, onErr));
  app.recompute = recompute;
}
app.selectStudent = (id, silent) => {
  app.sel = id;
  try { if (id) localStorage.setItem('sel', id); } catch { }
  watchStudent(id);
  if (!silent) app.render();
};

// day rollover: resubscribe so "today" moves forward
setInterval(() => { if (app.day && app.day !== todayStr() && !app.reader) { watchStudent(app.role === 'teacher' ? app.sel : app.user?.uid); } }, 60000);

async function boot() {
  app.mount(h('div', { class: 'splash' }, h('div', { class: 'logo big' }, 'م'), h('p', {}, 'Loading…')));
  try { await loadMushaf(); } catch (e) { app.mount(h('div', { class: 'splash' }, h('p', {}, 'Could not load the Mushaf. Check your internet and open again.'))); return; }
  store.onAuth(u => { if (u) start(u); else { app.unsub(); app.role = null; authScreen('login'); } });
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
