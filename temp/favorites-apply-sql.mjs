// Применение SQL через endpoint миграций Management API.
process.loadEnvFile(".env.local");
import { readFileSync } from "node:fs";

const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;
const file = process.argv[2];
const name = process.argv[3] ?? file;

const query = readFileSync(`supabase/migrations/${file}`, "utf8");

const response = await fetch(
  `https://api.supabase.com/v1/projects/${ref}/database/migrations`,
  {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Idempotency-Key": name,
    },
    body: JSON.stringify({ query, name }),
  },
);

console.log(response.status);
console.log((await response.text()).slice(0, 4000));
