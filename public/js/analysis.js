/* 관리자 화면용 집계·CSV. DOM·Firebase에 의존하지 않는 순수 함수(테스트 가능). */
import { BANNERS, buildFlow, SURVEY_VERSION } from './questions.js';

export const STATUS_LABEL = { in_progress: '진행 중', stale: '이탈 추정', complete: '완료', screened_out: '선별 탈락', quit: '중단(그만하기)' };
export const AGE_LABEL = { '20-30': '20~30대', '50-60': '50~60대', '': '연령 미응답·대상 외' };
export const LINK_LABEL = { none: '공통 링크', young: '예전 20~30대 링크(young)', older: '예전 50~60대 링크(older)', unknown: '잘못된 group 값' };
export const END_LABEL = { age: '나이(40대·70대 이상)', phone: '스마트폰 거의 안 씀', 'no-experience': '광고 클릭 경험 없음·기억 안 남(50~60대)' };
export const BANNER_NAME = { 1: '배너 1 (보험 환급금 조회)', 2: '배너 2 (빨간 ! 보호 안내)', 3: '배너 3 (화살표·확인하기)' };
/* 측정한 내용에 맞춘 이름. 시선 추적 자료가 아니다. */
export const SHORT_LABEL = {
  A1: '먼저 눈에 들어왔다고 응답한 항목(최대 2개)', A2: '서비스 성격 인식(사진 가린 뒤)', A3: '버튼 결과 예상(사진 가린 뒤)',
  A4: '광고/안내 인식(사진 가린 뒤)', B1: '비용 인식', B2: '버튼 누르면 바로 가입 예상', B5: '‘유료서비스 광고’ 작은 글씨 읽음',
};
/* 이탈 추정: 진행 중인데 마지막 저장 후 5시간 넘게 다시 접속(저장)하지 않은 응답 */
export const STALE_MS = 5 * 60 * 60 * 1000;

/* 문항 목록: 배너 순서 [1,2,3] 기준으로 모든 문항을 펼친다. */
const DUMMY = { ans: {}, group: '', cond: false };
export function catalog() {
  const flow = buildFlow([1, 2, 3], DUMMY);
  const out = [];
  flow.forEach((st) => {
    if (st.type !== 'q') return;
    const m = /^s(\d)_(.+)$/.exec(st.id);
    const item = {
      id: st.id, text: st.text, kind: st.kind, phase: st.phase, banner: m ? +m[1] : null, code: m ? m[2] : st.id,
      opts: (st.opts || []).map((o) => ({ v: o[0], label: o[1], other: (o[2] || '').indexOf('other') > -1 })),
      shuffle: !!st.shuffle, optional: !!st.optional,
    };
    if (st.id === 'M1') item.opts = item.opts.map((o) => (o.v >= 1 && o.v <= 3 ? { ...o, label: BANNER_NAME[o.v] } : o));
    out.push(item);
    if (st.conf) {
      const cm = /^s(\d)_(.+)$/.exec(st.conf);
      out.push({ id: st.conf, text: '확신 정도: ' + st.text, kind: 'scale', phase: st.phase, banner: +cm[1], code: cm[2], confOf: st.id,
        opts: [1, 2, 3, 4, 5].map((n) => ({ v: n, label: n + '점' + (n === 1 ? ' (전혀 확실하지 않다)' : n === 5 ? ' (아주 확실하다)' : '') })) });
    }
  });
  return out;
}
export function questionTitle(q) {
  const s = SHORT_LABEL[q.code];
  return (q.banner ? BANNER_NAME[q.banner] + ' · ' : '') + q.id + (s ? ' · ' + s : '');
}

export function tsMs(v) {
  if (!v) return null;
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  const t = Date.parse(v); return isNaN(t) ? null : t;
}
export function isStale(r, now) {
  const t = tsMs(r.serverUpdatedAt) || tsMs(r.updatedAt);
  return r.status === 'in_progress' && t !== null && now - t > STALE_MS;
}

