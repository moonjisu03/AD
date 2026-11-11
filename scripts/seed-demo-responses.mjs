// 로컬 에뮬레이터 전용: 관리자 화면 확인용 가짜 응답을 넣는다(test: true). 실제 프로젝트에는 연결하지 않는다.
//   npm run dev  (다른 터미널)
//   node scripts/seed-demo-responses.mjs [개수]
import { catalog } from '../public/js/analysis.js';

const FS = 'http://127.0.0.1:8080/v1/projects/demo-ad-survey/databases/(default)/documents';
const N = +(process.argv[2] || 36);
const rnd = (a) => a[Math.floor(Math.random() * a.length)];
const ri = (lo, hi) => lo + Math.floor(Math.random() * (hi - lo + 1));

function enc(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (v instanceof Date) return { timestampValue: v.toISOString() };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
}

const cat = catalog();
let made = 0;
for (let i = 0; i < N; i++) {
  const age = Math.random() < 0.5 ? '20-30' : '50-60';
  const roll = Math.random();
  const status = roll < 0.7 ? 'complete' : roll < 0.8 ? 'screened_out' : roll < 0.9 ? 'quit' : 'in_progress';
  const start = new Date(Date.now() - ri(1, 72) * 3600e3);
  const ans = { consent: 1, Q1: age === '20-30' ? rnd([1, 2]) : rnd([4, 5]), Q2: 1, Q3: rnd([1, 2]) };
  const ms = {};
  const slow = age === '50-60' ? 1.6 : 1;
  cat.forEach((q) => {
    if (['Q1', 'Q2', 'Q3', 'Q3_3'].includes(q.id) || q.kind === 'text') return;
    if (status !== 'complete' && !q.id.startsWith('Q')) return;
    if (q.kind === 'scale') ans[q.id] = Math.max(1, Math.min(5, Math.round((age === '20-30' ? 3.8 : 3.0) + (Math.random() - 0.5) * 2.5)));
    else if (q.kind === 'multi') ans[q.id] = [q.opts[ri(0, q.opts.length - 1)].v];
    else if (q.code === 'B5') ans[q.id] = Math.random() < (age === '20-30' ? 0.6 : 0.35) ? 1 : rnd([2, 3]);
    else ans[q.id] = q.opts[ri(0, q.opts.length - 1)].v;
    ms[q.id] = Math.round((4000 + Math.random() * 9000) * slow);
  });
  const fin = status === 'in_progress' ? '' : new Date(start.getTime() + ri(8, 20) * 60e3).toISOString();
  const id = 'demo-' + Math.random().toString(36).slice(2, 10) + '-' + i;
  const doc = {
    id, uid: 'demo-uid-' + i, surveyVersion: '2026-11-v1', rev: 5, status, endReason: status === 'screened_out' ? 'age:Q1' : '',
    test: true, consent: true, linkGroup: 'none', linkGroupRaw: '', ageGroup: status === 'screened_out' ? '' : age, groupMismatch: false,
    cond: false, order: rnd([[1, 2, 3], [2, 3, 1], [3, 1, 2]]), orderSrc: 'random', expSec: 10, vw: 390, vh: 844,
    openedAt: start.toISOString(), startedAt: start.toISOString(), updatedAt: fin || start.toISOString(), finishedAt: fin,
    ans, ms, optOrder: {}, restarts: Math.random() < 0.1 ? { s2: 1 } : {}, events: [],
    exposures: [1, 2, 3].map((b) => ({ banner: b, attempt: 1, plannedMs: 10000, actualMs: 10001, imgWaitMs: 20, outcome: 'completed', at: start.toISOString() })),
    serverCreatedAt: start, serverUpdatedAt: fin ? new Date(fin) : start,
  };
  const res = await fetch(`${FS}/responses/${id}`, {
    method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: enc(doc).mapValue.fields }),
  });
  if (!res.ok) { console.error('실패', await res.text()); process.exit(1); }
  made++;
}
console.log(`에뮬레이터에 예시 응답 ${made}건을 넣었습니다(test: true). 관리자 화면에서 ‘테스트 응답: 포함’으로 보세요.`);
