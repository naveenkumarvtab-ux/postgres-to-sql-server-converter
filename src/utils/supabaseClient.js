import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let supabaseClientInstance = null;

try {
  if (supabaseUrl && supabaseUrl.startsWith('http')) {
    supabaseClientInstance = createClient(supabaseUrl, supabaseAnonKey);
  } else {
    console.warn('Supabase URL is missing or invalid. Auth features will be disabled. Use skip-auth for local demo mode.');
  }
} catch (e) {
  console.error('Failed to initialize Supabase client:', e);
}

// Fallback dummy client to prevent runtime reference errors
if (!supabaseClientInstance) {
  supabaseClientInstance = {
    auth: {
      getSession: () => Promise.resolve({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
      signUp: () => Promise.reject(new Error('Supabase client is not configured. Set VITE_SUPABASE_URL in your .env file.')),
      signInWithPassword: () => Promise.reject(new Error('Supabase client is not configured. Set VITE_SUPABASE_URL in your .env file.')),
      signOut: () => Promise.resolve({ error: null })
    }
  };
}

export const supabase = supabaseClientInstance;