/* 화면에 쓰는 상태: 진행 중이지만 5시간 넘게 저장이 없으면 'stale'(이탈 추정). DB 값은 바꾸지 않는다. */
export function viewStatus(r, now = Date.now()) { return isStale(r, now) ? 'stale' : r.status; }
/* 필터: test = 'exclude' | 'include' | 'only', status = 'complete' | 'all' | 화면 상태값(stale 포함), version = 'all' | 버전, link = 'all' | 그룹 */
export const DEFAULT_FILTER = { test: 'exclude', status: 'complete', version: 'all', link: 'all' };
export function filterRows(rows, f, opts = {}) {
  return rows.filter((r) => {
    if (f.test === 'exclude' && r.test) return false;
    if (f.test === 'only' && !r.test) return false;
    if (f.version !== 'all' && r.surveyVersion !== f.version) return false;
    if (f.link !== 'all' && r.linkGroup !== f.link) return false;
    if (!opts.ignoreStatus && f.status !== 'all' && viewStatus(r, opts.now) !== f.status) return false;
    return true;
  });
}

export function statusSummary(rows, now) {
  const c = (fn) => rows.filter(fn).length;
  const reasons = {};
  rows.filter((r) => r.status === 'screened_out').forEach((r) => {
    const k = String(r.endReason || '').split(':')[0] || '(기록 없음)'; reasons[k] = (reasons[k] || 0) + 1;
  });
  return {
    started: rows.length,
    complete: c((r) => r.status === 'complete'),
    complete20: c((r) => r.status === 'complete' && r.ageGroup === '20-30'),
    complete50: c((r) => r.status === 'complete' && r.ageGroup === '50-60'),
    inProgress: c((r) => r.status === 'in_progress' && !isStale(r, now)),
    stale: c((r) => isStale(r, now)),
    quit: c((r) => r.status === 'quit'),
    screened: c((r) => r.status === 'screened_out'),
    reasons,
    mismatch: c((r) => r.groupMismatch),
    repeated: c((r) => Object.values(r.restarts || {}).some((n) => n > 0)),
  };
}

export function linkTable(rows) {
  return ['none', 'young', 'older', 'unknown'].map((g) => {
    const rs = rows.filter((r) => (r.linkGroup || 'unknown') === g);
    const c = (fn) => rs.filter(fn).length;
    return {
      group: g, started: rs.length, complete: c((r) => r.status === 'complete'),
      complete20: c((r) => r.status === 'complete' && r.ageGroup === '20-30'),
      complete50: c((r) => r.status === 'complete' && r.ageGroup === '50-60'),
      mismatch: c((r) => r.groupMismatch), screened: c((r) => r.status === 'screened_out'),
      quit: c((r) => r.status === 'quit'), inProgress: c((r) => r.status === 'in_progress'),
    };
  });
}

