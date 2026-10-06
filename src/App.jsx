import { useState, useRef } from "react";
import {
  useBookings,
  useCleaning,
  saveBookingWithCleaning,
  deleteBookingWithCleaning,
} from "./useFirestore";
import arangjaeLogo from "./assets/arangjae_logo.jpeg";

// ─── Constants ───
const PROPERTIES = [
  { id: "daol", name: "다올 교대", color: "#2563EB" },
  { id: "arangjae-ara", name: "아랑재 아라", color: "#7C3AED" },
  { id: "arangjae-maru", name: "아랑재 마루", color: "#059669" },
];

const CHANNELS = [
  { id: "airbnb", name: "에어비엔비", color: "#FF5A5F" },
  { id: "booking", name: "부킹닷컴", color: "#003580" },
  { id: "naver", name: "네이버플레이스", color: "#03C75A" },
  { id: "trip", name: "트립닷컴", color: "#287DFA" },
];

const CHANNEL_MAP = Object.fromEntries(CHANNELS.map((c) => [c.id, c]));

const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];

const CLEANING_STATUS = {
  none: { label: "없음", color: "transparent" },
  scheduled: { label: "예정", color: "#F59E0B" },
  done: { label: "완료", color: "#10B981" },
  issue: { label: "이슈", color: "#EF4444" },
};

const NATIONALITIES = [
  "한국", "일본", "중국", "미국", "캐나다", "영국", "프랑스", "독일",
  "호주", "대만", "홍콩", "태국", "베트남", "싱가포르", "말레이시아",
  "인도네시아", "필리핀", "인도", "러시아", "브라질", "기타",
];

