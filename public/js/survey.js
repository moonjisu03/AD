/* 설문 진행. 원본 `광고 해석 설문지.html`의 진행 로직을 옮기고,
 * 저장소를 window.claude.use('db') 대신 Firebase(익명 인증 + Firestore)로 바꿨다.
 * 원본에서 바뀐 동작은 README의 '원본 대비 변경 사항'에 적어 둔다. */
import { SURVEY_VERSION, BANNERS, CONF_LABEL, buildFlow } from './questions.js';
import { createStore } from './store.js';

var CONFIG = { exposureSec: 10, imgTimeoutMs: 15000 };

var $ = function (s) { return document.querySelector(s); };
var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
var IMG_KEYS = ['b01', 'b03', 'b04', 'b15'];
var imgSrc = function (k) { return '/img/' + k + '.png'; };

/* ---------- 상태 ---------- */
var S = null, FLOW = [], tm = null, expRun = null, STORE = null, storeReady = false, storeErr = '';
var HASH = (location.hash || '').replace('#', '');
var TEST = /(^|-)test(-|$)/.test(HASH);
var LS_KEY = 'adSurvey:' + SURVEY_VERSION + (TEST ? ':test' : '');

function newId() {
  try { if (crypto && crypto.randomUUID) return crypto.randomUUID(); } catch (e) {}
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
function shuffle(a) { a = a.slice(); for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

/* 진입 링크는 하나(그룹 값 없음 = 'none'). 연령대는 Q1 답으로만 구분한다.
 * 예전에 배포한 ?group=young | ?group=older 링크로 들어오면 그 값을 그대로 기록하고, 그 밖의 값은 'unknown'으로 기록한다.
 * 링크 값은 누구나 바꿀 수 있으므로 실제 연령이나 권한으로 쓰지 않는다(실제 연령대는 Q1 답). */
function readLinkGroup() {
  var raw = '';
  try { raw = new URLSearchParams(location.search).get('group') || ''; } catch (e) {}
  raw = raw.slice(0, 40);
  var g = raw === '' ? 'none' : (raw === 'young' || raw === 'older' ? raw : 'unknown');
  return { linkGroup: g, linkGroupRaw: raw };
}

function newState() {
  var NB = BANNERS.length, m = /(^|-)o([1-3])(-|$)/.exec(HASH), start, src;
  if (m) { start = +m[2]; src = 'link'; } else { start = 1 + Math.floor(Math.random() * NB); src = 'random'; }
  var order = []; for (var k = 0; k < NB; k++) order.push(((start - 1 + k) % NB) + 1);
  var t = /(^|-)t(5|10)(-|$)/.exec(HASH), lg = readLinkGroup();
  return {
    v: SURVEY_VERSION, id: newId(), i: 0, ans: {}, ms: {}, shuf: {}, order: order, orderSrc: src, group: '', status: 'in_progress', endReason: '',
    expSec: t ? +t[2] : CONFIG.exposureSec, test: TEST, cond: false, notice: '', agreed: false,
    linkGroup: lg.linkGroup, linkGroupRaw: lg.linkGroupRaw,
    exposures: [], restarts: {}, events: [], rev: 0, created: false, verified: false,
    openedAt: new Date().toISOString(), startedAt: '', finishedAt: '', vw: window.innerWidth, vh: window.innerHeight
  };
}

/* ---------- 로컬 복구용 사본 ---------- */
function persistLocal() {
  if (!S) return;
  try { localStorage.setItem(LS_KEY, JSON.stringify(S)); } catch (e) {}
}
function loadLocal() {
  try {
    var raw = localStorage.getItem(LS_KEY); if (!raw) return null;
    var s = JSON.parse(raw);
    if (!s || s.v !== SURVEY_VERSION || !s.id) return null;
    return s;
  } catch (e) { return null; }
}
function clearLocal() { try { localStorage.removeItem(LS_KEY); } catch (e) {} }

function logEvent(type, extra) {
  if (!S) return;
  var st = FLOW[S.i];
  var ev = { type: type, at: new Date().toISOString(), step: st ? st.id : '' };
  if (extra) Object.keys(extra).forEach(function (k) { ev[k] = extra[k]; });
  S.events.push(ev);
  if (S.events.length > 100) S.events = S.events.slice(-100);
}

/* ---------- 저장 ---------- */
function ageMismatch() {
  if ((S.linkGroup !== 'young' && S.linkGroup !== 'older') || !S.group) return false;
  return !((S.linkGroup === 'young' && S.group === '20-30') || (S.linkGroup === 'older' && S.group === '50-60'));
}
function snapshot() {
  return {
    id: S.id, surveyVersion: SURVEY_VERSION, status: S.status, endReason: S.endReason, test: S.test, consent: S.ans.consent === 1,
    linkGroup: S.linkGroup, linkGroupRaw: S.linkGroupRaw, ageGroup: S.group, groupMismatch: ageMismatch(),
    cond: S.cond, order: S.order.slice(), orderSrc: S.orderSrc, expSec: S.expSec,
    vw: S.vw, vh: S.vh, openedAt: S.openedAt, startedAt: S.startedAt, updatedAt: new Date().toISOString(), finishedAt: S.finishedAt,
    ans: JSON.parse(JSON.stringify(S.ans)), ms: JSON.parse(JSON.stringify(S.ms || {})), optOrder: JSON.parse(JSON.stringify(S.shuf)),
    exposures: JSON.parse(JSON.stringify(S.exposures)), restarts: JSON.parse(JSON.stringify(S.restarts)), events: JSON.parse(JSON.stringify(S.events))
  };
}
var saveT = null, chain = Promise.resolve(), lastOk = true;
function final() { return S.status !== 'in_progress'; }
/* 중간 저장: 1.2초 모아서 한 번. 참여 동의 전에는 저장하지 않는다.
 * 종료(완료·선별·그만하기) 뒤에는 예약된 중간 저장을 버린다. 규칙에서도 종료 응답 수정을 막는다. */
function save(now) {
  persistLocal();
  clearTimeout(saveT); saveT = null;
  if (!S.agreed || S.ans.consent !== 1 || !storeReady || final()) return chain;
  if (now) { queueWrite(); return chain; }
  saveT = setTimeout(function () { saveT = null; if (!final()) queueWrite(); }, 1200);
  return chain;
}
function queueWrite(timeoutMs) {
  var doc = snapshot(); S.rev += 1; doc.rev = S.rev;
  var p = chain.then(function () {
    return STORE.write(doc, !S.created, timeoutMs || 12000).then(function () {
      S.created = true; lastOk = true; persistLocal(); saveState();
    });
  });
  chain = p.catch(function (e) {
    lastOk = false; saveState();
    logEvent('save_fail', { code: String((e && e.code) || 'error').slice(0, 40) });
    persistLocal();
  });
  return p;
}
function saveState() {
  var el = $('#svst'); if (!el) return;
  el.hidden = lastOk;
  el.textContent = lastOk ? '' : '저장 대기 중 · 연결 확인';
}

/* ---------- 흐름 이동 ---------- */
function skipped(ix) { var st = FLOW[ix]; return !!(st && st.skip && st.skip()); }
function nextIdx(i) { var j = i + 1; while (j < FLOW.length && skipped(j)) j++; return j; }
function prevIdx(i) {
  var j = i - 1; while (j >= 0 && skipped(j)) j--;
  if (j < 0) return -1;
  var a = FLOW[j], b = FLOW[i];
  if (a.type !== 'q' || b.type !== 'q' || a.phase !== b.phase) return -1;
  return j;
}
function progress() {
  var tot = 0, done = 0;
  for (var k = 0; k < FLOW.length; k++) { if (skipped(k)) continue; tot++; if (k < S.i) done++; }
  return tot ? done / tot : 0;
}

/* ---------- 화면 그리기 ---------- */
var main = $('#main'), nextB = $('#next'), prevB = $('#prev');
function stageHTML(key, sm) {
  return '<button type="button" class="stage' + (sm ? ' sm' : '') + '" data-zoom="' + key + '" aria-label="광고 사진 크게 보기"><img src="' + imgSrc(key) + '" alt="광고 사진"><small>눌러서 크게 보기</small></button>';
}
function orderedOpts(st) {
  var o = st.opts, fixed = [], free = [];
  o.forEach(function (x) { ((x[2] || '').indexOf('fix') > -1 ? fixed : free).push(x); });
  if (!st.shuffle) return o;
  var key = st.id;
  if (!S.shuf[key]) { S.shuf[key] = shuffle(free).map(function (x) { return x[0]; }).concat(fixed.map(function (x) { return x[0]; })); }
  return S.shuf[key].map(function (v) { return o.filter(function (x) { return x[0] === v; })[0]; });
}
function isOn(st, v) { var a = S.ans[st.id]; return st.kind === 'multi' ? (Array.isArray(a) && a.indexOf(v) > -1) : a === v; }
function mineText(st) {
  var v = S.ans[st.id]; if (v === undefined) return '';
  var o = st.opts.filter(function (x) { return x[0] === v; })[0]; return o ? ('고른 답: ‘' + o[1] + '’') : '';
}
function otherVal(st) { var f = st.opts.filter(function (x) { return (x[2] || '').indexOf('other') > -1; })[0]; return f ? f[0] : null; }
function answered(st) {
  if (st.kind === 'text') return true;
  var a = S.ans[st.id];
  var ok = st.kind === 'multi' ? (Array.isArray(a) && a.length > 0) : (a !== undefined && a !== null);
  if (ok && st.conf) ok = S.ans[st.conf] !== undefined;
  return ok;
}
function updateNext(st) {
  nextB.disabled = !answered(st);
  var needConf = !!(st.conf && S.ans[st.id] !== undefined && S.ans[st.conf] === undefined);
  nextB.textContent = needConf ? '확신 정도 고르기' : ((st.id === 'M6') ? '제출하기' : '다음');
}
function renderQ(st) {
  var h = '';
  if (st.stage) h += stageHTML(st.stage, !!st.conf);
  if (st.chip) h += '<span class="chip">' + esc(st.chip) + '</span>';
  h += '<h1 class="q" tabindex="-1">' + esc(st.text) + '</h1>';
  if (st.hint) h += '<p class="hint">' + esc(st.hint) + '</p>';
  if (st.kind === 'text') {
    h += '<textarea id="ta" class="oth" maxlength="600" placeholder="여기에 적어 주세요(선택)">' + esc(S.ans[st.id] || '') + '</textarea>';
  } else {
    h += '<div class="opts" role="' + (st.kind === 'multi' ? 'group' : 'radiogroup') + '">';
    orderedOpts(st).forEach(function (x) {
      var on = isOn(st, x[0]);
      h += '<button type="button" class="opt' + (st.kind === 'multi' ? ' multi' : '') + (on ? ' on' : '') + '" data-v="' + x[0] + '" role="' + (st.kind === 'multi' ? 'checkbox' : 'radio') + '" aria-checked="' + on + '">' +
        '<span class="mk" aria-hidden="true"></span>' + (st.cards ? (x[2] && IMG_KEYS.indexOf(x[2]) > -1 ? '<img src="' + imgSrc(x[2]) + '" alt="">' : '') : '') + '<span class="tx">' + esc(x[1]) + '</span></button>';
    });
    h += '</div>';
    var ov = otherVal(st);
    if (ov !== null) {
      var show = isOn(st, ov);
      h += '<input id="oth" class="oth" type="text" maxlength="80" placeholder="직접 써 주세요" value="' + esc(S.ans[st.id + '_text'] || '') + '"' + (show ? '' : ' hidden') + '>';
    }
    if (st.conf) {
      var c = S.ans[st.conf], show2 = S.ans[st.id] !== undefined;
      h += '<div class="conf" id="conf"' + (show2 ? '' : ' hidden') + '><p class="mine" id="mine">' + esc(mineText(st)) + '</p><p>' + CONF_LABEL + '</p><div class="scale">';
      for (var n = 1; n <= 5; n++) h += '<button type="button" class="sc' + (c === n ? ' on' : '') + '" data-c="' + n + '" aria-label="' + n + '점">' + n + '</button>';
      h += '</div><div class="ends"><span>전혀 확실하지 않다</span><span>아주 확실하다</span></div></div>';
    }
  }
  main.innerHTML = h;
  nextB.textContent = (st.id === 'M6') ? '제출하기' : '다음';
  updateNext(st);
}
function renderConsent() {
  var h = '<h1 class="t" tabindex="-1">광고가 어떻게 보이는지 알려 주세요</h1>' +
    '<p class="lead">안녕하세요. 대학원 수업 프로젝트로, 휴대폰에서 자주 보는 광고가 어떻게 읽히고 있는지 알아보고 있습니다. 평소 휴대폰을 이용하시면서 접하셨던 광고를 떠올리며 각 질문에 편하게 답변해 주세요.</p>' +
    '<ul class="rules">' +
    '<li><b>소요시간 :</b> 약 15분</li>' +
    '<li><b>조사 목적 :</b> 모바일 광고 배너가 전하는 정보에 대한 인식과 이해도 파악</li>' +
    '<li><b>개인정보 안내 :</b> 응답 내용은 연구 목적으로만 활용되며, 개인을 식별할 수 있는 정보는 별도 동의 없이 수집하거나 공개하지 않습니다.</li></ul>' +
    '<p class="hint">바쁘신 가운데 설문에 참여해주셔서 감사합니다.</p>' +
    '<label class="agree"><input type="checkbox" id="agree"' + (S.agreed ? ' checked' : '') + '><span>위 내용을 읽었고 참여에 동의합니다.</span></label>' +
    '<div id="dbnote"></div>';
  main.innerHTML = h;
  nextB.textContent = '시작하기';
  dbNote();
}
function canStart() { return S.agreed && storeReady; }
function dbNote() {
  var el = $('#dbnote');
  if (FLOW[S.i] && FLOW[S.i].type === 'consent') nextB.disabled = !canStart();
  if (!el) return;
  if (storeErr) el.innerHTML = '<p class="note warn">지금은 응답을 저장할 수 없습니다. 인터넷 연결을 확인한 뒤 새로고침해 주세요.</p>';
  else if (!storeReady) el.innerHTML = '<p class="note">연결하는 중입니다…</p>';
  else el.innerHTML = '';
}
function renderInfo(st) {
  var again = S.notice;
  var h = '<h1 class="t" tabindex="-1">광고 사진 ' + st.pos + '/' + BANNERS.length + '</h1>' +
    (again ? '<p class="note warn">' + esc(again) + '</p>' : '') +
    '<p class="lead">아래 버튼을 누르면 광고 사진이 <b>' + S.expSec + '초</b> 동안 나타났다가 저절로 사라집니다.</p>' +
    '<p>눈에 들어오는 대로 편하게 보세요. 사라진 뒤에 기억나는 대로 물어봅니다. 사진이 나오는 동안은 다른 앱으로 나가지 말아 주세요.</p>';
  S.notice = '';
  main.innerHTML = h; nextB.textContent = '사진 보기'; nextB.disabled = false;
}

/* 노출: 이미지가 디코딩되어 화면에 그려진 뒤에 타이머를 시작한다.
 * 설정 시간(plannedMs)과 실제로 사진이 보인 시간(actualMs)을 따로 기록한다. */
function renderExposure(st) {
  var B = BANNERS[st.banner - 1], dur = S.expSec * 1000;
  stopTimer();
  var rec = {
    banner: st.banner, pos: FLOW.filter(function (f) { return f.type === 'exposure'; }).indexOf(st) + 1,
    attempt: S.exposures.filter(function (e) { return e.banner === st.banner; }).length + 1,
    plannedMs: dur, imgWaitMs: null, actualMs: null, outcome: 'loading', at: new Date().toISOString()
  };
  S.exposures.push(rec); if (S.exposures.length > 60) S.exposures = S.exposures.slice(-60);
  expRun = { rec: rec, st: st, t0: null };
  persistLocal();
  main.innerHTML = '<div class="big"><img alt="광고 사진" style="visibility:hidden"></div><div class="count"><div class="track"><i id="cbar"></i></div><b id="cnum">' + S.expSec + '</b></div><p class="hint" id="exphint" style="text-align:center">사진을 준비하고 있어요</p>';
  var img = main.querySelector('.big img'), bar = $('#cbar'), num = $('#cnum'), w0 = performance.now(), run = expRun;
  var failT = setTimeout(function () { fail(); }, CONFIG.imgTimeoutMs);
  function fail() {
    if (expRun !== run || run.t0 !== null) return;
    clearTimeout(failT);
    rec.outcome = 'img_error'; expRun = null; persistLocal();
    main.innerHTML = '<p class="note warn">사진을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.</p><button class="btn" type="button" id="expretry" style="width:100%">다시 시도</button>';
    $('#expretry').addEventListener('click', function () { renderExposure(st); });
  }
  var started = false, begun = false;
  function start() {
    if (started || expRun !== run) return;
    started = true;
    clearTimeout(failT);
    img.style.visibility = 'visible';
    /* 그려진 뒤 시작: requestAnimationFrame, 일부 환경에서 멈추면 200ms 뒤 시작 */
    var begin = function () {
      if (begun || expRun !== run) return; begun = true;
      run.t0 = performance.now(); rec.imgWaitMs = Math.round(run.t0 - w0); rec.outcome = 'showing'; rec.shownAt = new Date().toISOString(); persistLocal();
      $('#exphint').textContent = '곧 사진이 사라집니다';
      tm = setInterval(function () {
        var left = Math.max(0, dur - (performance.now() - run.t0));
        bar.style.transform = 'scaleX(' + (left / dur) + ')'; num.textContent = Math.ceil(left / 1000);
        if (left <= 0) {
          stopTimer();
          rec.actualMs = Math.round(performance.now() - run.t0); rec.outcome = 'completed'; expRun = null;
          go(nextIdx(S.i)); save();
        }
      }, 100);
    };
    requestAnimationFrame(begin); setTimeout(begin, 200);
  }
  /* 이미지가 실제로 불러와진 뒤 시작(onload 또는 decode 중 먼저 끝난 쪽) */
  img.onerror = fail;
  img.onload = function () { if (img.naturalWidth) start(); else fail(); };
  img.src = imgSrc(B.img);
  if (img.decode) img.decode().then(start, function () {});
}
function stopTimer() { if (tm) { clearInterval(tm); tm = null; } }
/* 노출을 중간에 끊고 안내 화면으로 되돌린다(다른 앱 이동, 새로고침). 다시 보면 반복 노출로 기록된다. */
function interruptExposure(reason, notice) {
  var st = FLOW[S.i]; if (!st || st.type !== 'exposure') return false;
  stopTimer();
  var last = S.exposures[S.exposures.length - 1];
  if (last && last.banner === st.banner && (last.outcome === 'loading' || last.outcome === 'showing')) {
    if (expRun && expRun.rec === last && expRun.t0 !== null) last.actualMs = Math.round(performance.now() - expRun.t0);
    last.outcome = reason;
  }
  expRun = null;
  var k = 's' + st.banner; S.restarts[k] = (S.restarts[k] || 0) + 1;
  logEvent('exposure_' + reason, { banner: st.banner });
  S.notice = notice;
  S.i = S.i - 1;
  return true;
}

function render() {
  var st = FLOW[S.i];
  window.scrollTo(0, 0);
  $('#pbar').style.width = Math.round(progress() * 100) + '%';
  $('#sec').textContent = S.test ? '테스트 · ' + (st.sec || '') : (st.sec || '');
  $('#quit').hidden = (st.type === 'consent' || st.type === 'end');
  var inExp = (st.type === 'exposure');
  $('#act').hidden = inExp || st.type === 'end';
  var pv = (st.type === 'q') ? prevIdx(S.i) : -1; prevB.hidden = (pv < 0);
  if (st.type === 'consent') renderConsent();
  else if (st.type === 'info') renderInfo(st);
  else if (st.type === 'exposure') renderExposure(st);
  else if (st.type === 'q') renderQ(st);
  var h = main.querySelector('h1'); if (h && !inExp) { try { h.focus({ preventScroll: true }); } catch (e) {} }
}
/* 화면별 응답 시간(ms). 다른 앱·탭에 가 있던 시간은 뺀다. 되돌아가 다시 답하면 누적. */
var T0 = 0, H0 = 0, hidAcc = 0, hidStart = null;
document.addEventListener('visibilitychange', function () {
  if (document.hidden) { hidStart = Date.now(); }
  else if (hidStart) { hidAcc += Date.now() - hidStart; hidStart = null; }
});
function markScreen() { T0 = Date.now(); H0 = hidAcc + (hidStart ? Date.now() - hidStart : 0); }
function tick(st) {
  if (!st || st.type !== 'q' || !T0) return;
  var now = Date.now(), hid = hidAcc + (hidStart ? now - hidStart : 0) - H0, d = now - T0 - hid;
  if (d < 0) d = 0;
  S.ms[st.id] = (S.ms[st.id] || 0) + d; T0 = 0;
}
function go(j) {
  if (j >= FLOW.length) { finish(); return; }
  S.i = j; persistLocal(); render(); markScreen();
}

/* ---------- 끝내기 ---------- */
/* 종료(완료·선별 탈락·그만하기)는 DB에 저장된 것을 서버에서 다시 읽어 확인한 뒤에만 안내한다. */
function code6() { return S.id.replace(/[^a-z0-9]/gi, '').slice(0, 6).toUpperCase(); }
var KIND = { complete: 'done', screened_out: 'screened', quit: 'quit' };
function terminate(status, reason) {
  stopTimer(); expRun = null;
  clearTimeout(saveT); saveT = null;
  S.status = status; S.endReason = reason || ''; S.finishedAt = new Date().toISOString(); S.verified = false;
  persistLocal();
  submitFinal();
}
var submitting = false;
function submitFinal() {
  if (submitting) return;
  submitting = true;
  $('#act').hidden = true; $('#quit').hidden = true; $('#pbar').style.width = '100%'; $('#sec').textContent = S.test ? '테스트' : '';
  main.innerHTML = '<h1 class="t" tabindex="-1">답을 저장하고 있습니다</h1><p class="lead">잠시만 기다려 주세요. 창을 닫지 말아 주세요.</p>';
  var write = storeReady ? queueWrite(20000).catch(function () {}) : Promise.resolve();
  write.then(function () { return storeReady ? STORE.verify(S.id, S.status) : false; })
    .then(function (ok) { return ok; }, function () { return false; })
    .then(function (ok) {
      submitting = false;
      if (ok) { S.verified = true; persistLocal(); endScreen(KIND[S.status]); }
      else { saveFailedScreen(); }
    });
}
function saveFailedScreen() {
  logEvent('final_save_fail'); persistLocal();
  var h = '<h1 class="t" tabindex="-1">아직 저장되지 않았습니다</h1>' +
    '<p class="lead">인터넷 연결을 확인한 뒤 ‘다시 시도’를 눌러 주세요. 답은 이 기기에 남아 있어서 창을 닫았다가 같은 링크로 다시 열어도 이어서 저장할 수 있습니다.</p>' +
    '<button class="btn" id="retry" type="button" style="width:100%">다시 시도</button>' +
    '<div class="mini" style="margin-top:18px"><button type="button" id="showcp">계속 안 되면: 답 내용 복사하기</button></div><div id="cpbox"></div>';
  main.innerHTML = h;
  var hh = main.querySelector('h1'); if (hh) hh.focus({ preventScroll: true });
  $('#retry').addEventListener('click', function () {
    if (!storeReady) { location.reload(); return; }
    submitFinal();
  });
  $('#showcp').addEventListener('click', function () {
    var txt = JSON.stringify(snapshot());
    $('#cpbox').innerHTML = '<p class="note warn">아래 내용을 복사해서 링크를 보내 드린 분께 보내 주세요.</p><textarea id="out" class="oth" readonly rows="5"></textarea><div style="margin-top:10px"><button class="btn" id="cp" type="button">내용 복사</button></div>';
    var ta = $('#out'); ta.value = txt;
    $('#cp').addEventListener('click', function () { copyText(txt, ta, $('#cp')); });
  });
}
function endScreen(kind) {
  stopTimer();
  $('#act').hidden = true; $('#quit').hidden = true; $('#pbar').style.width = '100%';
  var h = '';
  if (kind === 'screened') h = '<h1 class="t" tabindex="-1">참여해 주셔서 감사합니다</h1><p class="lead">이번 조사는 정해진 조건에 맞는 분들께만 진행하고 있어서, 여기서 마무리하겠습니다. 시간 내어 주셔서 정말 감사드립니다.</p>';
  else if (kind === 'quit') h = '<h1 class="t" tabindex="-1">그만두셨습니다</h1><p class="lead">참여해 주셔서 감사합니다. 지금까지의 답은 분석에서 제외됩니다.</p>' +
    '<div class="mini"><button type="button" id="restart">처음부터 다시 하기</button></div>';
  else {
    h = '<h1 class="t" tabindex="-1">모두 끝났습니다</h1><p class="lead">시간 내어 주셔서 감사합니다.</p>' +
      '<p class="hint">완료 번호</p><div class="code">' + esc(code6()) + '</div>' +
      '<p class="mini">사례를 약속받으셨다면 이 번호를 링크를 보내 드린 분께 알려 주세요.</p><p class="note">답이 저장되었습니다.</p>';
  }
  if (S.test && kind !== 'quit') h += '<div class="mini"><button type="button" id="restart">새 테스트 시작</button></div>';
  main.innerHTML = h; $('#sec').textContent = S.test ? '테스트' : '';
  var hh = main.querySelector('h1'); if (hh) hh.focus({ preventScroll: true });
  var rs = $('#restart'); if (rs) rs.addEventListener('click', function () { clearLocal(); location.reload(); });
}
function copyText(txt, ta, btn) {
  var ok = function () { btn.textContent = '복사했습니다'; };
  var fb = function () { try { ta.focus(); ta.select(); ta.setSelectionRange(0, txt.length); btn.textContent = '선택됨 · 길게 눌러 복사'; } catch (e) {} };
  try { navigator.clipboard.writeText(txt).then(ok, fb); } catch (e) { fb(); }
}
function finish() { terminate('complete', ''); }
function endNow(reason) { terminate('screened_out', reason); }
function quitNow() { terminate('quit', ''); }

/* ---------- 이벤트 ---------- */
main.addEventListener('click', function (e) {
  var st = FLOW[S.i]; if (!st || st.type !== 'q' || final()) return;
  var z = e.target.closest('[data-zoom]');
  if (z) { var lb = $('#lb'); lb.querySelector('img').src = imgSrc(z.getAttribute('data-zoom')); lb.hidden = false; return; }
  var o = e.target.closest('.opt');
  if (o) {
    var v = +o.getAttribute('data-v'), opt = st.opts.filter(function (x) { return x[0] === v; })[0], fl = (opt[2] || '');
    if (st.kind === 'single') { S.ans[st.id] = v; }
    else {
      var a = Array.isArray(S.ans[st.id]) ? S.ans[st.id].slice() : [], at = a.indexOf(v);
      if (at > -1) a.splice(at, 1);
      else {
        if (fl.indexOf('excl') > -1) a = [v];
        else {
          a = a.filter(function (x) { var xo = st.opts.filter(function (y) { return y[0] === x; })[0]; return (xo[2] || '').indexOf('excl') < 0; });
          a.push(v); if (st.max && a.length > st.max) a.shift();
        }
      }
      S.ans[st.id] = a;
    }
    var ov = otherVal(st);
    if (ov !== null && !isOn(st, ov)) delete S.ans[st.id + '_text'];
    main.querySelectorAll('.opt').forEach(function (b) {
      var on = isOn(st, +b.getAttribute('data-v')); b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
    });
    var oi = $('#oth'); if (oi) { oi.hidden = !isOn(st, ov); if (!oi.hidden && st.kind === 'single') oi.focus({ preventScroll: true }); }
    var mn = $('#mine'); if (mn) mn.textContent = mineText(st);
    var cf = $('#conf'); if (cf) { var was = cf.hidden; cf.hidden = false; if (was) { try { cf.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } catch (e2) {} } }
    updateNext(st); save(); return;
  }
  var sc = e.target.closest('.sc');
  if (sc) {
    S.ans[st.conf] = +sc.getAttribute('data-c');
    main.querySelectorAll('.sc').forEach(function (b) { b.classList.toggle('on', +b.getAttribute('data-c') === S.ans[st.conf]); });
    updateNext(st); save();
  }
});
main.addEventListener('input', function (e) {
  var st = FLOW[S.i]; if (final()) return;
  if (e.target.id === 'agree') { S.agreed = e.target.checked; nextB.disabled = !canStart(); persistLocal(); }
  else if (e.target.id === 'oth') { S.ans[st.id + '_text'] = e.target.value.slice(0, 80); save(); }
  else if (e.target.id === 'ta') { S.ans[st.id] = e.target.value.slice(0, 600); save(); }
});
main.addEventListener('change', function (e) { if (e.target.id === 'agree') { S.agreed = e.target.checked; nextB.disabled = !canStart(); persistLocal(); } });
nextB.addEventListener('click', function () {
  var st = FLOW[S.i]; if (final()) return;
  if (st.type === 'consent') {
    if (!canStart()) return;
    S.ans.consent = 1; S.startedAt = new Date().toISOString();
    S.i = nextIdx(S.i); persistLocal();
    /* 첫 저장(문서 생성)은 바로 보낸다. */
    save(true); render(); markScreen(); return;
  }
  if (st.type === 'info') { go(nextIdx(S.i)); return; }
  if (st.type !== 'q' || !answered(st)) return;
  tick(st);
  var v = S.ans[st.id];
  if (st.after) st.after(v);
  var r = st.end ? st.end(v) : '';
  if (r) { endNow(r + ':' + st.id); return; }
  if (nextIdx(S.i) >= FLOW.length) { finish(); return; }
  go(nextIdx(S.i)); save();
});
prevB.addEventListener('click', function () { var p = prevIdx(S.i); if (p >= 0) { tick(FLOW[S.i]); go(p); save(); } });
$('#quit').addEventListener('click', function () { $('#sheet').hidden = false; $('#cont').focus(); });
$('#cont').addEventListener('click', function () { $('#sheet').hidden = true; });
$('#stop').addEventListener('click', function () { $('#sheet').hidden = true; quitNow(); });
$('#lb').addEventListener('click', function () { $('#lb').hidden = true; });
document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { $('#lb').hidden = true; $('#sheet').hidden = true; } });
document.addEventListener('visibilitychange', function () {
  if (!S || final()) return;
  if (document.hidden) {
    /* 화면을 떠날 때 예약된 중간 저장을 바로 보낸다. */
    /* 노출 중 화면을 떠나면 그 순간 타이머를 멈추고 실제 표시 시간을 기록한다. 돌아오면 안내 화면부터 다시 보여 준다. */
    if (expRun && interruptExposure('hidden', '다른 앱으로 나가서 처음부터 사진을 다시 보여 드립니다.')) { render(); save(true); return; }
    if (saveT) save(true);
  }
});
window.addEventListener('pagehide', function () {
  if (!S || final()) return;
  if (saveT) save(true);
  persistLocal();
});

