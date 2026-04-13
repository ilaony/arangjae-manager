# 🏠 호스텔 매니저 - 설치 및 배포 가이드

## 📁 프로젝트 구조
```
hostel-project/
├── index.html
├── package.json
├── vite.config.js
├── .gitignore
└── src/
    ├── main.jsx
    ├── App.jsx          ← 메인 앱 (UI 전체)
    ├── firebase.js       ← Firebase 설정 (⚠️ 수정 필요)
    └── useFirestore.js   ← Firebase 실시간 데이터 훅
```

---

## 1단계: Firebase 프로젝트 생성

1. https://console.firebase.google.com 접속 (Google 계정 로그인)
2. **"프로젝트 추가"** 클릭 → 이름: `hostel-manager` → 만들기
3. Google Analytics는 비활성화해도 됨 (선택사항)

### Firestore 데이터베이스 만들기
4. 왼쪽 메뉴 → **"빌드"** → **"Firestore Database"**
5. **"데이터베이스 만들기"** 클릭
6. **"테스트 모드에서 시작"** 선택 → 위치: `asia-northeast3` (서울) → 만들기

> ⚠️ 테스트 모드는 30일 후 만료됩니다. 배포 후 아래 보안 규칙 섹션을 참고하세요.

### 웹 앱 등록
7. 프로젝트 메인 화면 → **톱니바퀴(설정)** → **"일반"** 탭
8. 하단 **"내 앱"** 섹션 → **웹 아이콘 `</>`** 클릭
9. 앱 닉네임: `hostel-web` → **"앱 등록"**
10. 화면에 나오는 `firebaseConfig` 값을 복사

### firebase.js 수정
11. `src/firebase.js` 파일을 열고 복사한 값으로 교체:
```js
const firebaseConfig = {
  apiKey: "AIzaSy...",           // 실제 값으로 교체
  authDomain: "hostel-manager-xxxxx.firebaseapp.com",
  projectId: "hostel-manager-xxxxx",
  storageBucket: "hostel-manager-xxxxx.firebasestorage.app",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

---

## 2단계: 로컬에서 실행

```bash
# 프로젝트 폴더로 이동
cd hostel-project

# 패키지 설치
npm install

# 개발 서버 시작
npm run dev
```

브라우저에서 `http://localhost:5173` 접속 → 앱이 실행됩니다!

---

## 3단계: Vercel 배포 (무료)

### GitHub에 올리기
```bash
# Git 초기화
git init
git add .
git commit -m "호스텔 매니저 초기 버전"

# GitHub에서 새 저장소 생성 후
git remote add origin https://github.com/YOUR_USERNAME/hostel-manager.git
git branch -M main
git push -u origin main
```

### Vercel 연동
1. https://vercel.com 접속 → GitHub 계정으로 로그인
2. **"New Project"** → GitHub 저장소 `hostel-manager` 선택
3. Framework: **Vite** 자동 감지됨
4. **"Deploy"** 클릭 → 1~2분 후 배포 완료!
5. `https://hostel-manager-xxxx.vercel.app` 같은 URL이 생성됨

> PC와 모바일 모두 이 URL로 접속하면 됩니다.

---

## 4단계: Firestore 보안 규칙 (중요!)

테스트 모드 만료 전에 보안 규칙을 설정하세요.

Firebase Console → Firestore → **"규칙"** 탭:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // 모든 컬렉션에 읽기/쓰기 허용 (2~3명 내부 사용)
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

> 이 규칙은 URL을 아는 사람은 누구나 접근 가능합니다.
> 2~3명 내부 사용에는 충분하지만, 외부 공개는 권장하지 않습니다.
> 더 안전하게 하려면 Firebase Authentication을 추가할 수 있습니다.

---

## 🔧 유용한 명령어

```bash
npm run dev      # 로컬 개발 서버
npm run build    # 프로덕션 빌드
npm run preview  # 빌드 결과 미리보기
```

---

## 💡 참고사항

- **실시간 동기화**: 한 기기에서 예약을 추가하면 다른 기기에서 자동으로 반영됩니다.
- **무료 한도**: Firebase 무료 티어는 일 읽기 50,000회, 쓰기 20,000회로 2~3명 사용에 충분합니다.
- **커스텀 도메인**: Vercel에서 본인 소유 도메인을 연결할 수 있습니다.
