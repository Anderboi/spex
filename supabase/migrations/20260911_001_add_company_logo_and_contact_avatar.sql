-- Изображения компаний и независимых специалистов.
--
-- У компании — логотип (companies.logo_url), у контакта/специалиста — фото
-- (contacts.avatar_url). Обе колонки nullable: изображение необязательно.
-- Файлы хранятся в публичном Supabase Storage bucket `company-images`
-- (path: {orgId}/companies/{uuid}.{ext} и {orgId}/contacts/{uuid}.{ext}),
-- в БД пишется только public URL.
--
-- Новых таблиц и bucket-миграций нет: структура моделей компаний/контактов
-- не меняется, добавляются только две колонки.

alter table public.companies
  add column logo_url text;

comment on column public.companies.logo_url is
  'Публичный URL логотипа компании (bucket company-images). NULL — показываем инициалы.';

alter table public.contacts
  add column avatar_url text;

comment on column public.contacts.avatar_url is
  'Публичный URL фото контакта/независимого специалиста (bucket company-images). NULL — показываем инициалы.';
