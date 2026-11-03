// Active-time tracking per page (pauses when idle 60s or app hidden, unless audio is playing)
export const IDLE_MS = 60000;

export class Tracker {
  constructor(store, uid) {
    this.store = store; this.uid = uid;
    this.pages = []; this.aid = null;
    this.acc = new Map();          // `${page}|${aid}` -> {sec, listen}
    this.readSec = {};             // aid -> active seconds since last count
    this.lastAct = Date.now();
    this.audioOn = false;
    this.sessionSec = 0;
    const act = () => { this.lastAct = Date.now(); };
    ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll'].forEach(ev => addEventListener(ev, act, { passive: true, capture: true }));
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.flush();
      else act();
    });
    addEventListener('pagehide', () => { this.flush(); this.store.logEvent(this.uid, 'session_end', { sec: Math.round(this.sessionSec) }); });
    this.timer = setInterval(() => this.tick(), 1000);
    this.flusher = setInterval(() => this.flush(), 60000);
    this.store.logEvent(uid, 'session_start', { ua: navigator.userAgent.slice(0, 160), w: innerWidth, h: innerHeight });
  }
  isActive() {
    const visible = document.visibilityState === 'visible';
    return this.audioOn || (visible && Date.now() - this.lastAct < IDLE_MS);
  }
  tick() {
    if (!this.isActive()) return;
    this.sessionSec++;
    if (!this.pages.length) return;
    const share = 1 / this.pages.length;
    for (const p of this.pages) {
      const k = `${p}|${this.aid || ''}`;
      const a = this.acc.get(k) || { sec: 0, listen: 0 };
      a.sec += share;
      if (this.audioOn) a.listen += share;
      this.acc.set(k, a);
    }
    if (this.aid) this.readSec[this.aid] = (this.readSec[this.aid] || 0) + 1;
    this.onTick?.();
  }
  setContext(pages, aid) {
    const same = aid === this.aid && pages.join() === this.pages.join();
    if (same) return;
    this.flush();
    this.pages = pages.slice();
    this.aid = aid || null;
    this.lastAct = Date.now();
  }
  setAudio(on) { this.audioOn = on; if (on) this.lastAct = Date.now(); }
  takeReadSec(aid) { const s = Math.round(this.readSec[aid] || 0); this.readSec[aid] = 0; return s; }
  peekReadSec(aid) { return Math.round(this.readSec[aid] || 0); }
  flush() {
    for (const [k, a] of this.acc) {
      const sec = Math.floor(a.sec), listen = Math.floor(a.listen);
      if (sec < 1) continue;
      const [page, aid] = k.split('|');
      this.store.logEvent(this.uid, 'page_time', { page: +page, sec, listen, assignmentId: aid || null });
      a.sec -= sec; a.listen -= listen;
    }
  }
}
