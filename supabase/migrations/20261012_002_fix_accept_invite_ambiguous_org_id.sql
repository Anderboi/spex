-- ============================================================================
-- Принятие приглашения: public.accept_invite падал на неоднозначной ссылке org_id
-- ============================================================================
--
-- Симптом: в production кнопка «Принять и войти» отвечала 500, а Next прятал
-- текст ошибки за digest («An error occurred in the Server Components render»).
--
-- Настоящая причина — SQLSTATE 42702, `column reference "org_id" is ambiguous`:
--
--   RETURNS TABLE(org_id uuid, org_slug text, org_name text)
--
-- объявляет переменные PL/pgSQL с теми же именами, что колонки таблиц, и в теле
--
--   where org_id = v_invite.org_id and user_id = p_user_id
--
-- Postgres не может решить, что это — переменная или колонка
-- `organization_members.org_id`. Падает КАЖДОЕ настоящее принятие: отказы по
-- токену, сроку и адресу срабатывают раньше и до этой строки не доходят, а
-- проверка «уже участник» — она и есть тот самый неоднозначный запрос.
--
-- Лечение — псевдонимы таблиц у ссылок на колонки: `m.org_id`, `u.id`, `i.id`.
-- От имён OUT-параметров отказаться нельзя: ровно их (`org_id`, `org_slug`,
-- `org_name`) читает `acceptInvite` в actions/teams.ts, а `return query`
-- сопоставляет результат позиционно.
--
-- ── Почему функция появилась в миграциях только сейчас ──────────────────────
--
-- До этой правки `accept_invite` существовала лишь в базе проекта (как и
-- `create_organization`, `set_spec_item_code` и прочие RPC): в
-- `supabase/migrations/` её не было, `supabase_migrations.schema_migrations`
-- в проекте отсутствует. Из-за этого баг не поймала ни сборка, ни ревью.
-- Ниже — тот же текст, что лежит в проекте, с квалифицированными колонками.
-- ============================================================================

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

  if exists (select 1 from organization_members m
             where m.org_id = v_invite.org_id and m.user_id = p_user_id) then
    delete from organization_invites as i where i.id = v_invite.id;
    raise exception 'ALREADY_MEMBER';
  end if;

  insert into organization_members (org_id, user_id, role)
  values (v_invite.org_id, p_user_id, v_invite.role);

  update users as u set active_org_id = v_invite.org_id where u.id = p_user_id;

  delete from organization_invites as i where i.id = v_invite.id;

  return query
    select o.id, o.slug, o.name from organizations o where o.id = v_invite.org_id;
end $function$;
