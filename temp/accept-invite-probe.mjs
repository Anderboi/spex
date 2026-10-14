// Проверка: применена ли чужая миграция 20261012_002 к живой базе (только чтение).
import { readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;

const query =
  "select pg_get_functiondef(p.oid) as d from pg_proc p where p.oid = 'public.accept_invite(text, uuid, text)'::regprocedure";

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
const text = await response.text();
console.log("status", response.status);
const hasAlias = text.includes("m.org_id = v_invite.org_id");
const hasAmbiguous = text.includes("where org_id = v_invite.org_id");
console.log("алиасы (m.org_id) есть:", hasAlias);
console.log("неоднозначная ссылка (org_id) есть:", hasAmbiguous);
console.log(text.slice(0, 1200));
