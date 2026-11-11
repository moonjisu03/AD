/* 관리자 화면. 전체 응답은 '응답 불러오기'를 누를 때 한 번 읽는다(실시간 구독 없음, 약 60명 규모 전제).
 * 화면에서 메뉴를 숨기는 것과 별개로, 실제 접근 통제는 firestore.rules가 한다. */
import { initFirebase } from './firebase.js';
import { buildFlow } from './questions.js';
import {
  STATUS_LABEL, AGE_LABEL, LINK_LABEL, END_LABEL, BANNER_NAME, COLS, DEFAULT_FILTER, catalog, questionTitle, filterRows,
  statusSummary, linkTable, aggregate, fmtPct, pct, rawCsv, summaryCsv, tsMs,
} from './analysis.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BIMG = { 1: 'b01', 2: 'b04', 3: 'b15' };
let FB, ROWS = [], LOADED_AT = null;
const F = { ...DEFAULT_FILTER };

function show(id) { ['login', 'denied', 'app'].forEach((k) => { $('#' + k).hidden = k !== id; }); }

async function boot() {
  try { FB = await initFirebase(); } catch (e) {
    show('login'); $('#lerr').textContent = 'Firebase 설정을 읽지 못했습니다. Firebase Hosting으로 배포된 주소에서 여세요.'; return;
  }
  if (FB.local) { $('#env').hidden = false; $('#env').textContent = '로컬 에뮬레이터'; }
  const { auth, authMod } = FB;
  authMod.onAuthStateChanged(auth, async (u) => {
    $('#logout').hidden = !u || u.isAnonymous;
    $('#who').textContent = u && !u.isAnonymous ? (u.email || u.uid) : '';
    if (!u || u.isAnonymous) { show('login'); return; }
    let ok = false;
    try {
      const s = await FB.fsMod.getDoc(FB.fsMod.doc(FB.db, 'admins', u.uid));
      ok = s.exists();
    } catch (e) { ok = false; }
    if (!ok) { $('#duid').textContent = u.uid; show('denied'); return; }
    show('app');
  });
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#lerr').textContent = '';
    try { await authMod.signInWithEmailAndPassword(auth, $('#em').value.trim(), $('#pw').value); $('#pw').value = ''; }
    catch (err) { $('#lerr').textContent = '로그인하지 못했습니다. 이메일과 비밀번호를 확인하세요. (' + esc(err.code || 'error') + ')'; }
  });
  $('#logout').addEventListener('click', () => { ROWS = []; $('#out').innerHTML = ''; authMod.signOut(auth); });
  $('#reload').addEventListener('click', load);
  ['test', 'status', 'version', 'link'].forEach((k) => $('#f-' + k).addEventListener('change', (e) => { F[k] = e.target.value; draw(); }));
  $('#dlraw').addEventListener('click', () => download('responses_raw', rawCsv(filterRows(ROWS, F))));
  $('#dlsum').addEventListener('click', () => download('responses_summary', summaryCsv(aggregate(filterRows(ROWS, F)), { filter: F, exportedAt: new Date().toISOString() })));
}

async function load() {
  const b = $('#reload'); b.disabled = true; $('#loaded').textContent = '불러오는 중…';
  try {
    const snap = await FB.fsMod.getDocs(FB.fsMod.collection(FB.db, 'responses'));
    ROWS = snap.docs.map((d) => d.data());
    LOADED_AT = new Date();
    const vs = [...new Set(ROWS.map((r) => r.surveyVersion).filter(Boolean))].sort();
    $('#f-version').innerHTML = '<option value="all">전체</option>' + vs.map((v) => '<option>' + esc(v) + '</option>').join('');
    if (F.version !== 'all' && !vs.includes(F.version)) F.version = 'all';
    $('#f-version').value = F.version;
    $('#loaded').textContent = '응답 ' + ROWS.length + '건 · ' + LOADED_AT.toLocaleString('ko-KR') + ' 기준';
    $('#dlraw').disabled = $('#dlsum').disabled = false;
    draw();
  } catch (e) {
    $('#loaded').textContent = '불러오지 못했습니다 (' + (e.code || 'error') + ')';
  } finally { b.disabled = false; }
}

