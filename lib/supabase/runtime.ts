import { createClient } from "@supabase/supabase-js";
import { assertRuntimeSecret, runtimeConfig } from "../runtime-config.ts";

export function createPublicSupabaseClient() {
  assertRuntimeSecret("SUPABASE_URL", runtimeConfig.supabaseUrl);
  assertRuntimeSecret("SUPABASE_ANON_KEY", runtimeConfig.supabaseAnonKey);

  return createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseAnonKey, {
    auth: {
      persistSession: false,
    },
  });
}

export function createServiceSupabaseClient() {
  assertRuntimeSecret("SUPABASE_URL", runtimeConfig.supabaseUrl);
  assertRuntimeSecret("SUPABASE_SERVICE_ROLE_KEY", runtimeConfig.supabaseServiceRoleKey);

  return createClient(runtimeConfig.supabaseUrl, runtimeConfig.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
    },
  });
}