// ─── Helpers ───
function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}
function getFirstDayOfWeek(year, month) {
  return new Date(year, month, 1).getDay();
}
function toDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}
function parseDate(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}
function reportSyncError(err) {
  console.error(err);
  alert("저장에 실패했습니다. 네트워크 상태를 확인한 뒤 다시 시도해 주세요.");
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (e) { /* fall through */ }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function buildCleaningScheduleText(property, year, month, cleaningData, bookings) {
  const shortName = property.name.split(" ").pop();
  const title = `${year}년 ${month + 1}월 청소일정 - ${shortName}`;
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}-`;
  const entries = cleaningData
    .filter((c) => c.date && c.date.startsWith(prefix) && c.status && c.status !== "none")
    .sort((a, b) => a.date.localeCompare(b.date));

  const lines = entries.map((c) => {
    const day = parseInt(c.date.slice(-2), 10);
    const weekday = WEEKDAYS[new Date(year, month, day).getDay()] + "요일";
    const checkoutBk = bookings.find((b) => b.checkOut === c.date);
    const nextBk = bookings
      .filter((b) => b.checkIn >= c.date)
      .sort((x, y) => x.checkIn.localeCompare(y.checkIn))[0];

    const parts = [];
    parts.push(nextBk ? `${nextBk.guests}인 세팅` : "세팅 미정");
    if (checkoutBk && checkoutBk.luggageAfter) parts.push("체크아웃 후 짐보관");
    if (checkoutBk && checkoutBk.lateCheckOut) parts.push("레이트 체크아웃");
    if (nextBk && nextBk.earlyCheckIn) parts.push("얼리 체크인");

    return `${month + 1}월 ${day}일 ${weekday} ${parts.join(", ")}`;
  });

  return [title, ...lines].join("\n");
}

// ═══════════════════════════════════════
//  Main App
// ═══════════════════════════════════════
export default function App() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());
  const [tab, setTab] = useState("booking");
  const todayStr = toDateStr(now.getFullYear(), now.getMonth(), now.getDate());
  const [selectedDate, setSelectedDate] = useState(todayStr);

  // Firebase 실시간 데이터 - 숙소별
  const daol = useBookings("daol");
  const ara = useBookings("arangjae-ara");
  const maru = useBookings("arangjae-maru");
  const daolClean = useCleaning("daol");
  const araClean = useCleaning("arangjae-ara");
  const maruClean = useCleaning("arangjae-maru");

  const bookingsMap = {
    "daol": daol,
    "arangjae-ara": ara,
    "arangjae-maru": maru,
  };
  const cleaningMap = {
    "daol": daolClean,
    "arangjae-ara": araClean,
    "arangjae-maru": maruClean,
  };

  const loaded =
    !daol.loading && !ara.loading && !maru.loading &&
    !daolClean.loading && !araClean.loading && !maruClean.loading;

  // Modal states
  const [modal, setModal] = useState(null);
  const [detailModal, setDetailModal] = useState(null);
  const [cleaningModal, setCleaningModal] = useState(null);

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(year - 1); }
    else setMonth(month - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(year + 1); }
    else setMonth(month + 1);
  };

  const shiftDay = (delta) => {
    const prev = parseDate(selectedDate);
    const next = new Date(prev);
    next.setDate(next.getDate() + delta);
    setSelectedDate(toDateStr(next.getFullYear(), next.getMonth(), next.getDate()));
    // 달력은 날짜가 월을 넘어갈 때만 따라온다. 월을 직접 넘겨 둘러보는 중이라면 건드리지 않는다.
    if (next.getMonth() !== prev.getMonth() || next.getFullYear() !== prev.getFullYear()) {
      setYear(next.getFullYear());
      setMonth(next.getMonth());
    }
  };
  const goToday = () => {
    setSelectedDate(todayStr);
    setYear(now.getFullYear());
    setMonth(now.getMonth());
  };

  if (!loaded) {
    return (
      <div style={styles.loadingWrap}>
        <div style={styles.spinner} />
        <p style={{ color: "#94A3B8", marginTop: 16, fontFamily: "'Pretendard Variable', sans-serif" }}>
          데이터 불러오는 중...
        </p>
      </div>
    );
  }

  return (
    <div style={styles.root}>
      {/* Header */}
      <header style={styles.header}>
        <div style={styles.headerInner}>
          <div style={styles.logoArea}>
            <img src={arangjaeLogo} alt="아랑재 로고" style={styles.logoIcon} />
            <h1 style={styles.logoText}>아랑재</h1>
          </div>
          <nav style={styles.tabNav}>
            <button
              onClick={() => setTab("booking")}
              style={{ ...styles.tabBtn, ...(tab === "booking" ? styles.tabBtnActive : {}) }}
            >
              📅 예약 관리
            </button>
            <button
              onClick={() => setTab("cleaning")}
              style={{ ...styles.tabBtn, ...(tab === "cleaning" ? styles.tabBtnActive : {}) }}
            >
              🧹 청소 일정
            </button>
          </nav>
        </div>
      </header>

      {/* Today Summary */}
      <TodaySummary
        properties={PROPERTIES}
        bookingsMap={bookingsMap}
        cleaningMap={cleaningMap}
        date={selectedDate}
        todayStr={todayStr}
        onShiftDay={shiftDay}
        onGoToday={goToday}
      />

      {/* Month Navigator */}
      <div style={styles.monthNav}>
        <button onClick={prevMonth} style={styles.navArrow}>◀</button>
        <div style={styles.monthSelector}>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} style={styles.selectBox}>
            {Array.from({ length: 11 }, (_, i) => 2020 + i).map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))} style={styles.selectBox}>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i} value={i}>{i + 1}월</option>
            ))}
          </select>
        </div>
        <button onClick={nextMonth} style={styles.navArrow}>▶</button>
      </div>

      {/* Legend */}
      {tab === "booking" && (
        <div style={styles.legend}>
          {CHANNELS.map((ch) => (
            <span key={ch.id} style={styles.legendItem}>
              <span style={{ ...styles.legendDot, background: ch.color }} />
              {ch.name}
            </span>
          ))}
        </div>
      )}
      {tab === "cleaning" && (
        <div style={styles.legend}>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: "#EF4444" }} />
            미정
          </span>
          <span style={styles.legendItem}>
            <span style={{ ...styles.legendDot, background: "#2563EB" }} />
            담당자 지정됨
          </span>
        </div>
      )}

      {/* Calendars */}
      <div style={styles.calendarsWrap}>
        {PROPERTIES.map((prop) => (
          <PropertyCalendar
            key={prop.id}
            property={prop}
            year={year}
            month={month}
            tab={tab}
            bookings={bookingsMap[prop.id].bookings}
            cleaningData={cleaningMap[prop.id].cleaning}
            onAddBooking={() => setModal({ propertyId: prop.id })}
            onClickBooking={(bId) => setDetailModal({ propertyId: prop.id, bookingId: bId })}
            onClickCleaning={(dateStr) => setCleaningModal({ propertyId: prop.id, date: dateStr })}
          />
        ))}
      </div>

      {/* Booking Modal */}
      {modal && (
        <BookingModal
          property={PROPERTIES.find((p) => p.id === modal.propertyId)}
          bookings={bookingsMap[modal.propertyId].bookings}
          editId={modal.editId}
          year={year}
          month={month}
          onClose={() => setModal(null)}
          onSave={(booking) => {
            const { propertyId, editId } = modal;
            const fb = bookingsMap[propertyId];
            const cl = cleaningMap[propertyId];
            const id = editId || genId();
            const old = editId
              ? fb.bookingsRef.current.find((b) => b.id === editId)
              : null;

            // 예약 쓰기와 청소 자동 등록은 한 배치로 원자적으로 커밋된다.
            // 로컬 캐시에는 즉시 반영되므로 서버 ack를 기다리지 않고 모달을 닫는다.
            saveBookingWithCleaning(
              propertyId,
              { id, ...booking },
              { oldBooking: old, latestCleaning: cl.cleaningRef.current }
            ).catch(reportSyncError);

            setModal(null);
          }}
          onDelete={(id) => {
            const { propertyId } = modal;
            const fb = bookingsMap[propertyId];
            const cl = cleaningMap[propertyId];
            const deleted = fb.bookingsRef.current.find((b) => b.id === id);

            if (deleted) {
              deleteBookingWithCleaning(propertyId, deleted, {
                latestCleaning: cl.cleaningRef.current,
              }).catch(reportSyncError);
            }
            setModal(null);
          }}
        />
      )}

      {/* Detail Modal */}
      {detailModal && (
        <DetailModal
          property={PROPERTIES.find((p) => p.id === detailModal.propertyId)}
          booking={bookingsMap[detailModal.propertyId].bookings.find(
            (b) => b.id === detailModal.bookingId
          )}
          onClose={() => setDetailModal(null)}
          onEdit={() => {
            setModal({ propertyId: detailModal.propertyId, editId: detailModal.bookingId });
            setDetailModal(null);
          }}
          onDelete={() => {
            const { propertyId, bookingId } = detailModal;
            const fb = bookingsMap[propertyId];
            const cl = cleaningMap[propertyId];
            const deleted = fb.bookingsRef.current.find((b) => b.id === bookingId);

            if (deleted) {
              deleteBookingWithCleaning(propertyId, deleted, {
                latestCleaning: cl.cleaningRef.current,
              }).catch(reportSyncError);
            }
            setDetailModal(null);
          }}
        />
      )}

      {/* Cleaning Modal */}
      {cleaningModal && (
        <CleaningModal
          property={PROPERTIES.find((p) => p.id === cleaningModal.propertyId)}
          date={cleaningModal.date}
          cleaningData={cleaningMap[cleaningModal.propertyId].cleaning}
          bookings={bookingsMap[cleaningModal.propertyId].bookings}
          onClose={() => setCleaningModal(null)}
          onSave={(updatedEntry) => {
            cleaningMap[cleaningModal.propertyId]
              .saveCleaning(cleaningModal.date, updatedEntry)
              .catch(reportSyncError);
            setCleaningModal(null);
          }}
        />
      )}
    </div>
  );
}

// ═══════════════════════════════════════
//  TodaySummary
// ═══════════════════════════════════════
const TONES = {
  plain: { bg: "#F1F5F9", fg: "#334155" },
  ok: { bg: "#ECFDF5", fg: "#047857" },
  info: { bg: "#EFF6FF", fg: "#1D4ED8" },
  danger: { bg: "#FEF2F2", fg: "#DC2626" },
  muted: { bg: "transparent", fg: "#94A3B8" },
};

function TodayChip({ tone, children }) {
  const t = TONES[tone];
  return (
    <span style={{ ...styles.todayChip, background: t.bg, color: t.fg }}>
      {children}
    </span>
  );
}

function TodayWarn({ labels }) {
  if (!labels.length) return null;
  return (
    <span style={styles.todayWarn}> ⚠️ {labels.join("·")}</span>
  );
}

// 하루치 숙소별 현황. 기본값은 오늘이고 좌우 스와이프(또는 쉐브론)로 날짜를 옮긴다.
// 한 숙소의 하루는 퇴실 1건 + 입실 1건 + 청소 1건을 넘지 않으므로 한 줄에 고정 배치된다.
function TodaySummary({
  properties, bookingsMap, cleaningMap,
  date, todayStr, onShiftDay, onGoToday,
}) {
  const touch = useRef(null);
  const shown = parseDate(date);
  const isToday = date === todayStr;

  const handleTouchStart = (e) => {
    const t = e.touches[0];
    // iOS standalone PWA 에서 화면 가장자리 스와이프는 뒤로가기로 먹히므로 제외한다
    if (t.clientX < 24 || t.clientX > window.innerWidth - 24) {
      touch.current = null;
      return;
    }
    touch.current = { x: t.clientX, y: t.clientY };
  };
  const handleTouchEnd = (e) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    // 세로 스크롤과 구분하기 위해 가로 이동이 충분히 크고 더 지배적일 때만 반응한다
    if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    onShiftDay(dx < 0 ? 1 : -1);
  };

  const rows = properties.map((prop) => {
    const bookings = bookingsMap[prop.id].bookings;
    const cleaning = cleaningMap[prop.id].cleaning;

    // 한 유닛에 예약이 겹쳐 들어가는 입력 오류가 실제로 있었으므로, 하나만 집지 않고
    // 해당일에 걸린 예약을 모두 모은다. 하나라도 빠뜨리면 달력과 어긋난다.
    const checkOuts = bookings.filter((b) => b.checkOut === date);
    const checkIns = bookings.filter((b) => b.checkIn === date);
    const stayings = bookings.filter((b) => b.checkIn < date && date < b.checkOut);

    // 정상적인 하루는 '퇴실 1건 + 입실 1건(회전)' 또는 '체류 1건'이다. 그걸 넘으면 겹침이다.
    const involved = new Set(
      [...checkOuts, ...checkIns, ...stayings].map((b) => b.id)
    ).size;
    const overlap =
      checkOuts.length > 1 ||
      checkIns.length > 1 ||
      stayings.length > 1 ||
      (stayings.length > 0 && (checkOuts.length > 0 || checkIns.length > 0));

    const entry = cleaning.find((c) => c.date === date) || null;
    const status = entry && entry.status ? entry.status : "none";
    const cleaner = entry && entry.cleaner ? entry.cleaner : "";

    // 청소 필요 여부는 퇴실에서 파생한다. 청소 항목이 없으면 '미등록'으로 드러나므로
    // 자동 등록이 누락돼도 조용히 넘어가지 않는다.
    let clean = null;
    if (checkOuts.length && status === "none") {
      clean = { tone: "danger", text: "🧹 청소 미등록" };
    } else if (status === "done") {
      clean = { tone: "ok", text: `🧹 완료${cleaner ? ` · ${cleaner}` : ""}` };
    } else if (status === "issue") {
      clean = { tone: "danger", text: `🧹 이슈${cleaner ? ` · ${cleaner}` : ""}` };
    } else if (status === "scheduled") {
      clean = cleaner
        ? { tone: "info", text: `🧹 ${cleaner}` }
        : { tone: "danger", text: "🧹 담당자 미정" };
    }

    // 겹침일 때는 체류 손님까지 모두 드러낸다. 평소엔 움직임이 있는 날의 '체류중'이 군더더기라 숨긴다.
    const quiet = checkOuts.length === 0 && checkIns.length === 0;
    const showStay = stayings.length > 0 && (quiet || overlap);
    const showEmpty = quiet && stayings.length === 0;

    return {
      prop, checkOuts, checkIns, stayings,
      involved, overlap, showStay, showEmpty, clean,
    };
  });

  const cleanCount = rows.filter((r) => r.clean).length;
  const alertCount = rows.filter((r) => r.clean && r.clean.tone === "danger").length;
  const overlapCount = rows.filter((r) => r.overlap).length;

  return (
    <section
      style={styles.todayWrap}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <div style={styles.todayHead}>
        <div style={styles.todayNav}>
          <button onClick={() => onShiftDay(-1)} style={styles.todayChevron} aria-label="이전 날">‹</button>
          <span style={styles.todayDate}>
            {isToday ? "오늘 · " : ""}
            {shown.getMonth() + 1}월 {shown.getDate()}일 ({WEEKDAYS[shown.getDay()]})
          </span>
          <button onClick={() => onShiftDay(1)} style={styles.todayChevron} aria-label="다음 날">›</button>
          {!isToday && (
            <button onClick={onGoToday} style={styles.todayJump}>오늘로</button>
          )}
        </div>
        <span
          style={{
            ...styles.todayAgg,
            color: alertCount || overlapCount ? "#DC2626" : "#64748B",
          }}
        >
          {cleanCount === 0
            ? "청소 없음"
            : alertCount
            ? `청소 ${cleanCount}건 · 확인 필요 ${alertCount}건 ⚠️`
            : `청소 ${cleanCount}건 · 담당자 배정 완료`}
          {overlapCount > 0 && ` · 예약 겹침 ${overlapCount}건 ⚠️`}
        </span>
      </div>

      {rows.map((r) => (
        <div
          key={r.prop.id}
          style={{ ...styles.todayRow, borderLeft: `3px solid ${r.prop.color}` }}
        >
          <span style={{ ...styles.todayProp, color: r.prop.color }}>
            {r.prop.name}
          </span>
          <div style={styles.todayChips}>
            {r.checkOuts.map((b) => (
              <TodayChip key={`o-${b.id}`} tone="plain">
                🚪 {b.guestName}
                <TodayWarn
                  labels={[
                    b.lateCheckOut && "레이트",
                    b.luggageAfter && "짐보관",
                  ].filter(Boolean)}
                />
              </TodayChip>
            ))}
            {r.checkOuts.length > 0 && r.checkIns.length > 0 && (
              <span style={styles.todayArrow}>→</span>
            )}
            {r.checkIns.map((b) => (
              <TodayChip key={`i-${b.id}`} tone="plain">
                🔑 {b.guestName} {b.guests}명
                <TodayWarn
                  labels={[
                    b.earlyCheckIn && "얼리",
                    b.luggageBefore && "짐보관",
                  ].filter(Boolean)}
                />
              </TodayChip>
            ))}
            {r.showStay &&
              r.stayings.map((b) => (
                <TodayChip key={`s-${b.id}`} tone="muted">
                  💤 체류중 · {b.guestName}
                </TodayChip>
              ))}
            {r.showEmpty && <TodayChip tone="muted">빈방</TodayChip>}
            {r.overlap && (
              <TodayChip tone="danger">⚠️ 예약 {r.involved}건 겹침</TodayChip>
            )}
            {r.clean && <TodayChip tone={r.clean.tone}>{r.clean.text}</TodayChip>}
          </div>
        </div>
      ))}
    </section>
  );
}

// ═══════════════════════════════════════
//  PropertyCalendar
// ═══════════════════════════════════════
function PropertyCalendar({
  property, year, month, tab, bookings, cleaningData,
  onAddBooking, onClickBooking, onClickCleaning,
}) {
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfWeek(year, month);
  const today = new Date();
  const todayStr = toDateStr(today.getFullYear(), today.getMonth(), today.getDate());

  // bookingMap for cleaning tab (per-day lookup)
  const bookingMap = {};
  bookings.forEach((b) => {
    const start = parseDate(b.checkIn);
    const end = parseDate(b.checkOut);
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      const ds = toDateStr(d.getFullYear(), d.getMonth(), d.getDate());
      if (!bookingMap[ds]) bookingMap[ds] = [];
      bookingMap[ds].push(b);
    }
  });

  const cleanMap = {};
  cleaningData.forEach((c) => { cleanMap[c.date] = c; });

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // --- Booking segments & lane assignment for spanning bars ---
  const laneMap = {};
  const segments = [];
  if (tab === "booking") {
    // Assign lanes (vertical slots) so overlapping bookings don't collide
    const sorted = [...bookings].sort((a, b) => a.checkIn.localeCompare(b.checkIn));
    const laneEnds = [];
    sorted.forEach((b) => {
      let lane = -1;
      for (let i = 0; i < laneEnds.length; i++) {
        if (b.checkIn >= laneEnds[i]) { lane = i; break; }
      }
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(null); }
      laneEnds[lane] = b.checkOut;
      laneMap[b.id] = lane;
    });

    // Build segments: one per week-row per booking
    const monthStart = new Date(year, month, 1);
    const monthEnd = new Date(year, month, daysInMonth);
    bookings.forEach((b) => {
      const checkIn = parseDate(b.checkIn);
      const checkOut = parseDate(b.checkOut);
      const visStart = checkIn < monthStart ? monthStart : checkIn;
      const lastDay = new Date(checkOut);
      lastDay.setDate(lastDay.getDate() - 1);
      const visEnd = lastDay > monthEnd ? monthEnd : lastDay;
      if (visStart > monthEnd || visEnd < monthStart) return;

      const startDay = visStart.getDate();
      const endDay = visEnd.getDate();
      for (let d = startDay; d <= endDay; ) {
        const cellIdx = firstDay + d - 1;
        const row = Math.floor(cellIdx / 7) + 1;
        const col = (cellIdx % 7) + 1;
        const remainWeek = 7 - col + 1;
        const remainBook = endDay - d + 1;
        const span = Math.min(remainWeek, remainBook);
        const isFirst = (d === startDay) && (checkIn >= monthStart);
        const isLast = (d + span - 1 === endDay) && (lastDay <= monthEnd);

        segments.push({
          booking: b,
          row, startCol: col, span,
          isFirst, isLast,
          lane: laneMap[b.id] || 0,
        });
        d += span;
      }
    });
  }

  const totalRows = Math.ceil(cells.length / 7);

  return (
    <div style={{ ...styles.calendarCard, borderTop: `3px solid ${property.color}` }}>
      <div style={styles.calendarHeader}>
        <h2 style={{ ...styles.calendarTitle, color: property.color }}>{property.name}</h2>
        {tab === "booking" && (
          <button onClick={onAddBooking} style={{ ...styles.addBtn, background: property.color }}>
            + 예약 추가
          </button>
        )}
        {tab === "cleaning" && (
          <button
            onClick={async () => {
              const text = buildCleaningScheduleText(property, year, month, cleaningData, bookings);
              const ok = await copyToClipboard(text);
              alert(ok ? "청소일정을 클립보드에 복사했습니다." : "복사에 실패했습니다.");
            }}
            style={{ ...styles.addBtn, background: property.color }}
          >
            📋 복사
          </button>
        )}
      </div>

      <div style={styles.weekdayRow}>
        {WEEKDAYS.map((w, i) => (
          <div key={i} style={{ ...styles.weekdayCell, color: i === 0 ? "#EF4444" : i === 6 ? "#3B82F6" : "#64748B" }}>
            {w}
          </div>
        ))}
      </div>

      <div style={{
        ...styles.daysGrid,
        gridTemplateRows: `repeat(${totalRows}, 64px)`,
      }}>
        {/* Day cells */}
        {cells.map((day, idx) => {
          const row = Math.floor(idx / 7) + 1;
          const col = (idx % 7) + 1;
          if (day === null) return (
            <div key={`e-${idx}`} style={{ ...styles.emptyCell, gridRow: row, gridColumn: col }} />
          );
          const dateStr = toDateStr(year, month, day);
          const isToday = dateStr === todayStr;
          const dayOfWeek = (firstDay + day - 1) % 7;
          const cleanEntry = cleanMap[dateStr] || null;
          const cleanStatus = cleanEntry ? cleanEntry.status || "none" : "none";
          const cleanerName = cleanEntry ? cleanEntry.cleaner || "" : "";
          const hasCleaning = cleanStatus !== "none";

          return (
            <div
              key={day}
              style={{
                ...styles.dayCell,
                gridRow: row, gridColumn: col,
                ...(isToday ? styles.todayCell : {}),
                ...(tab === "cleaning" && hasCleaning
                  ? { background: cleanerName ? "#EFF6FF" : "#FEF2F2" }
                  : {}),
              }}
              onClick={() => {
                if (tab === "cleaning" && hasCleaning) onClickCleaning(dateStr);
              }}
            >
              <span
                style={{
                  ...styles.dayNum,
                  color: dayOfWeek === 0 ? "#EF4444" : dayOfWeek === 6 ? "#3B82F6" : "#1E293B",
                  ...(isToday ? styles.todayNum : {}),
                }}
              >
                {day}
              </span>

              {tab === "cleaning" && hasCleaning && (() => {
                const nextBk = bookings
                  .filter((bk) => bk.checkIn >= dateStr)
                  .sort((x, y) => x.checkIn.localeCompare(y.checkIn))[0];
                return (
                  <div style={styles.cleanIndicators}>
                    <div
                      style={{
                        ...styles.cleanTag,
                        background: cleanerName ? "#2563EB" : "#EF4444",
                        cursor: "pointer",
                      }}
                    >
                      <span style={styles.cleanTagText}>
                        🧹 {cleanerName || "미정"}
                      </span>
                    </div>
                    {nextBk && (
                      <div style={styles.cleanGuestTag}>
                        👤 {nextBk.guests}명
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          );
        })}

        {/* Booking spanning bars */}
        {tab === "booking" && segments.map((seg, i) => {
          const ch = CHANNEL_MAP[seg.booking.channel];
          const color = ch ? ch.color : "#94A3B8";
          const radiusL = seg.isFirst ? 6 : 0;
          const radiusR = seg.isLast ? 6 : 0;
          return (
            <div
              key={`seg-${i}`}
              onClick={() => onClickBooking(seg.booking.id)}
              style={{
                gridRow: seg.row,
                gridColumn: `${seg.startCol} / ${seg.startCol + seg.span}`,
                alignSelf: "start",
                marginTop: 22 + seg.lane * 18,
                height: 16,
                background: color,
                borderRadius: `${radiusL}px ${radiusR}px ${radiusR}px ${radiusL}px`,
                cursor: "pointer",
                overflow: "hidden",
                padding: "0 4px",
                zIndex: 1,
                display: "flex",
                alignItems: "center",
              }}
              title={`${seg.booking.guestName} (${ch ? ch.name : ""})`}
            >
              <span style={styles.bookingTagText}>
                {seg.isFirst ? "▶ " : ""}{seg.booking.guestName}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
//  BookingModal
// ═══════════════════════════════════════
function BookingModal({ property, bookings, editId, year, month, onClose, onSave, onDelete }) {
  const existing = editId ? bookings.find((b) => b.id === editId) : null;

  const [checkIn, setCheckIn] = useState(existing ? existing.checkIn : "");
  const [checkOut, setCheckOut] = useState(existing ? existing.checkOut : "");
  const [channel, setChannel] = useState(existing ? existing.channel : "airbnb");
  const [guestName, setGuestName] = useState(existing ? existing.guestName : "");
  const [phone, setPhone] = useState(existing ? existing.phone : "");
  const [guests, setGuests] = useState(existing ? existing.guests : 1);
  const [nationality, setNationality] = useState(existing ? existing.nationality : "한국");
  const [memo, setMemo] = useState(existing ? existing.memo : "");
  const [earlyCheckIn, setEarlyCheckIn] = useState(existing ? existing.earlyCheckIn : false);
  const [lateCheckOut, setLateCheckOut] = useState(existing ? existing.lateCheckOut : false);
  const [luggageBefore, setLuggageBefore] = useState(existing ? existing.luggageBefore : false);
  const [luggageAfter, setLuggageAfter] = useState(existing ? existing.luggageAfter : false);
  const [selecting, setSelecting] = useState(existing ? null : "checkIn");
  const [calYear, setCalYear] = useState(year);
  const [calMonth, setCalMonth] = useState(month);

  const daysInMonth = getDaysInMonth(calYear, calMonth);
  const firstDay = getFirstDayOfWeek(calYear, calMonth);

  const otherBookings = bookings.filter((b) => b.id !== editId);
  const occupiedDates = new Set();
  otherBookings.forEach((b) => {
    const start = parseDate(b.checkIn);
    const end = parseDate(b.checkOut);
    for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
      occupiedDates.add(toDateStr(d.getFullYear(), d.getMonth(), d.getDate()));
    }
  });

  const handleDayClick = (day) => {
    const dateStr = toDateStr(calYear, calMonth, day);
    if (selecting === "checkIn") {
      setCheckIn(dateStr);
      setSelecting("checkOut");
      if (checkOut && dateStr >= checkOut) setCheckOut("");
    } else if (selecting === "checkOut") {
      if (dateStr > checkIn) {
        setCheckOut(dateStr);
        setSelecting(null);
      }
    }
  };

  const isInRange = (day) => {
    if (!checkIn || !checkOut) return false;
    const ds = toDateStr(calYear, calMonth, day);
    return ds >= checkIn && ds < checkOut;
  };

  const cells = [];
  for (let i = 0; i < firstDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const canSave = checkIn && checkOut && guestName.trim();

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>
            <span style={{ color: property.color }}>●</span>{" "}
            {property.name} — {editId ? "예약 수정" : "예약 추가"}
          </h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={styles.modalBody}>
          {/* Mini Calendar */}
          <div style={styles.miniCalSection}>
            <div style={styles.miniCalNav}>
              <button
                onClick={() => {
                  if (calMonth === 0) { setCalMonth(11); setCalYear(calYear - 1); }
                  else setCalMonth(calMonth - 1);
                }}
                style={styles.miniNavBtn}
              >◀</button>
              <span style={styles.miniCalLabel}>{calYear}년 {calMonth + 1}월</span>
              <button
                onClick={() => {
                  if (calMonth === 11) { setCalMonth(0); setCalYear(calYear + 1); }
                  else setCalMonth(calMonth + 1);
                }}
                style={styles.miniNavBtn}
              >▶</button>
            </div>

            <div style={styles.selectingHint}>
              {selecting === "checkIn" && "📌 입실일을 선택하세요"}
              {selecting === "checkOut" && "📌 퇴실일을 선택하세요"}
              {!selecting && checkIn && checkOut && ("✅ " + checkIn + " → " + checkOut)}
            </div>

            <div style={styles.miniWeekRow}>
              {WEEKDAYS.map((w, i) => (
                <div key={i} style={styles.miniWeekCell}>{w}</div>
              ))}
            </div>
            <div style={styles.miniDaysGrid}>
              {cells.map((day, idx) => {
                if (!day) return <div key={`e-${idx}`} style={styles.miniEmpty} />;
                const ds = toDateStr(calYear, calMonth, day);
                const isCI = ds === checkIn;
                const isCO = ds === checkOut;
                const inRange = isInRange(day);
                const isOccupied = occupiedDates.has(ds);

                return (
                  <div
                    key={day}
                    onClick={() => handleDayClick(day)}
                    style={{
                      ...styles.miniDayCell,
                      background: isCI ? property.color : isCO ? property.color : inRange ? property.color + "30" : isOccupied ? "#FEE2E2" : "transparent",
                      color: isCI || isCO ? "#FFF" : isOccupied ? "#DC2626" : "#334155",
                      cursor: selecting ? "pointer" : "default",
                      fontWeight: isCI || isCO ? 700 : 400,
                      borderRadius: isCI ? "8px 0 0 8px" : isCO ? "0 8px 8px 0" : inRange ? "0" : "8px",
                    }}
                  >
                    {day}
                  </div>
                );
              })}
            </div>
            <div style={styles.dateDisplayRow}>
              <button
                onClick={() => setSelecting("checkIn")}
                style={{
                  ...styles.datePicker,
                  borderColor: selecting === "checkIn" ? property.color : "#CBD5E1",
                  background: selecting === "checkIn" ? property.color + "10" : "#FFF",
                }}
              >
                <div style={styles.datePickerLabel}>입실일</div>
                <div style={styles.datePickerValue}>{checkIn || "선택"}</div>
              </button>
              <span style={{ color: "#94A3B8", fontSize: 20 }}>→</span>
              <button
                onClick={() => { if (checkIn) setSelecting("checkOut"); }}
                style={{
                  ...styles.datePicker,
                  borderColor: selecting === "checkOut" ? property.color : "#CBD5E1",
                  background: selecting === "checkOut" ? property.color + "10" : "#FFF",
                }}
              >
                <div style={styles.datePickerLabel}>퇴실일</div>
                <div style={styles.datePickerValue}>{checkOut || "선택"}</div>
              </button>
            </div>
          </div>

          {/* Form Fields */}
          <div style={styles.formSection}>
            <label style={styles.formLabel}>유입경로</label>
            <div style={styles.channelRow}>
              {CHANNELS.map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setChannel(ch.id)}
                  style={{
                    ...styles.channelBtn,
                    background: channel === ch.id ? ch.color : "#F1F5F9",
                    color: channel === ch.id ? "#FFF" : "#475569",
                    fontWeight: channel === ch.id ? 700 : 400,
                  }}
                >
                  {ch.name}
                </button>
              ))}
            </div>

            <div style={styles.formGrid}>
              <div style={styles.formField}>
                <label style={styles.formLabel}>예약자명</label>
                <input value={guestName} onChange={(e) => setGuestName(e.target.value)} style={styles.input} placeholder="이름 입력" />
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>연락처</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)} style={styles.input} placeholder="010-0000-0000" />
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>인원수</label>
                <input type="number" min={1} max={30} value={guests} onChange={(e) => setGuests(Number(e.target.value))} style={styles.input} />
              </div>
              <div style={styles.formField}>
                <label style={styles.formLabel}>국적</label>
                <select value={nationality} onChange={(e) => setNationality(e.target.value)} style={styles.input}>
                  {NATIONALITIES.map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            </div>

            <div style={styles.formField}>
              <label style={styles.formLabel}>메모</label>
              <textarea
                value={memo}
                onChange={(e) => setMemo(e.target.value)}
                style={{ ...styles.input, minHeight: 60, resize: "vertical" }}
                placeholder="특이사항 메모"
              />
            </div>

            <label style={styles.formLabel}>추가 옵션</label>
            <div style={styles.optionsGrid}>
              {[
                { label: "얼리 체크인", val: earlyCheckIn, set: setEarlyCheckIn },
                { label: "레이트 체크아웃", val: lateCheckOut, set: setLateCheckOut },
                { label: "체크인 전 짐보관", val: luggageBefore, set: setLuggageBefore },
                { label: "체크아웃 후 짐보관", val: luggageAfter, set: setLuggageAfter },
              ].map((opt) => (
                <label key={opt.label} style={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={opt.val}
                    onChange={(e) => opt.set(e.target.checked)}
                    style={styles.checkbox}
                  />
                  {opt.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div style={styles.modalFooter}>
          {editId && (
            <button onClick={() => onDelete(editId)} style={styles.deleteBtn}>삭제</button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={styles.cancelBtn}>취소</button>
          <button
            disabled={!canSave}
            onClick={() =>
              onSave({
                checkIn, checkOut, channel, guestName, phone,
                guests, nationality, memo,
                earlyCheckIn, lateCheckOut, luggageBefore, luggageAfter,
              })
            }
            style={{
              ...styles.saveBtn,
              background: canSave ? property.color : "#CBD5E1",
              cursor: canSave ? "pointer" : "not-allowed",
            }}
          >
            {editId ? "수정 완료" : "예약 저장"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
//  DetailModal
// ═══════════════════════════════════════
function DetailModal({ property, booking, onClose, onEdit, onDelete }) {
  if (!booking) return null;
  const ch = CHANNEL_MAP[booking.channel];
  const nights = Math.round(
    (parseDate(booking.checkOut) - parseDate(booking.checkIn)) / 86400000
  );

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: 440, minHeight: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>
            <span style={{ color: property.color }}>●</span> 예약 상세
          </h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>
        <div style={{ padding: "20px 24px" }}>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>예약자</span>
            <span style={styles.detailValue}>{booking.guestName}</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>숙소</span>
            <span style={styles.detailValue}>{property.name}</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>일정</span>
            <span style={styles.detailValue}>{booking.checkIn} → {booking.checkOut} ({nights}박)</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>유입경로</span>
            <span style={{ ...styles.channelBadge, background: ch ? ch.color : "#94A3B8" }}>{ch ? ch.name : "-"}</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>연락처</span>
            <span style={styles.detailValue}>{booking.phone || "-"}</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>인원</span>
            <span style={styles.detailValue}>{booking.guests}명</span>
          </div>
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>국적</span>
            <span style={styles.detailValue}>{booking.nationality}</span>
          </div>
          {booking.memo && (
            <div style={styles.detailRow}>
              <span style={styles.detailLabel}>메모</span>
              <span style={styles.detailValue}>{booking.memo}</span>
            </div>
          )}
          <div style={styles.detailRow}>
            <span style={styles.detailLabel}>옵션</span>
            <span style={styles.detailValue}>
              {[
                booking.earlyCheckIn && "얼리체크인",
                booking.lateCheckOut && "레이트체크아웃",
                booking.luggageBefore && "체크인전 짐보관",
                booking.luggageAfter && "체크아웃후 짐보관",
              ].filter(Boolean).join(", ") || "없음"}
            </span>
          </div>
        </div>
        <div style={{ ...styles.modalFooter, borderTop: "1px solid #E2E8F0" }}>
          <button onClick={onDelete} style={styles.deleteBtn}>삭제</button>
          <div style={{ flex: 1 }} />
          <button onClick={onEdit} style={{ ...styles.saveBtn, background: property.color }}>수정</button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
//  CleaningModal
// ═══════════════════════════════════════
function CleaningModal({ property, date, cleaningData, bookings, onClose, onSave }) {
  const existing = cleaningData.find((c) => c.date === date);
  const [cleaner, setCleaner] = useState(existing ? existing.cleaner || "" : "");
  const [status, setStatus] = useState(existing ? existing.status || "scheduled" : "scheduled");
  const [cleanMemo, setCleanMemo] = useState(existing ? existing.memo || "" : "");

  const checkoutBooking = bookings.find((b) => b.checkOut === date);
  const nextBooking = bookings
    .filter((bk) => bk.checkIn >= date)
    .sort((x, y) => x.checkIn.localeCompare(y.checkIn))[0] || null;

  return (
    <div style={styles.overlay} onClick={onClose}>
      <div style={{ ...styles.modal, maxWidth: 480, minHeight: "auto" }} onClick={(e) => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <h2 style={styles.modalTitle}>
            <span style={{ color: property.color }}>●</span> 청소 일정 관리
          </h2>
          <button onClick={onClose} style={styles.closeBtn}>✕</button>
        </div>

        <div style={{ padding: "20px 24px" }}>
          <div style={styles.cleanInfoBox}>
            <div style={styles.cleanInfoTitle}>📅 {date}</div>
            <div style={styles.cleanInfoSub}>{property.name}</div>
          </div>

          <div style={styles.cleanSection}>
            <div style={styles.cleanSectionTitle}>🚪 퇴실 정보</div>
            {checkoutBooking ? (
              <div style={styles.cleanInfoCard}>
                <div style={styles.cleanInfoRow}>
                  <span style={styles.cleanInfoLabel}>예약자</span>
                  <span style={styles.cleanInfoValue}>{checkoutBooking.guestName}</span>
                </div>
                <div style={styles.cleanInfoRow}>
                  <span style={styles.cleanInfoLabel}>레이트 체크아웃</span>
                  <span style={{
                    ...styles.cleanInfoValue,
                    color: checkoutBooking.lateCheckOut ? "#DC2626" : "#64748B",
                    fontWeight: checkoutBooking.lateCheckOut ? 700 : 400,
                  }}>
                    {checkoutBooking.lateCheckOut ? "⚠️ 있음" : "없음"}
                  </span>
                </div>
                <div style={styles.cleanInfoRow}>
                  <span style={styles.cleanInfoLabel}>체크아웃 후 짐보관</span>
                  <span style={{
                    ...styles.cleanInfoValue,
                    color: checkoutBooking.luggageAfter ? "#DC2626" : "#64748B",
                    fontWeight: checkoutBooking.luggageAfter ? 700 : 400,
                  }}>
                    {checkoutBooking.luggageAfter ? "⚠️ 있음" : "없음"}
                  </span>
                </div>
              </div>
            ) : (
              <div style={styles.cleanEmptyNote}>해당일 퇴실 예약 없음</div>
            )}
          </div>

          <div style={styles.cleanSection}>
            <div style={styles.cleanSectionTitle}>📋 다음 입실 정보</div>
            {nextBooking ? (
              <div style={styles.cleanInfoCard}>
                <div style={styles.cleanInfoRow}>
                  <span style={styles.cleanInfoLabel}>예약자</span>
                  <span style={styles.cleanInfoValue}>{nextBooking.guestName}</span>
                </div>
                <div style={styles.cleanInfoRow}>
                  <span style={styles.cleanInfoLabel}>입실일</span>
                  <span style={styles.cleanInfoValue}>{nextBooking.checkIn}</span>
                </div>
                <div style={styles.cleanInfoRow}>
                  <span style={styles.cleanInfoLabel}>인원수</span>
                  <span style={{ ...styles.cleanInfoValue, fontWeight: 700 }}>
                    {nextBooking.guests}명
                  </span>
                </div>
                {nextBooking.earlyCheckIn && (
                  <div style={styles.cleanInfoRow}>
                    <span style={styles.cleanInfoLabel}>얼리 체크인</span>
                    <span style={{ ...styles.cleanInfoValue, color: "#DC2626", fontWeight: 700 }}>
                      ⚠️ 있음
                    </span>
                  </div>
                )}
              </div>
            ) : (
              <div style={styles.cleanEmptyNote}>다음 입실 예약 없음</div>
            )}
          </div>

          <div style={styles.cleanSection}>
            <div style={styles.cleanSectionTitle}>🧹 청소 설정</div>
            <div style={{ marginTop: 8 }}>
              <label style={styles.formLabel}>청소 상태</label>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                {Object.entries(CLEANING_STATUS).filter(([k]) => k !== "none").map(([k, v]) => (
                  <button
                    key={k}
                    onClick={() => setStatus(k)}
                    style={{
                      padding: "7px 14px", border: "none", borderRadius: 8,
                      fontSize: 13, cursor: "pointer", fontFamily: "inherit",
                      background: status === k ? v.color : "#F1F5F9",
                      color: status === k ? "#FFF" : "#475569",
                      fontWeight: status === k ? 700 : 400,
                      transition: "all 0.15s",
                    }}
                  >
                    {v.label}
                  </button>
                ))}
              </div>

              <label style={styles.formLabel}>청소 담당자</label>
              <input
                value={cleaner}
                onChange={(e) => setCleaner(e.target.value)}
                style={styles.input}
                placeholder="담당자 이름 입력"
              />

              <label style={{ ...styles.formLabel, marginTop: 14 }}>메모</label>
              <textarea
                value={cleanMemo}
                onChange={(e) => setCleanMemo(e.target.value)}
                style={{ ...styles.input, minHeight: 50, resize: "vertical" }}
                placeholder="청소 관련 메모"
              />
            </div>
          </div>
        </div>

        <div style={styles.modalFooter}>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={styles.cancelBtn}>취소</button>
          <button
            onClick={() => onSave({
              status,
              cleaner: cleaner.trim(),
              memo: cleanMemo,
              auto: existing ? existing.auto || false : false,
            })}
            style={{ ...styles.saveBtn, background: property.color }}
          >
            저장
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
//  Styles
// ═══════════════════════════════════════
const styles = {
  root: {
    fontFamily: "'Pretendard Variable', -apple-system, BlinkMacSystemFont, sans-serif",
    minHeight: "100vh",
    background: "#F8FAFC",
    color: "#1E293B",
  },
  loadingWrap: {
    display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", background: "#F8FAFC",
  },
  spinner: {
    width: 40, height: 40, border: "3px solid #E2E8F0", borderTop: "3px solid #3B82F6",
    borderRadius: "50%", animation: "spin 0.8s linear infinite",
  },
  header: {
    background: "#FFF",
    borderBottom: "1px solid #E2E8F0",
    position: "sticky", top: 0, zIndex: 50,
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  headerInner: {
    maxWidth: 1400, margin: "0 auto", padding: "0 24px",
    display: "flex", alignItems: "center", justifyContent: "space-between",
    height: 60,
  },
  logoArea: { display: "flex", alignItems: "center", gap: 10 },
  logoIcon: { height: 32, borderRadius: 6, objectFit: 'contain' },
  logoText: {
    fontSize: 20, fontWeight: 800, margin: 0,
    background: "linear-gradient(135deg, #2563EB, #7C3AED)",
    WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
  },
  tabNav: { display: "flex", gap: 4 },
  tabBtn: {
    padding: "8px 18px", border: "none", borderRadius: 8,
    background: "transparent", color: "#64748B", cursor: "pointer",
    fontSize: 14, fontWeight: 600, fontFamily: "inherit",
    transition: "all 0.15s",
  },
  tabBtnActive: { background: "#EFF6FF", color: "#2563EB" },
  todayWrap: {
    maxWidth: 1400, margin: "16px auto 0", padding: "0 16px",
    display: "flex", flexDirection: "column", gap: 6,
    touchAction: "pan-y",
  },
  todayNav: { display: "flex", alignItems: "center", gap: 2 },
  todayChevron: {
    border: "none", background: "transparent", cursor: "pointer",
    color: "#94A3B8", fontSize: 20, lineHeight: 1, padding: "0 6px",
    fontFamily: "inherit",
  },
  todayJump: {
    marginLeft: 8, padding: "3px 10px", border: "1px solid #BFDBFE",
    borderRadius: 999, background: "#EFF6FF", color: "#1D4ED8",
    fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  todayHead: {
    display: "flex", alignItems: "baseline", justifyContent: "space-between",
    gap: 10, flexWrap: "wrap", padding: "0 2px 4px",
  },
  todayDate: { fontSize: 14, fontWeight: 800, color: "#1E293B" },
  todayAgg: { fontSize: 12, fontWeight: 700 },
  todayRow: {
    display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap",
    background: "#FFF", borderRadius: 10, padding: "9px 12px",
    boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
  },
  todayProp: { fontSize: 13, fontWeight: 800, minWidth: 86 },
  todayChips: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" },
  todayChip: {
    display: "inline-flex", alignItems: "center",
    padding: "3px 9px", borderRadius: 999,
    fontSize: 12, fontWeight: 600, whiteSpace: "nowrap",
  },
  todayWarn: { color: "#DC2626", fontWeight: 800 },
  todayArrow: { color: "#94A3B8", fontSize: 12, fontWeight: 700 },
  monthNav: {
    display: "flex", alignItems: "center", justifyContent: "center", gap: 16,
    padding: "20px 0 8px",
  },
  navArrow: {
    width: 40, height: 40, border: "1px solid #E2E8F0", borderRadius: 10,
    background: "#FFF", cursor: "pointer", fontSize: 16, color: "#475569",
    display: "flex", alignItems: "center", justifyContent: "center",
    fontFamily: "inherit", transition: "all 0.15s",
  },
  monthSelector: { display: "flex", gap: 8 },
  selectBox: {
    padding: "8px 14px", border: "1px solid #E2E8F0", borderRadius: 8,
    background: "#FFF", fontSize: 16, fontWeight: 700, color: "#1E293B",
    cursor: "pointer", fontFamily: "inherit",
  },
  legend: {
    display: "flex", justifyContent: "center", gap: 20, padding: "12px 0 4px",
    flexWrap: "wrap",
  },
  legendItem: { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#64748B" },
  legendDot: { width: 10, height: 10, borderRadius: "50%", display: "inline-block" },
  calendarsWrap: {
    maxWidth: 1400, margin: "0 auto", padding: "16px 16px 40px",
    display: "flex", flexDirection: "column", gap: 24,
  },
  calendarCard: {
    background: "#FFF", borderRadius: 14,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)",
    overflow: "hidden",
  },
  calendarHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "16px 20px 12px",
  },
  calendarTitle: { fontSize: 18, fontWeight: 800, margin: 0 },
  addBtn: {
    padding: "7px 16px", border: "none", borderRadius: 8,
    color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  weekdayRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "0 12px", gap: 2 },
  weekdayCell: { textAlign: "center", fontSize: 12, fontWeight: 700, padding: "6px 0" },
  daysGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", padding: "4px 12px 16px", gap: 2 },
  emptyCell: { height: 64 },
  dayCell: {
    height: 64, padding: "4px 4px 2px", borderRadius: 8,
    position: "relative", transition: "background 0.15s", cursor: "default", overflow: "hidden",
  },
  todayCell: { background: "#EFF6FF" },
  dayNum: { fontSize: 13, fontWeight: 600, display: "inline-block", padding: "1px 4px" },
  todayNum: { background: "#2563EB", color: "#FFF", borderRadius: 6, padding: "1px 6px" },
  bookingTagText: {
    fontSize: 10, color: "#FFF", fontWeight: 600,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block",
  },
  cleanIndicators: { display: "flex", flexDirection: "column", gap: 2, marginTop: 2 },
  cleanTag: { padding: "2px 5px", borderRadius: 4, overflow: "hidden" },
  cleanTagText: {
    fontSize: 10, color: "#FFF", fontWeight: 600,
    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block",
  },
  cleanGuestTag: {
    fontSize: 10, fontWeight: 600, color: "#64748B",
    padding: "1px 5px", background: "#F1F5F9", borderRadius: 4, whiteSpace: "nowrap",
  },
  overlay: {
    position: "fixed", inset: 0, background: "rgba(0,0,0,0.45)",
    display: "flex", alignItems: "center", justifyContent: "center",
    zIndex: 100, padding: 16,
  },
  modal: {
    background: "#FFF", borderRadius: 16, width: "100%", maxWidth: 640,
    maxHeight: "90vh", overflow: "auto", boxShadow: "0 20px 60px rgba(0,0,0,0.2)",
  },
  modalHeader: {
    display: "flex", alignItems: "center", justifyContent: "space-between",
    padding: "18px 24px 14px", borderBottom: "1px solid #F1F5F9",
  },
  modalTitle: { fontSize: 18, fontWeight: 800, margin: 0, display: "flex", alignItems: "center", gap: 8 },
  closeBtn: {
    width: 32, height: 32, border: "none", borderRadius: 8,
    background: "#F1F5F9", cursor: "pointer", fontSize: 16,
    display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "inherit",
  },
  modalBody: { padding: "16px 24px" },
  miniCalSection: { marginBottom: 20, padding: 16, background: "#F8FAFC", borderRadius: 12 },
  miniCalNav: { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 },
  miniNavBtn: {
    border: "none", background: "transparent", cursor: "pointer",
    fontSize: 14, color: "#64748B", padding: "4px 8px", fontFamily: "inherit",
  },
  miniCalLabel: { fontSize: 15, fontWeight: 700, color: "#1E293B" },
  selectingHint: { textAlign: "center", fontSize: 13, color: "#64748B", padding: "4px 0 8px", fontWeight: 500 },
  miniWeekRow: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 },
  miniWeekCell: { textAlign: "center", fontSize: 11, fontWeight: 700, color: "#94A3B8", padding: 4 },
  miniDaysGrid: { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 },
  miniEmpty: { height: 32 },
  miniDayCell: {
    height: 32, display: "flex", alignItems: "center", justifyContent: "center",
    fontSize: 13, transition: "all 0.1s",
  },
  dateDisplayRow: { display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 14 },
  datePicker: {
    flex: 1, padding: "10px 12px", border: "2px solid #CBD5E1",
    borderRadius: 10, background: "#FFF", cursor: "pointer",
    textAlign: "center", fontFamily: "inherit", maxWidth: 170,
  },
  datePickerLabel: { fontSize: 11, color: "#94A3B8", fontWeight: 600 },
  datePickerValue: { fontSize: 14, fontWeight: 700, color: "#1E293B", marginTop: 2 },
  formSection: {},
  formLabel: { fontSize: 13, fontWeight: 700, color: "#475569", display: "block", marginBottom: 6, marginTop: 14 },
  channelRow: { display: "flex", gap: 6, flexWrap: "wrap" },
  channelBtn: {
    padding: "7px 14px", border: "none", borderRadius: 8,
    fontSize: 13, cursor: "pointer", fontFamily: "inherit", transition: "all 0.15s",
  },
  formGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0 16px" },
  formField: {},
  input: {
    width: "100%", padding: "9px 12px", border: "1px solid #E2E8F0", borderRadius: 8,
    fontSize: 14, color: "#1E293B", fontFamily: "inherit", background: "#FFF",
    boxSizing: "border-box", outline: "none",
  },
  optionsGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 16px" },
  checkboxLabel: {
    display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#334155",
    cursor: "pointer", padding: "6px 10px", background: "#F8FAFC", borderRadius: 8,
  },
  checkbox: { width: 16, height: 16, cursor: "pointer", accentColor: "#2563EB" },
  modalFooter: { display: "flex", alignItems: "center", gap: 8, padding: "14px 24px 18px" },
  deleteBtn: {
    padding: "9px 18px", border: "1px solid #FCA5A5", borderRadius: 8,
    background: "#FEF2F2", color: "#DC2626", fontSize: 13, fontWeight: 700,
    cursor: "pointer", fontFamily: "inherit",
  },
  cancelBtn: {
    padding: "9px 18px", border: "1px solid #E2E8F0", borderRadius: 8,
    background: "#FFF", color: "#64748B", fontSize: 13, fontWeight: 600,
    cursor: "pointer", fontFamily: "inherit",
  },
  saveBtn: {
    padding: "9px 22px", border: "none", borderRadius: 8,
    color: "#FFF", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit",
  },
  detailRow: {
    display: "flex", alignItems: "flex-start", gap: 12,
    padding: "10px 0", borderBottom: "1px solid #F1F5F9",
  },
  detailLabel: { width: 80, fontSize: 13, fontWeight: 700, color: "#94A3B8", flexShrink: 0 },
  detailValue: { fontSize: 14, color: "#1E293B", fontWeight: 500 },
  channelBadge: { padding: "3px 10px", borderRadius: 6, color: "#FFF", fontSize: 12, fontWeight: 700 },
  cleanInfoBox: { background: "#F8FAFC", borderRadius: 10, padding: "14px 16px", marginBottom: 16, textAlign: "center" },
  cleanInfoTitle: { fontSize: 18, fontWeight: 800, color: "#1E293B" },
  cleanInfoSub: { fontSize: 13, color: "#64748B", marginTop: 4 },
  cleanSection: { marginBottom: 18 },
  cleanSectionTitle: {
    fontSize: 14, fontWeight: 700, color: "#334155",
    marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #F1F5F9",
  },
  cleanInfoCard: { background: "#F8FAFC", borderRadius: 10, padding: "10px 14px" },
  cleanInfoRow: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "7px 0", borderBottom: "1px solid #E2E8F0",
  },
  cleanInfoLabel: { fontSize: 13, fontWeight: 600, color: "#94A3B8" },
  cleanInfoValue: { fontSize: 13, color: "#1E293B" },
  cleanEmptyNote: {
    fontSize: 13, color: "#94A3B8", fontStyle: "italic",
    padding: "10px 14px", background: "#F8FAFC", borderRadius: 10,
  },
};
