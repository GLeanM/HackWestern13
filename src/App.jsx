import { useAuth0 } from "@auth0/auth0-react";
import ProfileForm from "./ProfileForm.jsx";

function App() {
  const { isLoading, isAuthenticated, error, loginWithRedirect: login, logout: auth0Logout, user } = useAuth0();

  const signup = () => login({ authorizationParams: { screen_hint: "signup" } });
  const logout = () => auth0Logout({ logoutParams: { returnTo: window.location.origin } });

  if (isLoading) return <main className="page"><p>Loading…</p></main>;

  return (
    <main className="page">
      <header className="topbar">
        <h1>CartPilot</h1>
        {isAuthenticated && (
          <div className="who">
            <span>{user.email ?? user.name}</span>
            <button className="secondary" onClick={logout}>Log out</button>
          </div>
        )}
      </header>

      {isAuthenticated ? (
        <ProfileForm />
      ) : (
        <section className="card">
          <p>Your personal grocery-shopping agent for T&amp;T Supermarket.</p>
          {error && <p className="error">Error: {error.message}</p>}
          <div className="actions">
            <button onClick={() => login()}>Log in</button>
            <button className="secondary" onClick={signup}>Sign up</button>
          </div>
        </section>
      )}
      <footer className="muted">Not affiliated with T&amp;T Supermarket. CartPilot never places orders or pays for you.</footer>
    </main>
  );
}

export default App;
