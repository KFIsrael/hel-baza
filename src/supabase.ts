import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://uspakygxibqcicmsjvct.supabase.co'
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVzcGFreWd4aWJxY2ljbXNqdmN0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU0MTYyODIsImV4cCI6MjA5MDk5MjI4Mn0.cRn3uhaT5JwuqdvfuXXI-T2zfXWE0bGNAr0tmpq3AuM'

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
