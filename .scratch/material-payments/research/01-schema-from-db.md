# Живая схема Supabase — дайджест каталога

Снято: 2026-10-09T10:23:08.692968+00:00
Источник: `temp/introspect.sql` через Management API (read-only). Сырой JSON — `01-catalog.json`.

## 1. RLS по таблицам

| таблица | RLS включён | политик | команды |
| --- | --- | --- | --- |
| accounts | да | 1 | ALL/public |
| companies | да | 0 | — |
| contacts | да | 0 | — |
| materials | да | 0 | — |
| organization_invites | да | 3 | DELETE/authenticated, INSERT/authenticated, SELECT/authenticated |
| organization_members | да | 3 | DELETE/authenticated, INSERT/authenticated, SELECT/authenticated |
| organizations | да | 2 | SELECT/authenticated, UPDATE/authenticated |
| password_reset_tokens | да | 1 | ALL/public |
| project_service_items | **НЕТ** | 0 | — |
| project_services | **НЕТ** | 0 | — |
| projects | да | 4 | DELETE/public, INSERT/public, SELECT/public, UPDATE/public |
| public_links | **НЕТ** | 0 | — |
| reserved_slugs | **НЕТ** | 0 | — |
| service_operation_items | да | 4 | DELETE/authenticated, INSERT/authenticated, SELECT/authenticated, UPDATE/authenticated |
| service_operations | да | 4 | DELETE/authenticated, INSERT/authenticated, SELECT/authenticated, UPDATE/authenticated |
| sessions | да | 1 | ALL/public |
| spec_item_comments | да | 4 | DELETE/authenticated, INSERT/authenticated, SELECT/authenticated, UPDATE/authenticated |
| spec_item_components | да | 4 | DELETE/authenticated, INSERT/authenticated, SELECT/authenticated, UPDATE/authenticated |
| spec_item_events | да | 1 | SELECT/authenticated |
| spec_item_files | да | 1 | SELECT/authenticated |
| spec_item_variants | да | 0 | — |
| spec_items | да | 0 | — |
| users | да | 1 | ALL/service_role |
| verification_tokens | да | 1 | ALL/public |
| storage.objects | (см. storage) | 3 | DELETE, INSERT, SELECT |

## 2. Полные тексты политик

### public.accounts

- **Service role access for accounts** (`ALL`, PERMISSIVE, roles: public)
  - using: `true`

### public.organization_invites

- **organization_invites_delete_manager** (`DELETE`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.org_id = organization_invites.org_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::org_role, 'admin'::org_role])))))`
- **organization_invites_insert_manager** (`INSERT`, PERMISSIVE, roles: authenticated)
  - with check: `(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.org_id = organization_invites.org_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::org_role, 'admin'::org_role])))))`
- **organization_invites_select_manager** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.org_id = organization_invites.org_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::org_role, 'admin'::org_role])))))`

### public.organization_members

- **organization_members_delete_manager** (`DELETE`, PERMISSIVE, roles: authenticated)
  - using: `((user_id <> auth.uid()) AND (EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.org_id = organization_members.org_id) AND (m.user_id = auth.uid()) AND ((m.role = 'owner'::org_role) OR ((m.role = 'admin'::org_role) AND (organization_members.role = 'member'::org_role)))))))`
- **organization_members_insert_manager** (`INSERT`, PERMISSIVE, roles: authenticated)
  - with check: `(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.org_id = organization_members.org_id) AND (m.user_id = auth.uid()) AND (m.role = ANY (ARRAY['owner'::org_role, 'admin'::org_role])))))`
- **organization_members_select_own_org** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `is_org_member(org_id)`

### public.organizations

- **organizations_select_own** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `is_org_member(id)`
- **organizations_update_owner** (`UPDATE`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.org_id = organizations.id) AND (m.user_id = auth.uid()) AND (m.role = 'owner'::org_role))))`
  - with check: `(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.org_id = organizations.id) AND (m.user_id = auth.uid()) AND (m.role = 'owner'::org_role))))`

### public.password_reset_tokens

- **Service role access for password_reset_tokens** (`ALL`, PERMISSIVE, roles: public)
  - using: `true`

### public.projects

- **Участники организации могут обнов** (`UPDATE`, PERMISSIVE, roles: public)
  - using: `is_org_member(org_id)`
- **Участники организации могут просм** (`SELECT`, PERMISSIVE, roles: public)
  - using: `is_org_member(org_id)`
- **Участники организации могут созда** (`INSERT`, PERMISSIVE, roles: public)
  - with check: `is_org_member(org_id)`
- **Участники организации могут удаля** (`DELETE`, PERMISSIVE, roles: public)
  - using: `is_org_member(org_id)`

### public.service_operation_items

- **service_operation_items_delete_own_org** (`DELETE`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN service_operations so ON ((so.id = service_operation_items.operation_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = so.org_id))))`
- **service_operation_items_insert_own_org** (`INSERT`, PERMISSIVE, roles: authenticated)
  - with check: `(EXISTS ( SELECT 1
   FROM ((organization_members m
     JOIN service_operations so ON ((so.id = service_operation_items.operation_id)))
     JOIN spec_items si ON ((si.id = service_operation_items.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = so.org_id) AND (si.org_id = so.org_id) AND (si.project_id = so.project_id))))`
- **service_operation_items_select_own_org** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN service_operations so ON ((so.id = service_operation_items.operation_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = so.org_id))))`
- **service_operation_items_update_own_org** (`UPDATE`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN service_operations so ON ((so.id = service_operation_items.operation_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = so.org_id))))`
  - with check: `(EXISTS ( SELECT 1
   FROM ((organization_members m
     JOIN service_operations so ON ((so.id = service_operation_items.operation_id)))
     JOIN spec_items si ON ((si.id = service_operation_items.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = so.org_id) AND (si.org_id = so.org_id) AND (si.project_id = so.project_id))))`

### public.service_operations

- **service_operations_delete_own_org** (`DELETE`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = service_operations.org_id))))`
- **service_operations_insert_own_org** (`INSERT`, PERMISSIVE, roles: authenticated)
  - with check: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN projects p ON ((p.id = service_operations.project_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = service_operations.org_id) AND (p.org_id = service_operations.org_id))))`
