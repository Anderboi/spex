// Разовая read-only проверка Storage-схемы на живом проекте.
// Ничего не создаёт и не меняет: только читает storage.buckets через PostgREST.
// Запуск: node temp/probe-storage-schema.mjs
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

async function rest(path, init = {}) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

const report = (label, r) =>
  console.log(
    `${label}: status=${r.status} ${
      typeof r.body === "string" ? r.body.slice(0, 300) : JSON.stringify(r.body)?.slice(0, 400)
    }`,
  );

// 1. Какие bucket'ы уже существуют и какие у них колонки.
report("buckets(all cols)", await rest("storage.buckets?select=*"));

// 2. Есть ли уже spec-item-files (не должно быть).
report(
  "bucket spec-item-files",
  await rest("storage.buckets?select=id,name,public&name=eq.spec-item-files"),
);

// 3. Колонки, которые собирается использовать миграция.
report(
  "file_size_limit + allowed_mime_types",
  await rest(
    "storage.buckets?select=name,file_size_limit,allowed_mime_types&name=eq.material-images",
  ),
);

// 4. Может ли PostgREST фильтровать по org_id через organization_members (RLS-паттерн).
report(
  "organization_members sample",
  await rest("organization_members?select=org_id,role,user_id&limit=2"),
);
