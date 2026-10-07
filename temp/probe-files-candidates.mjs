// Read-only подбор безопасной цели для smoke-теста: организация с одним
// владельцем, её проект и позиция. Ничего не меняет.
// Запуск: node temp/probe-files-candidates.mjs
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
const key = env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  const text = await res.text();
  try {
    return { status: res.status, body: text ? JSON.parse(text) : null };
  } catch {
    return { status: res.status, body: text };
  }
}

const orgs = await rest("organizations?select=id,name,slug");
const members = await rest("organization_members?select=org_id,user_id,role");
const users = await rest("users?select=id,email");
const projects = await rest("projects?select=id,org_id,client_name,created_at");
const items = await rest(
  "spec_items?select=id,org_id,project_id,name,is_placeholder,deleted_at&deleted_at=is.null&is_placeholder=is.false&limit=200",
);
const files = await rest("spec_item_files?select=id,org_id,spec_item_id,deleted_at");

const byOrg = (rows) => {
  const map = new Map();
  for (const row of rows) map.set(row.org_id, (map.get(row.org_id) ?? 0) + 1);
  return map;
};

const memberCount = byOrg(members.body ?? []);
const projectCount = byOrg(projects.body ?? []);
const itemCount = byOrg(items.body ?? []);
const fileCount = byOrg(files.body ?? []);
const userById = new Map((users.body ?? []).map((u) => [u.id, u.email]));
const orgById = new Map((orgs.body ?? []).map((o) => [o.id, o]));

console.log("=== организации ===");
for (const [id, name] of orgById) {
  console.log(
    `${id} | ${name?.name} | /${name?.slug} | members=${memberCount.get(id) ?? 0} | projects=${projectCount.get(id) ?? 0} | items=${itemCount.get(id) ?? 0} | files=${fileCount.get(id) ?? 0}`,
  );
}

console.log("\n=== участники ===");
for (const m of members.body ?? []) {
  console.log(`${m.org_id} | ${m.role} | ${userById.get(m.user_id) ?? m.user_id}`);
}

console.log("\n=== кандидаты (позиции, к которым можно привязать файл) ===");
for (const item of (items.body ?? []).slice(0, 12)) {
  const project = (projects.body ?? []).find((p) => p.id === item.project_id);
  console.log(
    `${item.org_id} | project=${item.project_id} (${project?.client_name ?? "?"}) | item=${item.id} | ${String(item.name).slice(0, 40)}`,
  );
}

console.log("\n=== существующие строки файлов (должны быть только тестовые) ===");
console.log(JSON.stringify(files.body ?? [], null, 2));
