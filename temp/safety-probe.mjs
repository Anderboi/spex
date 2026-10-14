// Разовая разведка живой схемы (только чтение) перед ответом о безопасности миграции.
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;

const queries = {
  "колонки materials":
    "select column_name || ' ' || data_type || ' ' || case when is_nullable='NO' then 'not null' else 'null' end as c from information_schema.columns where table_schema='public' and table_name='materials' order by ordinal_position",
  "триггеры на materials (не внутренние)":
    "select tgname || ' :: ' || pg_get_triggerdef(t.oid) as t from pg_trigger t where t.tgrelid='public.materials'::regclass and not t.tgisinternal",
  "RLS на materials":
    "select relrowsecurity::text || ' / ' || relforcerowsecurity::text as rls from pg_class where oid='public.materials'::regclass",
  "зависимые объекты (вьюхи/матвью)":
    "select c.relname || ' (' || c.relkind || ')' as obj from pg_class c join pg_depend d on d.objid=c.oid where d.refobjid='public.materials'::regclass and c.relkind in ('v','m') and c.oid <> 'public.materials'::regclass",
  "внешние ключи, ссылающиеся на materials":
    "select conname || ' :: ' || pg_get_constraintdef(oid) as fk from pg_constraint where confrelid='public.materials'::regclass",
  "констрейнты materials":
    "select conname || ' :: ' || pg_get_constraintdef(oid) as c from pg_constraint where conrelid='public.materials'::regclass",
  "auth.uid()":
    "select p.oid::regprocedure::text as f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='auth' and p.proname='uid'",
  "материалов всего / с компанией":
    "select (select count(*) from public.materials)::text || ' / ' || (select count(*) from public.materials where company_id is not null)::text as n",
  "таблица material_suppliers уже есть":
    "select count(*)::text as n from pg_class where relname='material_suppliers'",
};

for (const [label, query] of Object.entries(queries)) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await response.text();
  console.log(`\n## ${label} [${response.status}]\n${text.slice(0, 1500)}`);
}
