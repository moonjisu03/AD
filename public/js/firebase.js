/* Firebase 연결. 설정값은 저장소에 넣지 않는다.
 * - 배포된 Firebase Hosting: Hosting이 제공하는 /__/firebase/init.json 에서 웹 설정을 읽는다.
 * - 로컬(localhost·127.0.0.1): 에뮬레이터(demo-ad-survey 프로젝트)에 연결한다.
 * 웹 설정값은 비밀키가 아니다. 접근 통제는 Authentication과 firestore.rules가 맡는다. */
const V = '12.19.0';
const BASE = `https://www.gstatic.com/firebasejs/${V}/`;

export const IS_LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
export const DEMO_PROJECT = 'demo-ad-survey';

let ready = null;

export function initFirebase() {
  if (ready) return ready;
  ready = (async () => {
    const [appMod, authMod, fsMod] = await Promise.all([
      import(BASE + 'firebase-app.js'),
      import(BASE + 'firebase-auth.js'),
      import(BASE + 'firebase-firestore.js'),
    ]);
    let config;
    if (IS_LOCAL) {
      config = { apiKey: 'demo-api-key', projectId: DEMO_PROJECT, authDomain: DEMO_PROJECT + '.firebaseapp.com' };
    } else {
      const res = await fetch('/__/firebase/init.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('firebase-config');
      config = await res.json();
    }
    const app = appMod.initializeApp(config);
    const auth = authMod.getAuth(app);
    const db = fsMod.getFirestore(app);
    if (IS_LOCAL) {
      const host = location.hostname === '[::1]' ? '127.0.0.1' : location.hostname;
      authMod.connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
      fsMod.connectFirestoreEmulator(db, host, 8080);
    }
    return { app, auth, db, authMod, fsMod, local: IS_LOCAL };
  })();
  return ready;
}
