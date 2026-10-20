-- Избранное в библиотеке материалов (material_favorites)
--
-- Личная отметка сотрудника на материале библиотеки: «этот материал мне нужен».
-- Отметка невидима коллегам и не меняет порядок библиотеки — это рабочий список
-- одного человека, а не решение команды (см. `.scratch/material-favorites/spec.md`).
--
-- Строка — одна пара «пользователь — материал»; она же первичный ключ, поэтому
-- повторная отметка не порождает дублей, а снятие — это удаление строки.
--
-- `org_id` хранится явно, а не выводится через материал: политика доступа
-- проверяет членство в организации по самой строке, не поднимаясь по связи к
-- материалу. Значение всегда приходит из сессии — организацию материала
-- приложение сверяет до записи (`lib/materials/favorites.ts`).
--
-- Ссылка на материал — с каскадным удалением: окончательное удаление материала
-- не оставляет битых записей в избранном. Мягкое удаление (архив) строку не
-- трогает — отметка возвращается вместе с материалом.
--
-- Каждый шаг идемпотентен (`if not exists`): учёта применённых миграций у этого
-- проекта нет, SQL применяют руками, поэтому файл должен переживать повторный
-- запуск.

create table if not exists public.material_favorites (
  user_id uuid not null,
  material_id uuid not null,
  org_id uuid not null,
  created_at timestamptz not null default now(),

  -- Пара «пользователь — материал» уникальна и служит первичным ключом: второй
  -- такой же отметки не бывает по построению, а не по договорённости.
  constraint material_favorites_pkey primary key (user_id, material_id),
  constraint material_favorites_user_id_fkey
    foreign key (user_id) references public.users (id)
    on update cascade on delete cascade,
  constraint material_favorites_material_id_fkey
    foreign key (material_id) references public.materials (id)
    on delete cascade,
  -- Организацию удаляют — личные отметки уходят вместе с ней: без организации
  -- у них нет ни читателя, ни смысла. Это не финансовая история, о которой
  -- предупреждает ADR 0004, а личная настройка сотрудника; материалы
  -- организации при её удалении тоже исчезают, и отметкам не к чему относиться.
  constraint material_favorites_org_id_fkey
    foreign key (org_id) references public.organizations (id)
    on delete cascade
);

-- Чтение «мои отметки в организации»: первичный ключ начинается с `user_id`, но
-- организация в запросе участвует всегда, поэтому она впереди.
create index if not exists material_favorites_org_id_user_id_idx
  on public.material_favorites (org_id, user_id);

-- Каскадное удаление материала ищет строки по `material_id`.
create index if not exists material_favorites_material_id_idx
  on public.material_favorites (material_id);

comment on table public.material_favorites is
  'Личные отметки «избранное» на материалах библиотеки: пара пользователь — материал.';
comment on column public.material_favorites.org_id is
  'Организация материала на момент отметки: по ней проверяется членство в политике доступа.';
