// Firestore 보안 규칙 허용·거부 테스트. Firestore 에뮬레이터에서만 실행한다.
//   npm run test:rules
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, serverTimestamp, runTransaction,
} from 'firebase/firestore';

let env;
const RID = 'resp-0000-aaaa';
const OTHER = 'resp-1111-bbbb';

function base(uid, over = {}) {
  return {
    id: RID, uid, surveyVersion: '2026-11-v1', rev: 1, status: 'in_progress', endReason: '', test: false, consent: true,
    linkGroup: 'none', linkGroupRaw: '', ageGroup: '', groupMismatch: false, cond: false, order: [1, 2, 3], orderSrc: 'random',
    expSec: 10, vw: 390, vh: 844, openedAt: '2026-11-11T00:00:00.000Z', startedAt: '2026-11-11T00:00:01.000Z',
    updatedAt: '2026-11-11T00:00:02.000Z', finishedAt: '', ans: { consent: 1 }, ms: {}, optOrder: {},
    exposures: [], restarts: {}, events: [],
    serverCreatedAt: serverTimestamp(), serverUpdatedAt: serverTimestamp(),
    ...over,
  };
}
// 갱신용: 서버가 채운 serverCreatedAt은 보내지 않는다(updateDoc)
function upd(over = {}) {
  const d = base('ignored', over);
  delete d.uid; delete d.serverCreatedAt;
  return { ...d, serverUpdatedAt: serverTimestamp(), ...over };
}

const alice = () => env.authenticatedContext('alice', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const bob = () => env.authenticatedContext('bob', { firebase: { sign_in_provider: 'anonymous' } }).firestore();
const admin = () => env.authenticatedContext('admin1', { email: 'admin@example.test' }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-ad-survey',
    firestore: { rules: readFileSync(new URL('../../firestore.rules', import.meta.url), 'utf8') },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'admins/admin1'), { note: 'test admin' });
    await setDoc(doc(db, 'responses', OTHER), { ...base('bob', { id: OTHER }), serverCreatedAt: new Date(), serverUpdatedAt: new Date() });
  });
});

async function aliceCreates(over = {}) {
  await assertSucceeds(setDoc(doc(alice(), 'responses', RID), base('alice', over)));
}

// ---------- 비로그인 ----------
test('비로그인: 응답 읽기·목록·쓰기 모두 거부', async () => {
  const db = anon();
  await assertFails(getDoc(doc(db, 'responses', OTHER)));
  await assertFails(getDocs(collection(db, 'responses')));
  await assertFails(setDoc(doc(db, 'responses', RID), base('alice')));
  await assertFails(getDoc(doc(db, 'admins/admin1')));
});

// ---------- 참여자 생성 ----------
test('참여자: 자기 응답 생성 허용', async () => { await aliceCreates(); });

test('참여자: 다른 uid를 소유자로 넣어 생성 거부(소유자 위조)', async () => {
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('bob')));
});
test('참여자: 문서 ID와 id 필드 불일치 거부', async () => {
  await assertFails(setDoc(doc(alice(), 'responses', 'resp-zzzz-zzzz'), base('alice')));
});
test('참여자: 공통 링크(none)와 예전 링크(young·older)·잘못된 값(unknown) 생성 허용', async () => {
  for (const g of ['none', 'young', 'older', 'unknown']) {
    await env.clearFirestore();
    await aliceCreates({ linkGroup: g, linkGroupRaw: g === 'none' ? '' : g });
  }
});
test('참여자: 동의 없이 생성 거부', async () => {
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { consent: false })));
});
test('참여자: 허용되지 않은 필드(isAdmin, role) 추가 거부', async () => {
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { isAdmin: true })));
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { role: 'admin' })));
});
test('참여자: 잘못된 타입·값 거부', async () => {
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { status: 'hacked' })));
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { linkGroup: 'admin' })));
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { rev: '1' })));
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { expSec: 0 })));
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { order: [1, 2] })));
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { test: 'no' })));
});
test('참여자: 자유입력 길이 초과 거부, 제한 이내 허용', async () => {
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { ans: { consent: 1, M6: 'x'.repeat(601) } })));
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { ans: { consent: 1, s2_A2_text: 'x'.repeat(81) } })));
  await aliceCreates({ ans: { consent: 1, M6: 'x'.repeat(600), s2_A2_text: 'y'.repeat(80) } });
});
test('참여자: 서버 시각 대신 임의 시각 넣으면 거부', async () => {
  await assertFails(setDoc(doc(alice(), 'responses', RID), base('alice', { serverUpdatedAt: new Date('2020-01-01') })));
});

// ---------- 참여자 읽기 ----------
test('참여자: 자기 응답 읽기 허용, 남의 응답 읽기 거부', async () => {
  await aliceCreates();
  await assertSucceeds(getDoc(doc(alice(), 'responses', RID)));
  await assertFails(getDoc(doc(alice(), 'responses', OTHER)));
});
test('참여자: 없는 문서 존재 확인 허용(첫 저장용)', async () => {
  await assertSucceeds(getDoc(doc(alice(), 'responses', 'resp-none-0000')));
});
test('참여자: 전체 목록 조회 거부(자기 uid로 걸러도 거부)', async () => {
  await aliceCreates();
  await assertFails(getDocs(collection(alice(), 'responses')));
  await assertFails(getDocs(query(collection(alice(), 'responses'), where('uid', '==', 'alice'))));
});

