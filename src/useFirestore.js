import { useState, useEffect, useCallback, useRef } from "react";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  writeBatch,
  query,
} from "firebase/firestore";
import { db } from "./firebase";

// 숙소별 예약 데이터 실시간 구독
export function useBookings(propertyId) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);
  // 저장 핸들러가 렌더 클로저에 갇힌 낡은 배열을 읽지 않도록 최신 스냅샷을 따로 보관
  const bookingsRef = useRef([]);

  useEffect(() => {
    const q = query(collection(db, `bookings-${propertyId}`));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      bookingsRef.current = list;
      setBookings(list);
      setLoading(false);
    });
    return unsub;
  }, [propertyId]);

  return { bookings, loading, bookingsRef };
}

// 숙소별 청소 데이터 실시간 구독 (date를 doc ID로 사용)
export function useCleaning(propertyId) {
  const [cleaning, setCleaning] = useState([]);
  const [loading, setLoading] = useState(true);
  const cleaningRef = useRef([]);

  useEffect(() => {
    const q = query(collection(db, `cleaning-${propertyId}`));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ date: d.id, ...d.data() }));
      cleaningRef.current = list;
      setCleaning(list);
      setLoading(false);
    });
    return unsub;
  }, [propertyId]);

  const saveCleaning = useCallback(
    (date, data) => setDoc(doc(db, `cleaning-${propertyId}`, date), data),
    [propertyId]
  );

  return { cleaning, loading, cleaningRef, saveCleaning };
}

// 예약 저장과 퇴실일 청소 자동 등록을 하나의 배치로 커밋한다.
// 배치는 원자적이라 "예약만 저장되고 청소는 누락" 같은 반쪽 상태가 생기지 않고,
// 오프라인에서도 로컬 큐에 통째로 쌓였다가 연결 복구 시 함께 전송된다.
export async function saveBookingWithCleaning(
  propertyId,
  booking,
  { oldBooking = null, latestCleaning = [] } = {}
) {
  const { id, ...data } = booking;
  const batch = writeBatch(db);

  batch.set(doc(db, `bookings-${propertyId}`, id), data);

  // 수정으로 퇴실일이 바뀌었으면 옛 퇴실일의 자동 청소를 제거
  if (oldBooking && oldBooking.checkOut !== booking.checkOut) {
    const oldClean = latestCleaning.find(
      (c) => c.date === oldBooking.checkOut && c.status === "scheduled" && c.auto
    );
    if (oldClean) {
      batch.delete(doc(db, `cleaning-${propertyId}`, oldBooking.checkOut));
    }
  }

  // 새 퇴실일에 청소 '예정' 등록. 이미 항목이 있으면 담당자·상태가 지워지지 않도록 손대지 않는다.
  if (!latestCleaning.some((c) => c.date === booking.checkOut)) {
    batch.set(doc(db, `cleaning-${propertyId}`, booking.checkOut), {
      status: "scheduled",
      auto: true,
      cleaner: "",
      memo: "",
    });
  }

  return batch.commit();
}

// 예약 삭제와 딸린 자동 청소 제거도 같은 이유로 한 배치에서 처리한다.
export async function deleteBookingWithCleaning(
  propertyId,
  booking,
  { latestCleaning = [] } = {}
) {
  const batch = writeBatch(db);

  batch.delete(doc(db, `bookings-${propertyId}`, booking.id));

  const autoClean = latestCleaning.find(
    (c) => c.date === booking.checkOut && c.status === "scheduled" && c.auto
  );
  if (autoClean) {
    batch.delete(doc(db, `cleaning-${propertyId}`, booking.checkOut));
  }

  return batch.commit();
}
