// Read-only проверка цели smoke-теста и наличия публичных ссылок проекта.
// Запуск: node temp/probe-files-target.mjs
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
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const ORG = "a0a3fc2f-4bc6-4088-ab7c-68b70acb1e3c";
const ITEM = "15753bce-598e-4fc8-ae8e-f6df837fc047";

console.log("target item:", JSON.stringify(await rest(`spec_items?select=id,org_id,project_id,name,deleted_at&id=eq.${ITEM}`)));
console.log("links:", JSON.stringify(await rest(`public_links?select=token,type,project_id,expires_at&limit=5`)));
console.log("files rows:", JSON.stringify(await rest("spec_item_files?select=id,spec_item_id,deleted_at,file_name")));
console.log("org projects:", JSON.stringify(await rest(`projects?select=id,client_name,created_at&org_id=eq.${ORG}`)));
