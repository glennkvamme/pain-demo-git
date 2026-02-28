import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import ForingPage from "./pages/ForingPage";
import CreditorsPage from "./pages/CreditorsPage";
import HistoryPage from "./pages/HistoryPage";
import TilKundePage from "./pages/TilKundePage";

function SideMenu() {
  const location = useLocation();
  const linkClass = ({ isActive }) => `manage-link${isActive ? " active" : ""}`;
  const pathParts = location.pathname.split("/").filter(Boolean);
  const foringId = (pathParts[0] === "foring" || pathParts[0] === "til-kunde") ? pathParts[1] : "";
  const isForingContext = Boolean(foringId);

  return (
    <nav className="side-menu" aria-label="Sidenavigasjon">
      <p className="menu-title">Meny</p>
      {isForingContext ? (
        <>
          <NavLink className={linkClass} to="/">Oversikt</NavLink>
          <NavLink className={linkClass} to={`/til-kunde/${foringId}`}>Til kunde</NavLink>
        </>
      ) : (
        <>
          <NavLink className={linkClass} to="/">Oversikt</NavLink>
          <NavLink className={linkClass} to="/creditors">Vedlikehold kreditorliste</NavLink>
          <NavLink className={linkClass} to="/history">Historikk og backup</NavLink>
        </>
      )}
    </nav>
  );
}

function Layout({ children }) {
  return (
    <main className="card">
      <header className="brand-header">
        <img className="brand-logo" src="/assets/logos/kraftbank-logo.svg" alt="Kraft Bank logo" />
        <img className="brand-icon" src="/assets/logos/kraftbank-logopain.svg" alt="Kraft Bank logopain" />
      </header>
      <div className="page-layout">
        <SideMenu />
        <section className="content-area">
          {children}
          <footer className="page-version">Versjon v2.03</footer>
        </section>
      </div>
    </main>
  );
}

export default function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route path="/foring/:foringId" element={<ForingPage />} />
        <Route path="/creditors" element={<CreditorsPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/til-kunde/:foringId" element={<TilKundePage />} />
      </Routes>
    </Layout>
  );
}
