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
  if (c.includes('invalid-credential') || c.includes('wrong-password') || c.includes('user-not-found')) return 'البريد أو كلمة المرور غير صحيحة';
  if (c.includes('email-already-in-use')) return 'هذا البريد مسجّل مسبقًا، اختاري «دخول»';
  if (c.includes('weak-password')) return 'كلمة المرور قصيرة، استخدمي 6 أحرف على الأقل';
  if (c.includes('invalid-email')) return 'البريد الإلكتروني غير صحيح';
  if (c.includes('network')) return 'لا يوجد اتصال بالإنترنت';
  if (c.includes('too-many-requests')) return 'محاولات كثيرة، انتظري قليلًا ثم أعيدي المحاولة';
  return 'حدث خطأ: ' + (e?.message || c);
};

function authScreen(mode = 'login') {
  const name = h('input', { class: 'inp', placeholder: 'الاسم', autocomplete: 'name' });
  const email = h('input', { class: 'inp', type: 'email', placeholder: 'البريد الإلكتروني', autocomplete: 'email', dir: 'ltr' });
  const pw = h('input', { class: 'inp', type: 'password', placeholder: 'كلمة المرور (6 أحرف على الأقل)', autocomplete: mode === 'login' ? 'current-password' : 'new-password', dir: 'ltr' });
  const consent = h('input', { type: 'checkbox' });
  const err = h('div', { class: 'err', role: 'alert' });
  const btn = h('button', { class: 'btn primary block', type: 'submit' }, mode === 'login' ? 'دخول' : 'إنشاء الحساب');
  const form = h('form', {
    class: 'authform', onsubmit: async e => {
      e.preventDefault(); err.textContent = '';
      if (mode === 'signup') {
        if (!name.value.trim()) return err.textContent = 'اكتبي الاسم';
        if (!consent.checked && !isTeacherEmail(email.value)) return err.textContent = 'يلزم الموافقة على التتبّع لإكمال التسجيل';
      }
      btn.disabled = true; btn.textContent = '…';
      try {
        if (mode === 'login') await store.signIn(email.value, pw.value);
        else await store.signUp(name.value.trim(), email.value, pw.value);
      } catch (x) { err.textContent = errMsg(x); btn.disabled = false; btn.textContent = mode === 'login' ? 'دخول' : 'إنشاء الحساب'; }
    }
  },
    mode === 'signup' ? name : null, email, pw,
    mode === 'signup' ? h('label', { class: 'check consent' }, consent, ' أعلم أن التطبيق يسجّل أوقات القراءة والعدّات ليطّلع عليها المعلّم، وأوافق على ذلك.') : null,
    err, btn,
    mode === 'login' ? h('button', { type: 'button', class: 'link', onclick: async () => { if (!email.value) return err.textContent = 'اكتبي بريدك أولًا'; try { await store.resetPassword(email.value); toast('أُرسل رابط إعادة التعيين إلى بريدك'); } catch (x) { err.textContent = errMsg(x); } } }, 'نسيت كلمة المرور؟') : null);
  app.mount(h('div', { class: 'auth' },
    h('div', { class: 'auth-hero' }, h('div', { class: 'logo big' }, 'م'), h('h1', {}, 'مُراجِع'), h('p', {}, 'مراجعة الحفظ ومتابعته يومًا بيوم')),
    h('div', { class: 'seg' },
      h('button', { class: mode === 'login' ? 'on' : '', onclick: () => authScreen('login') }, 'دخول'),
      h('button', { class: mode === 'signup' ? 'on' : '', onclick: () => authScreen('signup') }, 'حساب جديد')),
    form));
}

function verifyScreen(u) {
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
    // make sure the ID token carries email_verified=true before querying
    store.refreshUser().catch(() => { }).finally(() => app.role === 'teacher' && watchTeacher());
    app.render();
    return;
  } else {
    app.role = 'student';
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
  app.assignments = []; app.marks = new Map(); app.weekEvents = []; app.tests = []; app.counts = {}; app.timeToday = {};
  if (!uid) return;
  const today = todayStr();
  app.day = today;
  const rer = () => app.render();
  studentSubs.push(store.watchAssignments(uid, l => { app.assignments = l; rer(); }, onErr));
  studentSubs.push(store.watchHighlights(uid, l => { app.marks = new Map(l.map(x => [`${x.vk}:${x.pos}`, x])); rer(); }, onErr));
  const from = addDays(today, app.role === 'teacher' ? -60 : -6);
  studentSubs.push(store.watchEventsSince(uid, from, evs => {
    app.weekEvents = evs;
    const d = breakdown(evs)[todayStr()] || { counts: {}, time: {} };
    app.counts = d.counts; app.timeToday = d.time;
    rer();
  }, onErr));
  if (app.role === 'teacher') studentSubs.push(store.watchTests(uid, l => { app.tests = l; rer(); }, onErr));
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
  app.mount(h('div', { class: 'splash' }, h('div', { class: 'logo big' }, 'م'), h('p', {}, 'جارٍ التحميل…')));
  try { await loadMushaf(); } catch (e) { app.mount(h('div', { class: 'splash' }, h('p', {}, 'تعذّر تحميل بيانات المصحف. تحقّقي من الإنترنت ثم أعيدي الفتح.'))); return; }
  store.onAuth(u => { if (u) start(u); else { app.unsub(); app.role = null; authScreen('login'); } });
}
boot();

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
