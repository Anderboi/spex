import ContactsView from "@/components/contacts/contacts-view";
import { getContactsData } from '@/lib/queries';

export default async function ContactsPage() {
  const { companies, contacts } = await getContactsData();

  // Разделяем контакты компании и независимые контакты
  const independentContacts = contacts.filter((c) => !c.company_id);

  return (
    <ContactsView
      initialCompanies={companies}
      initialContacts={contacts}
    />
  );
}
