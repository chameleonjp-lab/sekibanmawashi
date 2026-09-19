import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { GameApp } from "./components/GameApp.tsx";
import "./styles.css";

const root = document.getElementById("app");
if (!root) throw new Error("app root missing");

createRoot(root).render(
  <StrictMode>
    <GameApp />
  </StrictMode>,
);
