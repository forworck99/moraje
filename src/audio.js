// Recitation player: Alafasy / Husary, per-ayah files, ayah & range repetition
import { surahName } from './data.js';

const f6 = vk => { const [s, a] = vk.split(':'); return s.padStart(3, '0') + a.padStart(3, '0'); };
export const RECITERS = {
  alafasy: { name: 'العفاسي', urls: [vk => `https://everyayah.com/data/Alafasy_128kbps/${f6(vk)}.mp3`, vk => `https://verses.quran.com/Alafasy/mp3/${f6(vk)}.mp3`] },
  husary: { name: 'الحصري', urls: [vk => `https://everyayah.com/data/Husary_128kbps/${f6(vk)}.mp3`, vk => `https://verses.quran.com/Husary/mp3/${f6(vk)}.mp3`] }
};

export class Player {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.pre = new Audio();
    this.pre.preload = 'auto';
    this.queue = [];
    this.qi = 0;
    this.ayahRep = 1; this.ayahDone = 0;
    this.rangeRep = 1; this.rangeDone = 0;
    this.reciter = (() => { try { return localStorage.getItem('reciter') || 'alafasy'; } catch { return 'alafasy'; } })();
    this.playing = false;
    this.bism = false;
    this.urlTry = 0;
    this.listeners = new Set();
    this.wake = null;
    this.audio.addEventListener('ended', () => this._ended());
    this.audio.addEventListener('error', () => this._error());
    this.audio.addEventListener('playing', () => { this.loading = false; this._emit(); });
    this.audio.addEventListener('waiting', () => { this.loading = true; this._emit(); });
    if ('mediaSession' in navigator) {
      const ms = navigator.mediaSession;
      ms.setActionHandler('play', () => this.play());
      ms.setActionHandler('pause', () => this.pause());
      ms.setActionHandler('nexttrack', () => this.jump(1));
      ms.setActionHandler('previoustrack', () => this.jump(-1));
    }
  }
  on(f) { this.listeners.add(f); return () => this.listeners.delete(f); }
  _emit() { this.listeners.forEach(f => f(this)); }
  get current() { return this.queue[this.qi] || null; }

  setQueue(vks, startVk) {
    const wasPlaying = this.playing;
    this.queue = vks.slice();
    this.qi = Math.max(0, startVk ? this.queue.indexOf(startVk) : 0);
    this.ayahDone = 0; this.rangeDone = 0;
    if (wasPlaying) this._load(true); else this._emit();
  }
  setReciter(r) {
    this.reciter = r;
    try { localStorage.setItem('reciter', r); } catch { }
    if (this.playing) this._load(true); else this._emit();
  }
  setRepeat(ayah, range) {
    if (ayah != null) this.ayahRep = Math.max(1, ayah | 0);
    if (range != null) this.rangeRep = Math.max(0, range | 0);
    this._emit();
  }
  play() {
    if (!this.queue.length) return;
    this.playing = true;
    this._wakeOn();
    if (!this.audio.src) this._load(true);
    else this.audio.play().catch(() => { });
    this._emit();
  }
  pause() { this.playing = false; this.audio.pause(); this._wakeOff(); this._emit(); }
  stop() { this.pause(); this.audio.removeAttribute('src'); this.audio.load(); }
  toggle() { this.playing ? this.pause() : this.play(); }
  jump(d) {
    if (!this.queue.length) return;
    this.qi = Math.min(this.queue.length - 1, Math.max(0, this.qi + d));
    this.ayahDone = 0; this.bism = false;
    if (this.playing) this._load(true); else { this.audio.removeAttribute('src'); this._emit(); }
  }
  seek(vk) {
    const i = this.queue.indexOf(vk);
    if (i < 0) return false;
    this.qi = i; this.ayahDone = 0; this.bism = false;
    if (this.playing) this._load(true); else { this.audio.removeAttribute('src'); this._emit(); }
    return true;
  }

  _needsBism(vk) { const [s, a] = vk.split(':'); return a === '1' && s !== '1' && s !== '9'; }
  _url(vk) { return RECITERS[this.reciter].urls[Math.min(this.urlTry, 1)](vk); }
  _load(autoplay) {
    const vk = this.current;
    if (!vk) return;
    if (this.ayahDone === 0 && !this.bism && this._needsBism(vk) && this._bismPending !== vk) {
      this.bism = true; this._bismPending = vk;
    }
    this.urlTry = 0;
    this.audio.src = this.bism ? this._url('1:1') : this._url(vk);
    if (autoplay) this.audio.play().catch(() => { });
    const next = this.queue[this.qi + 1];
    if (next) { this.pre.src = this._url(next); }
    if ('mediaSession' in navigator && window.MediaMetadata) {
      const [s, a] = vk.split(':');
      navigator.mediaSession.metadata = new MediaMetadata({ title: `${surahName(+s)} – آية ${a}`, artist: RECITERS[this.reciter].name, album: 'مُراجِع' });
    }
    this._emit();
  }
  _ended() {
    if (this.bism) { this.bism = false; this._load(true); return; }
    this.ayahDone++;
    if (this.ayahDone < this.ayahRep) { this.audio.currentTime = 0; this.audio.play().catch(() => { }); this._emit(); return; }
    this.ayahDone = 0;
    if (this.qi < this.queue.length - 1) { this.qi++; this._load(true); return; }
    this.rangeDone++;
    this._bismPending = null;
    if (this.rangeRep === 0 || this.rangeDone < this.rangeRep) { this.qi = 0; this._load(true); return; }
    this.rangeDone = 0; this.qi = 0;
    this.pause();
    this.audio.removeAttribute('src');
    this.finished = Date.now();
    this._emit();
  }
  _error() {
    if (!this.audio.getAttribute('src')) return;
    if (this.urlTry < 1) {
      this.urlTry++;
      this.audio.src = this.bism ? this._url('1:1') : this._url(this.current);
      if (this.playing) this.audio.play().catch(() => { });
      return;
    }
    this.error = Date.now();
    this.pause();
    this._emit();
  }
  async _wakeOn() { try { if ('wakeLock' in navigator && !this.wake) { this.wake = await navigator.wakeLock.request('screen'); this.wake.addEventListener('release', () => { this.wake = null; }); } } catch { } }
  _wakeOff() { try { this.wake?.release(); } catch { } this.wake = null; }
}
