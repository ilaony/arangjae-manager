// node scripts/test-notify.mjs — 텔레그램에 쌓인 실제 알림 문구로 api/_notify-lib.js 를 검증한다.
import assert from "node:assert/strict";
import { handle, parse, propFromName, AUTO_MEMO } from "../api/_notify-lib.js";

function fakeIo({ bookings = {}, cleaning = {}, ical = {} }) {
  const db = { bookings: structuredClone(bookings), cleaning: structuredClone(cleaning), inbox: {}, log: {} };
  for (const p of ["arangjae-ara", "arangjae-maru", "daol"]) { db.bookings[p] ||= []; db.cleaning[p] ||= {}; }
  return {
    db,
    listBookings: async (p) => db.bookings[p],
    getCleaning: async (p, d) => db.cleaning[p][d] || null,
    cleaningExists: async (p, d) => !!db.cleaning[p][d],
    commitAdd: async (p, doc, withCleaning) => {
      db.bookings[p] = [...db.bookings[p], doc];
      if (withCleaning) db.cleaning[p][doc.checkOut] = { status: "scheduled", auto: true, cleaner: "", memo: "" };
    },
    commitDelete: async (p, b, c) => {
      db.bookings[p] = db.bookings[p].filter((x) => x !== b);
      if (c) delete db.cleaning[p][b.checkOut];
    },
    getInbox: async (k) => db.inbox[k] || null,
    putInbox: async (k, o) => { db.inbox[k] = o; },
    wasCancelled: async (n) => !!db.log[n],
    markCancelled: async (n) => { db.log[n] = true; },
    ical: async (p) => ical[p] || [],
  };
}

const B = (s) => ({ app: "Booking.com", message: s });
const A = (s) => ({ app: "Airbnb", message: s });

// ── 숙소 판별 ──
assert.equal(propFromName("[아라]광장시장/청계천/명동"), "arangjae-ara");
assert.equal(propFromName("[마루]신축 엘리베이터/독립 욕실2개"), "arangjae-maru");
assert.equal(propFromName("[Gangnam/3BR·2BA] 복층 독채 5베드｜교대·강남·고속터미널"), "daol");
assert.equal(propFromName("넓은 3룸 / 강남역"), "daol");
assert.equal(propFromName("다올스테이 신축"), "daol");
assert.equal(propFromName("Three-Bedroom Apartment"), "daol");
assert.equal(propFromName("2층 아라"), "arangjae-ara");
assert.equal(propFromName("3층 마루"), "arangjae-maru");
assert.equal(propFromName("[마루] 강남 근처"), "arangjae-maru"); // 대괄호 표시가 먼저
assert.equal(propFromName("새 리스팅 이름"), null);

// ── 해석 ──
let p = parse(B("신규 예약: 2027년 1월 17일 (일)부터 2박 //#6933350473 1 x 2층 아라<br> 총 요금: KRW 536000.00"));
assert.deepEqual([p.kind, p.bookNumber, p.checkIn, p.checkOut, p.rooms], ["booking-new", "6933350473", "2027-01-17", "2027-01-19", ["2층 아라"]]);
p = parse(B("신규 예약: 2026년 12월 31일 (목)부터 4박 //#5423704785 1 x 2층 아라<br> 총 요금: KRW 1646000.00"));
assert.equal(p.checkOut, "2027-01-04"); // 해 넘김
p = parse(B("신규 예약: 2026년 12월 27일 (일)부터 3박 //#5764975554 1 x Three-Bedroom Apartment<br> 총 요금: KRW 546000.00"));
assert.equal(propFromName(p.rooms[0]), "daol");
p = parse(B("취소//#6266685684 (Ying Ding) <br>1 x Three-Bedroom Apartment"));
assert.deepEqual([p.kind, p.bookNumber, p.guestName, p.rooms], ["booking-cancel", "6266685684", "Ying Ding", ["Three-Bedroom Apartment"]]);
p = parse(B("SUMIRE ONODERA 님의 메시지//おはようございます。"));
assert.equal(p.kind, "ignore");
p = parse(B("일간 보고서 (Daol Stay).esc//당일 현황 업데이트를 여기서 확인하실 수 있습니다."));
assert.equal(p.kind, "ignore");

