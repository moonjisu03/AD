// 에뮬레이터 없이 도는 테스트: 원본 문항 보존, CSV 안전 처리, 집계 분모.
//   npm run test:static
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildFlow, BANNERS } from '../../public/js/questions.js';
import { csvCell, toCsv, aggregate, catalog, rawCsv, filterRows, DEFAULT_FILTER, statusSummary } from '../../public/js/analysis.js';

const ORIGINAL = readFileSync(new URL('../../광고 해석 설문지.html', import.meta.url), 'utf8').split('\n');
const QJS = readFileSync(new URL('../../public/js/questions.js', import.meta.url), 'utf8');

test('원본 문항 은행(BANNERS·확신도 문구)이 글자 하나 바뀌지 않고 옮겨졌다', () => {
  const bank = ORIGINAL.slice(119, 133).join('\n');
  assert.ok(bank.startsWith('/* ---------- 문항 은행'));
  assert.ok(QJS.includes(bank));
});

test('원본 흐름(buildFlow: 문항·보기·선별 조건)이 함수 머리말 외에는 그대로다', () => {
  const flow = ORIGINAL.slice(155, 234).join('\n').replace('function buildFlow(order){', 'export function buildFlow(order,S){');
  assert.ok(flow.includes('export function buildFlow(order,S){'));
  assert.ok(QJS.includes(flow));
});

test('원본 노출 시간 기본값 10초와 해시 옵션(t5/t10, o1~o3, test)이 유지된다', () => {
  assert.match(ORIGINAL.join('\n'), /exposureSec:10/);
  const sj = readFileSync(new URL('../../public/js/survey.js', import.meta.url), 'utf8');
  assert.match(sj, /exposureSec: 10/);
  assert.match(sj, /\(\^\|-\)t\(5\|10\)\(-\|\$\)/);
  assert.match(sj, /\(\^\|-\)o\(\[1-3\]\)\(-\|\$\)/);
  assert.match(sj, /\(\^\|-\)test\(-\|\$\)/);
});

test('선별 조건: 40대·70대 이상, 스마트폰 거의 안 씀, 50~60대 클릭 경험 없음·기억 안 남은 종료', () => {
  const S = { ans: {}, group: '', cond: false };
  const f = buildFlow([1, 2, 3], S);
  const g = (id) => f.find((x) => x.id === id);
  assert.equal(g('Q1').end(3), 'age');
  assert.equal(g('Q1').end(6), 'age');
  assert.equal(g('Q1').end(1), '');
  assert.equal(g('Q2').end(4), 'phone');
  S.group = '50-60';
  assert.equal(g('Q3').end(4), 'no-experience');
  assert.equal(g('Q3_3').end(), 'no-experience');
  S.group = '20-30';
  assert.equal(g('Q3').end(4), '');
  assert.equal(g('Q3_3').end(), '');
});

test('배너 3개 각각 노출 → 가린 질문(A) → 다시 보여 주며 질문(B) 순서', () => {
  const f = buildFlow([2, 3, 1], { ans: {}, group: '', cond: false });
  const ids = f.map((x) => x.id);
  for (const b of [2, 3, 1]) {
    const i = ids.indexOf('s' + b + '_exp');
    assert.equal(ids[i - 1], 's' + b + '_info');
    assert.equal(ids[i + 1], 's' + b + '_A1');
    assert.ok(ids.indexOf('s' + b + '_B1') > ids.indexOf('s' + b + '_A4'));
  }
  assert.ok(ids.indexOf('s2_exp') < ids.indexOf('s3_exp') && ids.indexOf('s3_exp') < ids.indexOf('s1_exp'));
  assert.equal(BANNERS.length, 3);
});