/* ---------- 시작 ---------- */
IMG_KEYS.forEach(function (k) { var im = new Image(); im.src = imgSrc(k); });
function boot() {
  var saved = loadLocal();
  S = saved || newState();
  FLOW = buildFlow(S.order, S);
  if (saved) {
    /* 링크가 바뀌어도 처음 들어온 모집 링크 값을 유지한다. 바뀐 값은 사건 기록에만 남긴다. */
    var lg = readLinkGroup();
    if (lg.linkGroupRaw !== S.linkGroupRaw) logEvent('link_changed', { raw: lg.linkGroupRaw });
    if (S.status !== 'in_progress') {
      if (S.verified) { endScreen(KIND[S.status]); return; }
      /* 종료했지만 저장 확인이 안 된 응답: 연결되면 다시 저장한다. */
      $('#act').hidden = true; $('#quit').hidden = true;
      main.innerHTML = '<h1 class="t" tabindex="-1">답을 저장하고 있습니다</h1><p class="lead">잠시만 기다려 주세요. 창을 닫지 말아 주세요.</p>';
      return;
    }
    logEvent('reload');
    /* 새로고침 처리: 노출 화면이었다면 노출을 끊은 것으로 보고 안내 화면부터 다시 보여 준다(반복 노출로 기록).
     * 사진을 가린 질문(A)·다시 보여 주는 질문(B)은 그 자리에서 이어서 답한다. */
    if (FLOW[S.i] && FLOW[S.i].type === 'exposure') {
      var lst = S.exposures[S.exposures.length - 1];
      if (lst && (lst.outcome === 'loading' || lst.outcome === 'showing')) lst.outcome = 'reload';
      var k = 's' + FLOW[S.i].banner; S.restarts[k] = (S.restarts[k] || 0) + 1;
      S.notice = '화면을 새로 열어서 처음부터 사진을 다시 보여 드립니다.';
      S.i = S.i - 1;
    }
    if (S.i >= FLOW.length) S.i = FLOW.length - 1;
  }
  persistLocal();
  render(); markScreen();
}
boot();

createStore().then(function (store) {
  STORE = store; storeReady = true; storeErr = '';
  if (S.status === 'in_progress') {
    dbNote();
    if (S.agreed && S.ans.consent === 1) save(true);
  } else if (!S.verified) submitFinal();
}, function (e) {
  storeErr = String((e && e.code) || (e && e.message) || 'error'); storeReady = false;
  dbNote();
  if (S.status !== 'in_progress' && !S.verified) saveFailedScreen();
});
