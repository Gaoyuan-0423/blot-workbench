import React, { Suspense, lazy, useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Home from "./Home";
import "./styles.css";

const RealWorkbench = lazy(() => import("./real/RealWorkbench"));

type Route = "home" | "real" | "demo";

function routeFor(hash: string): Route {
  if (hash.startsWith("#real")) return "real";
  if (hash.startsWith("#demo") || hash.startsWith("#guide")) return "demo";
  return "home";
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
