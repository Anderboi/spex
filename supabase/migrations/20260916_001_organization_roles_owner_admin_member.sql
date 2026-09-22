-- ============================================================================
-- Роли организации: owner / admin / member
-- ============================================================================
--
-- Что уже есть в БД (проверено по удалённой схеме, а не по предположениям):
--
--   * enum public.org_role = ('owner', 'admin', 'member', 'viewer')
--     — пересоздавать тип НЕ нужно, 'owner' в нём уже присутствует;
--   * organization_members.role этого типа, PK (org_id, user_id),
--     FK на organizations(id) ON DELETE CASCADE;
--   * organization_invites.role — text с CHECK (role IN ('admin','member')),
--     то есть пригласить сразу owner'ом через существующую систему нельзя;
--   * organizations.created_by — «кто создал», но НЕ источник истины о владении:
--     у части организаций он NULL, а владелец при этом есть. Источник истины —
--     organization_members.role = 'owner'.
--
-- Поэтому миграция состоит из трёх частей:
--   1. нормализация ролей (owner только у того, у кого он уже есть) +
--      инвариант «ровно один owner», закреплённый в схеме;
--   2. RPC для изменения названия и передачи владения;
--   3. защита Data API (RLS) — второй контур, приложение работает через
--      service role из server actions.
--
-- Названия организаций миграция не трогает. Удаление организации выполняется
-- server action'ом (см. actions/organization.ts) — здесь для него нет функции.
--
-- ВАЖНО про авторизацию в RPC: приложение использует next-auth + собственные
-- сессии, а не Supabase Auth, поэтому `auth.uid()` внутри вызовов через service
-- role всегда NULL. Отсюда двухшаговая модель: функция дополнительно требует,
-- чтобы переданный актор совпадал с auth.uid(), ЕСЛИ uid есть (то есть при
-- вызове из-под настоящей Supabase-сессии), и всегда проверяет membership и
-- роль по БД. EXECUTE оставлен только service_role: произвольный пользователь
-- Data API эти функции вызвать не может.

-- ---------------------------------------------------------------------------
-- 1. Нормализация + инвариант «ровно один owner на организацию»
-- ---------------------------------------------------------------------------

-- Роли вне модели owner/admin/member не используются. Если такие строки есть —
-- останавливаемся и просим решение, а не угадываем роль.
do $$
declare
  v_bad text;
begin
  select string_agg(
           format('org=%s user=%s role=%s', m.org_id, m.user_id, m.role),
           '; '
         )
    into v_bad
  from public.organization_members m
  where m.role::text not in ('owner', 'admin', 'member');

  if v_bad is not null then
    raise exception
      'MIGRATION_ABORTED: недопустимые роли в organization_members: %', v_bad;
  end if;
end $$;

-- Организация без владельца — некорректное состояние: настройки (название,
-- передача владения, удаление) становятся недоступны навсегда.
--
-- Владельца назначаем ТОЛЬКО если выбор однозначен, в порядке приоритета:
--   1) organizations.created_by, если он участник этой организации;
--   2) если участник ровно один — он;
--   3) если «самый ранний» участник один — он.
-- Если участников несколько и created_by не помогает, миграция падает со
-- списком организаций: случайного владельца не назначаем.
do $$
declare
  v_org         record;
  v_owner       uuid;
  v_owners      int;
  v_min_created timestamptz;
  v_oldest_cnt  int;
  v_unresolved  text[] := '{}';