p = parse(A("凝悦님이 예약하셨습니다.//凝悦님이 2027년 1월 29일~31일에 호스트님의 숙소를 예약했습니다."));
assert.deepEqual([p.kind, p.guestName, p.checkIn, p.checkOut], ["airbnb-notice", "凝悦", "2027-01-29", "2027-01-31"]);
p = parse(A("지현님이 예약하셨습니다.//지현님이 2026년 12월 4일~6일에 호스트님의 숙소를 예약했습니다."));
assert.equal(p.key, "abnb_12-04_12-06");
p = parse(A("12월 4일~6일 • [Gangnam/3BR·2BA] 복층 독채 5베드｜교대·강남·고속터미널: 소피//지현님 안녕하세요. 저희 숙소에 예약해주셔서 진심으로 감사드려요."));
assert.deepEqual([p.kind, p.guestName, p.prop, p.key], ["airbnb-reply", "지현", "daol", "abnb_12-04_12-06"]);
p = parse(A("2027년 2월 11일~14일 • [마루]신축 엘리베이터/독립 욕실2개/명동/광장시장/넓은 가족실/짐보관가능: 라일라//Angela 님, 안녕하세요. 저희 숙소를 예약해주셔서 진심으로 감사드려요."));
assert.deepEqual([p.guestName, p.prop], ["Angela", "arangjae-maru"]);
p = parse(A("Erika님이 2026년 12월 31일 ~ 2027년 1월 2일에 호스트님의 숙소를 예약했습니다."));
assert.equal(p.kind, "ignore"); // 제목 없이 본문만 온 경우는 무시
p = parse(A("David님이 예약하셨습니다.//David님이 2026년 12월 31일 ~ 2027년 1월 2일에 호스트님의 숙소를 예약했습니다."));
assert.deepEqual([p.checkIn, p.checkOut], ["2026-12-31", "2027-01-02"]);
p = parse(A("11월 21일~23일 • [마루]신축 엘리베이터: 娇//혹시 쓰레기가 있으면 아래층의 큰 쓰레기통에 버리면 되나요?"));
assert.equal(p.kind, "ignore"); // 게스트 메시지
p = parse(A("11월 16일~20일 • [마루]신축: 라일라//안녕하세요 체크인 시간은 오후 4시 이후입니다. 예약하신 객실 비밀번호는 0000*입니다."));
assert.equal(p.kind, "ignore"); // 체크인 안내(예약 감사 인사 아님)
p = parse(A("예약 알림//娇님이 8일 후 도착합니다."));
assert.equal(p.kind, "ignore");

// ── 부킹닷컴 신규 → 추가 ──
let io = fakeIo({ bookings: { "arangjae-ara": [{ checkIn: "2027-01-15", checkOut: "2027-01-17", bookNumber: "6445700823", guestName: "Hong-Ming Chen" }] } });
let r = await handle(io, B("신규 예약: 2027년 1월 17일 (일)부터 2박 //#6933350473 1 x 2층 아라<br> 총 요금: KRW 536000.00"));
assert.equal(r.action, "added", r.note);
let added = io.db.bookings["arangjae-ara"].find((b) => b.bookNumber === "6933350473");
assert.deepEqual([added.guestName, added.guests, added.nationality, added.memo, added.channel], ["확인 필요", 0, "기타", AUTO_MEMO, "booking"]);
assert.ok(io.db.cleaning["arangjae-ara"]["2027-01-19"]);
r = await handle(io, B("신규 예약: 2027년 1월 17일 (일)부터 2박 //#6933350473 1 x 2층 아라<br> 총 요금: KRW 536000.00"));
assert.equal(r.action, "skip"); // 같은 알림이 또 와도 중복 없음
r = await handle(io, B("신규 예약: 2027년 1월 16일 (토)부터 2박 //#5000000001 1 x 2층 아라<br> 총 요금: KRW 1"));
assert.equal(r.action, "stop"); // 겹침
r = await handle(io, B("신규 예약: 2027년 3월 1일 (월)부터 2박 //#5000000002 1 x 2층 아라, 1 x 3층 마루<br> 총 요금: KRW 1"));
assert.equal(r.action, "stop"); // 두 객실

// ── 부킹닷컴 취소 → 삭제 (담당자가 있어도 청소 삭제) ──
io = fakeIo({
  bookings: { daol: [{ checkIn: "2026-12-16", checkOut: "2026-12-22", bookNumber: "6266685684", guestName: "Ying Ding" }, { checkIn: "2026-12-22", checkOut: "2026-12-25", bookNumber: "HMEZ325ZZD", guestName: "Arielle" }] },
  cleaning: { daol: { "2026-12-22": { auto: true, cleaner: "김지영" }, "2026-12-25": { auto: true, cleaner: "" } } },
});
r = await handle(io, B("취소//#6266685684 (Ying Ding) <br>1 x Three-Bedroom Apartment"));
assert.equal(r.action, "deleted", r.note);
assert.ok(!io.db.cleaning.daol["2026-12-22"]);
assert.match(r.note, /김지영/);
assert.equal(io.db.bookings.daol.length, 1);

