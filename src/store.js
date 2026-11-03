// Data layer: Firebase (real) or localStorage (mock, for testing with ?mock=student|teacher)
import { initializeApp } from 'firebase/app';
import {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  updateProfile, sendEmailVerification, signOut as fbSignOut, sendPasswordResetEmail
} from 'firebase/auth';
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, collection, doc,
  addDoc, setDoc, getDoc, getDocs, deleteDoc, onSnapshot, query, where, serverTimestamp
} from 'firebase/firestore';
import { firebaseConfig } from '../firebase-config.js';

export const TEACHER_EMAIL = 'forworck99@gmail.com';
export const isTeacherEmail = e => (e || '').toLowerCase() === TEACHER_EMAIL;

export function todayStr(d = new Date()) {
  const z = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
}

const tsMillis = t => (t && typeof t.toMillis === 'function') ? t.toMillis() : (typeof t === 'number' ? t : null);

/* ---------------- Firebase implementation ---------------- */
function firebaseStore() {
  const app = initializeApp(firebaseConfig);
  const auth = getAuth(app);
  let db;
  try {
    db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  } catch (e) {
    db = initializeFirestore(app, {});
  }
  const norm = d => ({ id: d.id, ...d.data() });
  const evNorm = d => {
    const x = d.data();
    return { id: d.id, ...x, ts: tsMillis(x.ts) ?? x.clientTs, pending: d.metadata?.hasPendingWrites };
  };

  return {
    kind: 'firebase',
    onAuth(cb) {
      return onAuthStateChanged(auth, u => cb(u ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified, name: u.displayName } : null));
    },
    async signIn(email, pw) { await signInWithEmailAndPassword(auth, email.trim(), pw); },
    async signUp(name, email, pw) {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pw);
      await updateProfile(cred.user, { displayName: name });
      if (isTeacherEmail(email)) {
        await sendEmailVerification(cred.user);
      } else {
        await setDoc(doc(db, 'users', cred.user.uid), {
          name, email: email.trim().toLowerCase(), role: 'student',
          createdAt: serverTimestamp(), consentAt: serverTimestamp()
        });
      }
    },
    async resendVerify() { if (auth.currentUser) await sendEmailVerification(auth.currentUser); },
    async refreshUser() {
      if (!auth.currentUser) return null;
      await auth.currentUser.reload();
      await auth.currentUser.getIdToken(true);
      const u = auth.currentUser;
      return { uid: u.uid, email: u.email, emailVerified: u.emailVerified, name: u.displayName };
    },
    async resetPassword(email) { await sendPasswordResetEmail(auth, email.trim()); },
    async signOut() { await fbSignOut(auth); },

    async getProfile(uid) { const s = await getDoc(doc(db, 'users', uid)); return s.exists() ? { id: s.id, ...s.data() } : null; },
    async ensureProfile(u) {
      const p = await this.getProfile(u.uid).catch(() => null);
      if (!p) {
        await setDoc(doc(db, 'users', u.uid), {
          name: u.name || u.email.split('@')[0], email: (u.email || '').toLowerCase(), role: 'student',
          createdAt: serverTimestamp(), consentAt: serverTimestamp()
        });
      }
    },
    watchStudents(cb, err) {
      return onSnapshot(query(collection(db, 'users'), where('role', '==', 'student')),
        s => cb(s.docs.map(norm)), err);
    },
    watchAssignments(studentUid, cb, err) {
      return onSnapshot(query(collection(db, 'assignments'), where('studentUid', '==', studentUid)),
        s => cb(s.docs.map(norm)), err);
    },
    async saveAssignment(a) {
      const { id, ...data } = a;
      if (id) await setDoc(doc(db, 'assignments', id), data, { merge: true });
      else await addDoc(collection(db, 'assignments'), { ...data, createdAt: serverTimestamp() });
    },
    async deleteAssignment(id) { await deleteDoc(doc(db, 'assignments', id)); },

    watchHighlights(studentUid, cb, err) {
      return onSnapshot(query(collection(db, 'highlights'), where('studentUid', '==', studentUid)),
        s => cb(s.docs.map(norm)), err);
    },
    async saveHighlight(h) { const { id, ...data } = h; await setDoc(doc(db, 'highlights', id), { ...data, updatedAt: serverTimestamp() }); },
    async deleteHighlight(id) { await deleteDoc(doc(db, 'highlights', id)); },

    watchTests(studentUid, cb, err) {
      return onSnapshot(query(collection(db, 'tests'), where('studentUid', '==', studentUid)),
        s => cb(s.docs.map(norm)), err);
    },
    async saveTest(t) { const { id, ...data } = t; if (id) await setDoc(doc(db, 'tests', id), data); else await addDoc(collection(db, 'tests'), { ...data, createdAt: serverTimestamp() }); },
    async deleteTest(id) { await deleteDoc(doc(db, 'tests', id)); },

    logEvent(uid, type, data = {}) {
      const now = new Date();
      return addDoc(collection(db, 'users', uid, 'events'), {
        type, ...data, day: todayStr(now), clientTs: now.getTime(), ts: serverTimestamp()
      }).catch(e => console.warn('log failed', e));
    },
    watchDayEvents(uid, day, cb, err) {
      return onSnapshot(query(collection(db, 'users', uid, 'events'), where('day', '==', day)),
        { includeMetadataChanges: false }, s => cb(s.docs.map(evNorm)), err);
    },
    async getEventsSince(uid, fromDay) {
      const s = await getDocs(query(collection(db, 'users', uid, 'events'), where('day', '>=', fromDay)));
      return s.docs.map(evNorm);
    },
    watchEventsSince(uid, fromDay, cb, err) {
      return onSnapshot(query(collection(db, 'users', uid, 'events'), where('day', '>=', fromDay)),
        s => cb(s.docs.map(evNorm)), err);
    }
  };
}

