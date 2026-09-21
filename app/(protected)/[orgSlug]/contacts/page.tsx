import { ContactsSkeleton } from "@/components/contacts/contacts-skeleton";
import { ContactsToolbar } from "@/components/contacts/contacts-toolbar";
import { ContactsList } from "@/components/contacts/contacts-list";
import { ContactsPagination } from "@/components/contacts/contacts-pagination";
import { ContactsHeaderActions } from "@/components/contacts/contacts-header-actions";
import { PageHeader } from "@/components/layout/page-header";
import { parseContactsFilters } from "@/lib/contacts/filters";
import { getContactsDirectory } from "@/lib/queries";
import { Suspense } from "react";

type Props = {
  params: Promise<{ orgSlug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export const metadata = { title: "Контакты" };

export default async function ContactsPage({ params, searchParams }: Props) {
  const { orgSlug } = await params;

  return (
    <>
      <PageHeader title="Контакты">
        <ContactsHeaderActions />
      </PageHeader>
      <Suspense fallback={<ContactsSkeleton />}>
        <ContactsData orgSlug={orgSlug} searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function ContactsData({
  orgSlug,
  searchParams,
}: {
  orgSlug: string;
  searchParams: Props["searchParams"];
}) {
  const sp = await searchParams;
  const filters = parseContactsFilters(sp);

  const {
    companies,
    independentContacts,
    managers,
    companiesCount,
    independentCount,
    pageCount,
    independentPageCount,
    page,
  } = await getContactsDirectory(orgSlug, filters);

  return (
    <>
      <ContactsToolbar />

      <ContactsList
        orgSlug={orgSlug}
        companies={companies}
        independentContacts={independentContacts}
        managers={managers}
        companiesCount={companiesCount}
        independentCount={independentCount}
        tab={filters.tab}
        page={page}
      />

      {/* Пагинация вне suspense-границы списка: при клиентской навигации она не
          размонтируется и не мигает. Объём страниц читает сама из своих пропсов. */}
      <ContactsPagination
        pageCount={pageCount}
        independentPageCount={independentPageCount}
      />
    </>
  );
}
