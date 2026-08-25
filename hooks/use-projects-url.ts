"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useTransition } from "react";
import { updateProjectsSearchParams } from "@/lib/projects/filters";
import type { ProjectsFilters } from "@/lib/types";

export function useProjectsUrl() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  const [isPending, startTransition] = useTransition();

  const update = useCallback(
    (patch: Partial<ProjectsFilters>) => {
      const qs = updateProjectsSearchParams(
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
