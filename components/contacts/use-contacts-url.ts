"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { updateContactsSearchParams } from "@/lib/contacts/filters";
import type { ContactsFilters } from "@/lib/types";

export function useContactsUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const update = useCallback(
    (patch: Partial<ContactsFilters>) => {
      const qs = updateContactsSearchParams(
        new URLSearchParams(searchParams.toString()),
        patch,
      );
      const url = qs ? `${pathname}?${qs}` : pathname;
      startTransition(() => {
        router.replace(url, { scroll: false });
      });
    },
    [router, pathname, searchParams],
  );

  return { update, isPending };
}
