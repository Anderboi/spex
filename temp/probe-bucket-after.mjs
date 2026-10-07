// Read-only: что осталось в bucket'е spec-item-files после интеграционного прогона.
// Запуск: node temp/probe-bucket-after.mjs
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

const base = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: key, Authorization: `Bearer ${key}` };

// Рекурсивный обход дерева: у bucket'а файлы лежат на 3 уровня вглубь.
async function walk(prefix = "") {
  const res = await fetch(`${base}/storage/v1/object/list/spec-item-files`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000 }),
  });
  const entries = await res.json();
  const files = [];
  for (const entry of entries ?? []) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!entry.id) files.push(...(await walk(path)));
    else files.push(path);
  }
  return files;
}

const files = await walk();
console.log(`объектов в spec-item-files: ${files.length}`);
for (const file of files) console.log(` - ${file}`);

const orgs = await fetch(`${base}/storage/v1/object/list/spec-item-files`, {
  method: "POST",
  headers: { ...headers, "Content-Type": "application/json" },
  body: JSON.stringify({ prefix: "", limit: 100 }),
}).then((r) => r.json());
console.log("верхний уровень:", JSON.stringify(orgs));
