import { todayStr } from './store.js';
// Aggregations over the append-only event log
export function sortEvents(evs) {
  return evs.slice().sort((a, b) => (a.clientTs || 0) - (b.clientTs || 0));
}

// Count totals per assignment for one day's events
function resetMap(assignments) { const m = {}; for (const a of assignments || []) if (a.resetAt) m[a.id] = a.resetAt; return m; }
const before = (e, R) => e.assignmentId && R[e.assignmentId] && (e.ts || e.clientTs || 0) < R[e.assignmentId];

export function countsFor(evs) {
  const out = {};
  for (const e of sortEvents(evs)) {
    if (!e.assignmentId) continue;
    if (e.type === 'count') out[e.assignmentId] = (out[e.assignmentId] || 0) + 1;
    else if (e.type === 'count_adjust') out[e.assignmentId] = Math.max(0, (out[e.assignmentId] || 0) + (e.delta || 0));
  }
  return out;
}

export function timeFor(evs) {
  const out = {};
  for (const e of evs) if (e.type === 'page_time' && e.assignmentId) out[e.assignmentId] = (out[e.assignmentId] || 0) + (e.sec || 0);
  return out;
}

// Full breakdown: day -> { counts:{aid:n}, time:{aid:sec}, total:sec, pages:{p:sec}, log:[...], first, last }
export function breakdown(evs, assignments, resetAll = 0) {
  const days = {};
  const lastCount = {};
  const R = resetMap(assignments);
  for (const e of sortEvents(evs)) {
    if (resetAll && (e.ts || e.clientTs || 0) < resetAll) continue;   // teacher reset everything for this student
    if (before(e, R)) continue;              // teacher reset this assignment (counts, time, opens)
    // group by the VIEWER's local day (student and teacher can be in different time zones)
    const tt = e.ts || e.clientTs || 0;
    const dk = tt ? todayStr(new Date(tt)) : e.day;
    const d = days[dk] ||= { counts: {}, time: {}, listen: 0, total: 0, pages: {}, log: [], first: null, last: null, sessions: 0, flags: 0, done: {} };
    const t = e.ts || e.clientTs;
    d.first = d.first ? Math.min(d.first, t) : t;
    d.last = d.last ? Math.max(d.last, t) : t;
    if (e.type === 'page_time') {
      d.total += e.sec || 0;
      d.listen += e.listen || 0;
      d.pages[e.page] = (d.pages[e.page] || 0) + (e.sec || 0);
      if (e.assignmentId) d.time[e.assignmentId] = (d.time[e.assignmentId] || 0) + (e.sec || 0);
    } else if (e.type === 'count') {
      const aid = e.assignmentId;
      d.counts[aid] = (d.counts[aid] || 0) + 1;
      const key = dk + aid;
      const interval = lastCount[key] ? Math.round((t - lastCount[key]) / 1000) : null;
      lastCount[key] = t;
      const minSec = e.minSec || 0;
      const suspicious = (e.readSec ?? 999999) < minSec || (interval != null && interval < minSec);
      if (suspicious) d.flags++;
      const skew = e.ts && e.clientTs ? Math.abs(e.ts - e.clientTs) > 10 * 60000 : false;
      d.log.push({ kind: 'count', t, aid, n: d.counts[aid], interval, readSec: e.readSec, minSec, suspicious, skew });
    } else if (e.type === 'recording') {
      const aid = e.assignmentId;
      d.counts[aid] = (d.counts[aid] || 0) + 1;
      const suspicious = (e.sec || 0) < (e.minSec || 0);
      if (suspicious) d.flags++;
      d.log.push({ kind: 'rec', t, aid, n: d.counts[aid], sec: e.sec, recId: e.recId, minSec: e.minSec, suspicious });
    } else if (e.type === 'count_adjust') {
      const aid = e.assignmentId;
      d.counts[aid] = Math.max(0, (d.counts[aid] || 0) + (e.delta || 0));
      d.log.push({ kind: 'adjust', t, aid, delta: e.delta, from: e.from, to: e.to });
    } else if (e.type === 'page_done') {
      const aid = e.assignmentId;
      const set = d.done[aid] ||= new Set();
      const key = dk + aid;
      const interval = lastCount[key] ? Math.round((t - lastCount[key]) / 1000) : null;
      lastCount[key] = t;
      const minSec = e.minSec || 0;
      const suspicious = (e.readSec ?? 999999) < minSec;
      if (suspicious) d.flags++;
      const again = set.has(e.page);
      set.add(e.page);
      d.counts[aid] = set.size;
      d.log.push({ kind: 'page', t, aid, page: e.page, n: set.size, interval, readSec: e.readSec, minSec, suspicious, again });
    } else if (e.type === 'page_undo') {
      const aid = e.assignmentId;
      const set = d.done[aid] ||= new Set();
      set.delete(e.page);
      d.counts[aid] = set.size;
      d.log.push({ kind: 'pundo', t, aid, page: e.page });
    } else if (e.type === 'session_start') {
      d.sessions++;
      d.log.push({ kind: 'open', t });
    } else if (e.type === 'session_end') {
      d.log.push({ kind: 'close', t, sec: e.sec });
    } else if (e.type === 'assignment_open') {
      d.log.push({ kind: 'aopen', t, aid: e.assignmentId });
    } else if (e.type === 'text_shown') {
      d.log.push({ kind: 'peek', t, aid: e.assignmentId });
    } else if (e.type === 'pause') {
      d.log.push({ kind: 'pause', t, aid: e.assignmentId, page: e.page, vk: e.vk });
    } else if (e.type === 'resume') {
      d.log.push({ kind: 'resume', t, aid: e.assignmentId, page: e.page });
    }
  }
  return days;
}
