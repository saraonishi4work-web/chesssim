import { initializeApp } from 'firebase/app';
import { getDatabase } from 'firebase/database';

const firebaseConfig = {
  apiKey: 'AIzaSyBH8e2VztztQHlwKBB4RM-19UvPwkYOdqg',
  authDomain: 'chesssim-337cc.firebaseapp.com',
  databaseURL: 'https://chesssim-337cc-default-rtdb.firebaseio.com',
  projectId: 'chesssim-337cc',
  storageBucket: 'chesssim-337cc.firebasestorage.app',
  messagingSenderId: '708003867603',
  appId: '1:708003867603:web:d87da1971cd03ce42b1d26',
  measurementId: 'G-1273M2H4GZ',
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
