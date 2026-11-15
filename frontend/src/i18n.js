import { useSyncExternalStore } from 'react';
import { zh } from './messages.js';

const STORAGE_KEY = 'twinomation.language';
const listeners = new Set();
export function initialLanguage(saved, browserLanguage = 'en') {
  return ['zh', 'en'].includes(saved) ? saved : (browserLanguage.toLowerCase().startsWith('zh') ? 'zh' : 'en');
}
let saved;
try { if (globalThis.window) saved = window.localStorage.getItem(STORAGE_KEY); } catch { /* Browser storage is optional. */ }
let language = initialLanguage(saved, globalThis.navigator?.language);
export const getLanguage = () => language;
export const localeCode = () => language === 'zh' ? 'zh-CN' : 'en-GB';
export function translate(message, params = {}, targetLanguage = language) {
  if (typeof message !== 'string') return message;
  const copy = targetLanguage === 'zh' && Object.hasOwn(zh, message) ? zh[message] : message;
  return copy.replace(/\{(\w+)\}/g, (match, key) => Object.hasOwn(params, key) ? String(params[key]) : match);
}
export const t = translate;
function updateDocument() {
  if (!globalThis.document) return;
  document.documentElement.lang = language === 'zh' ? 'zh-CN' : 'en';
  document.title = language === 'zh' ? 'Twinomation · 航班协调' : 'Twinomation · Operations';
  const description = document.querySelector('meta[name="description"]');
  if (description) description.content = language === 'zh' ? 'Twinomation — 由人工审核的航班不正常运行协调演示。' : 'Twinomation — a human-reviewed disruption coordination demo.';
}
function applyLanguage(value) {
  if (!['zh', 'en'].includes(value) || value === language) return;
  language = value;
  updateDocument();
  listeners.forEach(listener => listener());
}
export function setLanguage(value) {
  applyLanguage(value);
  try { if (globalThis.window) window.localStorage.setItem(STORAGE_KEY, language); } catch { /* Keep the in-memory choice. */ }
}
export function useLocale() {
  return useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, getLanguage, () => 'en');
}
if (globalThis.window) {
  window.addEventListener('storage', event => {
    if (event.key === STORAGE_KEY) applyLanguage(initialLanguage(event.newValue, navigator.language));
  });
  updateDocument();
}

// Translate known generated audit summaries only. Free-form notes and file names stay intact.
const eventPatterns = [
  [/^Work order v(\d+) sent$/, 'Work order v{0} sent'],
  [/^Work order v(\d+) received$/, 'Work order v{0} received'],
  [/^Reply to v(\d+) sent to OCC$/, 'Reply to v{0} sent to OCC'],
  [/^v(\d+) authorised and published$/, 'v{0} authorised and published'],
  [/^v(\d+) replaced by a new version$/, 'v{0} replaced by a new version'],
  [/^Work order v(\d+) stopped: (.*)$/s, 'Work order v{0} stopped: {1}'],
  [/^File shared: (.*)$/s, 'File shared: {0}'],
];
export function eventText(event) {
  const text = event.payload.summary;
  if (event.type === 'NOTE_ADDED' || event.type === 'SCHEDULE_PROPOSED') return text;
  if (!text) return t(event.type.toLowerCase().replaceAll('_', ' '));
  for (const [pattern, key] of eventPatterns) {
    const match = text.match(pattern);
    if (match) return t(key, Object.fromEntries(match.slice(1).map((v, i) => [i, v])));
  }
  return t(text);
}
export function itemLabel(item) { return item.kind === 'preset' ? t(item.label) : item.label; }
export function itemAnswer(item, answer = item.status) { return item.kind === 'preset' ? t(answer) : answer; }
export function errorText(error = {}, status) {
  const codes = {
    INVALID_TRANSITION: 'This work order cannot be changed in its current state.',
    VALIDATION_ERROR: 'Please check the supplied fields.',
    FILE_TYPE: 'Upload PDF, Word, Excel, PowerPoint, text or image files.',
    FILE_SIZE: 'Files must be between 1 byte and 5 MB.',
    BODY_LIMIT: 'The request is too large.',
    INVALID_ITEMS: 'Please check all item answers and custom choices.',
  };
  const message = codes[error.code] || error.message || (status === 413 ? 'Files must be 5 MB or smaller.' : 'Something went wrong. Please try again.');
  return message;
}
