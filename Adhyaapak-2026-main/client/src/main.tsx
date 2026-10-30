import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import "./styles/design.css";
import "./styles/app.css";
import "./styles/studio.css";
import "./styles/studio-today.css";
import "./styles/studio-fx.css";
import "./i18n";
import { App } from "./app/App";
import { ConfigProvider } from "./app/ConfigContext";
import { AuthProvider } from "./features/auth/AuthContext";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ConfigProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ConfigProvider>
    </BrowserRouter>
  </StrictMode>,
);

// Only in a production build: in development the service worker would cache stale code.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("service worker not registered", err));
  });
}
