// POST /api/notify — MacroDroid가 에어비앤비·부킹닷컴 알림을 보내는 곳.
// 본문(JSON): { "secret": "...", "app": "[앱 이름]", "message": "[알림 제목]//[알림 내용]" }
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
    if (!r.ok) throw new Error(`Firestore commit: ${r.status} ${await r.text()}`);
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
    async commitAdd(prop, doc, withCleaning) {
      const writes = [{
        update: { name: `${DOCS}/bookings-${prop}/${genId()}`, fields: toFields(doc) },
        currentDocument: { exists: false },
      }];
      if (withCleaning) writes.push({
        update: { name: `${DOCS}/cleaning-${prop}/${doc.checkOut}`, fields: toFields({ status: "scheduled", auto: true, cleaner: "", memo: "" }) },
        currentDocument: { exists: false },
      });
      await commit(writes);
      cache.delete(prop);
    },
    async commitDelete(prop, booking, cleaning) {
      const writes = [{ delete: booking._name, currentDocument: { updateTime: booking._updateTime } }];
      if (cleaning) writes.push({ delete: cleaning._name, currentDocument: { updateTime: cleaning._updateTime } });
      await commit(writes);
      cache.delete(prop);
    },
    getInbox: (k) => get(`notify-inbox/${k}`),
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

const ICON = { added: "✅", deleted: "🗑", stop: "⚠️", error: "❌" };

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (!process.env.NOTIFY_SECRET || body.secret !== process.env.NOTIFY_SECRET) {
    return res.status(401).json({ ok: false, error: "bad secret" });
  }
  if (!process.env.FIREBASE_API_KEY) return res.status(500).json({ ok: false, error: "FIREBASE_API_KEY 없음" });

  try {
    const result = await handle(makeIo(process.env.FIREBASE_API_KEY), { app: body.app, message: body.message });
    if (ICON[result.action]) await tell(`${ICON[result.action]} [앱 반영] ${result.note}`);
    return res.status(200).json(result);
  } catch (e) {
    await tell(`${ICON.error} [앱 반영 실패] ${e.message}\n원문: ${String(body.message || "").slice(0, 200)}`);
    return res.status(500).json({ ok: false, action: "error", note: e.message });
  }
}
