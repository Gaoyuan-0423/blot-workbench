import React, { Suspense, lazy, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Home from "./Home";
import "./styles.css";
import "./theme.css";

const RealWorkbench = lazy(() => import("./real/RealWorkbench"));

const SingleStripApp = lazy(() => import("./single/SingleStripApp"));
const QuickApp = lazy(() => import("./quick/QuickApp"));

type Route = "home" | "real" | "demo" | "single" | "quick";

function routeFor(hash: string): Route {
  const mode = new URLSearchParams(window.location.search).get("mode");
  if (mode === "single" || mode === "quick") return mode;
  if (hash.startsWith("#real")) return "real";
  if (hash.startsWith("#demo") || hash.startsWith("#guide")) return "demo";
  return mode === "project" ? "demo" : "home";
}

function WorkspaceRouter() {
  const [route, setRoute] = useState<Route>(() =>
    routeFor(window.location.hash),
  );
  useEffect(() => {
    const update = () => setRoute(routeFor(window.location.hash));
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);

  if (route === "single" || route === "quick")
    return (
      <Suspense
        fallback={
          <div className="workspace-loading" role="status">
            正在打开条带工作区…
          </div>
        }
      >
        {route === "single" ? <SingleStripApp /> : <QuickApp />}
      </Suspense>
    );

  if (route === "real")
    return (
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
    );
  if (route === "demo") return <App />;
  return <Home />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WorkspaceRouter />
  </React.StrictMode>,
);