begin
  for v_org in
    select o.id, o.name, o.created_by,
           (select count(*) from public.organization_members m
             where m.org_id = o.id) as member_count
      from public.organizations o
     order by o.created_at
  loop
    select count(*) into v_owners
      from public.organization_members m
     where m.org_id = v_org.id and m.role = 'owner';

    if v_owners = 1 then
      continue;
    end if;

    if v_owners > 1 then
      raise exception
        'MIGRATION_ABORTED: в организации % больше одного владельца (%)',
        v_org.id, v_owners;
    end if;

    if v_org.member_count = 0 then
      raise exception
        'MIGRATION_ABORTED: в организации % нет ни одного участника — назначать владельца не из чего',
        v_org.id;
    end if;

    v_owner := null;

    if v_org.created_by is not null
       and exists (
         select 1 from public.organization_members m
          where m.org_id = v_org.id and m.user_id = v_org.created_by
       ) then
      v_owner := v_org.created_by;
    elsif v_org.member_count = 1 then
      select m.user_id into v_owner
        from public.organization_members m
       where m.org_id = v_org.id;
    else
      select min(m.created_at) into v_min_created
        from public.organization_members m
       where m.org_id = v_org.id
         and m.role in ('admin', 'member');

      select count(*), min(m.user_id)
        into v_oldest_cnt, v_owner
        from public.organization_members m
       where m.org_id = v_org.id
         and m.created_at = v_min_created;

      if v_oldest_cnt <> 1 then
        v_owner := null;
      end if;
    end if;

    if v_owner is null then
      v_unresolved := v_unresolved || format(
        'org=%s (%s), участников=%s, created_by=%s',
        v_org.id, coalesce(v_org.name, '—'), v_org.member_count,
        coalesce(v_org.created_by::text, 'NULL')
      );
      continue;
    end if;

    update public.organization_members
       set role = 'owner'
     where org_id = v_org.id and user_id = v_owner;
  end loop;

  if array_length(v_unresolved, 1) > 0 then
    raise exception
      'MIGRATION_ABORTED: не удалось однозначно определить владельца: %. Нужно решить вручную, кого назначить owner, и повторить миграцию.',
      array_to_string(v_unresolved, ' | ');
  end if;
end $$;

-- Проверка результата: ровно один владелец в каждой организации.
do $$
declare
  v_bad text;
begin
  select string_agg(o.id::text, ', ') into v_bad
    from public.organizations o
   where (select count(*) from public.organization_members m
           where m.org_id = o.id and m.role = 'owner') <> 1;

  if v_bad is not null then
    raise exception 'MIGRATION_ABORTED: организации без ровно одного владельца: %', v_bad;
  end if;
end $$;

-- Инвариант держит СХЕМА, а не только server action: вторую строку с role=owner
-- в ту же организацию вставить нельзя.
create unique index if not exists organization_members_single_owner_idx
  on public.organization_members (org_id)
  where role = 'owner';

-- ---------------------------------------------------------------------------
-- 2. Смена названия организации
-- ---------------------------------------------------------------------------

create or replace function public.update_organization_name(
  p_org_id   uuid,
  p_actor_id uuid,
  p_name     text
)
returns text
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

comment on function public.update_organization_name(uuid, uuid, text) is
  'Переименование организации. Только owner. Слаг не меняется.';

-- ---------------------------------------------------------------------------
-- 3. Передача владения (атомарно)
-- ---------------------------------------------------------------------------

create or replace function public.transfer_organization_ownership(
  p_org_id      uuid,
  p_actor_id    uuid,
  p_target_name text
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
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
$function$;

comment on function public.transfer_organization_ownership(uuid, uuid, text) is
  'Атомарная передача владения: старый owner становится admin, новый — owner. '
  'Вызывается только server action от имени service_role.';

-- ---------------------------------------------------------------------------
-- 4. Права на функции
-- ---------------------------------------------------------------------------
-- По умолчанию EXECUTE у функции есть у PUBLIC. Для SECURITY DEFINER с
-- параметром-актором это недопустимо: вызывающий мог бы назваться кем угодно.
-- Оставляем вызов только service_role (server actions).

revoke all on function public.update_organization_name(uuid, uuid, text) from public;
revoke all on function public.update_organization_name(uuid, uuid, text) from anon;
revoke all on function public.update_organization_name(uuid, uuid, text) from authenticated;
grant execute on function public.update_organization_name(uuid, uuid, text) to service_role;

revoke all on function public.transfer_organization_ownership(uuid, uuid, text) from public;
revoke all on function public.transfer_organization_ownership(uuid, uuid, text) from anon;
revoke all on function public.transfer_organization_ownership(uuid, uuid, text) from authenticated;
grant execute on function public.transfer_organization_ownership(uuid, uuid, text) to service_role;

-- is_org_member нужен RLS-политикам, которые исполняются от authenticated.
revoke all on function public.is_org_member(uuid) from public;
revoke all on function public.is_org_member(uuid) from anon;
grant execute on function public.is_org_member(uuid) to authenticated;
grant execute on function public.is_org_member(uuid) to service_role;

-- Легаси-перегрузка create_organization(p_user_id, p_name) была SECURITY DEFINER
-- и при этом открыта для anon: любой человек без авторизации мог создать
-- организацию произвольному user_id. Вдобавок она ссылалась на несуществующую
-- колонку organization_members.organization_id, то есть падала при вызове.
-- Приложение её не использует (используется 3-аргументная версия с p_slug_base),
-- поэтому убираем перегрузку целиком, а не оставляем «спрятанной».
do $$
begin
  if to_regprocedure('public.create_organization(uuid, text)') is not null then
    drop function public.create_organization(uuid, text);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 5. RLS: второй контур защиты Data API
-- ---------------------------------------------------------------------------
-- Приложение ходит в БД через service role (server actions) и RLS обходит.
-- Политики ниже закрывают прямой доступ к Data API от имени authenticated
-- пользователя: он видит только свои организации и не может менять состав
-- команды в обход server actions. Смена роли и передача владения намеренно
-- доступны только через RPC выше (owner-only, атомарно).

-- Политика на users была `for all to public using (true)`: анонимный ключ мог
-- прочитать любую строку public.users (email, хеш пароля). Приложение эту
-- таблицу через Data API не читает — закрываем.
drop policy if exists "Service role access for users" on public.users;

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'users'
       and policyname = 'users_service_role_all'
  ) then
    create policy "users_service_role_all"
      on public.users
      for all
      to service_role
      using (true)
      with check (true);
  end if;
