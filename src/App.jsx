import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth0 } from "@auth0/auth0-react";
import { useApi } from "./api.js";
import { useTask, stepForTask } from "./useTask.js";
import { TopBar, StepNav, Summary } from "./AppShell.jsx";
import Landing from "./Landing.jsx";
import ProfileForm from "./ProfileForm.jsx";
import MealPlanStep from "./steps/MealPlanStep.jsx";
import CartStep from "./steps/CartStep.jsx";
import BuildStep from "./steps/BuildStep.jsx";
import { Logo, Spinner } from "./ui.jsx";

export default function App() {
  const { isLoading, isAuthenticated, error, loginWithRedirect: login, logout: auth0Logout, user } = useAuth0();
  if (isLoading) {
    return <div className="boot"><Logo /><Spinner label="Loading…" /></div>;
  }
  if (!isAuthenticated) {
    return (
      <Landing
        error={error}
        onLogin={() => login()}
        onSignup={() => login({ authorizationParams: { screen_hint: "signup" } })}
      />
    );
  }
  return <Workspace user={user} onLogout={() => auth0Logout({ logoutParams: { returnTo: window.location.origin } })} />;
}

function Workspace({ user, onLogout }) {
  const api = useApi();
  const { task, setTask, loaded, error, startPlan, refreshPrices, reload } = useTask(api);
  const [profileInfo, setProfileInfo] = useState(null); // { saved, profile }
  useEffect(() => {
    api("/profile")
      .then(({ profile, saved }) => setProfileInfo({ saved, profile }))
      .catch(() => setProfileInfo({ saved: false, profile: null }));
  }, [api]);
  if (!profileInfo) return <div className="boot"><Logo /><Spinner label="Loading your profile…" /></div>;
  return (
    <Shell
      initialProfile={profileInfo.profile}
      initialSaved={profileInfo.saved}
      user={user}
      onLogout={onLogout}
      api={api}
      task={task}
      setTask={setTask}
      loaded={loaded}
      error={error}
      startPlan={startPlan}
      refreshPrices={refreshPrices}
      reload={reload}
      renderProfile={(onLoaded, onSaved) => <ProfileForm onLoaded={onLoaded} onSaved={onSaved} />}
    />
  );
}

/**
 * The signed-in app: top bar, step navigation, the current step, and the
 * summary. Kept free of auth/network hooks so the dev preview can render it
 * with sample data.
 */
export function Shell({ user, onLogout, api, task, setTask, loaded, error, startPlan, refreshPrices, reload, renderProfile, initialProfile = null, initialSaved = false, forceStep = null }) {
  const [profile, setProfile] = useState(initialProfile);
  const [profileSaved, setProfileSaved] = useState(initialSaved);
  const [step, setStep] = useState(forceStep);
  const lastStatus = useRef(null);

  // Open the step that matches the task whenever its status moves on.
  useEffect(() => {
    if (!loaded || forceStep) return;
    const status = task?.status ?? "none";
    if (status === lastStatus.current) return;
    const first = lastStatus.current === null;
    lastStatus.current = status;
    if (first && !profileSaved && !task) return setStep("profile");
    // Planning finished and pricing started: show the list filling in.
    setStep(stepForTask(task));
  }, [loaded, task, profileSaved]);

  const unlocked = useMemo(() => {
    const u = new Set(["profile"]);
    if (profileSaved || task) u.add("plan");
    if (task?.result?.toBuy) u.add("cart");
    if (["priced", "building", "built"].includes(task?.status)) u.add("build");
    return u;
  }, [profileSaved, task]);

  const done = useMemo(() => {
    const d = new Set();
    if (profileSaved) d.add("profile");
    if (task?.result?.meals) d.add("plan");
    if (["building", "built"].includes(task?.status)) d.add("cart");
    if (task?.status === "built") d.add("build");
    return d;
  }, [profileSaved, task]);

  const current = step ?? (loaded ? "profile" : null);
  const goTo = (id) => unlocked.has(id) && setStep(id);

  return (
    <div className="app">
      <TopBar user={user} onLogout={onLogout} task={task} />
      <div className="layout">
        <StepNav step={current} setStep={goTo} unlocked={unlocked} done={done} />
        <main className="main" id="main">
          {!current ? (
            <div className="boot inline"><Spinner label="Loading your plan…" /></div>
          ) : current === "profile" ? (
            renderProfile(
              (saved, p) => { setProfileSaved(saved); setProfile(p); },
              (p) => { setProfileSaved(true); setProfile(p); setStep(task ? stepForTask(task) : "plan"); },
            )
          ) : current === "plan" ? (
            <MealPlanStep task={task} startPlan={startPlan} error={error} profileSaved={profileSaved || Boolean(task)} goTo={goTo} />
          ) : current === "cart" && task ? (
            <CartStep task={task} setTask={setTask} api={api} refreshPrices={refreshPrices} error={error} goTo={goTo} />
          ) : current === "build" && task ? (
            <BuildStep task={task} setTask={setTask} api={api} reload={reload} goTo={goTo} />
          ) : null}
          <footer className="app-foot muted small">
            Not affiliated with T&amp;T Supermarket. Autocart never places orders or pays for you.
          </footer>
        </main>
        <Summary task={task} profile={profile} step={current} setStep={goTo} />
      </div>
    </div>
  );
}
