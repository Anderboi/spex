"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { updateMaterialsSearchParams } from "@/lib/materials/filters";
import type { MaterialsFilters } from "@/lib/types";

export function useMaterialsUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const update = useCallback(
    (patch: Partial<MaterialsFilters>) => {
      const qs = updateMaterialsSearchParams(
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
