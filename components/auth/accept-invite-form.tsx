"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { acceptInviteFromForm, type AcceptInviteState } from "@/actions/teams";

const initialState: AcceptInviteState = { error: null };

/**
 * Кнопка «Принять и войти».
 *
 * Отказ приходит состоянием и показывается рядом с кнопкой. Раньше действие
 * бросало исключение, а в production Next прячет его текст за digest — вместо
 * «приглашение выписано на другой адрес» человек видел «ошибка в Server
 * Components render» и 500 в консоли.
 */
export function AcceptInviteForm({ token }: { token: string }) {
  const [state, formAction, isPending] = useActionState(
    acceptInviteFromForm,
    initialState,
  );

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="token" value={token} />

      {state.error && (
        <p
          role="alert"
          className="flex items-start gap-2 text-left text-sm text-destructive"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" />
          <span>{state.error}</span>
        </p>
      )}

      <Button type="submit" size="lg" className="w-full" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" />
            Принимаем…
          </>
        ) : (
          "Принять и войти"
        )}
      </Button>
    </form>
  );
}