end $$;

drop policy if exists "organizations_select_own" on public.organizations;
create policy "organizations_select_own"
  on public.organizations
  for select
  to authenticated
  using (public.is_org_member(id));

drop policy if exists "organizations_update_owner" on public.organizations;
create policy "organizations_update_owner"
  on public.organizations
  for update
  to authenticated
  using (
    exists (
      select 1 from public.organization_members m
       where m.org_id = organizations.id
         and m.user_id = auth.uid()
         and m.role = 'owner'
    )
  )
  with check (
    exists (
      select 1 from public.organization_members m
       where m.org_id = organizations.id
         and m.user_id = auth.uid()
         and m.role = 'owner'
    )
  );

-- DELETE у organizations намеренно без политики: удаление организации —
-- отдельная серверная операция с подтверждением названия.

drop policy if exists "organization_members_select_own_org" on public.organization_members;
create policy "organization_members_select_own_org"
  on public.organization_members
  for select
  to authenticated
  using (public.is_org_member(org_id));

drop policy if exists "organization_members_insert_manager" on public.organization_members;
create policy "organization_members_insert_manager"
  on public.organization_members
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
       where m.org_id = organization_members.org_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'admin')
    )
  );

drop policy if exists "organization_members_delete_manager" on public.organization_members;
create policy "organization_members_delete_manager"
  on public.organization_members
  for delete
  to authenticated
  using (
    user_id <> auth.uid()                                   -- себя не исключаем
    and exists (
      select 1 from public.organization_members m
       where m.org_id = organization_members.org_id
         and m.user_id = auth.uid()
         and (
           m.role = 'owner'
           or (m.role = 'admin' and organization_members.role = 'member')
         )
    )
  );

-- UPDATE у organization_members без политики: смена роли меняет права, а
-- инвариант «ровно один owner» требует атомарной операции. Только RPC.

drop policy if exists "organization_invites_select_manager" on public.organization_invites;
create policy "organization_invites_select_manager"
  on public.organization_invites
  for select
  to authenticated
  using (
    exists (
      select 1 from public.organization_members m
       where m.org_id = organization_invites.org_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'admin')
    )
  );

drop policy if exists "organization_invites_insert_manager" on public.organization_invites;
create policy "organization_invites_insert_manager"
  on public.organization_invites
  for insert
  to authenticated
  with check (
    exists (
      select 1 from public.organization_members m
       where m.org_id = organization_invites.org_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'admin')
    )
  );

drop policy if exists "organization_invites_delete_manager" on public.organization_invites;
create policy "organization_invites_delete_manager"
  on public.organization_invites
  for delete
  to authenticated
  using (
    exists (
      select 1 from public.organization_members m
       where m.org_id = organization_invites.org_id
         and m.user_id = auth.uid()
         and m.role in ('owner', 'admin')
    )
  );
