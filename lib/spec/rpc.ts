import type { SupabaseClient } from "@supabase/supabase-js";
import { CustomFunctions } from '../supabase/database.overrides';

export async function callRpc<K extends keyof CustomFunctions>(
  supabase: SupabaseClient<never>,
  fn: K,
  args: CustomFunctions[K]["Args"],
): Promise<{
  data: CustomFunctions[K]["Returns"] | null;
  error: { message: string } | null;
}> {
  const { data, error } = await (supabase as SupabaseClient).rpc(
    fn,
    args as never,
  );
  return {
    data: (data ?? null) as CustomFunctions[K]["Returns"] | null,
    error,
  };
}
