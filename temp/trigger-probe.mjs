// Чтение определений функций-триггеров materials (только чтение).
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;

const queries = {
  "sync_material_company_id()":
    "select pg_get_functiondef(p.oid) as d from pg_proc p where p.oid = 'public.sync_material_company_id()'::regprocedure",
  "touch_updated_at()":
    "select pg_get_functiondef(p.oid) as d from pg_proc p where p.oid = 'public.touch_updated_at()'::regprocedure",
  "handle_updated_at()":
    "select pg_get_functiondef(p.oid) as d from pg_proc p where p.oid = 'public.handle_updated_at()'::regprocedure",
  "вьюхи над materials":
    "select c.relname::text as obj from pg_class c join pg_depend d on d.objid=c.oid where d.refobjid='public.materials'::regclass and c.relkind in ('v','m') and c.oid <> 'public.materials'::regclass",
  "другие триггеры, которые могут писать в materials":
    "select p.proname::text as fn, c.relname::text as tbl from pg_trigger t join pg_proc p on p.oid=t.tgfoid join pg_class c on c.oid=t.tgrelid where not t.tgisinternal and p.proname ilike '%material%'",
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
  console.log(`\n===== ${label} [${response.status}] =====\n${text.slice(0, 3000)}`);
}
