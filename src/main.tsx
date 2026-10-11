import React, { Suspense, lazy, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const RealWorkbench = lazy(() => import("./real/RealWorkbench"));

function WorkspaceRouter() {
  const [real, setReal] = useState(() => window.location.hash === "#real");
  useEffect(() => {
    const update = () => setReal(window.location.hash === "#real");
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return real ? (
    <Suspense
      fallback={
        <div role="status">
          正在打开真实图像工作区 / Opening image workspace…
        </div>
      }
    >
      <RealWorkbench
        onDemo={() => {
          window.location.hash = "demo";
        }}
      />
    </Suspense>
  ) : (
    <App />
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceRouter />
  </React.StrictMode>,
);
