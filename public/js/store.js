/* 응답 저장소. 참여자는 회원가입 없이 익명 인증으로 구분한다(응답 소유자 = 익명 uid).
 * 익명 uid는 같은 브라우저에서 유지될 뿐, '실제 한 사람당 한 번 참여'를 보장하지 않는다. */
import { initFirebase } from './firebase.js';

function timeout(p, ms) {
  return new Promise(function (resolve, reject) {
    var t = setTimeout(function () { var e = new Error('timeout'); e.code = 'timeout'; reject(e); }, ms);
    p.then(function (v) { clearTimeout(t); resolve(v); }, function (e) { clearTimeout(t); reject(e); });
  });
}

export async function createStore() {
  const { auth, db, authMod, fsMod } = await initFirebase();
  const { doc, runTransaction, updateDoc, getDocFromServer, serverTimestamp } = fsMod;
  await auth.authStateReady();
  if (!auth.currentUser) await timeout(authMod.signInAnonymously(auth), 15000);
  const uid = auth.currentUser.uid;

  return {
    uid,
    /* create=true: 문서가 아직 확인되지 않은 상태. 트랜잭션으로 있으면 갱신, 없으면 생성한다.
     * 트랜잭션은 오프라인이면 바로 실패하므로 연결 끊김을 알 수 있다. */
    write(data, create, ms) {
      const ref = doc(db, 'responses', data.id);
      let p;
      if (create) {
        p = runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (snap.exists()) tx.update(ref, Object.assign({}, data, { serverUpdatedAt: serverTimestamp() }));
          else tx.set(ref, Object.assign({}, data, { uid, serverCreatedAt: serverTimestamp(), serverUpdatedAt: serverTimestamp() }));
        }, { maxAttempts: 2 });
      } else {
        p = updateDoc(ref, Object.assign({}, data, { serverUpdatedAt: serverTimestamp() }));
      }
      return timeout(p, ms || 12000);
    },
    /* 서버에서 다시 읽어 종료 상태가 실제로 저장됐는지 확인한다(캐시 사용 안 함). */
    async verify(id, status) {
      const snap = await timeout(getDocFromServer(doc(db, 'responses', id)), 12000);
      return snap.exists() && snap.data().status === status && snap.data().uid === uid;
    },
  };
}
