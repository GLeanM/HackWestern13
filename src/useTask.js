import { useCallback, useEffect, useRef, useState } from "react";

const POLL_MS = 2000;
const BUSY = new Set(["planning", "researching", "building"]);

/**
 * The user's current shopping task: loads the latest one, polls while
 * something is running, and exposes the actions that start work.
 */
export function useTask(api) {
  const [task, setTaskState] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef(null);
  const alive = useRef(true);

  const load = useCallback(
    async (id) => {
      clearTimeout(timer.current);
      try {
        const { task: t } = await api(`/shopping-tasks/${id}`);
        if (!alive.current) return;
        setTaskState(t);
        if (BUSY.has(t.status)) timer.current = setTimeout(() => load(id), POLL_MS);
      } catch (e) {
        setError(e.body?.message ?? "Couldn't load your plan.");
      }
    },
    [api],
  );

  useEffect(() => {
    alive.current = true;
    api("/shopping-tasks")
      .then(({ tasks }) => (tasks[0] ? load(tasks[0].id) : null))
      .catch(() => {})
      .finally(() => alive.current && setLoaded(true));
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [api, load]);

  // Any update coming back from an action: keep polling if it's busy.
  const setTask = useCallback(
    (t) => {
      setTaskState(t);
      clearTimeout(timer.current);
      if (t && BUSY.has(t.status)) timer.current = setTimeout(() => load(t.id), POLL_MS);
    },
    [load],
  );

  const startPlan = useCallback(
    async (note) => {
      setError("");
      try {
        const { task: t } = await api("/shopping-tasks", { method: "POST", body: { note } });
        setTask(t);
        return true;
      } catch (err) {
        setError(err.body?.message ?? (err.body?.fields ? Object.values(err.body.fields).join(" ") : "Couldn't start planning."));
        return false;
      }
    },
    [api, setTask],
  );

  const refreshPrices = useCallback(async () => {
    if (!task) return;
    setError("");
    try {
      const { task: t } = await api(`/shopping-tasks/${task.id}/research`, { method: "POST" });
      setTask(t);
    } catch (err) {
      setError(err.body?.message ?? "Couldn't start the price search.");
    }
  }, [api, task, setTask]);

  return { task, setTask, loaded, error, setError, startPlan, refreshPrices, reload: load };
}

/** Which step a task belongs on. */
export function stepForTask(task) {
  if (!task) return "plan";
  if (task.status === "building" || task.status === "built") return "build";
  if (task.status === "researching" || task.status === "priced") return "cart";
  return "plan";
}

/** Furthest step the user may open. */
export function maxStepForTask(task) {
  return { profile: 0, plan: 1, cart: 2, build: 3 }[stepForTask(task)] + (task?.status === "priced" ? 1 : 0);
}
