import { BrowserRouter, Routes, Route } from 'react-router-dom';
import SplashPage from './pages/SplashPage';
import RegionSelectPage from './pages/RegionSelectPage';
import RecordPage from './pages/RecordPage';
import SonicMapPage from './pages/SonicMapPage';
import ComparePage from './pages/ComparePage';

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<SplashPage />} />
        <Route path="/select" element={<RegionSelectPage />} />
        <Route path="/record/:regionId" element={<RecordPage />} />
        <Route path="/map" element={<SonicMapPage />} />
        <Route path="/compare" element={<ComparePage />} />
      </Routes>
    </BrowserRouter>
  );
}