function median(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
export const COLS = [
  { key: 'all', label: '전체', test: () => true },
  { key: '20-30', label: '20~30대', test: (r) => r.ageGroup === '20-30' },
  { key: '50-60', label: '50~60대', test: (r) => r.ageGroup === '50-60' },
];
/* 문항별 집계.
 * - base: 그 열(전체/연령대)에 속한 응답 수
 * - n(분모): 그 문항에 답한 응답 수. 비율 = 선택 수 / n
 * - none: base 중 답이 없는 수(건너뛴 문항·선택 문항 미응답·도중 종료)
 * - 복수 선택 문항은 비율 합이 100%를 넘을 수 있다 */
export function aggregate(rows) {
  return catalog().map((q) => {
    const cols = COLS.map((col) => {
      const rs = rows.filter(col.test);
      const vals = rs.map((r) => (r.ans || {})[q.id]);
      const has = (v) => (q.kind === 'multi' ? Array.isArray(v) && v.length > 0 : q.kind === 'text' ? typeof v === 'string' && v.trim() !== '' : v !== undefined && v !== null);
      const answered = vals.filter(has);
      const counts = {};
      if (q.kind !== 'text') {
        q.opts.forEach((o) => { counts[o.v] = 0; });
        answered.forEach((v) => { (Array.isArray(v) ? v : [v]).forEach((x) => { counts[x] = (counts[x] || 0) + 1; }); });
      }
      const times = rs.map((r) => (r.ms || {})[q.id]).filter((x) => typeof x === 'number' && x > 0);
      const others = q.opts.some((o) => o.other) ? rs.map((r) => (r.ans || {})[q.id + '_text']).filter((t) => typeof t === 'string' && t.trim()) : [];
      const mean = q.kind === 'scale' && answered.length ? answered.reduce((a, b) => a + b, 0) / answered.length : null;
      return { key: col.key, base: rs.length, n: answered.length, none: rs.length - answered.length, counts, medianMs: median(times), others, mean,
        texts: q.kind === 'text' ? answered : [] };
    });
    return { q, cols };
  });
}

export function pct(c, n) { return n ? (100 * c) / n : null; }
export function fmtPct(c, n) { const p = pct(c, n); return p === null ? '–' : p.toFixed(1) + '%'; }

/* ---------- CSV ---------- */
/* 스프레드시트 수식 실행 방지: =, +, -, @, 탭, CR로 시작하는 문자열 앞에 ' 를 붙인다. 숫자 값은 그대로 둔다. */
export function csvCell(v) {
  if (v === undefined || v === null) return '';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  let s = String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}
/* 한글이 엑셀에서 깨지지 않도록 UTF-8 BOM을 붙인다. */
export function toCsv(rows) { return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; }

function labelOf(q, v) {
  if (v === undefined || v === null || v === '') return '';
  const one = (x) => { const o = q.opts.find((p) => p.v === x); return o ? o.label : String(x); };
  return Array.isArray(v) ? v.map(one).join(' | ') : one(v);
}
function rawVal(v) { return Array.isArray(v) ? v.join('|') : v; }
function lastExposure(r, b) {
  const ex = (r.exposures || []).filter((e) => e.banner === b && e.outcome === 'completed');
  return ex.length ? ex[ex.length - 1] : null;
}
export function rawCsv(rows) {
  const cat = catalog();
  const now = Date.now();
  const head = ['response_id', 'survey_version', 'status', 'status_view', 'end_reason', 'test', 'consent', 'link_group', 'link_group_raw', 'age_group',
    'group_mismatch', 'cond_clicked_not_joined', 'banner_order', 'order_src', 'exposure_sec_setting', 'opened_at', 'started_at', 'finished_at',
    'server_created_at', 'server_updated_at'];
  [1, 2, 3].forEach((b) => head.push('s' + b + '_exposure_count', 's' + b + '_restarts', 's' + b + '_exposure_actual_ms', 's' + b + '_img_wait_ms'));
  head.push('reload_count', 'save_fail_count');
  cat.forEach((q) => {
    head.push(q.id, q.id + '_label');
    if (q.opts && q.opts.some((o) => o.other)) head.push(q.id + '_text');
    if (q.shuffle) head.push(q.id + '_option_order');
    if (q.kind !== 'scale') head.push('ms_' + q.id);
  });
  const iso = (v) => { const t = tsMs(v); return t === null ? '' : new Date(t).toISOString(); };
  const lines = rows.map((r) => {
    const a = r.ans || {};
    const row = [r.id, r.surveyVersion, r.status, viewStatus(r, now), r.endReason || '', !!r.test, !!r.consent, r.linkGroup, r.linkGroupRaw || '', r.ageGroup || '',
      !!r.groupMismatch, !!r.cond, (r.order || []).join('-'), r.orderSrc || '', r.expSec, r.openedAt || '', r.startedAt || '', r.finishedAt || '',
      iso(r.serverCreatedAt), iso(r.serverUpdatedAt)];
    [1, 2, 3].forEach((b) => {
      const ex = lastExposure(r, b);
      row.push((r.exposures || []).filter((e) => e.banner === b).length, (r.restarts || {})['s' + b] || 0, ex ? ex.actualMs : '', ex ? ex.imgWaitMs : '');
    });
    const ev = r.events || [];
    row.push(ev.filter((e) => e.type === 'reload').length, ev.filter((e) => e.type === 'save_fail' || e.type === 'final_save_fail').length);
    cat.forEach((q) => {
      row.push(rawVal(a[q.id]), q.kind === 'text' ? '' : labelOf(q, a[q.id]));
      if (q.opts && q.opts.some((o) => o.other)) row.push(a[q.id + '_text'] || '');
      if (q.shuffle) row.push(((r.optOrder || {})[q.id] || []).join('|'));
      if (q.kind !== 'scale') row.push((r.ms || {})[q.id] ?? '');
    });
    return row;
  });
  return toCsv([head].concat(lines));
}
export function summaryCsv(agg, meta) {
  const head = ['question_id', 'banner', 'question', 'measure', 'option_value', 'option_label', 'group', 'count', 'denominator_answered', 'percent', 'no_answer', 'note'];
  const out = [head];
  agg.forEach(({ q, cols }) => {
    const note = q.kind === 'multi' ? '복수 선택: 비율 합이 100%를 넘을 수 있음' : '';
    cols.forEach((c) => {
      if (q.kind === 'text') { out.push([q.id, q.banner || '', q.text, '자유 입력 응답 수', '', '', c.key, c.n, c.base, '', c.none, '']); return; }
      q.opts.forEach((o) => {
        const p = pct(c.counts[o.v] || 0, c.n);
        out.push([q.id, q.banner || '', q.text, SHORT_LABEL[q.code] || '', o.v, o.label, c.key, c.counts[o.v] || 0, c.n, p === null ? '' : +p.toFixed(1), c.none, note]);
      });
      if (q.kind === 'scale' && c.mean !== null) out.push([q.id, q.banner || '', q.text, '평균 확신도(1~5)', '', '', c.key, '', c.n, '', c.none, 'mean=' + c.mean.toFixed(2)]);
    });
  });
  out.push([]);
  out.push(['# filter', JSON.stringify(meta.filter)]);
  out.push(['# exported_at', meta.exportedAt]);
  out.push(['# denominator', '비율 분모 = 그 문항에 답한 응답 수(denominator_answered). no_answer = 해당 열 응답 중 답이 없는 수(건너뜀·선택 문항 미응답 포함)']);
  return toCsv(out);
}
export { SURVEY_VERSION, BANNERS };

/* ---------- 대시보드 카드용 ---------- */
export const SECTIONS = [
  { key: 'screen', label: '기본 질문', test: (id) => /^(Q\d|Q\d_\d)$/.test(id) },
  { key: 's1', label: '배너 1', test: (id) => id.startsWith('s1_') },
  { key: 's2', label: '배너 2', test: (id) => id.startsWith('s2_') },
  { key: 's3', label: '배너 3', test: (id) => id.startsWith('s3_') },
  { key: 'close', label: '마무리', test: (id) => /^M\d$/.test(id) },
];
/* 구간별 응답 시간(문항 응답 시간 합, 다른 앱에 있던 시간 제외) 중앙값(ms). 사진 노출 시간은 포함하지 않는다.
 * 해당 구간에 시간 기록이 있는 응답만 센다. */
export function sectionTimes(rows) {
  return SECTIONS.map((sec) => {
    const out = { key: sec.key, label: sec.label };
    COLS.forEach((col) => {
      const v = rows.filter(col.test).map((r) => Object.entries(r.ms || {}).filter(([k]) => sec.test(k)).reduce((a, [, x]) => a + (typeof x === 'number' ? x : 0), 0)).filter((x) => x > 0);
      out[col.key] = { median: median(v), n: v.length };
    });
    return out;
  });
}
/* 배너별 요약: 평균 확신도(B4_1·B4_2 평균, 1~5)와 ‘유료서비스 광고’ 작은 글씨를 읽었다고 답한 비율(B5 = 1) */
export function bannerSummary(rows) {
  const out = [];
  [1, 2, 3].forEach((b) => {
    const conf = { key: 'conf' + b, banner: b, kind: 'mean', label: '평균 확신도', unit: '/5' };
    const read = { key: 'read' + b, banner: b, kind: 'pct', label: '작은 글씨 읽었다고 응답', unit: '%' };
    COLS.forEach((col) => {
      const rs = rows.filter(col.test);
      const cs = [];
      rs.forEach((r) => { const a = r.ans || {}; [a['s' + b + '_B4_1'], a['s' + b + '_B4_2']].forEach((x) => { if (typeof x === 'number') cs.push(x); }); });
      conf[col.key] = { value: cs.length ? cs.reduce((x, y) => x + y, 0) / cs.length : null, n: cs.length };
      const ans = rs.map((r) => (r.ans || {})['s' + b + '_B5']).filter((x) => x !== undefined && x !== null);
      read[col.key] = { value: ans.length ? (100 * ans.filter((x) => x === 1).length) / ans.length : null, n: ans.length };
    });
    out.push(conf, read);
  });
  return out;
}
