// Разведка: бэкапы и план проекта (только чтение).
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;

async function get(path, label) {
  const response = await fetch(`https://api.supabase.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  console.log(`\n## ${label} [${response.status}]\n${text.slice(0, 1200)}`);
}

await get(`projects/${ref}/database/backups`, "бэкапы БД");
await get(`projects/${ref}/database/backups/pitr`, "PITR");
await get(`projects/${ref}`, "проект (план, регион)");
