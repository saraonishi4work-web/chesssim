import { initializeApp } from 'firebase/app';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { getAuth } from 'firebase/auth';
import { getDatabase } from 'firebase/database';

export const PUSHER_KEY = '131e537e8338288feef4';
export const PUSHER_CLUSTER = 'ap3';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? 'chesssim-337cc.firebaseapp.com',
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL ?? 'https://chesssim-337cc-default-rtdb.firebaseio.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? 'chesssim-337cc',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? 'chesssim-337cc.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '708003867603',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '1:708003867603:web:d87da1971cd03ce42b1d26',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID ?? 'G-1273M2H4GZ',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getDatabase(app);

export async function initAnalytics() {
  if (typeof window === 'undefined') return null;
  const supported = await isAnalyticsSupported().catch(() => false);
  if (!supported) return null;
  return getAnalytics(app);
}
