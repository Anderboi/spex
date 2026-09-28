"use client";

import { saveSpecItemPatch } from '@/actions/specifications';
import { SpecItemPatch } from '@/lib/types';
import {
  mergePendingPatch,
  takePendingPatches,
  type PendingPatchEntry,
  type PendingPatchOptions,
} from "@/lib/spec/pending-patches";
import { useCallback, useEffect, useRef, useState } from "react";

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export function useSpecPersistence(orgSlug: string, projectId: string) {
  const queue = useRef(new Map<string, PendingPatchEntry>());
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [status, setStatus] = useState<SaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    if (queue.current.size === 0) return;

    const batch = takePendingPatches(queue.current);
    setStatus("saving");

    const results = await Promise.all(
      batch.map(([id, entry]) =>
        saveSpecItemPatch(orgSlug, projectId, id, entry.patch, {
          explicitQuantity: entry.explicitQuantity,
          explicitSupplier: entry.explicitSupplier,
          composite: entry.composite,
          fillOrigin: entry.fillOrigin,
          cleared: entry.cleared,
        }),
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

  /**
   * Ставит патч в очередь. Патчи одной позиции сливаются, разные позиции
   * независимы; отправка — одна на серию, через 800 мс тишины.
   */
  const push = useCallback(
    (id: string, patch: SpecItemPatch, options: PendingPatchOptions = {}) => {
      queue.current = mergePendingPatch(queue.current, id, patch, options);
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