// 같은 날 다른 예약이 퇴실하면 청소는 남긴다
io = fakeIo({
  bookings: { "arangjae-ara": [{ checkIn: "2027-01-01", checkOut: "2027-01-05", bookNumber: "5000000003" }, { checkIn: "2027-01-03", checkOut: "2027-01-05", bookNumber: "5000000004" }] },
  cleaning: { "arangjae-ara": { "2027-01-05": { auto: true, cleaner: "" } } },
});
r = await handle(io, B("취소//#5000000003 (X) <br>1 x 2층 아라"));
assert.ok(io.db.cleaning["arangjae-ara"]["2027-01-05"]);

// 취소가 신규보다 먼저 와도 유령 예약이 남지 않는다
io = fakeIo({});
await handle(io, B("취소//#5900763477 (Seymone Miller) <br>1 x 3층 마루"));
r = await handle(io, B("신규 예약: 2027년 1월 24일 (일)부터 4박 //#5900763477 1 x 3층 마루<br> 총 요금: KRW 1170000.00"));
assert.equal(r.action, "skip");
assert.equal(io.db.bookings["arangjae-maru"].length, 0);

// ── 에어비앤비: 예약 알림 + 자동 답변 + iCal ──
const ical = { daol: [{ checkIn: "2027-01-29", checkOut: "2027-01-31", code: "HMPKEBFYAT" }], "arangjae-maru": [{ checkIn: "2027-02-11", checkOut: "2027-02-14", code: "HMYJC2RWWB" }] };
io = fakeIo({ ical });
r = await handle(io, A("凝悦님이 예약하셨습니다.//凝悦님이 2027년 1월 29일~31일에 호스트님의 숙소를 예약했습니다."));
assert.equal(r.action, "added", r.note); // iCal에 이미 있으면 자동 답변 전에 바로 들어간다
r = await handle(io, A("2027년 1월 29일~31일 • [Gangnam/3BR·2BA] 복층 독채 5베드｜교대·강남·고속터미널: 소피//凝悦님 안녕하세요. 저희 숙소에 예약해주셔서 진심으로 감사드려요."));
assert.equal(r.action, "skip");
assert.equal(io.db.bookings.daol.length, 1);
assert.deepEqual([io.db.bookings.daol[0].bookNumber, io.db.bookings.daol[0].guestName, io.db.bookings.daol[0].guests], ["HMPKEBFYAT", "凝悦", 0]);

// 자동 답변이 먼저 오고 iCal에 아직 없으면 기다렸다가 알림 때 처리
io = fakeIo({ ical: {} });
r = await handle(io, A("2027년 2월 11일~14일 • [마루]신축 엘리베이터/독립 욕실2개/명동/광장시장/넓은 가족실/짐보관가능: 라일라//Angela 님, 안녕하세요. 저희 숙소를 예약해주셔서 진심으로 감사드려요."));
assert.equal(r.action, "wait");
r = await handle(io, A("Angela님이 예약하셨습니다.//Angela님이 2027년 2월 11일~14일에 호스트님의 숙소를 예약했습니다."));
assert.equal(r.action, "stop"); // 둘 다 왔는데 iCal에 없음 → 동기화로 넘김
io.ical = async (pp) => ical[pp] || [];
r = await handle(io, A("Angela님이 예약하셨습니다.//Angela님이 2027년 2월 11일~14일에 호스트님의 숙소를 예약했습니다."));
assert.equal(r.action, "added", r.note); // 알림이 다시 오면 그때 들어간다
assert.equal(io.db.bookings["arangjae-maru"][0].bookNumber, "HMYJC2RWWB");

// 둘 다 대기 중일 때 이름이 다르면 멈춘다
io = fakeIo({ ical: {} });
await handle(io, A("2027년 2월 11일~14일 • [마루]신축: 라일라//Bob 님, 안녕하세요. 저희 숙소를 예약해주셔서 진심으로 감사드려요."));
r = await handle(io, A("Angela님이 예약하셨습니다.//Angela님이 2027년 2월 11일~14일에 호스트님의 숙소를 예약했습니다."));
assert.equal(r.action, "stop");

// ── 실제 사례: 용환 (예약 알림 12:32 → 자동 답변 12:33) ──
const YH_NOTICE = "용환님이 예약하셨습니다.//용환님이 2026년 12월 17일~20일에 호스트님의 숙소를 예약했습니다.";
const YH_REPLY = '12월 17일~20일 • [Gangnam/3BR·2BA] 복층 독채 5베드｜교대·강남·고속터미널: 소피//용환님 안녕하세요. 저희 숙소에 예약해주셔서 진심으로 감사드려요. 소중한 여행을 "다올스테이"와 함께 해주셔서 정말 감사합니다:) 예약하신 날짜는 2026년 12월 17일입니다. 오시는 시간에 맞춰서 청결하게 준비해놓겠습니다.';
const yhIcal = { daol: [{ checkIn: "2026-12-17", checkOut: "2026-12-20", code: "HMPKATZBTC" }] };

