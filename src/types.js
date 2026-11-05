// Assignment types
export const TYPES = {
  new: { en: 'New memorization', label: 'الحفظ الجديد', short: 'جديد', color: '#2e7d32', tint: 'rgba(46,125,50,.16)', target: 15 },
  old: { en: 'Old memorization', label: 'الحفظ القديم', short: 'قديم', color: '#1565c0', tint: 'rgba(21,101,192,.14)', target: 15 },
  recent: { en: 'Recent review', label: 'الحفظ الحديث', short: 'حديث', color: '#a66a00', tint: 'rgba(196,140,20,.18)', target: 1 },
  recite: { en: 'Recitation', label: 'التسميع', short: 'تسميع', color: '#b23a48', tint: 'rgba(178,58,72,.13)', target: 1 },
  review: { en: 'Review', label: 'مراجعة', short: 'مراجعة', color: '#6a1b9a', tint: 'rgba(106,27,154,.13)', target: 1 }
};
export const TYPE_ORDER = ['new', 'old', 'recent', 'review', 'recite'];

import { rangePages } from './data.js';
// 'page' = the student marks each page of the range once (review); 'range' = she counts full readings of the range
export const modeOf = a => a.type === 'recite' ? 'record' : a.mode || (a.type === 'recent' || a.type === 'review' ? 'page' : 'range');
export const isPageMode = a => modeOf(a) === 'page';
export const isRecordMode = a => modeOf(a) === 'record';
export const targetOf = a => isPageMode(a) ? rangePages(a.from, a.to).length : (a.target || TYPES[a.type]?.target || 1);
export const unitOf = a => isPageMode(a) ? 'صفحة' : isRecordMode(a) ? 'تسميع' : 'مرة';
export const unitEn = (a, n) => isPageMode(a) ? (n === 1 ? 'page' : 'pages') : isRecordMode(a) ? (n === 1 ? 'recording' : 'recordings') : (n === 1 ? 'time' : 'times');
