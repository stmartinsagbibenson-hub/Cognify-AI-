import { initializeApp } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyBNncLycZDH0SN7DJBOPA8M6I7d2JAElqo",
  authDomain: "cognify-5c357.firebaseapp.com",
  projectId: "cognify-5c357",
  storageBucket: "cognify-5c357.firebasestorage.app",
  messagingSenderId: "506056614406",
  appId: "1:506056614406:web:11b1decc7090140cc1d987"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const provider = new GoogleAuthProvider();
provider.setCustomParameters({ prompt: "select_account" });

const button = document.getElementById("googleSignInButton");
const status = document.getElementById("googleSignInStatus");

window.addEventListener("cognify:firebase-google-signin", async () => {
  if (!button || button.disabled) return;
  button.disabled = true;
  if (status) {
    status.hidden = false;
    status.textContent = "Connecting to Google…";
  }
  try {
    const result = await signInWithPopup(auth, provider);
    const idToken = await result.user.getIdToken(true);
    const response = await fetch("/api/auth/firebase", {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ idToken })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Google sign-in failed.");
    await signOut(auth);
    window.location.assign("/");
  } catch (error) {
    try { await signOut(auth); } catch {}
    if (status) {
      status.hidden = false;
      status.textContent = error?.code === "auth/popup-closed-by-user"
        ? "Google sign-in was cancelled. You can try again."
        : (error?.message || "Google sign-in couldn't be completed. Please try again.");
    }
    button.disabled = false;
  }
});
