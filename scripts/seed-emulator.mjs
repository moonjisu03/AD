// 로컬 에뮬레이터 전용: 테스트 관리자 계정을 만들고 admins/{uid}에 등록한다.
// 실제 Firebase 프로젝트에는 연결하지 않는다(demo- 프로젝트, localhost 에뮬레이터만).
//   npm run dev   (다른 터미널)
//   npm run seed
const PROJECT = 'demo-ad-survey';
const AUTH = 'http://127.0.0.1:9099';
const FS = 'http://127.0.0.1:8080';
// 에뮬레이터 전용 테스트 값. 실제 계정 비밀번호로 쓰지 말 것.
const EMAIL = process.env.SEED_ADMIN_EMAIL || 'admin@example.test';
const PASSWORD = process.env.SEED_ADMIN_PASSWORD || 'emulator-only-pass';

async function j(res) { const t = await res.text(); try { return JSON.parse(t); } catch { return t; } }

let r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-api-key`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
});
let body = await j(r);
if (!r.ok) {
  r = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-api-key`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true }),
  });
  body = await j(r);
  if (!r.ok) { console.error('관리자 계정 생성 실패', body); process.exit(1); }
}
const uid = body.localId;
r = await fetch(`${FS}/v1/projects/${PROJECT}/databases/(default)/documents/admins/${uid}`, {
  method: 'PATCH', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer owner' },
  body: JSON.stringify({ fields: { note: { stringValue: 'emulator seed admin' } } }),
});
if (!r.ok) { console.error('admins 문서 생성 실패', await j(r)); process.exit(1); }
console.log(`에뮬레이터 관리자 등록 완료: ${EMAIL} (uid ${uid}). 비밀번호는 scripts/seed-emulator.mjs 참고.`);
