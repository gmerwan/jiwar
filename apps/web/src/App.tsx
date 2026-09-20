import { BrowserRouter, Route, Routes } from "react-router-dom";
import { NotFound } from "./routes/NotFound.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
