// Loaded the same way the website does it (index.html / dashboard.html /
// admin.html): the web SDK via CDN, running in a real Chromium renderer
// context, not Node. This is why it works here but not in main.js.
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCaDw0tyvGFqJgDTjaresWOe0SyCJo2Tt4",
  authDomain: "the-dilemma-ky.firebaseapp.com",
  projectId: "the-dilemma-ky",
  storageBucket: "the-dilemma-ky.firebasestorage.app",
  messagingSenderId: "785323303290",
  appId: "1:785323303290:web:370f052cc499c8c410f6c3",
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
