/**
 * 아랑재 예약 메일 → /api/notify 전달 (Google Apps Script)
 *
 * 휴대폰 알림(MacroDroid)이 빠졌을 때의 보완책이다. 5분마다 Gmail에서 예약 메일을 찾아
 * Vercel 함수로 보낸다. 같은 건이 알림과 메일로 두 번 가도 함수가 예약번호로 중복을 막는다.
 *
 * 보내는 메일:
 *   에어비앤비  예약 확정 / 취소됨 / 예약 변경 완료
 *   부킹닷컴    취소된 예약 안내
 *
 * 설치 (ilaony@gmail.com 계정으로):
 *   1. script.google.com → 새 프로젝트 → 이 파일 내용을 Code.gs에 붙여넣기
 *   2. 프로젝트 설정(톱니바퀴) → 스크립트 속성 추가
 *        NOTIFY_URL     https://arangjae-manager.vercel.app/api/notify
 *        NOTIFY_SECRET  Vercel의 NOTIFY_SECRET과 같은 값
 *   3. 편집기 위쪽에서 함수 `setup`을 골라 실행 → Gmail 읽기·외부 요청 권한 허용
 *      (5분마다 `run`이 돌도록 트리거가 만들어진다)
 *   4. 실행 기록(왼쪽 메뉴 "실행")에서 오류가 없는지 확인
 */

const QUERY =
  'newer_than:2d (' +
  '(from:airbnb.com (subject:"예약 확정" OR subject:"취소됨" OR subject:"예약 변경 완료")) OR ' +
  '(from:booking.com subject:"취소된 예약 안내")' +
  ')';
const SUBJECT_OK = /^(예약 확정 -|취소됨:|예약 변경 완료 -|Booking\.com - 취소된 예약 안내!)/;
const KEEP_IDS = 300; // 처리한 메일 ID를 이만큼 기억한다 (스크립트 속성 9KB 한도 안)

function setup() {
  ScriptApp.getProjectTriggers()
    .filter((t) => t.getHandlerFunction() === 'run')
    .forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('run').timeBased().everyMinutes(5).create();
  run();
}

function run() {
  const props = PropertiesService.getScriptProperties();
  const url = props.getProperty('NOTIFY_URL');
  const secret = props.getProperty('NOTIFY_SECRET');
  if (!url || !secret) throw new Error('스크립트 속성 NOTIFY_URL / NOTIFY_SECRET이 없습니다');

  const done = JSON.parse(props.getProperty('DONE_IDS') || '[]');
  const fails = JSON.parse(props.getProperty('FAIL_COUNTS') || '{}'); // 같은 메일은 3번까지만 다시 보낸다
  const seen = new Set(done);
  const cutoff = Date.now() - 2 * 24 * 3600 * 1000;

  // 메일이 없으면 검색 한 번으로 끝난다 (실행 시간 한도 절약)
  const threads = GmailApp.search(QUERY, 0, 50);
  for (const thread of threads) {
    // Gmail은 제목이 같은 메일(예: 예약 변경 완료)을 한 스레드로 묶으므로 메시지마다 본다
    for (const msg of thread.getMessages()) {
      const id = msg.getId();
      if (seen.has(id) || msg.getDate().getTime() < cutoff) continue;
      const subject = msg.getSubject();
      if (!SUBJECT_OK.test(subject)) { seen.add(id); done.push(id); continue; }

      const res = UrlFetchApp.fetch(url, {
        method: 'post',
        contentType: 'application/json',
        muteHttpExceptions: true,
        payload: JSON.stringify({
          secret: secret,
          source: 'mail',
          from: msg.getFrom(),
          subject: subject,
          body: msg.getPlainBody().slice(0, 4000),
        }),
      });
      const code = res.getResponseCode();
      if (code === 401) throw new Error('비밀값이 맞지 않습니다 (NOTIFY_SECRET 확인)');
      if (code !== 200) {
        fails[id] = (fails[id] || 0) + 1;
        console.warn(`${code} ${subject} — 실패 ${fails[id]}회`);
        if (fails[id] < 3) continue; // 다음 실행 때 다시 보냄
      }
      if (code === 200) console.log(`${subject} → ${res.getContentText().slice(0, 200)}`);
      seen.add(id);
      done.push(id);
    }
  }
  props.setProperty('DONE_IDS', JSON.stringify(done.slice(-KEEP_IDS)));
  for (const k of Object.keys(fails)) if (seen.has(k)) delete fails[k];
  props.setProperty('FAIL_COUNTS', JSON.stringify(fails));
}
