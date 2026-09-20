import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setWorkerUrl } from "maplibre-gl";
import maplibreWorkerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "./styles.css";

/**
 * MapLibre cannot find its own worker under Vite, so the URL is supplied explicitly.
 *
 * `maplibre-gl@6.9.1` derives the worker URL from `import.meta.url` at runtime
 * (`new URL("./maplibre-gl-worker.mjs", import.meta.url)`). Under Vite that
 * resolves against the *served* module path, and no such sibling file exists:
 *   dev   -> GET /node_modules/.vite/deps/maplibre-gl-worker.mjs  404
 *   build -> GET /assets/maplibre-gl-worker.mjs  falls through to index.html
 * The map then renders its canvas, controls, markers and attribution but never
 * any tiles -- a blank cream rectangle with no thrown error, which is why this
 * is easy to miss: only the 404 in the console gives it away.
 *
 * `?worker&url` rather than a plain `?url`: the shipped worker is itself an ES
 * module that imports a sibling `./maplibre-gl-shared.mjs`, which `?url` does not
 * emit, so the worker loaded but its own import 404'd to index.html and tiles
 * still never arrived (measured: 4 metadata requests, 0 tiles). `?worker` makes
 * Vite bundle the worker with that dependency inlined, and `&url` hands back the
 * href `setWorkerUrl` wants rather than a constructor. Verified in both dev and
 * `vite preview`: 18 OpenFreeMap requests and Algiers tiles painted.
 */
setWorkerUrl(maplibreWorkerUrl);

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
});

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>,
);
