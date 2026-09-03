alter table spec_items
add column parent_id uuid
references spec_items(id)
on delete restrict;