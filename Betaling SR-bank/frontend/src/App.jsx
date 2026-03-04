import { useAuth0 } from "@auth0/auth0-react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import DashboardPage from "./pages/DashboardPage";
import ForingPage from "./pages/ForingPage";
import CreditorsPage from "./pages/CreditorsPage";
import HistoryPage from "./pages/HistoryPage";
import TilKundePage from "./pages/TilKundePage";

const ROLE_ADMIN = "admin";
const ROLE_ADVISOR = "advisor";
const rolesClaim = import.meta.env.VITE_AUTH0_ROLES_CLAIM ?? "https://betaling-app/roles";
const ADMIN_ALIASES = new Set(["admin", "administrator"]);
const ADVISOR_ALIASES = new Set(["advisor", "radgiver"]);

function normalizeRole(role) {
  return String(role ?? "")
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractRoles(user) {
  const rawRoles = user?.[rolesClaim];
  if (!Array.isArray(rawRoles)) {
    return [];
  }

  return rawRoles.map(normalizeRole).filter(Boolean);
}

function SideMenu({ isAdmin }) {
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
        </>
      ) : (
        <>
          <NavLink className={linkClass} to="/">Oversikt</NavLink>
          {isAdmin ? <NavLink className={linkClass} to="/creditors">Vedlikehold kreditorliste</NavLink> : null}
          {isAdmin ? <NavLink className={linkClass} to="/history">Historikk og backup</NavLink> : null}
        </>
      )}
    </nav>
  );
}

function Layout({ children, isAdmin }) {
  const { user, logout } = useAuth0();

  return (
    <main className="card">
      <header className="brand-header">
        <img className="brand-logo" src="/assets/logos/kraftbank-logo.svg" alt="Kraft Bank logo" />
        <div className="auth-header-actions">
          <span className="auth-user" title={user?.email ?? ""}>{user?.name ?? user?.email}</span>
          <span className="role-chip">{isAdmin ? "Administrator" : "Rådgiver"}</span>
          <button
            type="button"
            className="secondary-btn"
            onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })}
          >
            Logg ut
          </button>
        </div>
      </header>
      <div className="page-layout">
        <SideMenu isAdmin={isAdmin} />
        <section className="content-area">
          {children}
          <footer className="page-version">Versjon v.2.1.1</footer>
        </section>
      </div>
    </main>
  );
}

function LoginView({ errorMessage }) {
  const { loginWithRedirect } = useAuth0();

  return (
    <main className="card auth-view">
      <header className="brand-header">
        <img className="brand-logo" src="/assets/logos/kraftbank-logo.svg" alt="Kraft Bank logo" />
        <img className="brand-icon" src="/assets/logos/kraftbank-logopain.svg" alt="Kraft Bank logopain" />
      </header>
      <h1>Logg inn for å fortsette</h1>
      <p>Du må være autentisert for å bruke Betaling i Kraft Bank.</p>
      {errorMessage ? <p className="live-validation">{errorMessage}</p> : null}
      <div className="actions actions-left">
        <button type="button" onClick={() => loginWithRedirect()}>Logg inn</button>
      </div>
    </main>
  );
}

function LoadingView() {
  return (
    <main className="card auth-view">
      <p>Laster inn autentisering ...</p>
    </main>
  );
}

function AccessDeniedView() {
  const { loginWithRedirect } = useAuth0();

  return (
    <main className="card auth-view">
      <h1>Ingen tilgang</h1>
      <p>Du har ikke rolle som kreves for denne siden.</p>
      <div className="actions actions-left">
        <NavLink className="action-link" to="/">Til oversikt</NavLink>
        <button
          type="button"
          className="secondary-btn"
          onClick={() => loginWithRedirect({ authorizationParams: { prompt: "login" } })}
        >
          Logg inn på nytt
        </button>
      </div>
    </main>
  );
}

function hasRole(userRoles, role) {
  if (role === ROLE_ADMIN) {
    return userRoles.some((userRole) => ADMIN_ALIASES.has(userRole));
  }

  if (role === ROLE_ADVISOR) {
    return userRoles.some((userRole) => ADVISOR_ALIASES.has(userRole));
  }

  return userRoles.includes(role);
}

function RequireRole({ allowedRoles, userRoles, children }) {
  const hasAccess = allowedRoles.some((role) => hasRole(userRoles, role));
  if (!hasAccess) {
    return <AccessDeniedView />;
  }

  return children;
}

export default function App() {
  const { isAuthenticated, isLoading, error, user } = useAuth0();
  const userRoles = extractRoles(user);
  const isAdmin = hasRole(userRoles, ROLE_ADMIN);
  const hasKnownRole = isAdmin || hasRole(userRoles, ROLE_ADVISOR);

  const query = new URLSearchParams(window.location.search);
  const auth0Error = query.get("error_description") ?? query.get("error");
  const authErrorMessage = error?.message ?? auth0Error;

  if (isLoading) {
    return <LoadingView />;
  }

  if (!isAuthenticated) {
    return <LoginView errorMessage={authErrorMessage} />;
  }

  if (!hasKnownRole) {
    return <AccessDeniedView />;
  }

  return (
    <Layout isAdmin={isAdmin}>
      <Routes>
        <Route path="/" element={<DashboardPage />} />
        <Route
          path="/foring/:foringId"
          element={(
            <RequireRole allowedRoles={[ROLE_ADVISOR, ROLE_ADMIN]} userRoles={userRoles}>
              <ForingPage />
            </RequireRole>
          )}
        />
        <Route
          path="/creditors"
          element={(
            <RequireRole allowedRoles={[ROLE_ADMIN]} userRoles={userRoles}>
              <CreditorsPage />
            </RequireRole>
          )}
        />
        <Route
          path="/history"
          element={(
            <RequireRole allowedRoles={[ROLE_ADMIN]} userRoles={userRoles}>
              <HistoryPage />
            </RequireRole>
          )}
        />
        <Route
          path="/til-kunde/:foringId"
          element={(
            <RequireRole allowedRoles={[ROLE_ADVISOR, ROLE_ADMIN]} userRoles={userRoles}>
              <TilKundePage />
            </RequireRole>
          )}
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  );
}


