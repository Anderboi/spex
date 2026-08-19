import { ContactsSkeleton } from '@/components/contacts/contacts-skeleton';
import ContactsView from "@/components/contacts/contacts-view";
import { PageHeader } from '@/components/layout/page-header';
import { getContactsData } from "@/lib/queries";
import { Suspense } from 'react';

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Контакты" };

export default async function ContactsPage({ params }: Props) {
  const { orgSlug } = await params;
  return (
    <>
      <PageHeader
        title="Контакты"
        description="Компании, поставщики и представители. Управляйте справочником и
          привязывайте их к позициям спецификации"
      />
      <Suspense fallback={<ContactsSkeleton />}>
        <ContactsData orgSlug={orgSlug} />
      </Suspense>
    </>
  );
}

async function ContactsData({ orgSlug }: { orgSlug: string }) {
  const { companies, contacts } = await getContactsData(orgSlug);
  return (
    <ContactsView
      orgSlug={orgSlug}
      initialCompanies={companies}
      initialContacts={contacts}
    />
  );
}