- **service_operations_select_own_org** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = service_operations.org_id))))`
- **service_operations_update_own_org** (`UPDATE`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = service_operations.org_id))))`
  - with check: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN projects p ON ((p.id = service_operations.project_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = service_operations.org_id) AND (p.org_id = service_operations.org_id))))`

### public.sessions

- **Service role access for sessions** (`ALL`, PERMISSIVE, roles: public)
  - using: `true`

### public.spec_item_comments

- **spec_item_comments_delete_author** (`DELETE`, PERMISSIVE, roles: authenticated)
  - using: `((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_comments.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_comments.org_id) AND (s.org_id = spec_item_comments.org_id)))))`
- **spec_item_comments_insert_member** (`INSERT`, PERMISSIVE, roles: authenticated)
  - with check: `((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_comments.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.role <> 'viewer'::org_role) AND (m.org_id = spec_item_comments.org_id) AND (s.org_id = spec_item_comments.org_id)))))`
- **spec_item_comments_select_own_org** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_comments.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_comments.org_id) AND (s.org_id = spec_item_comments.org_id))))`
- **spec_item_comments_update_author** (`UPDATE`, PERMISSIVE, roles: authenticated)
  - using: `((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_comments.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_comments.org_id) AND (s.org_id = spec_item_comments.org_id)))))`
  - with check: `((author_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_comments.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_comments.org_id) AND (s.org_id = spec_item_comments.org_id)))))`

### public.spec_item_components

- **spec_item_components_delete_own_org** (`DELETE`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_components.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_components.org_id) AND (s.org_id = spec_item_components.org_id))))`
- **spec_item_components_insert_own_org** (`INSERT`, PERMISSIVE, roles: authenticated)
  - with check: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_components.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_components.org_id) AND (s.org_id = spec_item_components.org_id))))`
- **spec_item_components_select_own_org** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_components.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_components.org_id) AND (s.org_id = spec_item_components.org_id))))`
- **spec_item_components_update_own_org** (`UPDATE`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_components.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_components.org_id) AND (s.org_id = spec_item_components.org_id))))`
  - with check: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_components.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_components.org_id) AND (s.org_id = spec_item_components.org_id))))`

### public.spec_item_events

- **spec_item_events_select_own_org** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_events.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_events.org_id) AND (s.org_id = spec_item_events.org_id))))`

### public.spec_item_files

- **spec_item_files_select_own_org** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `(EXISTS ( SELECT 1
   FROM (organization_members m
     JOIN spec_items s ON ((s.id = spec_item_files.spec_item_id)))
  WHERE ((m.user_id = auth.uid()) AND (m.org_id = spec_item_files.org_id) AND (s.org_id = spec_item_files.org_id))))`

### public.users

- **users_service_role_all** (`ALL`, PERMISSIVE, roles: service_role)
  - using: `true`
  - with check: `true`

### public.verification_tokens

- **Service role access for verification_tokens** (`ALL`, PERMISSIVE, roles: public)
  - using: `true`

### storage.objects

- **spec_item_files_objects_delete_own_org** (`DELETE`, PERMISSIVE, roles: authenticated)
  - using: `((bucket_id = 'spec-item-files'::text) AND (EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.user_id = auth.uid()) AND ((m.org_id)::text = (storage.foldername(objects.name))[1]) AND (m.role <> 'viewer'::org_role)))))`
- **spec_item_files_objects_insert_own_org** (`INSERT`, PERMISSIVE, roles: authenticated)
  - with check: `((bucket_id = 'spec-item-files'::text) AND (EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.user_id = auth.uid()) AND ((m.org_id)::text = (storage.foldername(objects.name))[1]) AND (m.role <> 'viewer'::org_role)))))`
- **spec_item_files_objects_select_own_org** (`SELECT`, PERMISSIVE, roles: authenticated)
  - using: `((bucket_id = 'spec-item-files'::text) AND (EXISTS ( SELECT 1
   FROM organization_members m
  WHERE ((m.user_id = auth.uid()) AND ((m.org_id)::text = (storage.foldername(objects.name))[1])))))`

## 3. Денежные и числовые колонки (numeric) с точностью

| таблица | колонка | numeric(p,s) | not null | default |
| --- | --- | --- | --- | --- |
| accounts | expires_at | bigint |  |  |
| materials | price | numeric(12,2) | да | 0.00 |
| project_services | amount | numeric (без typmod) | да |  |
| projects | budget | integer |  |  |
| service_operations | amount | numeric (без typmod) | да |  |
| spec_item_components | cost | numeric (без typmod) |  |  |
| spec_item_components | position | integer | да | 0 |
| spec_item_components | additional_cost | numeric (без typmod) |  |  |
| spec_item_files | size_bytes | bigint | да |  |
| spec_item_variants | price | numeric (без typmod) | да | 0 |
| spec_item_variants | position | integer | да | 0 |
| spec_items | qty | numeric(10,2) | да | 1.00 |
| spec_items | price | numeric(12,2) | да | 0.00 |
| spec_items | position | integer | да | 0 |
| spec_items | base_price | numeric (без typmod) | да | 0 |
| spec_items | supplier_discount | numeric (без typmod) | да | 0 |
| spec_items | client_discount | numeric (без typmod) | да | 0 |
| spec_items | cutting_stock | numeric (без typmod) | да | 0 |
| spec_items | stock_pct | numeric(5,2) | да | 0 |
| spec_items | client_discount_pct | numeric(5,2) | да | 0 |
| spec_items | supplier_discount_pct | numeric(5,2) | да | 0 |
| spec_items_priced | qty | numeric(10,2) |  |  |
| spec_items_priced | price | numeric(12,2) |  |  |
| spec_items_priced | position | integer |  |  |
| spec_items_priced | base_price | numeric (без typmod) |  |  |
| spec_items_priced | supplier_discount | numeric (без typmod) |  |  |
| spec_items_priced | client_discount | numeric (без typmod) |  |  |
| spec_items_priced | cutting_stock | numeric (без typmod) |  |  |
| spec_items_priced | stock_pct | numeric(5,2) |  |  |
| spec_items_priced | client_discount_pct | numeric(5,2) |  |  |
| spec_items_priced | supplier_discount_pct | numeric(5,2) |  |  |
| spec_items_priced | qty_final | numeric (без typmod) |  |  |
| spec_items_priced | price_final | numeric (без typmod) |  |  |

## 4. Ограничения (PK / FK с поведением ON DELETE / UNIQUE / CHECK)

