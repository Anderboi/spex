// Что за отметка осталась в таблице.
process.loadEnvFile(".env.local");
import { readFileSync } from "node:fs";

const ref = readFileSync("supabase/.temp/project-ref", "utf8").trim();
const token = process.env.SUPABASE_ACCESS_TOKEN;

const query = `
select f.user_id, f.material_id, f.org_id, f.created_at, m.name
  from public.material_favorites f
  left join public.materials m on m.id = f.material_id
`;

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
console.log(response.status);
console.log(await response.text());