function download(name, text) {
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.csv`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const kpi = (n, label) => `<div class="kpi"><b>${n}</b><span>${esc(label)}</span></div>`;

function draw() {
  if (!LOADED_AT) return;
  const now = Date.now();
  const scope = filterRows(ROWS, F, { ignoreStatus: true });
  const rows = filterRows(ROWS, F);
  const s = statusSummary(scope, now);
  /* 진입 링크는 하나다. 예전 연령대별 링크·잘못된 값으로 들어온 응답이 있을 때만 링크 관련 표를 보여 준다. */
  const legacy = scope.some((r) => (r.linkGroup || 'unknown') !== 'none');
  let h = '<h2>참여 현황</h2><p class="mut small">테스트·버전·링크 필터 적용, 진행 상태는 전체. ‘진행 중’은 마지막 저장 후 2시간 이내, 그보다 오래된 진행 중 응답은 ‘이탈 추정’으로 따로 셉니다.</p><div class="kpis">' +
    kpi(s.started, '시작(동의 후 저장된 응답)') + kpi(s.complete, '완료') + kpi(s.complete20, '완료 · 20~30대') + kpi(s.complete50, '완료 · 50~60대') +
    kpi(s.inProgress, '진행 중') + kpi(s.stale, '이탈 추정(진행 중, 2시간+)') + kpi(s.quit, '중단(그만하기)') + kpi(s.screened, '선별 탈락') +
    (legacy ? kpi(s.mismatch, '예전 링크 그룹 ≠ 응답 연령대') : '') + kpi(s.repeated, '사진 반복 노출 있음') + '</div>';
  const rk = Object.keys(s.reasons);
  if (rk.length) {
    h += '<div class="tw" style="margin-top:10px"><table><tr><th>선별 탈락 사유</th><th class="n">수</th></tr>' +
      rk.map((k) => `<tr><td>${esc(END_LABEL[k] || k)}</td><td class="n">${s.reasons[k]}</td></tr>`).join('') + '</table></div>';
  }

  if (legacy) h += '<h2>진입 링크별 현황</h2><p class="mut small">지금은 공통 링크 하나로 받습니다. 예전 연령대별 링크(?group=young·older)로 들어온 응답이 있어 함께 표시합니다. 연령대는 링크가 아니라 Q1 응답 기준입니다.</p><div class="tw"><table><tr><th>진입 링크</th><th class="n">시작</th><th class="n">완료</th><th class="n">완료·20~30대</th><th class="n">완료·50~60대</th><th class="n">연령 불일치</th><th class="n">선별 탈락</th><th class="n">중단</th><th class="n">진행 중</th></tr>' +
    linkTable(scope).filter((r) => r.started > 0).map((r) => `<tr><td>${esc(LINK_LABEL[r.group])}</td><td class="n">${r.started}</td><td class="n">${r.complete}</td><td class="n">${r.complete20}</td><td class="n">${r.complete50}</td><td class="n">${r.mismatch}</td><td class="n">${r.screened}</td><td class="n">${r.quit}</td><td class="n">${r.inProgress}</td></tr>`).join('') +
    '</table></div>';

  h += drawQuestions(rows);
  h += drawList(rows);
  $('#out').innerHTML = h;
  $('#out').querySelectorAll('[data-rid]').forEach((b) => b.addEventListener('click', () => detail(b.getAttribute('data-rid'))));
}

function drawQuestions(rows) {
  const agg = aggregate(rows);
  const nCol = COLS.map((c) => rows.filter(c.test).length);
  let h = `<h2>문항별 응답 (${esc(F.status === 'all' ? '전체 상태' : STATUS_LABEL[F.status])} ${rows.length}건)</h2>` +
    '<p class="mut small">비율 = 선택 수 ÷ 그 문항에 답한 응답 수(n). ‘답 없음’은 분기로 건너뛴 문항, 선택 문항 미응답, 도중 종료를 포함하며 분모에서 뺍니다. 복수 선택 문항은 비율 합이 100%를 넘을 수 있습니다. ‘먼저 눈에 들어왔다고 응답한 항목’은 참여자의 기억 응답이며 시선 추적 측정이 아닙니다.</p>' +
    `<p class="mut small">열별 응답 수: ${COLS.map((c, i) => esc(c.label) + ' ' + nCol[i]).join(' · ')}</p>`;
  let lastSec = '';
  agg.forEach(({ q, cols }) => {
    const sec = q.banner ? 'b' + q.banner : q.phase;
    if (sec !== lastSec) {
      h += q.banner ? `<h2><img class="thumb" src="/img/${BIMG[q.banner]}.png" alt="">${esc(BANNER_NAME[q.banner])}</h2>`
        : '<h2>' + (q.phase === 'screen' ? '기본 질문' : '마무리 문항') + '</h2>';
      lastSec = sec;
    }
    h += `<div class="q"><h3>${esc(questionTitle(q))}</h3><p class="qt">${esc(q.text)}${q.kind === 'multi' ? ' <span class="pill">복수 선택</span>' : ''}</p>`;
    if (q.kind === 'text') {
      h += '<div class="tw"><table><tr><th></th>' + cols.map((c, i) => `<th class="n">${esc(COLS[i].label)}</th>`).join('') + '</tr>' +
        '<tr><td>적은 응답</td>' + cols.map((c) => `<td class="n">${c.n}</td>`).join('') + '</tr>' +
        '<tr><td>답 없음</td>' + cols.map((c) => `<td class="n">${c.none}</td>`).join('') + '</tr></table></div>';
      if (cols[0].texts.length) h += `<details><summary>적은 내용 ${cols[0].texts.length}건 보기</summary><ul>${cols[0].texts.map((t) => '<li>' + esc(t) + '</li>').join('')}</ul></details>`;
      h += '</div>'; return;
    }
    h += '<div class="tw"><table><tr><th>보기</th>' + cols.map((c, i) => `<th class="n" colspan="2">${esc(COLS[i].label)} (n=${c.n})</th>`).join('') + '</tr>';
    q.opts.forEach((o) => {
      h += `<tr><td>${esc(o.label)}</td>` + cols.map((c) => {
        const k = c.counts[o.v] || 0, p = pct(k, c.n);
        return `<td class="n">${k}</td><td class="n barcell"><i style="width:${p ? Math.min(100, p) : 0}%"></i><span>${fmtPct(k, c.n)}</span></td>`;
      }).join('') + '</tr>';
    });
    h += '<tr><td class="mut">답 없음 (분모 제외)</td>' + cols.map((c) => `<td class="n mut">${c.none}</td><td></td>`).join('') + '</tr>';
    if (q.kind === 'scale') h += '<tr><td class="mut">평균 확신도</td>' + cols.map((c) => `<td class="n" colspan="2">${c.mean === null ? '–' : c.mean.toFixed(2)}</td>`).join('') + '</tr>';
    else h += '<tr><td class="mut">응답 시간 중앙값</td>' + cols.map((c) => `<td class="n mut" colspan="2">${c.medianMs === null ? '–' : (c.medianMs / 1000).toFixed(1) + '초'}</td>`).join('') + '</tr>';
    h += '</table></div>';
    if (q.kind === 'multi') h += '<p class="note">복수 선택 문항: 비율 합계가 100%를 넘을 수 있습니다.</p>';
    if (cols[0].others.length) h += `<details><summary>직접 쓴 답 ${cols[0].others.length}건 보기</summary><ul>${cols[0].others.map((t) => '<li>' + esc(t) + '</li>').join('')}</ul></details>`;
    h += '</div>';
  });
  return h;
}

function fmtDate(v) { const t = tsMs(v); return t === null ? '' : new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function drawList(rows) {
  const sorted = rows.slice().sort((a, b) => (tsMs(b.serverCreatedAt) || 0) - (tsMs(a.serverCreatedAt) || 0));
  return '<h2>응답 조회</h2><div class="tw"><table><tr><th>응답</th><th>상태</th><th>진입 링크</th><th>응답 연령대</th><th>버전</th><th>시작</th><th>종료</th><th class="n">소요</th><th>표시</th></tr>' +
    sorted.map((r) => {
      const dur = tsMs(r.finishedAt) && tsMs(r.startedAt) ? Math.round((tsMs(r.finishedAt) - tsMs(r.startedAt)) / 60000) + '분' : '';
      const flags = [r.test ? '<span class="pill">테스트</span>' : '', r.groupMismatch ? '<span class="pill bad">연령 불일치</span>' : '',
        Object.values(r.restarts || {}).some((n) => n > 0) ? '<span class="pill bad">반복 노출</span>' : ''].join(' ');
      return `<tr><td><button class="rowbtn" data-rid="${esc(r.id)}">${esc(String(r.id).slice(0, 8))}</button></td><td>${esc(STATUS_LABEL[r.status] || r.status)}</td><td>${esc(r.linkGroup)}</td><td>${esc(AGE_LABEL[r.ageGroup || ''])}</td><td>${esc(r.surveyVersion)}</td><td>${fmtDate(r.serverCreatedAt)}</td><td>${fmtDate(r.finishedAt)}</td><td class="n">${dur}</td><td>${flags}</td></tr>`;
    }).join('') + '</table></div>';
}

function detail(id) {
  const r = ROWS.find((x) => x.id === id); if (!r) return;
  const cat = Object.fromEntries(catalog().map((q) => [q.id, q]));
  const flow = buildFlow(r.order && r.order.length === 3 ? r.order : [1, 2, 3], { ans: r.ans || {}, group: r.ageGroup || '', cond: !!r.cond });
  const a = r.ans || {};
  const lab = (q, v) => {
    if (v === undefined || v === null || v === '') return '<span class="mut">답 없음</span>';
    if (q.kind === 'text') return esc(v);
    const one = (x) => { const o = q.opts.find((p) => p.v === x); return esc(o ? o.label : x); };
    return Array.isArray(v) ? v.map(one).join(', ') : one(v);
  };
  let h = `<h1>응답 ${esc(String(r.id).slice(0, 8))}</h1><p class="mut small">${esc(r.id)}<br>상태: ${esc(STATUS_LABEL[r.status] || r.status)}${r.endReason ? ' (' + esc(r.endReason) + ')' : ''} · 테스트: ${r.test ? '예' : '아니오'} · 버전 ${esc(r.surveyVersion)}<br>` +
    `진입 링크: ${esc(LINK_LABEL[r.linkGroup] || r.linkGroup)}${r.linkGroupRaw && r.linkGroupRaw !== r.linkGroup ? ' (원래 값 “' + esc(r.linkGroupRaw) + '”)' : ''} · 응답 연령대: ${esc(AGE_LABEL[r.ageGroup || ''])}${r.groupMismatch ? ' · <b>링크와 불일치</b>' : ''}<br>` +
    `배너 순서: ${esc((r.order || []).join(' → '))} · 노출 설정 ${esc(r.expSec)}초</p>`;
  const ex = r.exposures || [];
  if (ex.length) {
    h += '<h3>사진 노출 기록</h3><div class="tw"><table><tr><th>배너</th><th class="n">회차</th><th>결과</th><th class="n">설정</th><th class="n">실제 표시</th><th class="n">이미지 준비</th></tr>' +
      ex.map((e) => `<tr><td>${esc(e.banner)}</td><td class="n">${esc(e.attempt)}</td><td>${esc({ completed: '끝까지 봄', hidden: '다른 앱 이동으로 중단', reload: '새로고침으로 중단', img_error: '이미지 오류', loading: '준비 중 종료', showing: '표시 중 종료' }[e.outcome] || e.outcome)}</td><td class="n">${e.plannedMs != null ? (e.plannedMs / 1000).toFixed(1) + '초' : ''}</td><td class="n">${e.actualMs != null ? (e.actualMs / 1000).toFixed(2) + '초' : '–'}</td><td class="n">${e.imgWaitMs != null ? e.imgWaitMs + 'ms' : '–'}</td></tr>`).join('') + '</table></div>';
  }
  h += '<h3 style="margin-top:14px">답변 (제시 순서)</h3>';
  flow.forEach((st) => {
    if (st.type !== 'q') return;
    const q = cat[st.id]; if (!q) return;
    if (!(st.id in a) && st.skip && st.skip()) return;
    const conf = st.conf ? ` · 확신 ${a[st.conf] ?? '–'}/5` : '';
    const other = a[st.id + '_text'] ? ` · 직접 씀: “${esc(a[st.id + '_text'])}”` : '';
    const ms = (r.ms || {})[st.id];
    h += `<div class="ans"><div class="qt">${esc(questionTitle(q))}</div><div>${esc(st.text)}</div><div><b>${lab(q, a[st.id])}</b>${conf}${other}${ms ? ' <span class="mut small">(' + (ms / 1000).toFixed(1) + '초)</span>' : ''}</div></div>`;
  });
  const ev = r.events || [];
  if (ev.length) h += `<details><summary>진행 기록 ${ev.length}건</summary><ul>${ev.map((e) => `<li>${esc(e.at)} · ${esc(e.type)} · ${esc(e.step)}</li>`).join('')}</ul></details>`;
  $('#dlgbody').innerHTML = h;
  $('#dlg').showModal();
}

boot();
