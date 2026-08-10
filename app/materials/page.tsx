import {
  getCounterparties,
  getMaterials,
} from "@/lib/queries";
import { SearchSortBar } from "@/components/layout/search-sort-bar";
import { Suspense } from "react";
import { MaterialsClient } from "@/components/materials/materials-client";
import { PageHeader } from "@/components/layout/page-header";
import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";



interface MaterialsPageProps {
  searchParams: Promise<{
    q?: string;
    sort?: string;
    action?: string;
    id?: string;
  }>;
}

export default async function MaterialsLibraryPage({
  searchParams,
}: MaterialsPageProps) {
  const resolvedParams = await searchParams;

  const [materials, counterparties] = await Promise.all([
    getMaterials(),
    getCounterparties(),
  ]);

  return (
    <div className="px-4 sm:px-6 md:px-10 pb-35 max-w-7xl mx-auto min-w-0 space-y-6">
      <PageHeader
        title="Библиотека материалов"
        description="Сохраненные позиции и образцы для быстрого добавления в проекты"
      >
        <Button className="h-10 bg-fg">
          <Link
            className="flex flex-row items-center gap-2"
            href="/materials?action=create"
          >
            <Plus className="size-4" /> Добавить в библиотеку
          </Link>
        </Button>
      </PageHeader>

      <Suspense
        fallback={<div className="h-10 bg-muted/30 rounded-lg animate-pulse" />}
      >
        <SearchSortBar
          placeholder="Поиск по материалам, артикулам, брендам…"
          sortOptions={[
            { label: "По названию (А-Я)", value: "name_asc" },
            { label: "По цене (сначала дешевле)", value: "price_asc" },
            { label: "По цене (сначала дороже)", value: "price_desc" },
          ]}
        />
      </Suspense>
      <MaterialsClient
        initialMaterials={materials ?? []}
        companies={counterparties.companies}
        contacts={counterparties.contacts}
        searchParams={resolvedParams}
      />
    </div>
  );
}
