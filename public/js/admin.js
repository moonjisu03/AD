/* 관리자 화면. 전체 응답은 '응답 불러오기'를 누를 때 한 번 읽는다(실시간 구독 없음, 약 60명 규모 전제).
 * 화면에서 메뉴를 숨기는 것과 별개로, 실제 접근 통제는 firestore.rules가 한다. */
import { initFirebase } from './firebase.js';
import { buildFlow } from './questions.js';
import {
  STATUS_LABEL, AGE_LABEL, LINK_LABEL, END_LABEL, BANNER_NAME, COLS, DEFAULT_FILTER, catalog, questionTitle, filterRows,
  statusSummary, linkTable, aggregate, fmtPct, pct, rawCsv, summaryCsv, tsMs, sectionTimes, bannerSummary,
} from './analysis.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const BIMG = { 1: 'b01', 2: 'b04', 3: 'b15' };
/* 계열 색: 연령대 2개는 고정 순서(20~30대 = 1번, 50~60대 = 2번). 필터가 바뀌어도 색이 바뀌지 않는다. */
const AGE_COLOR = { '20-30': 'var(--s1)', '50-60': 'var(--s2)' };
const AGE_COLS = COLS.filter((c) => c.key !== 'all');
let FB, ROWS = [], LOADED_AT = null;
const F = { ...DEFAULT_FILTER };

function show(id) {
  ['login', 'denied', 'app'].forEach((k) => { $('#' + k).hidden = k !== id; });
  $('#side').hidden = id !== 'app';
}

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
    try { ok = (await FB.fsMod.getDoc(FB.fsMod.doc(FB.db, 'admins', u.uid))).exists(); } catch (e) { ok = false; }
    if (!ok) { $('#duid').textContent = u.uid; show('denied'); return; }
    show('app');
  });
  $('#lf').addEventListener('submit', async (e) => {
    e.preventDefault(); $('#lerr').textContent = '';
    try { await authMod.signInWithEmailAndPassword(auth, $('#em').value.trim(), $('#pw').value); $('#pw').value = ''; }
    catch (err) { $('#lerr').textContent = '로그인하지 못했습니다. 이메일과 비밀번호를 확인하세요. (' + esc(err.code || 'error') + ')'; }
  });
  $('#logout').addEventListener('click', () => { ROWS = []; LOADED_AT = null; $('#out').innerHTML = ''; $('#flow').innerHTML = ''; authMod.signOut(auth); });
  $('#reload').addEventListener('click', load);
  ['test', 'status', 'version', 'link'].forEach((k) => $('#f-' + k).addEventListener('change', (e) => { F[k] = e.target.value; draw(); }));
  $('#dlraw').addEventListener('click', () => download('responses_raw', rawCsv(filterRows(ROWS, F))));
  $('#dlsum').addEventListener('click', () => download('responses_summary', summaryCsv(aggregate(filterRows(ROWS, F)), { filter: F, exportedAt: new Date().toISOString() })));
  setupNav(); setupTip();
}

