import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://fallback.supabase.co';
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'fallback-anon-key';

export const supabase = createClient(supabaseUrl, supabaseKey);
