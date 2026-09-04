alter table public.spec_items
add column parent_id uuid null;

alter table public.spec_items
add constraint spec_items_parent_id_fkey
foreign key (parent_id)
references public.spec_items(id)
on delete restrict;

create index spec_items_parent_id_idx
on public.spec_items(parent_id);