// ---------------------------------------------------------------------------
// Firebase, initialised once. Everything imports from here so there is one
// place to change the SDK version, and no chance of two scripts both calling
// initializeApp — which is a real bug, not a theoretical one.
// ---------------------------------------------------------------------------
import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, signInWithCustomToken, signOut, onAuthStateChanged, onIdTokenChanged
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection,
  query, where, orderBy, limit, onSnapshot, getDocs, serverTimestamp,
  arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import {
  getStorage, ref as storageRef, uploadBytesResumable, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-storage.js";
import {
  getFunctions, httpsCallable
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-functions.js";

import { firebaseConfig, FUNCTIONS_REGION } from "./config.js";

export const app  = getApps().length ? getApps()[0] : initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db   = getFirestore(app);
export const storage   = getStorage(app);
export const functions = getFunctions(app, FUNCTIONS_REGION);

export const callable = (name) => httpsCallable(functions, name);

export {
  signInWithCustomToken, signOut, onAuthStateChanged, onIdTokenChanged,
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, query, where,
  orderBy, limit, onSnapshot, getDocs, serverTimestamp, arrayUnion, arrayRemove,
  storageRef, uploadBytesResumable, getDownloadURL, deleteObject
};
