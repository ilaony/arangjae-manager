// POST /api/notify — MacroDroid가 에어비앤비·부킹닷컴 알림을 보내는 곳.
// 휴대폰 알림(MacroDroid): secret, app("[앱 이름]"), message("[알림 제목]//[알림 내용]")
// 메일(Google Apps Script, scripts/gmail-forwarder.gs): secret, source="mail", from, subject, body
// 쿼리 파라미터(권장 — MacroDroid가 인코딩해 줌), 폼 본문, JSON 본문 어느 쪽으로 보내도 된다.
//
// Vercel 환경 변수:
//   NOTIFY_SECRET        MacroDroid와 맞춘 비밀값 (필수)
//   FIREBASE_API_KEY     src/firebase.js 의 apiKey (필수)
//   ICAL_ARA / ICAL_MARU / ICAL_DAOL   에어비앤비 iCal 주소 (에어비앤비 처리에 필수)
//   TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID   처리 결과를 텔레그램으로 회신 (선택)

import { handle, parseIcal, PROP_LABEL } from "./_notify-lib.js";

const PROJECT = "arangjae-manager";
const DOCS = `projects/${PROJECT}/databases/(default)/documents`;
const BASE = `https://firestore.googleapis.com/v1/${DOCS}`;

// ── Firestore REST 값 변환 ──
const toValue = (v) =>
  typeof v === "boolean" ? { booleanValue: v }
  : Number.isInteger(v) ? { integerValue: String(v) }
  : { stringValue: String(v ?? "") };
const toFields = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, toValue(v)]));
const fromValue = (v) =>
  "integerValue" in v ? Number(v.integerValue)
  : "booleanValue" in v ? v.booleanValue
  : "doubleValue" in v ? v.doubleValue
  : v.stringValue ?? null;
const fromDoc = (d) => ({
  ...Object.fromEntries(Object.entries(d.fields || {}).map(([k, v]) => [k, fromValue(v)])),
  _name: d.name, _updateTime: d.updateTime,
});

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function makeIo(key) {
  const q = `key=${encodeURIComponent(key)}`;
  const get = async (path) => {
    const r = await fetch(`${BASE}/${path}?${q}`);
    if (r.status === 404) return null;
    if (!r.ok) throw new Error(`Firestore GET ${path}: ${r.status} ${await r.text()}`);
    return fromDoc(await r.json());
  };
  const put = async (path, obj) => {
    const r = await fetch(`${BASE}/${path}?${q}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: toFields(obj) }),
    });
    if (!r.ok) throw new Error(`Firestore PATCH ${path}: ${r.status} ${await r.text()}`);
  };
  const commit = async (writes) => {
    const r = await fetch(`https://firestore.googleapis.com/v1/${DOCS}:commit?${q}`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ writes }),
    });
    if (!r.ok) {
      const text = await r.text();
      const err = new Error(`Firestore commit: ${r.status} ${text}`);
      // "이미 있으면 실패" 조건에 걸림 — 다른 쪽(동기화·메일·알림)이 먼저 썼다
      err.conflict = /ALREADY_EXISTS|FAILED_PRECONDITION/.test(text);
      throw err;
    }
  };
  const cache = new Map();

  return {
    async listBookings(prop) {
      if (cache.has(prop)) return cache.get(prop);
      const out = [];
      let token = "";
      do {
        const r = await fetch(`${BASE}/bookings-${prop}?${q}&pageSize=300${token ? `&pageToken=${token}` : ""}`);
        if (!r.ok) throw new Error(`Firestore list bookings-${prop}: ${r.status}`);
        const j = await r.json();
        for (const d of j.documents || []) out.push(fromDoc(d));
        token = j.nextPageToken || "";
      } while (token);
      cache.set(prop, out);
      return out;
    },
    getCleaning: (prop, date) => get(`cleaning-${prop}/${date}`),
    async cleaningExists(prop, date) { return !!(await get(`cleaning-${prop}/${date}`)); },
    // 새 예약 문서 이름은 예약번호로 정한다(bn-예약번호). 동기화도 같은 이름을 쓰므로,
    // 동기화와 알림·메일이 같은 예약을 동시에 넣어도 "이미 있으면 실패" 조건으로 1건만 남는다.
    // 반환: "ok" | "exists"(그 예약이 이미 있음)
    async commitAdd(prop, doc, withCleaning) {
      const id = doc.bookNumber ? `bn-${doc.bookNumber}` : genId();
      const bookingWrite = {
        update: { name: `${DOCS}/bookings-${prop}/${id}`, fields: toFields(doc) },
        currentDocument: { exists: false },
      };
      const cleaningWrite = {
        update: { name: `${DOCS}/cleaning-${prop}/${doc.checkOut}`, fields: toFields({ status: "scheduled", auto: true, cleaner: "", memo: "" }) },
        currentDocument: { exists: false },
      };
      cache.delete(prop);
      try {
        await commit(withCleaning ? [bookingWrite, cleaningWrite] : [bookingWrite]);
        return "ok";
      } catch (e) {
        if (!e.conflict) throw e;
        if (await get(`bookings-${prop}/${id}`)) return "exists";
        if (!withCleaning) throw e;
        await commit([bookingWrite]); // 그사이 청소가 먼저 생긴 경우 — 예약만 넣는다
        return "ok";
      }
    },
    async commitDelete(prop, booking, cleaning) {
      const writes = [{ delete: booking._name, currentDocument: { updateTime: booking._updateTime } }];
      if (cleaning) writes.push({ delete: cleaning._name, currentDocument: { updateTime: cleaning._updateTime } });
      await commit(writes);
      cache.delete(prop);
    },
    // 예약 날짜만 고치고(updateMask), 청소를 옛 퇴실일에서 새 퇴실일로 옮긴다 — 한 배치로
    async commitChange(prop, booking, dates, moveFrom, createNew) {
      const writes = [{
        update: { name: booking._name, fields: toFields(dates) },
        updateMask: { fieldPaths: Object.keys(dates) },
        currentDocument: { updateTime: booking._updateTime },
      }];
      if (moveFrom) writes.push({ delete: moveFrom._name, currentDocument: { updateTime: moveFrom._updateTime } });
      if (createNew) {
        const fields = moveFrom ? stripMeta(moveFrom) : { status: "scheduled", auto: true, cleaner: "", memo: "" };
        writes.push({
          update: { name: `${DOCS}/cleaning-${prop}/${dates.checkOut}`, fields: toFields(fields) },
          currentDocument: { exists: false },
        });
      }
      await commit(writes);
      cache.delete(prop);
    },
    // 한국 시간 기준 오늘
    today: () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10),
    // 알림·메일로 들어온 예약의 빈칸(이름·인원·국적)만 채운다
    async commitFill(prop, booking, fields) {
      await commit([{
        update: { name: booking._name, fields: toFields(fields) },
        updateMask: { fieldPaths: Object.keys(fields) },
        currentDocument: { updateTime: booking._updateTime },
      }]);
      cache.delete(prop);
    },
    getInbox: (k) => get(`notify-inbox/${k}`),
    async listInbox(prefix) {
      const out = [];
      let token = "";
      do {
        const r = await fetch(`${BASE}/notify-inbox?${q}&pageSize=300${token ? `&pageToken=${token}` : ""}`);
        if (!r.ok) throw new Error(`Firestore list notify-inbox: ${r.status}`);
        const j = await r.json();
        for (const d of j.documents || []) if (d.name.split("/").pop().startsWith(prefix)) out.push(fromDoc(d));
        token = j.nextPageToken || "";
      } while (token);
      return out;
    },
    putInbox: (k, obj) => put(`notify-inbox/${k}`, { ...stripMeta(obj), updatedAt: new Date().toISOString() }),
    async wasCancelled(bookNumber) { return !!(await get(`notify-log/${bookNumber}`)); },
    markCancelled: (bookNumber) => put(`notify-log/${bookNumber}`, { cancelledAt: new Date().toISOString() }),
    async ical(prop) {
      const url = { "arangjae-ara": process.env.ICAL_ARA, "arangjae-maru": process.env.ICAL_MARU, daol: process.env.ICAL_DAOL }[prop];
      if (!url) throw new Error(`iCal 주소 환경 변수가 없음: ${PROP_LABEL[prop]}`);
      if (cache.has(`ical-${prop}`)) return cache.get(`ical-${prop}`);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`iCal ${PROP_LABEL[prop]}: ${r.status}`);
      const events = parseIcal(await r.text());
      cache.set(`ical-${prop}`, events);
      return events;
    },
  };
}