// ---------- 참여자 수정 ----------
test('참여자: 진행 중인 자기 응답 갱신 허용(rev 증가)', async () => {
  await aliceCreates();
  await assertSucceeds(updateDoc(doc(alice(), 'responses', RID), upd({ rev: 2, ans: { consent: 1, Q1: 1 } })));
});
test('참여자: rev가 늘지 않은 늦은 저장 거부', async () => {
  await aliceCreates();
  await assertSucceeds(updateDoc(doc(alice(), 'responses', RID), upd({ rev: 5 })));
  await assertFails(updateDoc(doc(alice(), 'responses', RID), upd({ rev: 4 })));
  await assertFails(updateDoc(doc(alice(), 'responses', RID), upd({ rev: 5 })));
});
test('참여자: 소유자·모집 링크·배너 순서·테스트 표시 변경 거부', async () => {
  await aliceCreates();
  const r = doc(alice(), 'responses', RID);
  await assertFails(updateDoc(r, { ...upd({ rev: 2 }), uid: 'bob' }));
  await assertFails(updateDoc(r, upd({ rev: 2, linkGroup: 'older' })));
  await assertFails(updateDoc(r, upd({ rev: 2, order: [3, 1, 2] })));
  await assertFails(updateDoc(r, upd({ rev: 2, test: true })));
  await assertFails(updateDoc(r, upd({ rev: 2, surveyVersion: 'x' })));
});
test('참여자: 남의 응답 수정·삭제 거부', async () => {
  await assertFails(updateDoc(doc(alice(), 'responses', OTHER), upd({ id: OTHER, rev: 9 })));
  await assertFails(deleteDoc(doc(alice(), 'responses', OTHER)));
});
test('참여자: 남의 응답 문서를 setDoc으로 덮어쓰기 거부', async () => {
  await assertFails(setDoc(doc(alice(), 'responses', OTHER), base('alice', { id: OTHER, rev: 99 })));
});
test('참여자: 자기 응답 삭제 거부', async () => {
  await aliceCreates();
  await assertFails(deleteDoc(doc(alice(), 'responses', RID)));
});
test('참여자: 완료로 바꾸기 허용, 완료 뒤 수정 거부', async () => {
  await aliceCreates();
  const r = doc(alice(), 'responses', RID);
  await assertFails(updateDoc(r, upd({ rev: 2, status: 'complete', finishedAt: '' })));
  await assertSucceeds(updateDoc(r, upd({ rev: 2, status: 'complete', finishedAt: '2026-11-11T00:20:00.000Z' })));
  await assertFails(updateDoc(r, upd({ rev: 3, status: 'complete', finishedAt: '2026-11-11T00:20:00.000Z', ans: { consent: 1, Q1: 2 } })));
  await assertFails(updateDoc(r, upd({ rev: 3, status: 'in_progress' })));
});
test('참여자: 선별 탈락·그만하기 뒤 수정 거부', async () => {
  for (const st of ['screened_out', 'quit']) {
    await env.clearFirestore();
    await aliceCreates();
    const r = doc(alice(), 'responses', RID);
    await assertSucceeds(updateDoc(r, upd({ rev: 2, status: st, finishedAt: '2026-11-11T00:05:00.000Z' })));
    await assertFails(updateDoc(r, upd({ rev: 3, status: 'in_progress' })));
  }
});
test('참여자: 처음 저장부터 완료 상태로 생성 허용(중간 저장이 모두 실패한 경우)', async () => {
  await aliceCreates({ status: 'complete', finishedAt: '2026-11-11T00:20:00.000Z' });
});
test('참여자: 앱이 쓰는 트랜잭션 방식(존재 확인 후 생성) 허용', async () => {
  const db = alice();
  await assertSucceeds(runTransaction(db, async (tx) => {
    const ref = doc(db, 'responses', RID);
    const s = await tx.get(ref);
    if (!s.exists()) tx.set(ref, base('alice'));
  }));
});

// ---------- 관리자 권한 ----------
test('참여자: admins 문서 생성으로 관리자 권한 부여 거부', async () => {
  await assertFails(setDoc(doc(alice(), 'admins/alice'), { note: 'me' }));
  await assertFails(getDocs(collection(alice(), 'responses')));
});
test('참여자: 다른 사람의 admins 문서 조회 거부, 자기 것은 확인 가능', async () => {
  await assertFails(getDoc(doc(alice(), 'admins/admin1')));
  await assertSucceeds(getDoc(doc(alice(), 'admins/alice')));
});
test('관리자: 전체 응답 목록·개별 조회 허용', async () => {
  await aliceCreates();
  await assertSucceeds(getDocs(collection(admin(), 'responses')));
  await assertSucceeds(getDoc(doc(admin(), 'responses', RID)));
});
test('관리자: 응답 수정·삭제와 admins 변경 거부(읽기 전용)', async () => {
  await assertFails(updateDoc(doc(admin(), 'responses', OTHER), { status: 'complete' }));
  await assertFails(deleteDoc(doc(admin(), 'responses', OTHER)));
  await assertFails(setDoc(doc(admin(), 'admins/eve'), { note: 'x' }));
});
test('관리자 아님: 이메일 계정이라도 admins 문서가 없으면 목록 거부', async () => {
  const db = env.authenticatedContext('eve', { email: 'eve@example.test' }).firestore();
  await assertFails(getDocs(collection(db, 'responses')));
});
test('그 밖의 컬렉션 접근 거부', async () => {
  await assertFails(setDoc(doc(alice(), 'other/x'), { a: 1 }));
  await assertFails(getDoc(doc(admin(), 'other/x')));
});
