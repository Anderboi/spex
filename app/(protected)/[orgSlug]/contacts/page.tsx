import { ContactsSkeleton } from '@/components/contacts/contacts-skeleton';
import ContactsView from "@/components/contacts/contacts-view";
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { getContactsData } from "@/lib/queries";
import { Plus, UserPlus } from 'lucide-react';
import { Suspense } from 'react';

type Props = { params: Promise<{ orgSlug: string }> };

export const metadata = { title: "Контакты" };

export default async function ContactsPage({ params }: Props) {
  const { orgSlug } = await params;
  return (
    <>
      <PageHeader
        title="Контакты"
        // description="Компании, поставщики и представители. Управляйте справочником и
        //   привязывайте их к позициям спецификации"
      >
        <div className="flex flex-wrap w-full justify-end items-center gap-2">
          <Button
            variant="outline"
            size="lg"
            className="flex-1 whitespace-nowrap bg-bg sm:flex-none"
            // onClick={() => setManagerDialog({ open: true, independent: true })}
          >
            <UserPlus className="mr-1 size-4" /> Добавить специалиста
          </Button>
          <Button
            size="lg"
            className="flex-1 bg-fg whitespace-nowrap sm:flex-none"
            // onClick={() => setCompanyDialogOpen(true)}
          >
            <Plus className="mr-1 size-4" /> Добавить компанию
          </Button>
        </div>
      </PageHeader>
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
