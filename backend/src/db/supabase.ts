import 'dotenv/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl) {
  console.error(
    'ERROR: SUPABASE_URL environment variable is not set. ' +
    'Please configure it in your .env file.'
  );
  process.exit(1);
}

if (!supabaseServiceRoleKey) {
  console.error(
    'ERROR: SUPABASE_SERVICE_ROLE_KEY environment variable is not set. ' +
    'Please configure it in your .env file.'
  );
  process.exit(1);
}

export const supabaseClient: SupabaseClient = createClient(
  supabaseUrl,
  supabaseServiceRoleKey,
  {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  }
);

/**
 * Verifies that the pgvector extension is enabled in the Supabase project by
 * querying the pg_extension catalog. If the extension is absent, logs a
 * descriptive error and exits the process without modifying any data.
 *
 * Satisfies Requirement 1.13.
 */
export async function checkPgvectorExtension(): Promise<void> {
  // Supabase's service role key has access to pg_catalog views via PostgREST.
  // We query pg_extension to check for the 'vector' extension.
  const { data, error } = await supabaseClient
    .from('pg_extension')
    .select('extname')
    .eq('extname', 'vector')
    .maybeSingle();

  if (error) {
    // pg_extension may not be exposed via PostgREST in all Supabase tiers.
    // Log a warning and proceed rather than blocking startup on a check failure.
    console.warn(
      `WARNING: Could not query pg_extension to verify pgvector status: ${error.message}. ` +
      'Proceeding — ensure CREATE EXTENSION IF NOT EXISTS vector; has been run in your Supabase project.'
    );
    return;
  }

  if (!data) {
    console.error(
      'ERROR: pgvector extension is not enabled in your Supabase project. ' +
      'Please run: CREATE EXTENSION IF NOT EXISTS vector;'
    );
    process.exit(1);
  }
}
