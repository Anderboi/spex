// Read-only: доступна ли таблица spec_item_files в схеме PostgREST
// (OpenAPI-описание) и каков реальный набор колонок.
// Запуск: node temp/probe-files-openapi.mjs
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, "")];
    }),
);

const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;

const res = await fetch(`${url}/rest/v1/`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
});
const spec = await res.json();

const tables = Object.keys(spec.definitions ?? {});
console.log(`status=${res.status} таблиц в схеме: ${tables.length}`);
console.log(
  "есть spec_item_files:",
  tables.includes("spec_item_files"),
);
console.log(
  "есть spec_item_files_priced:",
  tables.filter((t) => t.startsWith("spec_item_files")).join(", ") || "(нет)",
);

const table = spec.definitions?.spec_item_files;
if (table) {
  console.log("\n### properties (order as generated)");
  console.log(JSON.stringify(table.properties, null, 2));
  console.log("\n### required");
  console.log(JSON.stringify(table.required, null, 2));
  console.log("\n### relationships");
  console.log(JSON.stringify(table.properties?.project_id ?? {}, null, 2));
}

// Для сравнения — форма ответа у уже существующей таблицы.
const existing = await fetch(`${url}/rest/v1/spec_item_comments?select=*&limit=0`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
});
console.log(`\nspec_item_comments limit=0: status=${existing.status} body=${(await existing.text()).slice(0, 120)}`);

const filesZero = await fetch(`${url}/rest/v1/spec_item_files?select=*&limit=0`, {
  headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
});
console.log(`spec_item_files limit=0: status=${filesZero.status} body=${(await filesZero.text()).slice(0, 200)}`);

// Проверка конкретных колонок: имя колонки в select.
for (const column of ["storage_path", "file_name", "mime_type", "size_bytes", "category", "uploaded_by", "deleted_at"]) {
  const r = await fetch(
    `${url}/rest/v1/spec_item_files?select=${column}&limit=0`,
    { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } },
  );
  console.log(`column ${column}: ${r.status} ${r.status === 200 ? "ok" : (await r.text()).slice(0, 160)}`);
}
