import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource/oxanium/latin-400.css";
import "@fontsource/oxanium/latin-500.css";
import "@fontsource/oxanium/latin-600.css";
import "@fontsource/oxanium/latin-700.css";
import "@fontsource/source-code-pro/latin-400.css";
import "@fontsource/source-code-pro/latin-500.css";
import "@fontsource/source-code-pro/latin-600.css";
import "./styles.css";
import "./doom-console.css";
import "./workspace.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
