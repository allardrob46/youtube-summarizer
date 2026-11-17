import { useEffect, useState } from "react";

import { getSummary, listSummaries, subscribe, type Summary } from "./storage";

/** The whole library, kept fresh whenever any screen changes storage. */
export function useLibrary(): { items: Summary[]; loading: boolean } {
  const [items, setItems] = useState<Summary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    const load = () => {
      listSummaries().then((list) => {
        if (!alive) return;
        setItems(list);
        setLoading(false);
      });
    };
    load();
    const unsubscribe = subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, []);

  return { items, loading };
}

/** One saved summary by id. `undefined` while loading, `null` when it no longer exists. */
export function useSummary(id: string | undefined): Summary | null | undefined {
  const [state, setState] = useState<{ id: string; item: Summary | null } | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    const load = () => {
      getSummary(id).then((found) => {
        if (alive) setState({ id, item: found });
      });
    };
    load();
    const unsubscribe = subscribe(load);
    return () => {
      alive = false;
      unsubscribe();
    };
  }, [id]);

  if (!id) return null;
  // Ignore a result that belongs to a previous id while the new one loads.
  return state && state.id === id ? state.item : undefined;
}
