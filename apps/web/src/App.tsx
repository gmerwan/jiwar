import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Home } from "./routes/Home.js";
import { NoticeDetail } from "./routes/NoticeDetail.js";
import { NotFound } from "./routes/NotFound.js";
import { Submit } from "./routes/Submit.js";

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/submit" element={<Submit />} />
        <Route path="/n/:publicId" element={<NoticeDetail />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </BrowserRouter>
  );
}
