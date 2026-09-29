import { initializeApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDH1MxY5NGtem43kHunP-ObtViG0TDP8r4",
  authDomain: "arangjae-manager.firebaseapp.com",
  projectId: "arangjae-manager",
  storageBucket: "arangjae-manager.firebasestorage.app",
  messagingSenderId: "730719943602",
  appId: "1:730719943602:web:0330177f91f4e9f77882ab",
  measurementId: "G-1FMQZTEMSC",
};

const app = initializeApp(firebaseConfig);

// IndexedDB 영속 캐시: 전송 전에 앱이 종료돼도 대기 중인 쓰기가 살아남아
// 다음 실행 때 재전송된다. (기본값인 메모리 캐시는 종료 시 유실)
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({
    tabManager: persistentMultipleTabManager(),
  }),
});
