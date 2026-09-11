import { ContactsSort } from "./contacts-sort";
import TypeChipsSection from "../spec-builder/type-chips-section";
import { SearchBlock } from "../layout/search-block";

export function ContactsToolbar() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 mt-2 sm:mt-5">
        <SearchBlock
          className="min-w-60 flex-1"
          placeholder="Поиск по названию, категории, имени..."
        />
        <ContactsSort isMobile={false} />
      </div>
      <div className="flex mb-4 gap-2">
        <TypeChipsSection className="//mb-4" />
        <ContactsSort />
      </div>
    </div>
  );
}
