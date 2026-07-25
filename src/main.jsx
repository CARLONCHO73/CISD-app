// Importante: este import va primero, para que "window.storage" ya
// exista antes de que App.jsx intente usarlo.
import "./lib/storage.js";

import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
