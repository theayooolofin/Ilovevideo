import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

// Always export a client — throwing here leaves `supabase` in TDZ and crashes
// every importer with "Cannot access 'X' before initialization" in prod bundles.
// If env vars are missing the client will exist but API calls will fail gracefully.
export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder-anon-key'
)