- `accounts` **accounts_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `accounts` **accounts_provider_provider_account_id_key** [UNIQUE] UNIQUE (provider, provider_account_id)
- `accounts` **accounts_user_id_fkey** [FOREIGN KEY] FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
- `companies` **companies_created_by_fkey** [FOREIGN KEY] FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
- `companies` **companies_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
- `companies` **companies_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `contacts` **contacts_company_id_fkey** [FOREIGN KEY] FOREIGN KEY (company_id) REFERENCES companies(id) ON UPDATE CASCADE ON DELETE SET NULL
- `contacts` **contacts_created_by_fkey** [FOREIGN KEY] FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
- `contacts` **contacts_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
- `contacts` **contacts_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `materials` **materials_company_id_fkey** [FOREIGN KEY] FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
- `materials` **materials_contact_id_fkey** [FOREIGN KEY] FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
- `materials` **materials_created_by_fkey** [FOREIGN KEY] FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
- `materials` **materials_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
- `materials` **materials_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `organization_invites` **organization_invites_invited_by_fkey** [FOREIGN KEY] FOREIGN KEY (invited_by) REFERENCES users(id) ON DELETE SET NULL
- `organization_invites` **organization_invites_org_email_key** [UNIQUE] UNIQUE (org_id, email)
- `organization_invites` **organization_invites_org_id_email_key** [UNIQUE] UNIQUE (org_id, email)
- `organization_invites` **organization_invites_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
- `organization_invites` **organization_invites_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `organization_invites` **organization_invites_role_check** [CHECK] CHECK ((role = ANY (ARRAY['admin'::text, 'member'::text])))
- `organization_invites` **organization_invites_token_key** [UNIQUE] UNIQUE (token)
- `organization_members` **organization_members_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
- `organization_members` **organization_members_pkey** [PRIMARY KEY] PRIMARY KEY (org_id, user_id)
- `organization_members` **organization_members_user_id_fkey** [FOREIGN KEY] FOREIGN KEY (user_id) REFERENCES users(id) ON UPDATE CASCADE ON DELETE CASCADE
- `organizations` **organizations_created_by_fkey** [FOREIGN KEY] FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
- `organizations` **organizations_name_length** [CHECK] CHECK ((length(TRIM(BOTH FROM name)) >= 2))
- `organizations` **organizations_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `organizations` **organizations_slug_format** [CHECK] CHECK ((slug ~ '^[a-z0-9][a-z0-9-]{1,49}$'::text))
- `organizations` **organizations_slug_key** [UNIQUE] UNIQUE (slug)
- `password_reset_tokens` **password_reset_tokens_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `password_reset_tokens` **password_reset_tokens_token_key** [UNIQUE] UNIQUE (token)
- `project_service_items` **project_service_items_item_id_fkey** [FOREIGN KEY] FOREIGN KEY (item_id) REFERENCES spec_items(id)
- `project_service_items` **project_service_items_pkey** [PRIMARY KEY] PRIMARY KEY (service_id, item_id)
- `project_service_items` **project_service_items_service_id_fkey** [FOREIGN KEY] FOREIGN KEY (service_id) REFERENCES project_services(id)
- `project_services` **project_services_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `project_services` **project_services_project_id_fkey** [FOREIGN KEY] FOREIGN KEY (project_id) REFERENCES projects(id)
- `project_services` **project_services_supplier_id_fkey** [FOREIGN KEY] FOREIGN KEY (supplier_id) REFERENCES companies(id)
- `project_services` **project_services_type_check** [CHECK] CHECK ((type = ANY (ARRAY['delivery'::text, 'installation'::text, 'other'::text])))
- `projects` **projects_created_by_fkey** [FOREIGN KEY] FOREIGN KEY (created_by) REFERENCES users(id) ON UPDATE CASCADE ON DELETE SET NULL
- `projects` **projects_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
- `projects` **projects_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `projects` **projects_status_check** [CHECK] CHECK ((status = ANY (ARRAY['draft'::text, 'active'::text, 'on_hold'::text, 'completed'::text, 'archived'::text])))
- `public_links` **public_links_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id)
- `public_links` **public_links_pkey** [PRIMARY KEY] PRIMARY KEY (token)
- `public_links` **public_links_project_id_fkey** [FOREIGN KEY] FOREIGN KEY (project_id) REFERENCES projects(id)
- `public_links` **public_links_type_check** [CHECK] CHECK ((type = ANY (ARRAY['spec'::text, 'pdf'::text])))
- `reserved_slugs` **reserved_slugs_pkey** [PRIMARY KEY] PRIMARY KEY (slug)
- `service_operation_items` **service_operation_items_operation_id_fkey** [FOREIGN KEY] FOREIGN KEY (operation_id) REFERENCES service_operations(id) ON DELETE CASCADE
- `service_operation_items` **service_operation_items_pkey** [PRIMARY KEY] PRIMARY KEY (operation_id, spec_item_id)
- `service_operation_items` **service_operation_items_spec_item_id_fkey** [FOREIGN KEY] FOREIGN KEY (spec_item_id) REFERENCES spec_items(id) ON DELETE CASCADE
- `service_operations` **service_operations_amount_check** [CHECK] CHECK ((amount >= (0)::numeric))
- `service_operations` **service_operations_contractor_company_id_fkey** [FOREIGN KEY] FOREIGN KEY (contractor_company_id) REFERENCES companies(id) ON DELETE SET NULL
- `service_operations` **service_operations_name_check** [CHECK] CHECK ((((type = 'service'::text) AND (name IS NOT NULL) AND (btrim(name) <> ''::text)) OR ((type <> 'service'::text) AND (name IS NULL))))
- `service_operations` **service_operations_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id)
- `service_operations` **service_operations_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `service_operations` **service_operations_project_id_fkey** [FOREIGN KEY] FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
- `service_operations` **service_operations_type_check** [CHECK] CHECK ((type = ANY (ARRAY['delivery'::text, 'installation'::text, 'service'::text])))
- `sessions` **sessions_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `sessions` **sessions_session_token_key** [UNIQUE] UNIQUE (session_token)
- `sessions` **sessions_user_id_fkey** [FOREIGN KEY] FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
- `spec_item_comments` **spec_item_comments_author_id_fkey** [FOREIGN KEY] FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
- `spec_item_comments` **spec_item_comments_body_check** [CHECK] CHECK ((char_length(btrim(body)) > 0))
- `spec_item_comments` **spec_item_comments_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id)
- `spec_item_comments` **spec_item_comments_parent_id_fkey** [FOREIGN KEY] FOREIGN KEY (parent_id) REFERENCES spec_item_comments(id) ON DELETE CASCADE
- `spec_item_comments` **spec_item_comments_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `spec_item_comments` **spec_item_comments_spec_item_id_fkey** [FOREIGN KEY] FOREIGN KEY (spec_item_id) REFERENCES spec_items(id) ON DELETE CASCADE
- `spec_item_components` **spec_item_components_additional_cost_check** [CHECK] CHECK (((additional_cost IS NULL) OR (additional_cost >= (0)::numeric)))
- `spec_item_components` **spec_item_components_company_id_fkey** [FOREIGN KEY] FOREIGN KEY (company_id) REFERENCES companies(id)
- `spec_item_components` **spec_item_components_contact_id_fkey** [FOREIGN KEY] FOREIGN KEY (contact_id) REFERENCES contacts(id)
- `spec_item_components` **spec_item_components_kind_check** [CHECK] CHECK ((kind = ANY (ARRAY['group'::text, 'component'::text, 'spec_ref'::text])))
- `spec_item_components` **spec_item_components_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id)
- `spec_item_components` **spec_item_components_parent_component_id_fkey** [FOREIGN KEY] FOREIGN KEY (parent_component_id) REFERENCES spec_item_components(id) ON DELETE CASCADE
- `spec_item_components` **spec_item_components_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `spec_item_components` **spec_item_components_ref_spec_item_id_check** [CHECK] CHECK ((((kind = ANY (ARRAY['group'::text, 'component'::text])) AND (ref_spec_item_id IS NULL)) OR ((kind = 'spec_ref'::text) AND (ref_spec_item_id IS NOT NULL))))
- `spec_item_components` **spec_item_components_ref_spec_item_id_fkey** [FOREIGN KEY] FOREIGN KEY (ref_spec_item_id) REFERENCES spec_items(id) ON DELETE RESTRICT
- `spec_item_components` **spec_item_components_spec_item_id_fkey** [FOREIGN KEY] FOREIGN KEY (spec_item_id) REFERENCES spec_items(id) ON DELETE CASCADE
- `spec_item_events` **spec_item_events_actor_id_fkey** [FOREIGN KEY] FOREIGN KEY (actor_id) REFERENCES users(id) ON DELETE SET NULL
- `spec_item_events` **spec_item_events_kind_check** [CHECK] CHECK ((kind = ANY (ARRAY['created'::text, 'filled'::text, 'cleared'::text, 'removed'::text, 'restored'::text, 'code_changed'::text, 'status_changed'::text, 'price_changed'::text, 'quantity_changed'::text, 'supplier_changed'::text, 'details_changed'::text, 'parent_changed'::text, 'variant_added'::text, 'variant_switched'::text, 'variant_updated'::text, 'variant_removed'::text, 'component_added'::text, 'component_removed'::text, 'service_added'::text, 'service_completed'::text, 'service_removed'::text])))
- `spec_item_events` **spec_item_events_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id)
- `spec_item_events` **spec_item_events_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `spec_item_events` **spec_item_events_spec_item_id_fkey** [FOREIGN KEY] FOREIGN KEY (spec_item_id) REFERENCES spec_items(id) ON DELETE CASCADE
- `spec_item_files` **spec_item_files_category_check** [CHECK] CHECK ((category = ANY (ARRAY['document'::text, 'texture'::text, 'other'::text])))
- `spec_item_files` **spec_item_files_file_name_check** [CHECK] CHECK ((char_length(btrim(file_name)) > 0))
- `spec_item_files` **spec_item_files_mime_type_check** [CHECK] CHECK ((char_length(btrim(mime_type)) > 0))
- `spec_item_files` **spec_item_files_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id)
- `spec_item_files` **spec_item_files_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `spec_item_files` **spec_item_files_project_id_fkey** [FOREIGN KEY] FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
- `spec_item_files` **spec_item_files_size_bytes_check** [CHECK] CHECK ((size_bytes > 0))
- `spec_item_files` **spec_item_files_spec_item_id_fkey** [FOREIGN KEY] FOREIGN KEY (spec_item_id) REFERENCES spec_items(id) ON DELETE CASCADE
- `spec_item_files` **spec_item_files_storage_path_check** [CHECK] CHECK ((char_length(btrim(storage_path)) > 0))
- `spec_item_files` **spec_item_files_uploaded_by_fkey** [FOREIGN KEY] FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
- `spec_item_variants` **spec_item_variants_company_id_fkey** [FOREIGN KEY] FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
- `spec_item_variants` **spec_item_variants_contact_id_fkey** [FOREIGN KEY] FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
- `spec_item_variants` **spec_item_variants_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
- `spec_item_variants` **spec_item_variants_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `spec_item_variants` **spec_item_variants_spec_item_id_fkey** [FOREIGN KEY] FOREIGN KEY (spec_item_id) REFERENCES spec_items(id) ON DELETE CASCADE
- `spec_items` **spec_items_client_discount_check** [CHECK] CHECK (((client_discount_pct >= (0)::numeric) AND (client_discount_pct <= (100)::numeric)))
- `spec_items` **spec_items_company_id_fkey** [FOREIGN KEY] FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
- `spec_items` **spec_items_contact_id_fkey** [FOREIGN KEY] FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE SET NULL
- `spec_items` **spec_items_material_id_fkey** [FOREIGN KEY] FOREIGN KEY (material_id) REFERENCES materials(id) ON DELETE SET NULL
- `spec_items` **spec_items_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE CASCADE
- `spec_items` **spec_items_parent_id_fkey** [FOREIGN KEY] FOREIGN KEY (parent_id) REFERENCES spec_items(id) ON DELETE RESTRICT
- `spec_items` **spec_items_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `spec_items` **spec_items_project_id_fkey** [FOREIGN KEY] FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
- `spec_items` **spec_items_stock_pct_check** [CHECK] CHECK (((stock_pct >= (0)::numeric) AND (stock_pct <= (100)::numeric)))
- `spec_items` **spec_items_supplier_discount_check** [CHECK] CHECK (((supplier_discount_pct >= (0)::numeric) AND (supplier_discount_pct <= (100)::numeric)))
- `spec_items` **spec_items_type_check** [CHECK] CHECK ((type = ANY (ARRAY['Отделка'::text, 'Мебель'::text, 'Оборудование'::text, 'Сантехника'::text, 'Освещение'::text, 'Текстиль'::text, 'Инженерное оборудование'::text, 'Декор'::text, 'Двери'::text, 'Электрика'::text, 'Прочее'::text])))
- `users` **users_active_org_id_fkey** [FOREIGN KEY] FOREIGN KEY (active_org_id) REFERENCES organizations(id) ON DELETE SET NULL
- `users` **users_pkey** [PRIMARY KEY] PRIMARY KEY (id)
- `verification_tokens` **verification_tokens_pkey** [PRIMARY KEY] PRIMARY KEY (identifier, token)
- `verification_tokens` **verification_tokens_token_key** [UNIQUE] UNIQUE (token)

