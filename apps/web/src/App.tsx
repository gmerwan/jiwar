import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "./routes/Home.js";
import { NotFound } from "./routes/NotFound.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
