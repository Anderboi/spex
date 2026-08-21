"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

type Options = {
  title: string;
  description?: string;
  confirmLabel?: string;
  destructive?: boolean;
};

const Ctx = createContext<(o: Options) => Promise<boolean>>(async () => false);

export const useConfirm = () => useContext(Ctx);

export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [opts, setOpts] = useState<Options | null>(null);
  const resolver = useRef<((v: boolean) => void) | null>(null);

  const confirm = useCallback((o: Options) => {
    setOpts(o);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const close = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOpts(null);
  };

  return (
    <Ctx.Provider value={confirm}>
      {children}
      {opts && (
        <ConfirmDialog
          open
          title={opts.title}
          description={opts.description}
          confirmLabel={opts.confirmLabel ?? "Подтвердить"}
          destructive={opts.destructive}
          onConfirm={() => close(true)}
          onCancel={() => close(false)}
        />
      )}
    </Ctx.Provider>
  );
}
