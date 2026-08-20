"use client";

import { saveSpecItemPatch } from '@/actions/specifications';
import { SpecItemPatch } from '@/lib/types';
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useSpecPersistence(orgSlug: string, projectId: string) {
  const queue = useRef(new Map<string, SpecItemPatch>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (queue.current.size === 0) return;

    const batch = [...queue.current.entries()];
    queue.current.clear();
    setStatus("saving");

    const results = await Promise.all(
      batch.map(([id, patch]) =>
        saveSpecItemPatch(orgSlug, projectId, id, patch),
      ),
    );
    const failed = results.find((r) => !r.success);
    if (failed && !failed.success) {
      setStatus("error");
      setError(failed.error);
      return;
    }
    setStatus("saved");
    setError(null);
  }, [orgSlug, projectId]);

  /** Ставит патч в очередь. Патчи одной позиции сливаются. */
  const push = useCallback(
    (id: string, patch: SpecItemPatch) => {
      queue.current.set(id, { ...queue.current.get(id), ...patch });
      setStatus("saving");
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), 800);
    },
    [flush],
  );

  // вкладку свернули/закрыли — не теряем несохранённое
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") void flush();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      void flush();
    };
  }, [flush]);

  // предупреждение при закрытии с несохранёнными правками
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (queue.current.size > 0) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, []);

  return {
    push,
    flush,
    status,
    error,
    hasPending: () => queue.current.size > 0,
  };
}