## 5. Индексы

- `accounts`: CREATE UNIQUE INDEX accounts_pkey ON public.accounts USING btree (id)
- `accounts`: CREATE UNIQUE INDEX accounts_provider_provider_account_id_key ON public.accounts USING btree (provider, provider_account_id)
- `companies`: CREATE UNIQUE INDEX companies_pkey ON public.companies USING btree (id)
- `companies`: CREATE INDEX idx_companies_org ON public.companies USING btree (org_id)
- `contacts`: CREATE INDEX contacts_company_idx ON public.contacts USING btree (company_id)
- `contacts`: CREATE INDEX contacts_org_idx ON public.contacts USING btree (org_id)
- `contacts`: CREATE UNIQUE INDEX contacts_pkey ON public.contacts USING btree (id)
- `materials`: CREATE INDEX idx_materials_org ON public.materials USING btree (org_id)
- `materials`: CREATE INDEX idx_materials_supplier ON public.materials USING btree (company_id)
- `materials`: CREATE INDEX materials_org_created_idx ON public.materials USING btree (org_id, created_at DESC) WHERE (deleted_at IS NULL)
- `materials`: CREATE UNIQUE INDEX materials_pkey ON public.materials USING btree (id)
- `organization_invites`: CREATE INDEX idx_org_invites_token ON public.organization_invites USING btree (token)
- `organization_invites`: CREATE UNIQUE INDEX organization_invites_org_email_key ON public.organization_invites USING btree (org_id, email)
- `organization_invites`: CREATE UNIQUE INDEX organization_invites_org_id_email_key ON public.organization_invites USING btree (org_id, email)
- `organization_invites`: CREATE UNIQUE INDEX organization_invites_pkey ON public.organization_invites USING btree (id)
- `organization_invites`: CREATE UNIQUE INDEX organization_invites_token_key ON public.organization_invites USING btree (token)
- `organization_members`: CREATE UNIQUE INDEX organization_members_pkey ON public.organization_members USING btree (org_id, user_id)
- `organization_members`: CREATE UNIQUE INDEX organization_members_single_owner_idx ON public.organization_members USING btree (org_id) WHERE (role = 'owner'::org_role)
- `organization_members`: CREATE INDEX organization_members_user_idx ON public.organization_members USING btree (user_id)
- `organizations`: CREATE UNIQUE INDEX organizations_pkey ON public.organizations USING btree (id)
- `organizations`: CREATE UNIQUE INDEX organizations_slug_key ON public.organizations USING btree (slug)
- `password_reset_tokens`: CREATE INDEX password_reset_tokens_email_idx ON public.password_reset_tokens USING btree (email)
- `password_reset_tokens`: CREATE UNIQUE INDEX password_reset_tokens_pkey ON public.password_reset_tokens USING btree (id)
- `password_reset_tokens`: CREATE UNIQUE INDEX password_reset_tokens_token_key ON public.password_reset_tokens USING btree (token)
- `project_service_items`: CREATE UNIQUE INDEX project_service_items_pkey ON public.project_service_items USING btree (service_id, item_id)
- `project_services`: CREATE UNIQUE INDEX project_services_pkey ON public.project_services USING btree (id)
- `projects`: CREATE INDEX idx_projects_org ON public.projects USING btree (org_id)
- `projects`: CREATE INDEX projects_org_updated_idx ON public.projects USING btree (org_id, updated_at DESC) WHERE (deleted_at IS NULL)
- `projects`: CREATE UNIQUE INDEX projects_pkey ON public.projects USING btree (id)
- `public_links`: CREATE INDEX public_links_expires_at_idx ON public.public_links USING btree (expires_at)
- `public_links`: CREATE UNIQUE INDEX public_links_pkey ON public.public_links USING btree (token)
- `public_links`: CREATE INDEX public_links_project_id_idx ON public.public_links USING btree (project_id)
- `reserved_slugs`: CREATE UNIQUE INDEX reserved_slugs_pkey ON public.reserved_slugs USING btree (slug)
- `service_operation_items`: CREATE UNIQUE INDEX service_operation_items_pkey ON public.service_operation_items USING btree (operation_id, spec_item_id)
- `service_operation_items`: CREATE INDEX service_operation_items_spec_item_id_idx ON public.service_operation_items USING btree (spec_item_id)
- `service_operations`: CREATE INDEX service_operations_org_id_idx ON public.service_operations USING btree (org_id)
- `service_operations`: CREATE UNIQUE INDEX service_operations_pkey ON public.service_operations USING btree (id)
- `service_operations`: CREATE INDEX service_operations_project_id_idx ON public.service_operations USING btree (project_id)
- `sessions`: CREATE UNIQUE INDEX sessions_pkey ON public.sessions USING btree (id)
- `sessions`: CREATE UNIQUE INDEX sessions_session_token_key ON public.sessions USING btree (session_token)
- `spec_item_comments`: CREATE INDEX spec_item_comments_parent_id_created_at_idx ON public.spec_item_comments USING btree (parent_id, created_at)
- `spec_item_comments`: CREATE UNIQUE INDEX spec_item_comments_pkey ON public.spec_item_comments USING btree (id)
- `spec_item_comments`: CREATE INDEX spec_item_comments_spec_item_id_created_at_idx ON public.spec_item_comments USING btree (spec_item_id, created_at DESC)
- `spec_item_comments`: CREATE INDEX spec_item_comments_spec_item_id_root_id_created_at_idx ON public.spec_item_comments USING btree (spec_item_id, root_id, created_at)
- `spec_item_components`: CREATE INDEX spec_item_components_parent_component_id_position_idx ON public.spec_item_components USING btree (parent_component_id, "position")
- `spec_item_components`: CREATE UNIQUE INDEX spec_item_components_pkey ON public.spec_item_components USING btree (id)
- `spec_item_components`: CREATE INDEX spec_item_components_ref_spec_item_id_idx ON public.spec_item_components USING btree (ref_spec_item_id) WHERE (ref_spec_item_id IS NOT NULL)
- `spec_item_components`: CREATE INDEX spec_item_components_spec_item_id_position_idx ON public.spec_item_components USING btree (spec_item_id, "position")
- `spec_item_events`: CREATE INDEX spec_item_events_org_id_idx ON public.spec_item_events USING btree (org_id)
- `spec_item_events`: CREATE UNIQUE INDEX spec_item_events_pkey ON public.spec_item_events USING btree (id)
- `spec_item_events`: CREATE INDEX spec_item_events_spec_item_id_created_at_idx ON public.spec_item_events USING btree (spec_item_id, created_at DESC)
- `spec_item_files`: CREATE INDEX spec_item_files_org_id_idx ON public.spec_item_files USING btree (org_id)
- `spec_item_files`: CREATE UNIQUE INDEX spec_item_files_pkey ON public.spec_item_files USING btree (id)
- `spec_item_files`: CREATE INDEX spec_item_files_project_id_idx ON public.spec_item_files USING btree (project_id)
- `spec_item_files`: CREATE INDEX spec_item_files_spec_item_id_active_idx ON public.spec_item_files USING btree (spec_item_id, created_at DESC, id DESC) WHERE (deleted_at IS NULL)
- `spec_item_variants`: CREATE INDEX idx_variants_item ON public.spec_item_variants USING btree (spec_item_id)
- `spec_item_variants`: CREATE INDEX idx_variants_org ON public.spec_item_variants USING btree (org_id)
- `spec_item_variants`: CREATE UNIQUE INDEX spec_item_variants_pkey ON public.spec_item_variants USING btree (id)
- `spec_item_variants`: CREATE UNIQUE INDEX uniq_active_variant ON public.spec_item_variants USING btree (spec_item_id) WHERE is_active
- `spec_items`: CREATE INDEX idx_spec_items_project ON public.spec_items USING btree (project_id)
- `spec_items`: CREATE INDEX spec_items_org_project_idx ON public.spec_items USING btree (org_id, project_id, "position")
- `spec_items`: CREATE INDEX spec_items_parent_id_idx ON public.spec_items USING btree (parent_id)
- `spec_items`: CREATE UNIQUE INDEX spec_items_pkey ON public.spec_items USING btree (id)
- `spec_items`: CREATE INDEX spec_items_project_alive_idx ON public.spec_items USING btree (project_id, "position") WHERE (deleted_at IS NULL)
- `spec_items`: CREATE UNIQUE INDEX spec_items_project_code_uidx ON public.spec_items USING btree (project_id, code) WHERE ((deleted_at IS NULL) AND (code IS NOT NULL))
- `spec_items`: CREATE INDEX spec_items_project_type_idx ON public.spec_items USING btree (project_id, type) WHERE (deleted_at IS NULL)
- `spec_items`: CREATE INDEX spec_items_type_idx ON public.spec_items USING btree (project_id, type)
- `users`: CREATE UNIQUE INDEX users_email_lower_uidx ON public.users USING btree (lower(email))
- `users`: CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)
- `verification_tokens`: CREATE UNIQUE INDEX verification_tokens_pkey ON public.verification_tokens USING btree (identifier, token)
- `verification_tokens`: CREATE UNIQUE INDEX verification_tokens_token_key ON public.verification_tokens USING btree (token)

