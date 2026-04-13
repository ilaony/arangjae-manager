import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

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
export const db = getFirestore(app);
