// Разовая проверка: какой режим у Management API «Run a query».
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;

async function call(body, label) {
  const response = await fetch(
    `https://api.supabase.com/v1/projects/${ref}/database/query`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  console.log(label, response.status, (await response.text()).slice(0, 300));
}

await call({ query: "show transaction_read_only" }, "read_only по умолчанию:");
await call(
  {
    query: "begin; create temp table _t(x int); rollback; select 'ddl ok' as r",
    read_only: false,
  },
  "read_only:false + temp DDL:",
);