test('CSV: 수식으로 시작하는 문자열 무력화, 따옴표·쉼표·줄바꿈 처리, 숫자는 그대로', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`);
  assert.equal(csvCell('+1'), "'+1");
  assert.equal(csvCell('-2+3'), "'-2+3");
  assert.equal(csvCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(csvCell('\tx'), "'\tx");
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('줄\n바꿈'), '"줄\n바꿈"');
  assert.equal(csvCell(-5), '-5');
  assert.equal(csvCell(null), '');
  const out = toCsv([['가', '나']]);
  assert.ok(out.startsWith('﻿가,나'));
});

function row(over) {
  return { id: 'x' + Math.random(), status: 'complete', test: false, surveyVersion: 'v', linkGroup: 'young', ageGroup: '20-30', ans: {}, ms: {}, ...over };
}
test('집계: 분모는 그 문항에 답한 수, 답 없음은 따로, 복수 선택 합은 100% 초과 가능', () => {
  const rows = [
    row({ ans: { s1_A1: [1, 2], M1: 4 } }),
    row({ ans: { s1_A1: [1], M1: 1, M2: [3] } }),
    row({ ageGroup: '50-60', ans: { s1_A1: [2], M1: 1, M2: [1, 3] } }),
  ];
  const agg = aggregate(rows);
  const a1 = agg.find((x) => x.q.id === 's1_A1').cols[0];
  assert.equal(a1.n, 3); assert.equal(a1.counts[1], 2); assert.equal(a1.counts[2], 2);
  const m2 = agg.find((x) => x.q.id === 'M2').cols[0];
  assert.equal(m2.n, 2); assert.equal(m2.none, 1);
  const m2y = agg.find((x) => x.q.id === 'M2').cols[1];
  assert.equal(m2y.n, 1);
});

test('기본 필터: 테스트 제외·완료만', () => {
  const rows = [row({}), row({ test: true }), row({ status: 'quit' })];
  assert.equal(filterRows(rows, DEFAULT_FILTER).length, 1);
  assert.equal(statusSummary(filterRows(rows, DEFAULT_FILTER, { ignoreStatus: true }), Date.now()).started, 2);
});

test('원자료 CSV: 자유 입력 수식 무력화, 보기 문구 열 포함', () => {
  const csv = rawCsv([row({ ans: { M6: '=1+1', Q1: 1, s1_A2: 7, s1_A2_text: '@cmd' } })]);
  assert.ok(csv.includes(",'=1+1,"));
  assert.ok(csv.includes(",'@cmd,"));
  assert.ok(csv.includes('20대'));
  assert.ok(catalog().some((q) => q.id === 's3_B4_2'));
});

test('대시보드: 구간별 응답 시간 중앙값과 배너별 확신도·작은 글씨 비율', async () => {
  const { sectionTimes, bannerSummary } = await import('../../public/js/analysis.js');
  const rows = [
    row({ ageGroup: '20-30', ms: { Q1: 1000, Q2: 1000, s1_A1: 3000, M1: 2000 }, ans: { s1_B4_1: 4, s1_B4_2: 2, s1_B5: 1 } }),
    row({ ageGroup: '50-60', ms: { Q1: 4000, s1_B1: 9000 }, ans: { s1_B4_1: 5, s1_B5: 3 } }),
  ];
  const t = sectionTimes(rows);
  assert.equal(t.find((x) => x.key === 'screen')['20-30'].median, 2000);
  assert.equal(t.find((x) => x.key === 's1')['50-60'].median, 9000);
  assert.equal(t.find((x) => x.key === 's1').all.median, 6000);
  assert.equal(t.find((x) => x.key === 's2').all.n, 0);
  const b = bannerSummary(rows);
  assert.equal(b.find((x) => x.key === 'conf1').all.value, 11 / 3);
  assert.equal(b.find((x) => x.key === 'read1').all.value, 50);
  assert.equal(b.find((x) => x.key === 'read1')['50-60'].value, 0);
});

test('이탈 추정: 진행 중이고 마지막 저장 후 5시간 넘으면 stale, 필터로 따로 셈', async () => {
  const { viewStatus, filterRows, statusSummary } = await import('../../public/js/analysis.js');
  const now = Date.parse('2026-11-12T12:00:00Z');
  const at = (h) => ({ seconds: (now - h * 3600e3) / 1000 });
  const rows = [
    row({ status: 'in_progress', serverUpdatedAt: at(4.9) }),
    row({ status: 'in_progress', serverUpdatedAt: at(5.1) }),
    row({ status: 'quit', serverUpdatedAt: at(10) }),
    row({ status: 'complete', serverUpdatedAt: at(10) }),
  ];
  assert.deepEqual(rows.map((r) => viewStatus(r, now)), ['in_progress', 'stale', 'quit', 'complete']);
  assert.equal(filterRows(rows, { ...DEFAULT_FILTER, status: 'stale' }, { now }).length, 1);
  assert.equal(filterRows(rows, { ...DEFAULT_FILTER, status: 'in_progress' }, { now }).length, 1);
  const s = statusSummary(rows, now);
  assert.equal(s.stale, 1); assert.equal(s.inProgress, 1); assert.equal(s.quit, 1);
});