/* 왼쪽 메뉴: 누르면 해당 카드로 이동, 스크롤 위치에 따라 현재 메뉴 표시 */
function setupNav() {
  const links = [...document.querySelectorAll('[data-nav]')];
  window.addEventListener('scroll', () => {
    let cur = 'sec-dash';
    links.forEach((a) => { const el = document.getElementById(a.dataset.nav); if (el && el.getBoundingClientRect().top < 140) cur = a.dataset.nav; });
    links.forEach((a) => a.classList.toggle('on', a.dataset.nav === cur));
  }, { passive: true });
}
/* 차트 툴팁: data-tip 속성이 있는 도형에 마우스를 올리면 표시 */
function setupTip() {
  const tip = $('#tip');
  document.addEventListener('mousemove', (e) => {
    const t = e.target.closest && e.target.closest('[data-tip]');
    if (!t) { tip.hidden = true; return; }
    tip.textContent = t.getAttribute('data-tip'); tip.hidden = false;
    const w = tip.offsetWidth, x = Math.min(e.clientX + 14, window.innerWidth - w - 8);
    tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px';
  });
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

function setStatus(v) { F.status = v; $('#f-status').value = v; draw(); document.getElementById('sec-list').scrollIntoView({ behavior: 'smooth' }); }

function draw() {
  if (!LOADED_AT) return;
  const now = Date.now();
  const scope = filterRows(ROWS, F, { ignoreStatus: true });
  const rows = filterRows(ROWS, F);
  const s = statusSummary(scope, now);
  $('#flow').innerHTML = drawFlow(s, scope);
  $('#flow').querySelectorAll('[data-status]').forEach((b) => b.addEventListener('click', () => setStatus(b.dataset.status)));

  const stLabel = F.status === 'all' ? '전체 상태' : STATUS_LABEL[F.status];
  let h = '<div class="grid g-2-3">' + cardTimes(rows, stLabel) + cardBanners(rows, stLabel) + '</div>';
  h += '<div class="grid g-3-2">' + cardRecent(scope) + cardDonut(s) + '</div>';
  if (scope.some((r) => (r.linkGroup || 'unknown') !== 'none')) h += cardLinks(scope);
  h += '<div class="card" id="sec-q"><div class="card-h"><h2>문항별 응답</h2><span class="mut small">' + esc(stLabel) + ' ' + rows.length + '건</span></div>' + drawQuestions(rows) + '</div>';
  h += '<div class="card" id="sec-list"><div class="card-h"><h2>응답 조회</h2><span class="mut small">' + esc(stLabel) + ' ' + rows.length + '건 · 응답 번호를 누르면 상세</span></div><div class="card-b">' + drawList(rows) + '</div></div>';
  $('#out').innerHTML = h;
  $('#out').querySelectorAll('[data-rid]').forEach((b) => b.addEventListener('click', () => detail(b.getAttribute('data-rid'))));
}

/* ---------- 참여 흐름 카드 ---------- */
function drawFlow(s, scope) {
  const rate = s.started ? Math.round((100 * s.complete) / s.started) : null;
  const box = (n, label, status) => status
    ? `<button type="button" class="box" data-status="${status}"><b>${n}<small>건</small></b><span>${esc(label)}</span></button>`
    : `<div class="box static"><b>${n}<small>건</small></b><span>${esc(label)}</span></div>`;
  const step = (label, boxes) => `<div class="step"><i class="dot"></i><span class="lbl">${esc(label)}</span><div class="boxes">${boxes}</div></div>`;
  const reasons = Object.keys(s.reasons).map((k) => `${END_LABEL[k] || k} ${s.reasons[k]}`).join(', ');
  return `<div class="flow">
    <div class="hero"><b>${rate === null ? '–' : rate}<small>%</small></b><span>완료율</span><em>완료 ${s.complete} ÷ 시작 ${s.started}</em></div>
    <div class="steps">
      ${step('동의 후 시작', box(s.started, '시작', 'all'))}
      ${step('기본 질문 선별', box(s.screened, '선별 탈락', 'screened_out'))}
      ${step('응답 진행', box(s.inProgress, '진행 중', 'in_progress') + box(s.stale, '이탈 추정') + box(s.quit, '중단', 'quit'))}
      ${step('완료', box(s.complete20, '20~30대', '') + box(s.complete50, '50~60대', '') + box(s.complete, '전체', 'complete'))}
    </div></div>
    <p class="flow-foot"><span>테스트·버전·링크 필터만 적용(진행 상태 필터와 무관)</span><span>이탈 추정: 진행 중인데 마지막 저장 후 2시간 넘음</span>${reasons ? '<span>선별 탈락 사유: ' + esc(reasons) + '</span>' : ''}<span>사진 반복 노출 ${s.repeated}건</span>${scope.some((r) => r.groupMismatch) ? '<span>예전 링크 그룹 ≠ 응답 연령대 ' + s.mismatch + '건</span>' : ''}</p>`;
}

/* ---------- 구간별 응답 시간(묶은 막대) ---------- */
function fmtDur(ms) { if (ms === null) return '–'; return ms >= 60000 ? (ms / 60000).toFixed(1) + '분' : Math.round(ms / 1000) + '초'; }
function cardTimes(rows, stLabel) {
  const data = sectionTimes(rows);
  const max = Math.max(1, ...data.flatMap((d) => AGE_COLS.map((c) => d[c.key].median || 0)));
  const useMin = max >= 60000, unit = useMin ? 60000 : 1000;
  const top = niceTop(max / unit), W = 460, H = 260, L = 34, R = 8, T = 22, B = 30, pw = W - L - R, ph = H - T - B;
  const gw = pw / data.length, bw = Math.min(26, gw / 3), gap = 2;
  let g = '';
  for (let i = 0; i <= 5; i++) {
    const v = (top * i) / 5, y = T + ph - (ph * i) / 5;
    g += `<line class="${i ? 'grid-l' : 'base'}" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text class="ax" x="${L - 6}" y="${y + 4}" text-anchor="end">${+v.toFixed(1)}</text>`;
  }
  data.forEach((d, i) => {
    const cx = L + gw * i + gw / 2;
    AGE_COLS.forEach((c, j) => {
      const m = d[c.key].median, x = cx + (j === 0 ? -bw - gap / 2 : gap / 2);
      if (m === null) { g += `<text class="val" x="${x + bw / 2}" y="${T + ph - 4}" text-anchor="middle">–</text>`; return; }
      const hgt = Math.max(1, (ph * (m / unit)) / top), y = T + ph - hgt;
      const tip = `${d.label} · ${c.label}\n중앙값 ${fmtDur(m)} (n=${d[c.key].n})`;
      g += `<path d="${barPath(x, y, bw, hgt)}" fill="${AGE_COLOR[c.key]}" data-tip="${esc(tip)}"/>`;
      g += `<text class="val" x="${x + bw / 2}" y="${y - 5}" text-anchor="middle">${(m / unit).toFixed(1)}</text>`;
      g += `<rect x="${x - 4}" y="${T}" width="${bw + 8}" height="${ph}" fill="transparent" data-tip="${esc(tip)}"/>`;
    });
    g += `<text class="ax" x="${cx}" y="${H - 10}" text-anchor="middle">${esc(d.label)}</text>`;
  });
  g += `<text class="ax" x="${L - 6}" y="${T - 10}" text-anchor="end">(${useMin ? '분' : '초'})</text>`;
  return `<div class="card"><div class="card-h"><h2>구간별 응답 시간</h2><span class="sp"></span>${legend()}</div>
    <div class="card-b chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="구간별 응답 시간 중앙값, 연령대별">${g}</svg>
    <p class="mut small" style="margin:6px 0 0">${esc(stLabel)} 응답 기준, 구간 안 문항 응답 시간 합의 중앙값. 사진 노출 시간과 다른 앱에 가 있던 시간은 빠집니다.</p></div></div>`;
}
function niceTop(v) { if (v <= 0) return 1; const p = Math.pow(10, Math.floor(Math.log10(v))); for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p; return 10 * p; }
/* 위쪽 모서리만 4px 둥글게, 바닥은 기준선에 붙인다 */
function barPath(x, y, w, h) { const r = Math.min(4, w / 2, h); return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`; }
function legend() { return '<span class="legend">' + AGE_COLS.map((c) => `<span><i style="background:${AGE_COLOR[c.key]}"></i>${esc(c.label)}</span>`).join('') + '</span>'; }

/* ---------- 배너별 요약 카드 ---------- */
function cardBanners(rows, stLabel) {
  const items = bannerSummary(rows);
  const fmt = (it, v) => (v === null ? '–' : it.kind === 'pct' ? v.toFixed(0) : v.toFixed(1));
  const order = [1, 2, 3].flatMap((b) => [items.find((x) => x.key === 'conf' + b)]).concat([1, 2, 3].map((b) => items.find((x) => x.key === 'read' + b)));
  const cards = order.map((it) => `<div class="stat"><div class="t">배너 ${it.banner} · ${esc(it.label)} <small>n=${it.all.n}</small></div>
    <div class="row"><span class="big">${fmt(it, it.all.value)}<small>${it.unit}</small></span>
    <dl>${AGE_COLS.map((c) => `<dt><i style="background:${AGE_COLOR[c.key]}"></i>${esc(c.label)}</dt><dd>${fmt(it, it[c.key].value)}${it[c.key].value === null ? '' : it.unit}</dd>`).join('')}</dl></div></div>`).join('');
  return `<div class="card"><div class="card-h"><h2>배너별 이해 지표</h2><span class="mut small">${esc(stLabel)} 응답 기준</span></div>
    <div class="card-b"><div class="stats">${cards}</div>
    <p class="mut small" style="margin:10px 0 0">평균 확신도: 사진을 다시 보며 답한 두 문항(B3)의 확신 정도 평균(1~5, n은 답한 문항 수). 작은 글씨: ‘유료서비스 광고’ 글씨를 ‘읽었다’고 답한 비율(분모는 그 문항 응답 수).</p></div></div>`;
}

/* ---------- 최근 응답 ---------- */
function fmtDate(v) { const t = tsMs(v); return t === null ? '' : new Date(t).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function statusPill(st) { return `<span class="pill${st === 'complete' ? ' ok' : st === 'screened_out' || st === 'quit' ? ' bad' : ''}">${esc(STATUS_LABEL[st] || st)}</span>`; }
function cardRecent(scope) {
  const recent = scope.slice().sort((a, b) => (tsMs(b.serverUpdatedAt) || 0) - (tsMs(a.serverUpdatedAt) || 0)).slice(0, 5);
  const body = recent.length ? recent.map((r, i) => `<tr><td class="c">${i + 1}</td><td><button class="rowbtn" data-rid="${esc(r.id)}">${esc(String(r.id).slice(0, 8))}</button>${r.test ? ' <span class="pill">테스트</span>' : ''}</td><td>${statusPill(r.status)}</td><td>${esc(AGE_LABEL[r.ageGroup || ''])}</td><td>${fmtDate(r.serverUpdatedAt)}</td></tr>`).join('')
    : '<tr><td colspan="5" class="mut c">응답이 없습니다</td></tr>';
  return `<div class="card"><div class="card-h"><h2>최근 응답</h2><span class="mut small">마지막 저장 순 5건</span></div>
    <div class="card-b tw"><table><thead><tr><th class="c">순서</th><th>응답</th><th>상태</th><th>응답 연령대</th><th>마지막 저장</th></tr></thead><tbody>${body}</tbody></table></div></div>`;
}

/* ---------- 상태 분포 도넛 ---------- */
function cardDonut(s) {
  const parts = [
    { label: '완료', v: s.complete, c: 'var(--s1)' },
    { label: '선별 탈락', v: s.screened, c: 'var(--s2)' },
    { label: '중단', v: s.quit, c: 'var(--s3)' },
    { label: '진행 중·이탈 추정', v: s.inProgress + s.stale, c: 'var(--s4)' },
  ];
  const tot = parts.reduce((a, p) => a + p.v, 0), cx = 100, cy = 100, ro = 90, ri = 58;
  let a0 = -Math.PI / 2, g = '';
  if (!tot) g = `<circle cx="${cx}" cy="${cy}" r="${(ro + ri) / 2}" fill="none" stroke="var(--line-2)" stroke-width="${ro - ri}"/>`;
  parts.forEach((p) => {
    if (!p.v) return;
    const frac = p.v / tot, a1 = a0 + frac * Math.PI * 2, tip = `${p.label} ${p.v}건 (${fmtPct(p.v, tot)})`;
    if (frac >= 0.9999) g += `<circle cx="${cx}" cy="${cy}" r="${(ro + ri) / 2}" fill="none" stroke="${p.c}" stroke-width="${ro - ri}" data-tip="${esc(tip)}"/>`;
    else g += `<path d="${arc(cx, cy, ro, ri, a0, a1)}" fill="${p.c}" stroke="#fff" stroke-width="2" data-tip="${esc(tip)}"/>`;
    a0 = a1;
  });
  g += `<text class="center" x="${cx}" y="${cy + 4}" text-anchor="middle">${tot}</text><text class="center-s" x="${cx}" y="${cy + 22}" text-anchor="middle">시작한 응답</text>`;
  const li = parts.map((p) => `<li><i style="background:${p.c}"></i>${esc(p.label)}<b>${p.v}</b><small>${fmtPct(p.v, tot)}</small></li>`).join('');
  return `<div class="card"><div class="card-h"><h2>응답 상태 분포</h2></div>
    <div class="card-b chart donut"><svg viewBox="0 0 200 200" role="img" aria-label="응답 상태 분포">${g}</svg><ul>${li}</ul></div></div>`;
}
function arc(cx, cy, ro, ri, a0, a1) {
  const p = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`, big = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(ro, a0)}A${ro},${ro} 0 ${big} 1 ${p(ro, a1)}L${p(ri, a1)}A${ri},${ri} 0 ${big} 0 ${p(ri, a0)}Z`;
}

/* ---------- 예전 링크 현황 ---------- */
function cardLinks(scope) {
  return '<div class="card"><div class="card-h"><h2>진입 링크별 현황</h2><span class="mut small">예전 연령대별 링크로 들어온 응답이 있어 표시합니다. 연령대는 Q1 응답 기준입니다.</span></div><div class="card-b tw"><table><thead><tr><th>진입 링크</th><th class="n">시작</th><th class="n">완료</th><th class="n">완료·20~30대</th><th class="n">완료·50~60대</th><th class="n">연령 불일치</th><th class="n">선별 탈락</th><th class="n">중단</th><th class="n">진행 중</th></tr></thead><tbody>' +
    linkTable(scope).filter((r) => r.started > 0).map((r) => `<tr><td>${esc(LINK_LABEL[r.group])}</td><td class="n">${r.started}</td><td class="n">${r.complete}</td><td class="n">${r.complete20}</td><td class="n">${r.complete50}</td><td class="n">${r.mismatch}</td><td class="n">${r.screened}</td><td class="n">${r.quit}</td><td class="n">${r.inProgress}</td></tr>`).join('') +
    '</tbody></table></div></div>';
}

/* ---------- 문항별 응답 ---------- */
function drawQuestions(rows) {
  const agg = aggregate(rows);
  const nCol = COLS.map((c) => rows.filter(c.test).length);
  let h = '<p class="intro">비율 = 선택 수 ÷ 그 문항에 답한 응답 수(n). ‘답 없음’은 분기로 건너뛴 문항, 선택 문항 미응답, 도중 종료를 포함하며 분모에서 뺍니다. 복수 선택 문항은 비율 합이 100%를 넘을 수 있습니다. ‘먼저 눈에 들어왔다고 응답한 항목’은 참여자의 기억 응답이며 시선 추적 측정이 아닙니다.<br>' +
    `열별 응답 수: ${COLS.map((c, i) => esc(c.label) + ' ' + nCol[i]).join(' · ')}</p>`;
  let lastSec = '';
  agg.forEach(({ q, cols }) => {
    const sec = q.banner ? 'b' + q.banner : q.phase;
    if (sec !== lastSec) {
      h += q.banner ? `<div class="qsec"><img class="thumb" src="/img/${BIMG[q.banner]}.png" alt="">${esc(BANNER_NAME[q.banner])}</div>`
        : '<div class="qsec">' + (q.phase === 'screen' ? '기본 질문' : '마무리 문항') + '</div>';
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

/* ---------- 응답 목록 ---------- */
function drawList(rows) {
  const sorted = rows.slice().sort((a, b) => (tsMs(b.serverCreatedAt) || 0) - (tsMs(a.serverCreatedAt) || 0));
  if (!sorted.length) return '<p class="mut">조건에 맞는 응답이 없습니다.</p>';
  return '<div class="tw"><table><thead><tr><th>응답</th><th>상태</th><th>진입 링크</th><th>응답 연령대</th><th>버전</th><th>시작</th><th>종료</th><th class="n">소요</th><th>표시</th></tr></thead><tbody>' +
    sorted.map((r) => {
      const dur = tsMs(r.finishedAt) && tsMs(r.startedAt) ? Math.round((tsMs(r.finishedAt) - tsMs(r.startedAt)) / 60000) + '분' : '';
      const flags = [r.test ? '<span class="pill">테스트</span>' : '', r.groupMismatch ? '<span class="pill bad">연령 불일치</span>' : '',
        Object.values(r.restarts || {}).some((n) => n > 0) ? '<span class="pill bad">반복 노출</span>' : ''].join(' ');
      return `<tr><td><button class="rowbtn" data-rid="${esc(r.id)}">${esc(String(r.id).slice(0, 8))}</button></td><td>${statusPill(r.status)}</td><td>${esc(LINK_LABEL[r.linkGroup] || r.linkGroup)}</td><td>${esc(AGE_LABEL[r.ageGroup || ''])}</td><td>${esc(r.surveyVersion)}</td><td>${fmtDate(r.serverCreatedAt)}</td><td>${fmtDate(r.finishedAt)}</td><td class="n">${dur}</td><td>${flags}</td></tr>`;
    }).join('') + '</tbody></table></div>';
}

/* ---------- 응답 상세 ---------- */
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
