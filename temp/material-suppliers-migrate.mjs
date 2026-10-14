/**
 * Применение миграций фичи «несколько поставщиков материала» к связанному проекту.
 *
 * Учёта миграций в проекте нет (`supabase_migrations.schema_migrations` не
 * существует), поэтому `supabase db push` здесь неприменим — SQL отправляется
 * точечно через Management API.
 *
 * Режимы:
 *   node temp/material-suppliers-migrate.mjs dry     — те же файлы в BEGIN…ROLLBACK
 *   node temp/material-suppliers-migrate.mjs apply   — применить по одному файлу
 *   node temp/material-suppliers-migrate.mjs verify  — проверить итог через PostgREST
 *
 * Временный файл: удалить после применения (песочница не даёт удалять — очистить).
 */
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");

const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const FILES = [
  "20261013_001_add_material_suppliers.sql",
  "20261013_002_add_material_suppliers_rls.sql",
  "20261013_003_add_sync_material_suppliers.sql",
];

const fileSql = (name) => readFileSync(`supabase/migrations/${name}`, "utf8");

async function sql(query) {
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
  return { status: response.status, text: await response.text() };
}

async function rest(path) {
  const response = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
  return { status: response.status, text: await response.text() };
}

/**
 * Проверки внутри транзакции: перенос существующих поставщиков, зеркало после
 * `sync_material_suppliers` на реальном материале и снятие одной строки.
 */
const PROBES = `
create temp table _probe (label text, value text) on commit drop;

insert into _probe
select 'перенос: строк в material_suppliers', count(*)::text
  from public.material_suppliers
union all
select 'перенос: материалов с непустым массивом', count(*)::text
  from public.materials where cardinality(supplier_company_ids) > 0
union all
select 'перенос: массив пуст, а компания есть', count(*)::text
  from public.materials
 where company_id is not null and cardinality(supplier_company_ids) = 0;

do $probe$
declare
  v_material uuid;
  v_org      uuid;
  v_c1       uuid;
  v_c2       uuid;
  v_rows     integer;
begin
  select m.id, m.org_id, m.company_id
    into v_material, v_org, v_c1
    from public.materials m
   where m.company_id is not null
   limit 1;

  select c.id into v_c2
    from public.companies c
   where c.org_id = v_org and c.id <> v_c1
   limit 1;

  if v_c2 is null then
    insert into _probe values ('прогон функции', 'пропущен: нет второй компании');
    return;
  end if;

  perform public.sync_material_suppliers(
    v_org,
    v_material,
    jsonb_build_array(
      jsonb_build_object('company_id', v_c1, 'price', 111,
                         'product_url', 'https://a.example/x', 'position', 0),
      jsonb_build_object('company_id', v_c2, 'price', 222, 'position', 1)
    )
  );

  select count(*) into v_rows
    from public.material_suppliers where material_id = v_material;

  insert into _probe values ('после sync: строк', v_rows::text);
  insert into _probe
  select 'после sync: компания-зеркало', company_id::text
    from public.materials where id = v_material;
  insert into _probe
  select 'после sync: цена-зеркало', price::text
    from public.materials where id = v_material;
  insert into _probe
  select 'после sync: ссылка-зеркало', product_url
    from public.materials where id = v_material;
  insert into _probe
  select 'после sync: массив', supplier_company_ids::text
    from public.materials where id = v_material;

  perform public.sync_material_suppliers(
    v_org,
    v_material,
    jsonb_build_array(
      jsonb_build_object('company_id', v_c2, 'price', 222, 'position', 0)
    )
  );

  select count(*) into v_rows
    from public.material_suppliers where material_id = v_material;

  insert into _probe values ('после снятия строки: строк', v_rows::text);
  insert into _probe
  select 'после снятия строки: зеркало', company_id::text
    from public.materials where id = v_material;
  insert into _probe
  select 'после снятия строки: массив', supplier_company_ids::text
    from public.materials where id = v_material;

  -- Пустой список: строк нет, компания снята, цена материала сохраняется.
  perform public.sync_material_suppliers(v_org, v_material, jsonb_build_array());

  insert into _probe
  select 'после пустого списка: строк', count(*)::text
    from public.material_suppliers where material_id = v_material;
  insert into _probe
  select 'после пустого списка: компания', coalesce(company_id::text, 'null')
    from public.materials where id = v_material;
  insert into _probe
  select 'после пустого списка: цена', price::text
    from public.materials where id = v_material;
end
$probe$;

select label, value from _probe order by label;
`;

async function dry() {
  const query = [
    "begin;",
    ...FILES.map(fileSql),
    PROBES,
    "rollback;",
  ].join("\n\n");

  const { status, text } = await sql(query);
  console.log("статус:", status);
  console.log(text.slice(0, 4000));
}

async function apply() {
  for (const name of FILES) {
    const { status, text } = await sql(fileSql(name));
    const ok = status >= 200 && status < 300;
    console.log(`${ok ? "OK  " : "FAIL"} ${name}: ${status} ${text.slice(0, 300)}`);
    if (!ok) return;
  }
}

async function verify() {
  const embed = await rest(
    "materials?select=id,name,price,company_id,supplier_company_ids,material_suppliers(id,company_id,price,position,companies:company_id(id,name))&limit=2",
  );
  console.log("вложенная выборка поставщиков:", embed.status, embed.text.slice(0, 700));

  const one = await rest("materials?select=supplier_company_ids&limit=20");
  let companyId = null;
  try {
    const rows = JSON.parse(one.text);
    for (const row of rows) {
      if (Array.isArray(row.supplier_company_ids) && row.supplier_company_ids.length) {
        companyId = row.supplier_company_ids[0];
        break;
      }
    }
  } catch {
    /* ниже скажем, что id не нашли */
  }

  if (!companyId) {
    console.log("фильтр по компании: не проверен — массивов нет");
    return;
  }

  const filtered = await rest(
    `materials?select=id&supplier_company_ids=cs.{${companyId}}&limit=3`,
  );
  console.log(
    `фильтр по компании (cs.{${companyId}}):`,
    filtered.status,
    filtered.text.slice(0, 300),
  );
}

const mode = process.argv[2];
if (mode === "dry") await dry();
else if (mode === "apply") await apply();
else if (mode === "verify") await verify();
else console.log("укажите режим: dry | apply | verify");
