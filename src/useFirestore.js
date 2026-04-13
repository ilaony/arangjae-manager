import { useState, useEffect, useCallback } from "react";
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  query,
} from "firebase/firestore";
import { db } from "./firebase";

// 숙소별 예약 데이터 실시간 구독
export function useBookings(propertyId) {
  const [bookings, setBookings] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, `bookings-${propertyId}`));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
      setBookings(list);
      setLoading(false);
    });
    return unsub;
  }, [propertyId]);

  const saveBooking = useCallback(
    async (booking) => {
      const { id, ...data } = booking;
      await setDoc(doc(db, `bookings-${propertyId}`, id), data);
    },
    [propertyId]
  );

  const deleteBooking = useCallback(
    async (id) => {
      await deleteDoc(doc(db, `bookings-${propertyId}`, id));
    },
    [propertyId]
  );

  return { bookings, loading, saveBooking, deleteBooking };
}

// 숙소별 청소 데이터 실시간 구독 (date를 doc ID로 사용)
export function useCleaning(propertyId) {
  const [cleaning, setCleaning] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const q = query(collection(db, `cleaning-${propertyId}`));
    const unsub = onSnapshot(q, (snapshot) => {
      const list = snapshot.docs.map((d) => ({ date: d.id, ...d.data() }));
      setCleaning(list);
      setLoading(false);
    });
    return unsub;
  }, [propertyId]);

  const saveCleaning = useCallback(
    async (date, data) => {
      await setDoc(doc(db, `cleaning-${propertyId}`, date), data);
    },
    [propertyId]
  );

  const deleteCleaning = useCallback(
    async (date) => {
      await deleteDoc(doc(db, `cleaning-${propertyId}`, date));
    },
    [propertyId]
  );

  return { cleaning, loading, saveCleaning, deleteCleaning };
}
