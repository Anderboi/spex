import { ContactsSort } from "./contacts-sort";
import TypeChipsSection from "../spec-builder/type-chips-section";
import { SearchBlock } from "../layout/search-block";

export function ContactsToolbar() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <SearchBlock
          className="min-w-60 flex-1"
          placeholder="Поиск по названию, категории, имени..."
        />
        <ContactsSort />
      </div>
      <TypeChipsSection className="mb-4" />
    </div>
  );
}
