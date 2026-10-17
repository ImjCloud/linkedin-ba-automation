import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
let client: SupabaseClient | undefined;

// Lazy initialization avoids requiring deployment secrets during static/build analysis.
// Server-only module: never import from a Client Component or expose these values.
export function getSupabase() {
  if (!client) client = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'X-Client-Info': 'linkedin-ba-automation/0.1.0' } }
  });
  return client;
}