const stripMeta = (o) => Object.fromEntries(Object.entries(o).filter(([k]) => !k.startsWith("_")));

async function tell(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, disable_notification: false }),
  }).catch(() => {});
}

const ICON = { added: "✅", deleted: "🗑", changed: "🔁", filled: "📝", stop: "⚠️", error: "❌" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  // 본문(JSON·폼)과 쿼리 파라미터를 모두 받는다. MacroDroid는 쿼리 파라미터 값을 인코딩해 주므로
  // 알림 문구의 "#예약번호"가 잘리지 않는다(주소에 직접 넣으면 # 뒤가 조각(fragment)으로 빠진다).
  let fromBody = req.body;
  if (typeof fromBody === "string") { try { fromBody = JSON.parse(fromBody); } catch { fromBody = {}; } }
  const body = { ...(req.query || {}), ...(fromBody || {}) };

  if (!process.env.NOTIFY_SECRET || body.secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ ok: false, error: "bad secret" });
  }
  if (!process.env.FIREBASE_API_KEY) return res.status(500).json({ ok: false, error: "FIREBASE_API_KEY 없음" });

  try {
    const input = body.source === "mail"
      ? { source: "mail", from: body.from, subject: body.subject, body: body.body }
      : { app: body.app, message: body.message };
    const result = await handle(makeIo(process.env.FIREBASE_API_KEY), input);
    const tag = body.source === "mail" ? "[메일 반영]" : "[앱 반영]";
    if (ICON[result.action]) await tell(`${ICON[result.action]} ${tag} ${result.note}`);
    return res.status(200).json(result);
  } catch (e) {
    await tell(`${ICON.error} [반영 실패] ${e.message}\n원문: ${String(body.message || body.subject || "").slice(0, 200)}`);
    return res.status(500).json({ ok: false, action: "error", note: e.message });
  }
}
