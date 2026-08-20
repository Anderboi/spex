import type { SupabaseClient } from "@supabase/supabase-js";
import type { CustomFunctions } from "./database.overrides";

export async function callRpc<K extends keyof CustomFunctions>(
  supabase: SupabaseClient,
  fn: K,
  args: CustomFunctions[K]["Args"],
): Promise<{
  data: CustomFunctions[K]["Returns"] | null;
  error: { message: string } | null;
}> {
  const { data, error } = await supabase.rpc(fn as string, args as never);
  return {
    data: (data ?? null) as CustomFunctions[K]["Returns"] | null,
    error,
  };
}