p = parse(A(YH_REPLY));
assert.deepEqual([p.checkIn, p.checkOut, p.prop, p.guestName], ["2026-12-17", "2026-12-20", "daol", "용환"]); // 연도는 본문에서

// 알림 → 자동 답변: 알림으로 등록, 자동 답변은 숙소·이름이 같아 조용히 건너뜀
io = fakeIo({ ical: yhIcal });
r = await handle(io, A(YH_NOTICE));
assert.equal(r.action, "added", r.note);
r = await handle(io, A(YH_REPLY));
assert.equal(r.action, "skip", r.note);
assert.match(r.note, /자동 답변도 일치/);

// 예약 알림이 빠지고 자동 답변만 와도 등록
io = fakeIo({ ical: yhIcal });
r = await handle(io, A(YH_REPLY));
assert.equal(r.action, "added", r.note);
assert.deepEqual([io.db.bookings.daol[0].bookNumber, io.db.bookings.daol[0].guestName], ["HMPKATZBTC", "용환"]);
r = await handle(io, A(YH_NOTICE)); // 나중에 알림이 와도 중복 없음
assert.equal(r.action, "skip");
assert.equal(io.db.bookings.daol.length, 1);

// 자동 답변만 왔는데 iCal에 아직 없으면 기다림(앱에 쓰지 않음)
io = fakeIo({ ical: {} });
r = await handle(io, A(YH_REPLY));
assert.equal(r.action, "wait");
assert.equal(io.db.bookings.daol.length, 0);

// 알림으로 다올에 등록했는데 자동 답변이 마루를 가리키면 ⚠️
io = fakeIo({ ical: yhIcal });
await handle(io, A(YH_NOTICE));
r = await handle(io, A(YH_REPLY.replace("[Gangnam/3BR·2BA] 복층 독채 5베드｜교대·강남·고속터미널", "[마루]신축 엘리베이터")));
assert.equal(r.action, "stop", r.note);

// 등록한 이름과 자동 답변 이름이 다르면 ⚠️
io = fakeIo({ ical: yhIcal });
await handle(io, A(YH_NOTICE));
r = await handle(io, A(YH_REPLY.replace("용환님 안녕하세요", "민수님 안녕하세요")));
assert.equal(r.action, "stop", r.note);

// ── 에어비앤비 취소 (실제 문구: 예약코드 없음) ──
const PAN = "Pan 님이 예약을 취소했습니다//취소된 예약은 2026년 8월 31일 ~ 9월 4일에 예정된 강남역/서초역/교대역 /넓은 3룸 2욕실 가족 숙소/각방 에어컨 총 5대 리스팅에 대한 것으로, 해당 날짜에 새로운 예약을 받으실 수 있도록 달력에도 반영되었습니다.";
p = parse(A(PAN));
assert.deepEqual([p.kind, p.guestName, p.prop, p.checkIn, p.checkOut], ["airbnb-cancel", "Pan", "daol", "2026-08-31", "2026-09-04"]);

const panBooking = { checkIn: "2026-08-31", checkOut: "2026-09-04", bookNumber: "HMPANTEST1", guestName: "Pan", channel: "airbnb" };
io = fakeIo({ bookings: { daol: [panBooking] }, cleaning: { daol: { "2026-09-04": { auto: true, cleaner: "김지영" } } }, ical: { daol: [] } });
r = await handle(io, A(PAN));
assert.equal(r.action, "deleted", r.note);
assert.equal(io.db.bookings.daol.length, 0);
assert.ok(!io.db.cleaning.daol["2026-09-04"]);
assert.match(r.note, /김지영/);

io = fakeIo({ bookings: { daol: [panBooking] }, ical: { daol: [{ checkIn: "2026-08-31", checkOut: "2026-09-04", code: "HMPANTEST1" }] } });
r = await handle(io, A(PAN));
assert.equal(r.action, "stop"); // 아직 iCal에 있으면 지우지 않는다
assert.equal(io.db.bookings.daol.length, 1);

io = fakeIo({ bookings: { daol: [{ ...panBooking, guestName: "김철수" }] }, ical: { daol: [] } });
r = await handle(io, A(PAN));
assert.equal(r.action, "stop"); // 이름이 다르면 멈춘다

io = fakeIo({ ical: { daol: [] } });
r = await handle(io, A(PAN));
assert.equal(r.action, "skip"); // 앱에 없으면 건너뜀

console.log("모든 테스트 통과");
