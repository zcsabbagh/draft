import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import DocumentPreview from "./mcp-app";
import "./global.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <DocumentPreview />
  </StrictMode>,
);
