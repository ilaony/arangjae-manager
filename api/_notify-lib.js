// 알림(MacroDroid → POST /api/notify) 해석과 반영 규칙.
// 입출력(Firestore·iCal·텔레그램)은 io 객체로 주입한다 — 로컬 테스트에서 가짜로 바꿔 끼운다.

import { NATIONALITIES } from "../src/nationalities.js";

export const PROPS = ["arangjae-ara", "arangjae-maru", "daol"];
// 에어비앤비 리스팅 번호 → 앱 컬렉션 (메일 본문의 "리스팅 번호 #…")
const LISTING_ID = { "1649288534400052206": "arangjae-ara", "1649530929908799202": "arangjae-maru", "979425845780379545": "daol" };
export const PROP_LABEL = { "arangjae-ara": "아라", "arangjae-maru": "마루", daol: "다올" };

// 알림으로 들어간 예약의 표시. 동기화(/아랑재동기화)가 이 표시를 보고 이름·인원·국적을 채운다.
export const AUTO_MEMO = "알림 자동 등록 · 인원 확인 필요";
export const PLACEHOLDER_NAME = "확인 필요";

const pad = (n) => String(n).padStart(2, "0");
export const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;

export function addDays(date, n) {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return ymd(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

// 리스팅 이름이나 부킹닷컴 객실 이름 → 앱 컬렉션.
// 순서가 중요하다: [아라]·[마루] 표시를 먼저 보고, 다올 단서는 그다음이다.
// 다올 단서(강남·교대·다올·복층·Gangnam)는 2026-11-22 사용자 결정.
export function propFromName(name) {
  const s = (name || "").trim();
  if (!s) return null;
  if (s.includes("[아라]") || /^2층\s*아라$/.test(s)) return "arangjae-ara";
  if (s.includes("[마루]") || /^3층\s*마루$/.test(s)) return "arangjae-maru";
  if (/강남|교대|다올|복층|gangnam|three-bedroom|3베드룸/i.test(s)) return "daol";
  return null;
}

// MacroDroid가 텔레그램에 보내는 것과 같은 "제목//본문" 한 줄을 받는다.
export function splitMessage(message) {
  const s = String(message || "").replace(/<br\s*\/?>/gi, "\n").replace(/\r/g, "");
  const i = s.indexOf("//");
  return i < 0 ? { title: s.trim(), text: "" } : { title: s.slice(0, i).trim(), text: s.slice(i + 2).trim() };
}

// ── 부킹닷컴 ────────────────────────────────────────────────

// "신규 예약: 2027년 1월 17일 (일)부터 2박 " // "#6933350473 1 x 2층 아라\n 총 요금: KRW 536000.00"
// "취소" // "#6266685684 (Ying Ding) \n1 x Three-Bedroom Apartment"
export function parseBooking({ title, text }) {
  const all = `${title}\n${text}`;
  const num = (all.match(/#\s*(\d{10})\b/) || [])[1];
  const rooms = [...all.matchAll(/\d+\s*x\s*([^\n,]+?)(?=\s*(?:,|\n|총 요금|$))/g)].map((m) => m[1].trim());

  const nw = title.match(/신규 예약:\s*(\d{4})년\s*(\d+)월\s*(\d+)일.*?(\d+)\s*박/);
  if (nw) {
    const checkIn = ymd(nw[1], nw[2], nw[3]);
    return { kind: "booking-new", bookNumber: num, checkIn, checkOut: addDays(checkIn, Number(nw[4])), rooms };
  }
  if (/^취소/.test(title)) {
    const name = (text.match(/#\s*\d{10}\s*\(([^)]*)\)/) || [])[1];
    return { kind: "booking-cancel", bookNumber: num, guestName: name ? name.trim() : "", rooms };
  }
  return { kind: "ignore" };
}

// ── 에어비앤비 ──────────────────────────────────────────────

// 날짜 구간: "2027년 1월 29일~31일", "12월 4일~6일", "2026년 12월 31일 ~ 2027년 1월 2일", "3월 31일 ~ 4월 7일"
const RANGE = /(?:(\d{4})년\s*)?(\d+)월\s*(\d+)일\s*~\s*(?:(\d{4})년\s*)?(?:(\d+)월\s*)?(\d+)일/;

function parseRange(s) {
  const m = s.match(RANGE);
  if (!m) return null;
  const [, y1, m1, d1, y2, m2, d2] = m;
  return {
    y1: y1 ? Number(y1) : null,
    m1: Number(m1), d1: Number(d1),
    y2: y2 ? Number(y2) : null,
    m2: m2 ? Number(m2) : Number(m1), d2: Number(d2),
  };
}

// 연도가 없는 쪽(자동 답변)과 있는 쪽(예약 알림)을 짝짓는 열쇠. 월·일만 쓴다.
export const pairKey = (r) => `abnb_${pad(r.m1)}-${pad(r.d1)}_${pad(r.m2)}-${pad(r.d2)}`;

function fullDates(r) {
  if (!r.y1) return null;
  const y2 = r.y2 || (r.m2 < r.m1 ? r.y1 + 1 : r.y1);
  return { checkIn: ymd(r.y1, r.m1, r.d1), checkOut: ymd(y2, r.m2, r.d2) };
}

const sameName = (a, b) => {
  const x = (a || "").replace(/\s+/g, "").toLowerCase();
  const y = (b || "").replace(/\s+/g, "").toLowerCase();
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
};
export { sameName };

// "凝悦님이 예약하셨습니다." // "凝悦님이 2027년 1월 29일~31일에 호스트님의 숙소를 예약했습니다."
// "2027년 1월 29일~31일 • [Gangnam/…]: 소피" // "凝悦님 안녕하세요. 저희 숙소에 예약해주셔서 …"
// (텔레그램에는 제목//본문이 "날짜 • 리스팅: 보낸사람//메시지" 형태로 보인다)
export function parseAirbnb({ title, text }) {
  const notice = title.match(/^(.+?)님이 예약하셨습니다/);
  if (notice) {
    const r = parseRange(text);
    if (!r || !r.y1) return { kind: "ignore", reason: "예약 알림의 날짜를 못 읽음" };
    return { kind: "airbnb-notice", guestName: notice[1].trim(), key: pairKey(r), ...fullDates(r) };
  }

  // 자동 답변: 제목이 "날짜 • 리스팅: 보낸사람", 본문에 예약 감사 인사
  const head = title.match(/^(.*?)\s•\s(.+):\s*([^:]+)$/);
  if (head && /예약해주셔서/.test(text)) {
    const r = parseRange(head[1]);
    const guest = (text.match(/^(.+?)\s*님\s*,?\s*안녕하세요/) || [])[1];
    if (!r || !guest) return { kind: "ignore", reason: "자동 답변의 날짜나 이름을 못 읽음" };
    // 제목 날짜에 연도가 없으면(올해 날짜) 본문의 "예약하신 날짜는 2026년 12월 17일"에서 가져온다
    if (!r.y1) {
      const y = text.match(/예약하신 날짜는\s*(\d{4})년\s*(\d+)월\s*(\d+)일/);
      if (y && Number(y[2]) === r.m1 && Number(y[3]) === r.d1) r.y1 = Number(y[1]);
    }
    return {
      kind: "airbnb-reply",
      guestName: guest.trim(),
      listing: head[2].trim(),
      prop: propFromName(head[2]),
      key: pairKey(r),
      ...(fullDates(r) || {}),
    };
  }

  // 변경: "변경 요청" // "Baekyung님이 에어비앤비 예약의 숙박 기간을 2027년 6월 28일 - 2027년 7월 11일로 변경하고 싶어 합니다."
  //       "예약 변경 완료" // "Baekyung님의 예약이 변경되었습니다."
  // 요청은 대조용으로 저장만 하고, 완료가 와야 반영한다(호스트가 거절할 수 있다). 새 날짜의 근거는 iCal이다.
  if (/^변경 요청/.test(title)) {
    const m = text.match(/^(.+?)님이 .*?(\d{4})년\s*(\d+)월\s*(\d+)일\s*[-~]\s*(\d{4})년\s*(\d+)월\s*(\d+)일/);
    if (!m) return { kind: "ignore", reason: "변경 요청의 이름이나 날짜를 못 읽음" };
    return { kind: "airbnb-change-request", guestName: m[1].trim(), checkIn: ymd(m[2], m[3], m[4]), checkOut: ymd(m[5], m[6], m[7]) };
  }
  if (/^예약 변경 완료/.test(title)) {
    const m = text.match(/^(.+?)님의 예약이 변경되었습니다/);
    if (!m) return { kind: "ignore", reason: "변경 완료 알림의 이름을 못 읽음" };
    return { kind: "airbnb-change-done", guestName: m[1].trim() };
  }

  // "Pan 님이 예약을 취소했습니다" //"취소된 예약은 2026년 8월 31일 ~ 9월 4일에 예정된 강남역/…/각방 에어컨 총 5대 리스팅에 대한 것으로, …"
  // 예약코드가 없다 — 이름·날짜·리스팅으로 앱의 예약을 찾고, 그 예약의 코드가 iCal에서 사라졌는지로 확인한다.
  const cancel = title.match(/^(.+?)\s*님이 예약을 취소했습니다/);
  if (cancel) {
    const r = parseRange(text);
    const listing = (text.match(/예정된\s+(.+?)\s+리스팅에 대한/) || [])[1] || "";
    const dates = r && fullDates(r);
    if (!dates) return { kind: "ignore", reason: "에어비앤비 취소 알림의 날짜를 못 읽음" };
    return { kind: "airbnb-cancel", bookNumber: null, guestName: cancel[1].trim(), listing, prop: propFromName(listing), ...dates, raw: `${title}//${text}` };
  }
  if (/취소/.test(title)) {
    const code = (`${title} ${text}`.match(/\b(HM[A-Z0-9]{8})\b/) || [])[1];
    return { kind: "airbnb-cancel", bookNumber: code || null, raw: `${title}//${text}` };
  }
  return { kind: "ignore" };
}

export function parse({ app, message }) {
  const parts = splitMessage(message);
  const a = String(app || "").toLowerCase();
  const isBooking = a.includes("booking") || /^(신규 예약:|취소$)/.test(parts.title);
  if (isBooking) return parseBooking(parts);
  if (a.includes("airbnb") || a.includes("에어비앤비") || !a) return parseAirbnb(parts);
  return { kind: "ignore" };
}

// ── iCal ───────────────────────────────────────────────────

export function parseIcal(raw) {
  const t = raw.replace(/\r\n[ \t]/g, "").replace(/\r/g, "");
  return t.split("BEGIN:VEVENT").slice(1).map((b) => {
    const g = (k) => ((b.match(new RegExp(`^${k}[^:\\n]*:(.*)$`, "m")) || [])[1] || "").trim();
    const d = (v) => (v.length >= 8 ? `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}` : "");
    return { checkIn: d(g("DTSTART")), checkOut: d(g("DTEND")), code: (b.match(/details\/(HM[A-Z0-9]+)/) || [])[1] || "" };
  });
}

// ── 판단 ───────────────────────────────────────────────────

// 체크인 ~ (체크아웃−1일)이 겹치면 겹침. 전환일(퇴실일 == 입실일)은 겹침이 아니다.
export const overlaps = (bookings, checkIn, checkOut) =>
  bookings.filter((b) => b.checkIn < checkOut && checkIn < b.checkOut);

function newBookingDoc({ checkIn, checkOut, channel, guestName, bookNumber }) {
  return {
    checkIn, checkOut, channel, guestName, bookNumber,
    phone: "", guests: 0, nationality: "기타", memo: AUTO_MEMO,
    earlyCheckIn: false, lateCheckOut: false, luggageBefore: false, luggageAfter: false,
  };
}

async function addBooking(io, prop, doc) {
  const existing = await io.listBookings(prop);
  if (existing.some((b) => b.bookNumber === doc.bookNumber)) {
    return { ok: true, action: "skip", note: `이미 앱에 있음 (${doc.bookNumber})` };
  }
  const clash = overlaps(existing, doc.checkIn, doc.checkOut);
  if (clash.length) {
    return {
      ok: false, action: "stop",
      note: `${PROP_LABEL[prop]} ${doc.checkIn}~${doc.checkOut} 이 기존 예약과 겹침: ` +
        clash.map((b) => `${b.guestName} ${b.checkIn}~${b.checkOut} (${b.bookNumber || "번호 없음"})`).join(", "),
    };
  }
  const cleaningExists = await io.cleaningExists(prop, doc.checkOut);
  if ((await io.commitAdd(prop, doc, !cleaningExists)) === "exists") {
    return { ok: true, action: "skip", note: `이미 앱에 있음 (${doc.bookNumber}) — 다른 경로가 방금 넣음` };
  }
  return {
    ok: true, action: "added",
    note: `${PROP_LABEL[prop]} ${doc.checkIn}~${doc.checkOut} ${doc.guestName} 추가 (${doc.bookNumber})` +
      (cleaningExists ? " · 퇴실일 청소는 이미 있음" : " · 퇴실일 청소 추가"),
  };
}

// 취소: 예약을 지우고, 그날 청소는 auto:true이고 그날 퇴실하는 다른 예약이 없으면 같이 지운다.
// 담당자가 배정돼 있어도 지운다(2026-11-22 사용자 결정) — 대신 담당자 이름을 알린다.
async function cancelBooking(io, bookNumber) {
  for (const prop of PROPS) {
    const list = await io.listBookings(prop);
    const hit = list.filter((b) => b.bookNumber === bookNumber);
    if (!hit.length) continue;
    if (hit.length > 1) return { ok: false, action: "stop", note: `${PROP_LABEL[prop]}에 ${bookNumber}가 ${hit.length}건 — 수동 확인` };
    const b = hit[0];
    const others = list.filter((x) => x !== b && x.checkOut === b.checkOut);
    const cleaning = await io.getCleaning(prop, b.checkOut);
    const dropCleaning = !!cleaning && cleaning.auto === true && others.length === 0;
    await io.commitDelete(prop, b, dropCleaning ? cleaning : null);
    let note = `${PROP_LABEL[prop]} ${b.checkIn}~${b.checkOut} ${b.guestName} 삭제 (${bookNumber})`;
    if (dropCleaning) note += cleaning.cleaner ? ` · ${b.checkOut} 청소 삭제 — 담당 ${cleaning.cleaner}님께 알려 주세요` : ` · ${b.checkOut} 청소 삭제`;
    else if (cleaning) note += ` · ${b.checkOut} 청소는 남김 (${others.length ? "그날 퇴실하는 다른 예약 있음" : "수동으로 만든 청소"})`;
    return { ok: true, action: "deleted", note };
  }
  return { ok: true, action: "skip", note: `앱에 없음 (${bookNumber})` };
}

async function handleBookingNew(io, p) {
  if (!p.bookNumber) return { ok: false, action: "stop", note: "예약번호를 못 읽음" };
  if (p.rooms.length !== 1) return { ok: false, action: "stop", note: `객실이 ${p.rooms.length}개 (${p.rooms.join(", ") || "없음"}) — 수동 처리` };
  const prop = propFromName(p.rooms[0]);
  if (!prop) return { ok: false, action: "stop", note: `객실 이름으로 숙소를 못 가림: ${p.rooms[0]}` };
  if (await io.wasCancelled(p.bookNumber)) return { ok: true, action: "skip", note: `${p.bookNumber}는 이미 취소 알림을 받음 — 추가하지 않음` };
  return addBooking(io, prop, newBookingDoc({ ...p, channel: "booking", guestName: PLACEHOLDER_NAME }));
}

async function handleBookingCancel(io, p) {
  if (!p.bookNumber) return { ok: false, action: "stop", note: "예약번호를 못 읽음" };
  await io.markCancelled(p.bookNumber);
  return cancelBooking(io, p.bookNumber);
}

// 에어비앤비 신규: 예약 알림(이름·날짜) + 자동 답변(리스팅·이름·날짜) + iCal(예약코드)을 맞춘다.
// 둘 중 하나만 와도 등록할 수 있다 —
//   예약 알림만: 세 숙소 iCal에서 같은 날짜의 새 예약이 딱 하나면 그 숙소
//   자동 답변만: 리스팅으로 숙소를 정하고, 그 숙소 iCal에서 같은 날짜의 새 예약
// 먼저 온 쪽으로 이미 등록했으면, 나중에 온 쪽이 숙소·이름이 같은지 다시 확인한다.
async function handleAirbnbPiece(io, p) {
  const prev = (await io.getInbox(p.key)) || {};

  if (prev.done) {
    const label = p.kind === "airbnb-reply" ? "자동 답변" : "예약 알림";
    const name = prev.noticeName || prev.replyName;
    if (p.kind === "airbnb-reply" && prev.prop && p.prop && p.prop !== prev.prop) {
      return { ok: false, action: "stop", note: `등록은 ${PROP_LABEL[prev.prop]}(${prev.code})로 했는데 자동 답변은 ${PROP_LABEL[p.prop]}를 가리킴 — 확인 필요 (${p.guestName} ${p.key.slice(5)})` };
    }
    if (p.kind === "airbnb-reply" && !p.prop) {
      return { ok: false, action: "stop", note: `등록은 ${PROP_LABEL[prev.prop] || "?"}(${prev.code})로 했는데 자동 답변의 리스팅으로 숙소를 못 가림: ${p.listing}` };
    }
    if (name && !sameName(name, p.guestName)) {
      return { ok: false, action: "stop", note: `등록한 예약(${name}, ${prev.code})과 ${label}(${p.guestName})의 이름이 다름 — 확인 필요` };
    }
    return { ok: true, action: "skip", note: `이미 처리한 예약 — ${label}도 일치 (${prev.code})` };
  }

  const cur = { ...prev };
  if (p.kind === "airbnb-notice") Object.assign(cur, { noticeName: p.guestName, checkIn: p.checkIn, checkOut: p.checkOut });
  else Object.assign(cur, { replyName: p.guestName, listing: p.listing, prop: p.prop || "", ...(p.checkIn ? { replyCheckIn: p.checkIn, replyCheckOut: p.checkOut } : {}) });
  await io.putInbox(p.key, cur);

  if (cur.noticeName && cur.replyName && !sameName(cur.noticeName, cur.replyName)) {
    return { ok: false, action: "stop", note: `예약 알림(${cur.noticeName})과 자동 답변(${cur.replyName})의 이름이 다름` };
  }
  if (cur.replyName && cur.listing && !cur.prop) {
    return { ok: false, action: "stop", note: `리스팅 이름으로 숙소를 못 가림: ${cur.listing}` };
  }

  // 날짜와 이름: 예약 알림이 우선, 없으면 자동 답변
  const checkIn = cur.checkIn || cur.replyCheckIn;
  const checkOut = cur.checkOut || cur.replyCheckOut;
  const guestName = cur.noticeName || cur.replyName;
  if (!checkIn) return { ok: true, action: "wait", note: "자동 답변의 연도를 못 읽음 — 예약 알림을 기다림" };

  // 숙소를 iCal로 찾는다: 자동 답변이 있으면 그 숙소만, 없으면 세 숙소를 다 본다.
  const candidates = cur.prop ? [cur.prop] : PROPS;
  const found = [];
  for (const prop of candidates) {
    const events = await io.ical(prop);
    for (const e of events) if (e.code && e.checkIn === checkIn && e.checkOut === checkOut) found.push({ prop, code: e.code });
  }
  const fresh = [];
  for (const f of found) {
    const list = await io.listBookings(f.prop);
    if (!list.some((b) => b.bookNumber === f.code)) fresh.push(f);
  }
  if (found.length && !fresh.length) {
    await io.putInbox(p.key, { ...cur, done: true });
    return { ok: true, action: "skip", note: `이미 앱에 있음 (${found.map((f) => f.code).join(", ")})` };
  }
  if (fresh.length !== 1) {
    // 짝이 아직 안 왔으면 기다린다(짝이 오면 그때 iCal을 다시 본다). 둘 다 왔는데도 안 맞으면 멈춘다.
    if (!cur.replyName) return { ok: true, action: "wait", note: `iCal에서 ${checkIn}~${checkOut} 새 예약 ${fresh.length}건 — 자동 답변을 기다림` };
    if (!cur.noticeName) return { ok: true, action: "wait", note: `iCal에서 ${checkIn}~${checkOut} 새 예약 ${fresh.length}건 — 예약 알림을 기다림` };
    return { ok: false, action: "stop", note: `iCal에서 ${PROP_LABEL[cur.prop] || "세 숙소"} ${checkIn}~${checkOut} 새 예약을 ${fresh.length}건 찾음 — 동기화 때 확인 (${guestName})` };
  }

  const { prop, code } = fresh[0];
  const r = await addBooking(io, prop, newBookingDoc({ checkIn, checkOut, channel: "airbnb", guestName, bookNumber: code }));
  if (r.action === "added" || r.action === "skip") await io.putInbox(p.key, { ...cur, prop, code, done: true });
  return r;
}

// 에어비앤비 취소: 문구에 예약코드가 없으므로 숙소·날짜로 앱 예약을 찾고, 이름이 맞고,
// 그 예약의 코드가 iCal에서도 사라졌을 때만 지운다.
async function handleAirbnbCancel(io, p) {
  if (!p.bookNumber && p.checkIn) {
    if (!p.prop) return { ok: false, action: "stop", note: `에어비앤비 취소: 리스팅 이름으로 숙소를 못 가림 — ${p.listing || "이름 없음"}` };
    const list = await io.listBookings(p.prop);
    const hit = list.filter((b) => b.checkIn === p.checkIn && b.checkOut === p.checkOut);
    const where = `${PROP_LABEL[p.prop]} ${p.checkIn}~${p.checkOut} ${p.guestName}`;
    if (!hit.length) return { ok: true, action: "skip", note: `에어비앤비 취소 — 앱에 없음 (${where})` };
    if (hit.length > 1) return { ok: false, action: "stop", note: `에어비앤비 취소 — 같은 날짜 예약이 ${hit.length}건 (${where})` };
    const b = hit[0];
    if (!sameName(b.guestName, p.guestName)) return { ok: false, action: "stop", note: `에어비앤비 취소 — 앱 이름(${b.guestName})과 알림 이름(${p.guestName})이 다름 (${where})` };
    if (!/^HM/.test(b.bookNumber || "")) return { ok: false, action: "stop", note: `에어비앤비 취소 — 앱 예약에 에어비앤비 예약코드가 없음 (${where})` };
    p = { ...p, bookNumber: b.bookNumber };
  }
  if (!p.bookNumber) return { ok: false, action: "stop", note: `에어비앤비 취소 알림에서 예약코드를 못 찾음 — 문구: ${p.raw.slice(0, 120)}` };
  for (const prop of PROPS) {
    const events = await io.ical(prop);
    if (events.some((e) => e.code === p.bookNumber)) {
      // 취소 알림이 iCal 반영보다 먼저 온 경우(2026-11-26 David). 기록해 두고, 다음 알림 때 다시 본다.
      await io.putInbox(`cancel_${p.bookNumber}`, { code: p.bookNumber, guestName: p.guestName || "", checkIn: p.checkIn || "", checkOut: p.checkOut || "" });
      return { ok: false, action: "stop", note: `${p.bookNumber}가 아직 iCal에 있음 — 지금은 지우지 않고, iCal에서 빠지면 다음 알림 때 지움` };
    }
  }
  return cancelBooking(io, p.bookNumber);
}

// 에어비앤비 변경 요청: 반영하지 않고 새 날짜만 저장해 둔다(완료 알림 때 iCal과 맞춰 본다).
const changeKey = (name) => `chg_${(name || "").replace(/\s+/g, "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "")}`;

async function handleChangeRequest(io, p) {
  await io.putInbox(changeKey(p.guestName), { guestName: p.guestName, checkIn: p.checkIn, checkOut: p.checkOut });
  return { ok: true, action: "wait", note: `${p.guestName} 변경 요청(${p.checkIn}~${p.checkOut}) — 변경 완료 알림을 기다림` };
}

// 에어비앤비 변경 완료: 이름이 같은 미래 에어비앤비 예약 중, iCal 날짜가 앱 날짜와 달라진 것이 딱 하나면 반영한다.
// 예약 날짜만 고치고(updateMask), 청소를 새 퇴실일로 옮긴다. 담당자가 있으면 담당자째 옮기고 알린다.
async function handleChangeDone(io, p) {
  const today = io.today();
  const req = await io.getInbox(changeKey(p.guestName));
  const cands = [];
  for (const prop of PROPS) {
    const list = await io.listBookings(prop);
    for (const b of list) {
      if (/^HM/.test(b.bookNumber || "") && b.checkOut >= today && sameName(b.guestName, p.guestName)) cands.push({ prop, b });
    }
  }
  if (!cands.length) return { ok: false, action: "stop", note: `${p.guestName} 예약 변경 완료 — 앱에서 이 이름의 에어비앤비 예약을 못 찾음` };

  const changed = [];
  for (const c of cands) {
    const e = (await io.ical(c.prop)).find((x) => x.code === c.b.bookNumber);
    if (e && (e.checkIn !== c.b.checkIn || e.checkOut !== c.b.checkOut)) changed.push({ ...c, checkIn: e.checkIn, checkOut: e.checkOut });
  }
  if (!changed.length) {
    return { ok: true, action: "skip", note: `${p.guestName} 예약 변경 완료 — iCal 날짜가 이미 앱과 같음 (${cands.map((c) => c.b.bookNumber).join(", ")})` };
  }
  if (changed.length > 1) {
    return { ok: false, action: "stop", note: `${p.guestName} 예약 변경 완료 — 날짜가 바뀐 예약이 ${changed.length}건, 수동 확인 (${changed.map((c) => c.b.bookNumber).join(", ")})` };
  }

  const { prop, b, checkIn, checkOut } = changed[0];
  const where = `${PROP_LABEL[prop]} ${b.guestName} (${b.bookNumber})`;
  if (req && req.checkIn && (req.checkIn !== checkIn || req.checkOut !== checkOut)) {
    return { ok: false, action: "stop", note: `${where} 변경 요청은 ${req.checkIn}~${req.checkOut}인데 iCal은 ${checkIn}~${checkOut} — 확인 필요` };
  }
  const list = await io.listBookings(prop);
  const clash = overlaps(list.filter((x) => x !== b), checkIn, checkOut);
  if (clash.length) {
    return { ok: false, action: "stop", note: `${where} 새 날짜 ${checkIn}~${checkOut}이 기존 예약과 겹침: ` + clash.map((x) => `${x.guestName} ${x.checkIn}~${x.checkOut}`).join(", ") };
  }

  // 청소: 퇴실일이 바뀌었을 때만 옮긴다
  let moveFrom = null, createNew = false, cleanerNote = "";
  if (checkOut !== b.checkOut) {
    const oldC = await io.getCleaning(prop, b.checkOut);
    const othersOld = list.filter((x) => x !== b && x.checkOut === b.checkOut);
    const newExists = await io.cleaningExists(prop, checkOut);
    if (oldC && oldC.auto === true && othersOld.length === 0) moveFrom = oldC;
    createNew = !newExists;
    if (moveFrom && moveFrom.cleaner) cleanerNote = ` — 담당 ${moveFrom.cleaner}님께 날짜 변경 알려 주세요`;
  }
  const oldIn = b.checkIn, oldOut = b.checkOut;
  await io.commitChange(prop, b, { checkIn, checkOut }, moveFrom, createNew);
  if (req) await io.putInbox(changeKey(p.guestName), { ...req, done: true });

  let note = `${where} ${oldIn}~${oldOut} → ${checkIn}~${checkOut} 변경`;
  if (checkOut !== oldOut) {
    note += moveFrom ? ` · 청소 ${oldOut} → ${checkOut} 이동${createNew ? "" : "(새 날짜 청소는 이미 있어 기존 것 삭제만)"}${cleanerNote}`
      : createNew ? ` · ${checkOut} 청소 추가 (${oldOut} 청소는 남김)` : "";
  }
  return { ok: true, action: "changed", note };
}

// ── 메일 (Google Apps Script가 5분마다 Gmail에서 찾아 보낸다) ──────────────

const COUNTRY_ALIAS = { "오스트레일리아": "호주", "대한민국": "한국", "터키": "튀르키예" };
// "중국", "베이징, 중국" → 앱 국적 값. 목록 밖이면 null
export function toNationality(raw) {
  const last = String(raw || "").split(",").pop().trim();
  const v = COUNTRY_ALIAS[last] || last;
  return NATIONALITIES.includes(v) ? v : null;
}

// 처리 대상: 에어비앤비 예약 확정·취소됨·예약 변경 완료, 부킹닷컴 취소된 예약 안내
export function parseMail({ from, subject, body }) {
  const f = String(from || "").toLowerCase();
  const subj = String(subject || "").trim();
  const text = String(body || "").replace(/\r/g, "");
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  if (f.includes("booking.com")) {
    const c = subj.match(/취소된 예약 안내!\s*\((\d{10}),/);
    if (c) return { kind: "booking-cancel", bookNumber: c[1], guestName: "", rooms: [] };
    return { kind: "ignore", reason: "부킹닷컴 메일 — 취소 외에는 처리하지 않음" };
  }
  if (!f.includes("airbnb")) return { kind: "ignore", reason: "에어비앤비·부킹닷컴 메일이 아님" };

  // "취소됨: 12월 31일 ~ 1월 2일 예약 건(HMD99SXCZT)"
  const cancel = subj.match(/^취소됨:.*\((HM[A-Z0-9]{8})\)/);
  if (cancel) {
    const name = (text.match(/게스트\s+(.+?)\s*님이\s*\d{4}년/) || [])[1] || "";
    return { kind: "airbnb-cancel", bookNumber: cancel[1], guestName: name.trim(), raw: subj };
  }
  // "예약 변경 완료 - Baekyung 님의 예약이 변경되었습니다."
  const changed = subj.match(/^예약 변경 완료\s*-\s*(.+?)\s*님의 예약이 변경/);
  if (changed) return { kind: "airbnb-change-done", guestName: changed[1].trim() };

  // "예약 확정 - 嫦嫦 魏 님이 11월 27일에 체크인할 예정입니다"
  const confirm = subj.match(/^예약 확정\s*-\s*(.+?)\s*님이\s*(\d+)월\s*(\d+)일/);
  if (confirm) {
    const code = (text.match(/예약\s*코드\s*(HM[A-Z0-9]{8})/) || text.match(/\b(HM[A-Z0-9]{8})\b/) || [])[1];
    const head = lines.slice(0, 30);
    const listingLine = head.find((l) => propFromName(l)) || "";
    const countryLine = head.find((l) => l.length <= 30 && toNationality(l)) || "";
    const ci = text.match(/체크인\s*(\d+)월\s*(\d+)일/);
    const co = text.match(/체크아웃\s*(\d+)월\s*(\d+)일/);
    const n = (re) => Number((text.match(re) || [])[1] || 0);
    const guests = n(/성인\s*(\d+)명/) + n(/어린이\s*(\d+)명/) + n(/유아\s*(\d+)명/);
    return {
      kind: "airbnb-mail-new", bookNumber: code || null, guestName: confirm[1].trim(),
      nationality: toNationality(countryLine), listing: listingLine, prop: propFromName(listingLine),
      md: ci && co ? { m1: +ci[1], d1: +ci[2], m2: +co[1], d2: +co[2] } : null, guests,
    };
  }
  return { kind: "ignore", reason: "처리 대상 에어비앤비 메일이 아님" };
}

// 에어비앤비 확정 메일: 코드로 iCal에서 날짜(연도 포함)를 확인하고 등록한다.
// 이미 알림으로 들어와 있으면 빈칸(이름·인원·국적)만 채운다. iCal에 아직 없으면 보류해 두고 다음 알림 때 다시 본다.
// 인원은 메일의 성인+어린이+유아 — 호스팅 목록의 일행 수와 다를 수 있어 메모 표시를 남겨 동기화가 확인한다.
async function applyAirbnbMailNew(io, p, fromSweep) {
  if (!p.bookNumber) return { ok: false, action: "stop", note: `에어비앤비 확정 메일(${p.guestName})에서 예약코드를 못 읽음` };
  const props = p.prop ? [p.prop] : PROPS;
  let hit = null;
  for (const prop of props) {
    const e = (await io.ical(prop)).find((x) => x.code === p.bookNumber);
    if (e) { hit = { prop, ...e }; break; }
  }
  if (!hit) {
    if (!fromSweep) await io.putInbox(`mailnew_${p.bookNumber}`, { code: p.bookNumber, payload: JSON.stringify(p) });
    return { ok: true, action: "wait", note: `확정 메일 ${p.guestName} (${p.bookNumber}) — iCal에 아직 없어 보류` };
  }
  if (p.md && (Number(hit.checkIn.slice(5, 7)) !== p.md.m1 || Number(hit.checkIn.slice(8)) !== p.md.d1)) {
    return { ok: false, action: "stop", note: `확정 메일 ${p.guestName} (${p.bookNumber}) 체크인 ${p.md.m1}/${p.md.d1}과 iCal ${hit.checkIn}이 다름 — 확인 필요` };
  }

  for (const prop of PROPS) {
    const b = (await io.listBookings(prop)).find((x) => x.bookNumber === p.bookNumber);
    if (!b) continue;
    if (b.memo !== AUTO_MEMO) return { ok: true, action: "skip", note: `이미 앱에 있음 (${p.bookNumber})` };
    const fields = {};
    if (p.guestName && b.guestName !== p.guestName && sameName(b.guestName, p.guestName)) fields.guestName = p.guestName;
    if (p.guests && b.guests !== p.guests) fields.guests = p.guests;
    if (p.nationality && b.nationality === "기타") fields.nationality = p.nationality;
    if (!Object.keys(fields).length) return { ok: true, action: "skip", note: `이미 앱에 있음 (${p.bookNumber})` };
    await io.commitFill(prop, b, fields);
    return { ok: true, action: "filled", note: `${PROP_LABEL[prop]} ${b.checkIn}~${b.checkOut} ${p.guestName} 빈칸 채움 (${Object.entries(fields).map(([k, v]) => `${k}=${v}`).join(", ")})` };
  }

  const doc = newBookingDoc({ checkIn: hit.checkIn, checkOut: hit.checkOut, channel: "airbnb", guestName: p.guestName, bookNumber: p.bookNumber });
  if (p.guests) doc.guests = p.guests;
  if (p.nationality) doc.nationality = p.nationality;
  return addBooking(io, hit.prop, doc);
}

// 보류된 에어비앤비 취소를 다시 본다: 코드가 iCal에서 빠졌으면 이제 지운다. 모든 알림마다 돈다.
async function sweepPendingCancels(io) {
  const notes = [];
  const pending = (await io.listInbox("cancel_")).filter((x) => !x.done);
  for (const c of pending) {
    let still = false;
    for (const prop of PROPS) if ((await io.ical(prop)).some((e) => e.code === c.code)) still = true;
    if (still) continue;
    const r = await cancelBooking(io, c.code);
    await io.putInbox(`cancel_${c.code}`, { ...c, done: true });
    if (r.action === "deleted") notes.push({ action: "deleted", note: `보류했던 취소 처리: ${r.note}` });
  }
  // 메일로 받았지만 iCal에 아직 없던 에어비앤비 신규
  for (const m of (await io.listInbox("mailnew_")).filter((x) => !x.done)) {
    const r = await applyAirbnbMailNew(io, JSON.parse(m.payload), true);
    if (r.action !== "wait") await io.putInbox(`mailnew_${m.code}`, { ...m, done: true });
    if (["added", "filled", "stop"].includes(r.action)) notes.push({ action: r.action, note: `보류했던 메일 예약: ${r.note}` });
  }
  return notes;
}

export async function handle(io, input) {
  const swept = io.listInbox ? await sweepPendingCancels(io) : [];
  const r = await handleOne(io, input);
  if (!swept.length) return r;
  const quiet = ["ignore", "skip", "wait"].includes(r.action);
  return { ...r, action: quiet ? swept[0].action : r.action, note: [...swept.map((x) => x.note), ...(quiet ? [] : [r.note])].join(" / ") };
}

async function handleOne(io, input) {
  const p = input.source === "mail" ? parseMail(input) : parse(input);
  switch (p.kind) {
    case "booking-new": return { parsed: p, ...(await handleBookingNew(io, p)) };
    case "booking-cancel": return { parsed: p, ...(await handleBookingCancel(io, p)) };
    case "airbnb-notice":
    case "airbnb-reply": return { parsed: p, ...(await handleAirbnbPiece(io, p)) };
    case "airbnb-cancel": return { parsed: p, ...(await handleAirbnbCancel(io, p)) };
    case "airbnb-change-request": return { parsed: p, ...(await handleChangeRequest(io, p)) };
    case "airbnb-change-done": return { parsed: p, ...(await handleChangeDone(io, p)) };
    case "airbnb-mail-new": return { parsed: p, ...(await applyAirbnbMailNew(io, p, false)) };
    default: return { parsed: p, ok: true, action: "ignore", note: p.reason || "처리 대상 아님" };
  }
}