## 6. Представления

### spec_items_priced (owner: postgres)

```sql
 SELECT id,
    project_id,
    material_id,
    code,
    name,
    brand,
    spec,
    qty,
    unit,
    price,
    status,
    is_placeholder,
    "position",
    created_at,
    updated_at,
    company_id,
    contact_id,
    org_id,
    company_name_snapshot,
    contact_name_snapshot,
    article,
    rooms,
    notes,
    lead_time,
    avail,
    attrs,
    type,
    deleted_at,
    base_price,
    supplier_discount,
    client_discount,
    cutting_stock,
    stock_pct,
    client_discount_pct,
    supplier_discount_pct,
        CASE
            WHEN (unit = ANY (ARRAY['шт'::text, 'компл.'::text, 'пара'::text, 'короб'::text, 'рулон'::text, 'лист'::text])) THEN ceil((qty * ((1)::numeric + (stock_pct / (100)::numeric))))
            ELSE round((qty * ((1)::numeric + (stock_pct / (100)::numeric))), 2)
        END AS qty_final,
    round((price * ((1)::numeric - (client_discount_pct / (100)::numeric))), 2) AS price_final
   FROM spec_items i
  WHERE (deleted_at IS NULL);
```

## 7. Функции

### accept_invite(p_token text, p_user_id uuid, p_email text) → TABLE(org_id uuid, org_slug text, org_name text), SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.accept_invite(p_token text, p_user_id uuid, p_email text)
 RETURNS TABLE(org_id uuid, org_slug text, org_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_invite record;
begin
  select i.* into v_invite
  from organization_invites i
  where i.token = p_token
  for update;                                    -- блокируем: второй вызов подождёт

  if not found then raise exception 'INVITE_NOT_FOUND'; end if;
  if v_invite.expires_at < now() then raise exception 'INVITE_EXPIRED'; end if;
  if lower(v_invite.email) <> lower(p_email) then raise exception 'INVITE_EMAIL_MISMATCH:%', v_invite.email; end if;

  if exists (select 1 from organization_members
             where org_id = v_invite.org_id and user_id = p_user_id) then
    delete from organization_invites where id = v_invite.id;
    raise exception 'ALREADY_MEMBER';
  end if;

  insert into organization_members (org_id, user_id, role)
  values (v_invite.org_id, p_user_id, v_invite.role);

  update users set active_org_id = v_invite.org_id where id = p_user_id;
  delete from organization_invites where id = v_invite.id;

  return query
    select o.id, o.slug, o.name from organizations o where o.id = v_invite.org_id;
end $function$

```

### create_manual_spec_item(p_org_id uuid, p_project_id uuid, p_item_id uuid, p_material_id uuid, p_company_id uuid, p_company_name text, p_created_by uuid, p_code text, p_type text, p_name text, p_brand text, p_spec text, p_article text, p_qty numeric, p_unit text, p_price numeric, p_stock_pct numeric, p_client_discount_pct numeric, p_supplier_discount_pct numeric, p_save_to_library boolean, p_image_url text) → TABLE(id uuid), SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.create_manual_spec_item(p_org_id uuid, p_project_id uuid, p_item_id uuid, p_material_id uuid, p_company_id uuid, p_company_name text, p_created_by uuid, p_code text, p_type text, p_name text, p_brand text, p_spec text, p_article text, p_qty numeric, p_unit text, p_price numeric, p_stock_pct numeric, p_client_discount_pct numeric, p_supplier_discount_pct numeric, p_save_to_library boolean, p_image_url text)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.spec_status;
begin
  -- защита: проект принадлежит организации и не удалён
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.org_id = p_org_id and p.deleted_at is null
  ) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  v_status := case
    when p_price > 0 then 'picked'::public.spec_status
    else 'draft'::public.spec_status
  end;

  -- 1. библиотека материалов (только если попросили)
  if p_save_to_library then
    insert into public.materials (
      id, org_id, created_by, name, brand, category, article, unit, price, company_id, image_url
    ) values (
      p_material_id, p_org_id, p_created_by, p_name, p_brand, p_type,
      p_article, p_unit, p_price, p_company_id, p_image_url
    );
  end if;

  -- 2. позиция спецификации
  insert into public.spec_items (
    id, project_id, org_id, material_id, company_id, company_name_snapshot,
    code, type, name, brand, spec, article, qty, unit, price,
    stock_pct, client_discount_pct, supplier_discount_pct, status, is_placeholder, position, image_url
  ) values (
    p_item_id, p_project_id, p_org_id, p_material_id, p_company_id, p_company_name,
    p_code, p_type, p_name, p_brand, p_spec, p_article, p_qty, p_unit, p_price,
    p_stock_pct, p_client_discount_pct, p_supplier_discount_pct, v_status, false,
    (select coalesce(max(position), -1) + 1
     from public.spec_items
     where project_id = p_project_id and deleted_at is null),
    p_image_url
  );

  return query select p_item_id as id;

exception
  when unique_violation then
    -- любой дубль (марка уже занята) — откат обеих вставок и понятная ошибка
    raise exception 'CODE_TAKEN';
end;
$function$

```

### create_manual_spec_item(p_org_id uuid, p_project_id uuid, p_item_id uuid, p_material_id uuid, p_company_id uuid, p_company_name text, p_created_by uuid, p_image_url text, p_code text, p_type text, p_name text, p_brand text, p_spec text, p_article text, p_qty numeric, p_unit text, p_price numeric, p_stock_pct numeric, p_client_discount_pct numeric, p_supplier_discount_pct numeric, p_save_to_library boolean, p_parent_id uuid DEFAULT NULL::uuid, p_product_type text DEFAULT NULL::text, p_product_url text DEFAULT NULL::text, p_lead_time text DEFAULT NULL::text, p_attrs jsonb DEFAULT '{}'::jsonb) → TABLE(id uuid), SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.create_manual_spec_item(p_org_id uuid, p_project_id uuid, p_item_id uuid, p_material_id uuid, p_company_id uuid, p_company_name text, p_created_by uuid, p_image_url text, p_code text, p_type text, p_name text, p_brand text, p_spec text, p_article text, p_qty numeric, p_unit text, p_price numeric, p_stock_pct numeric, p_client_discount_pct numeric, p_supplier_discount_pct numeric, p_save_to_library boolean, p_parent_id uuid DEFAULT NULL::uuid, p_product_type text DEFAULT NULL::text, p_product_url text DEFAULT NULL::text, p_lead_time text DEFAULT NULL::text, p_attrs jsonb DEFAULT '{}'::jsonb)
 RETURNS TABLE(id uuid)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_status public.spec_status;
  v_attrs jsonb := coalesce(p_attrs, '{}'::jsonb);
  v_lead_time text := nullif(p_lead_time, '');
begin
  -- защита: проект принадлежит организации и не удалён
  if not exists (
    select 1 from public.projects p
    where p.id = p_project_id and p.org_id = p_org_id and p.deleted_at is null
  ) then
    raise exception 'PROJECT_NOT_FOUND';
  end if;

  v_status := case
    when p_price > 0 then 'picked'::public.spec_status
    else 'draft'::public.spec_status
  end;

  -- 1. библиотека материалов (только если попросили).
  --    p_type — это КАТЕГОРИЯ позиции, она же `materials.category`.
  if p_save_to_library then
    insert into public.materials (
      id, org_id, created_by, name, brand, category, article, unit, price,
      company_id, image_url, product_type, product_url, lead_time, attrs
    ) values (
      p_material_id, p_org_id, p_created_by, p_name, p_brand, p_type,
      p_article, p_unit, p_price, p_company_id,
      p_image_url, nullif(p_product_type, ''), nullif(p_product_url, ''),
      v_lead_time, v_attrs
    );
  end if;

  -- 2. позиция спецификации
  insert into public.spec_items (
    id, project_id, org_id, material_id, company_id, company_name_snapshot,
    image_url, parent_id, code, type, name, brand, spec, article,
    qty, unit, price, stock_pct, client_discount_pct, supplier_discount_pct,
    status, is_placeholder, position, product_type, product_url, lead_time, attrs
  ) values (
    p_item_id, p_project_id, p_org_id, p_material_id, p_company_id, p_company_name,
    p_image_url, p_parent_id, p_code, p_type, p_name, p_brand, p_spec, p_article,
    p_qty, p_unit, p_price, p_stock_pct, p_client_discount_pct, p_supplier_discount_pct,
    v_status, false,
    (select coalesce(max(position), -1) + 1
     from public.spec_items
     where project_id = p_project_id and deleted_at is null),
    nullif(p_product_type, ''), nullif(p_product_url, ''), v_lead_time, v_attrs
  );

  return query select p_item_id as id;

exception
  when unique_violation then
    -- любой дубль (марка уже занята) — откат обеих вставок и понятная ошибка
    raise exception 'CODE_TAKEN';
end;
$function$

```

### create_organization(p_user_id uuid, p_name text, p_slug_base text DEFAULT NULL::text) → TABLE(org_id uuid, org_slug text), SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.create_organization(p_user_id uuid, p_name text, p_slug_base text DEFAULT NULL::text)
 RETURNS TABLE(org_id uuid, org_slug text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org_id uuid;
  v_slug   text;
  v_name   text := nullif(btrim(p_name), '');
begin
  if v_name is null then
    raise exception 'EMPTY_NAME' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'NAME_TOO_LONG' using errcode = '22023';
  end if;
  if not exists (select 1 from users where id = p_user_id) then
    raise exception 'USER_NOT_FOUND' using errcode = '23503';
  end if;

  -- slug: из явной базы (имя пользователя) либо из названия студии
  v_slug := public.unique_org_slug(coalesce(nullif(btrim(p_slug_base), ''), v_name));

  insert into organizations (name, slug, created_by)
  values (v_name, v_slug, p_user_id)
  returning id into v_org_id;

  insert into organization_members (org_id, user_id, role)
  values (v_org_id, p_user_id, 'owner');

  update users set active_org_id = v_org_id where id = p_user_id;

  return query select v_org_id, v_slug;
end $function$

```

### create_organization(p_name text) → uuid, SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.create_organization(p_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid := auth.uid();
  v_org  uuid;
begin
  if v_user is null then
    raise exception 'unauthenticated' using errcode = '28000';
  end if;

  -- идемпотентность: защита от двойного submit и от повторного онбординга
  select organization_id into v_org
  from organization_members
  where user_id = v_user
  limit 1;

  if v_org is not null then
    return v_org;
  end if;

  insert into organizations (name, created_by)
  values (btrim(p_name), v_user)
  returning id into v_org;

  insert into organization_members (organization_id, user_id, role)
  values (v_org, v_user, 'owner');

  return v_org;
end;
$function$

```

### ensure_personal_org(p_user_id uuid) → uuid, SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.ensure_personal_org(p_user_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_existing uuid;
  v_user     record;
  v_result   record;
begin
  -- уже состоит хоть где-то — ничего не делаем
  select m.org_id into v_existing
  from organization_members m where m.user_id = p_user_id limit 1;

  if v_existing is not null then
    update users set active_org_id = coalesce(active_org_id, v_existing) where id = p_user_id;
    return v_existing;
  end if;

  select name, email into v_user from users where id = p_user_id;
  if not found then
    raise exception 'USER_NOT_FOUND' using errcode = '23503';
  end if;

  select * into v_result from public.create_organization(
    p_user_id,
    'Моя студия',
    coalesce(nullif(btrim(v_user.name), ''), split_part(v_user.email, '@', 1))
  );

  return v_result.org_id;
end $function$

```

### handle_updated_at() → trigger

```sql
CREATE OR REPLACE FUNCTION public.handle_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  new.updated_at = now();
  return new;
end;
$function$

```

### is_org_member(_org_id uuid) → boolean, SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.is_org_member(_org_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
begin
  return exists (
    select 1
    from public.organization_members
    where org_id = _org_id
      and user_id = auth.uid()
  );
end;
$function$

```

### set_spec_item_code(p_org_id uuid, p_project_id uuid, p_item_id uuid, p_code text, p_allow_swap boolean DEFAULT false) → TABLE(result text, swapped_id uuid, swapped_name text), SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.set_spec_item_code(p_org_id uuid, p_project_id uuid, p_item_id uuid, p_code text, p_allow_swap boolean DEFAULT false)
 RETURNS TABLE(result text, swapped_id uuid, swapped_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_code     text := upper(btrim(p_code));
  v_occupant record;
  v_old_code text;
begin
  perform 1 from projects where id = p_project_id and org_id = p_org_id for update;
  if not found then raise exception 'PROJECT_NOT_FOUND'; end if;

  if v_code = '' or v_code !~ '^[A-ZА-Я]{1,3}-[0-9]{1,3}$' then
    raise exception 'CODE_INVALID';
  end if;

  select code into v_old_code from spec_items
  where id = p_item_id and project_id = p_project_id;
  if not found then raise exception 'ITEM_NOT_FOUND'; end if;
  if v_old_code = v_code then
    return query select 'unchanged'::text, null::uuid, null::text;
  end if;

  select id, name into v_occupant from spec_items
  where project_id = p_project_id and code = v_code;

  if v_occupant.id is not null then
    if not p_allow_swap then
      raise exception 'CODE_TAKEN:%', coalesce(v_occupant.name, '');
    end if;
    -- обмен: обе строки в одном statement, дубль допустим до конца транзакции
    update spec_items set code = case id when p_item_id then v_code else v_old_code end,
                          updated_at = now()
    where id in (p_item_id, v_occupant.id);

    return query select 'swapped'::text, v_occupant.id, v_occupant.name;
  end if;

  update spec_items set code = v_code, updated_at = now() where id = p_item_id;
  return query select 'ok'::text, null::uuid, null::text;
end $function$

```

### spec_items_sync_org() → trigger

```sql
CREATE OR REPLACE FUNCTION public.spec_items_sync_org()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin
  select org_id into new.org_id from public.projects where id = new.project_id;
  if new.org_id is null then
    raise exception 'PROJECT_NOT_FOUND';
  end if;
  return new;
end $function$

```

### sync_material_company_id() → trigger

```sql
CREATE OR REPLACE FUNCTION public.sync_material_company_id()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Если указан contact_id, но не указан company_id — берём компанию из контакта
  IF NEW.contact_id IS NOT NULL AND NEW.company_id IS NULL THEN
    SELECT company_id INTO NEW.company_id 
    FROM public.contacts 
    WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END;
$function$

```

### touch_updated_at() → trigger

```sql
CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
begin new.updated_at := now(); return new; end $function$

```

### transfer_organization_ownership(p_org_id uuid, p_actor_id uuid, p_target_name text) → void, SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.transfer_organization_ownership(p_org_id uuid, p_actor_id uuid, p_target_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_role  text;
  v_target_id   uuid;
  v_target_cnt  int := 0;
  v_target_name text;
  v_target_role text;
  v_candidate   record;
begin
  if p_actor_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  if auth.uid() is not null and auth.uid() <> p_actor_id then
    raise exception 'ACTOR_MISMATCH' using errcode = '42501';
  end if;

  v_target_name := nullif(btrim(coalesce(p_target_name, '')), '');
  if v_target_name is null then
    raise exception 'TARGET_REQUIRED' using errcode = '22023';
  end if;

  -- Блокируем состав организации: до коммита конкурентная передача владения
  -- (или обычная смена роли) не сможет изменить эти строки.
  perform 1
     from public.organization_members m
    where m.org_id = p_org_id
    for update;

  select m.role::text into v_actor_role
    from public.organization_members m
   where m.org_id = p_org_id and m.user_id = p_actor_id;

  if v_actor_role is null then
    raise exception 'NOT_A_MEMBER' using errcode = '42501';
  end if;
  if v_actor_role <> 'owner' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  -- Получателя ищем по имени среди участников организации (кроме актора).
  -- Сравнение с именем, а не только с id, — вторая линия: клиент не может
  -- подсунуть произвольный user_id в обход выбранного в UI участника.
  for v_candidate in
    select m.user_id, u.name, u.email, m.role::text as role
      from public.organization_members m
      join public.users u on u.id = m.user_id
     where m.org_id = p_org_id
       and m.user_id <> p_actor_id
       and (u.name = v_target_name or (u.name is null and u.email = v_target_name))
  loop
    v_target_cnt := v_target_cnt + 1;
    v_target_id := v_candidate.user_id;
    v_target_role := v_candidate.role;
  end loop;

  if v_target_cnt = 0 then
    raise exception 'TARGET_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_target_cnt > 1 then
    raise exception 'TARGET_AMBIGUOUS' using errcode = '22023';
  end if;

  if v_target_role = 'owner' then
    raise exception 'ALREADY_OWNER' using errcode = '22023';
  end if;

  -- Владельца в организации ровно один (это гарантирует частичный уникальный
  -- индекс), поэтому место освобождается до назначения нового.
  -- Старый owner становится АДМИНИСТРАТОРОМ.
  update public.organization_members
     set role = 'admin'
   where org_id = p_org_id and user_id = p_actor_id;

  update public.organization_members
     set role = 'owner'
   where org_id = p_org_id and user_id = v_target_id;

  update public.organizations
     set updated_at = now()
   where id = p_org_id;
end;
$function$

```

### update_organization_name(p_org_id uuid, p_actor_id uuid, p_name text) → text, SECURITY DEFINER

```sql
CREATE OR REPLACE FUNCTION public.update_organization_name(p_org_id uuid, p_actor_id uuid, p_name text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_name text := nullif(btrim(coalesce(p_name, '')), '');
  v_role text;
begin
  -- актор обязателен: анонимный вызов серверной операции невозможен
  if p_actor_id is null then
    raise exception 'UNAUTHENTICATED' using errcode = '28000';
  end if;

  -- если функция вызвана под настоящей Supabase-сессией, подменять актора нельзя
  if auth.uid() is not null and auth.uid() <> p_actor_id then
    raise exception 'ACTOR_MISMATCH' using errcode = '42501';
  end if;

  if v_name is null or length(v_name) < 2 then
    raise exception 'EMPTY_NAME' using errcode = '22023';
  end if;
  if length(v_name) > 80 then
    raise exception 'NAME_TOO_LONG' using errcode = '22023';
  end if;

  select m.role::text into v_role
    from public.organization_members m
   where m.org_id = p_org_id and m.user_id = p_actor_id;

  if v_role is null then
    raise exception 'NOT_A_MEMBER' using errcode = '42501';
  end if;
  if v_role <> 'owner' then
    raise exception 'FORBIDDEN' using errcode = '42501';
  end if;

  update public.organizations
     set name = v_name,
         updated_at = now()
   where id = p_org_id;

  if not found then
    raise exception 'ORG_NOT_FOUND' using errcode = 'P0002';
  end if;

  return v_name;
end;
$function$

```

## 8. Enum-типы

- `public.org_role`: owner | admin | member | viewer
- `public.spec_status`: draft | picked | approved | ordered | delivered | replace
- `public.spec_types`: Отделка | Мебель | Оборудование | Сантехника | Освещение | Текстиль | Инженерное оборудование | Декор | Двери | Электрика | Прочее

## 9. Таблицы без RLS

`project_service_items`, `project_services`, `public_links`, `reserved_slugs`

## 10. Триггеры

Триггеров в public нет.
