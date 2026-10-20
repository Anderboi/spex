/**
 * Применение миграций фичи «Избранное в библиотеке материалов» к связанному
 * проекту. Учёта миграций в проекте нет, поэтому SQL отправляется точечно через
 * Management API (как в temp/material-suppliers-migrate.mjs).
 *
 *   node temp/favorites-migrate.mjs dry     — те же файлы в BEGIN…ROLLBACK
 *   node temp/favorites-migrate.mjs apply   — применить по одному файлу
 *   node temp/favorites-migrate.mjs check   — схема и политики после применения
 */
process.loadEnvFile(".env.local");
import { readFileSync } from "node:fs";

const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;

const FILES = [
  "20261020_001_add_material_favorites.sql",
  "20261020_002_add_material_favorites_rls.sql",
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

async function dry() {
  const query = ["begin;", ...FILES.map(fileSql), "rollback;"].join("\n\n");
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

async function check() {
  const { status, text } = await sql(`
    select
      (select count(*) from information_schema.columns
        where table_schema = 'public' and table_name = 'material_favorites') as columns,
      (select count(*) from pg_policies
        where schemaname = 'public' and tablename = 'material_favorites') as policies,
      (select relrowsecurity from pg_class
        where oid = 'public.material_favorites'::regclass) as rls
  `);
  console.log("статус:", status);
  console.log(text.slice(0, 2000));
}

const mode = process.argv[2];
if (mode === "dry") await dry();
else if (mode === "apply") await apply();
else if (mode === "check") await check();
else console.log("укажите режим: dry | apply | check");