/* ---------------- Mock implementation (testing only) ---------------- */
function mockStore(role) {
  const KEY = 'moraje-mock';
  const load = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } };
  const st = Object.assign({ users: {}, assignments: {}, highlights: {}, tests: {}, events: {} }, load());
  const subs = new Set();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch { } subs.forEach(f => f()); };
  const sub = f => { subs.add(f); f(); return () => subs.delete(f); };
  const uid = role === 'teacher' ? 'T1' : 'S1';
  if (!st.users.S1) st.users.S1 = { name: 'طالبة تجريبية', email: 'student@test', role: 'student', createdAt: Date.now() };
  const user = role === 'teacher'
    ? { uid, email: TEACHER_EMAIL, emailVerified: true, name: 'المعلم' }
    : { uid, email: 'student@test', emailVerified: true, name: 'طالبة تجريبية' };
  let n = 0; const id = () => Date.now().toString(36) + (n++);
  const list = (c, f) => Object.entries(st[c]).map(([id, v]) => ({ id, ...v })).filter(f);
  return {
    kind: 'mock',
    onAuth(cb) { setTimeout(() => cb(user), 0); return () => { }; },
    async signIn() { }, async signUp() { }, async resendVerify() { }, async refreshUser() { return user; },
    async resetPassword() { }, async signOut() { localStorage.removeItem(KEY); location.search = ''; },
    async getProfile(u) { return st.users[u] ? { id: u, ...st.users[u] } : null; },
    async ensureProfile() { },
    watchStudents(cb) { return sub(() => cb(list('users', x => x.role === 'student'))); },
    watchAssignments(s, cb) { return sub(() => cb(list('assignments', x => x.studentUid === s))); },
    async saveAssignment(a) { const { id: i, ...d } = a; st.assignments[i || id()] = { ...(st.assignments[i] || {}), ...d }; save(); },
    async deleteAssignment(i) { delete st.assignments[i]; save(); },
    watchHighlights(s, cb) { return sub(() => cb(list('highlights', x => x.studentUid === s))); },
    async saveHighlight(h) { const { id: i, ...d } = h; st.highlights[i] = d; save(); },
    async deleteHighlight(i) { delete st.highlights[i]; save(); },
    watchTests(s, cb) { return sub(() => cb(list('tests', x => x.studentUid === s))); },
    async saveTest(t) { const { id: i, ...d } = t; st.tests[i || id()] = d; save(); },
    async deleteTest(i) { delete st.tests[i]; save(); },
    logEvent(u, type, data = {}) {
      const now = Date.now();
      (st.events[u] ||= []).push({ id: id(), type, ...data, day: todayStr(new Date(now)), clientTs: now, ts: now });
      save(); return Promise.resolve();
    },
    watchDayEvents(u, day, cb) { return sub(() => cb((st.events[u] || []).filter(e => e.day === day))); },
    async getEventsSince(u, from) { return (st.events[u] || []).filter(e => e.day >= from); },
    watchEventsSince(u, from, cb) { return sub(() => cb((st.events[u] || []).filter(e => e.day >= from))); }
  };
}

const mockRole = new URLSearchParams(location.search).get('mock');
export const store = mockRole ? mockStore(mockRole) : firebaseStore();
