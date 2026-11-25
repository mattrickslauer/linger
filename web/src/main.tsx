import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { finishRedirectSignIn } from "./auth";
import "./styles.css";

// The OAuth redirect lands on "/": a sign-in popup hands its code back and closes without rendering the app.
finishRedirectSignIn().then((mode) => {
  if (mode === "popup") return;
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
