
import { initializeApp } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.2.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyACGlRx2t_TTvA7GjgTyseSs5b2wTyhW1Q",
    authDomain: "projeto-cloud-feedbacks.firebaseapp.com",
    projectId: "projeto-cloud-feedbacks",
    storageBucket: "projeto-cloud-feedbacks.firebasestorage.app",
    messagingSenderId: "396059566237",
    appId: "1:396059566237:web:36134cd356331ad84ef474"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

export { app, auth };
