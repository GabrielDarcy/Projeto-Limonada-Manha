import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

const supabaseUrl = 'https://sqosvgesugekqvgucepn.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InNxb3N2Z2VzdWdla3F2Z3VjZXBuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODkwNDQ3MzYsImV4cCI6MjEwNDYyMDczNn0.3cMMFMHsCKgeCT3OSucgNKwt7XwYaZIrE14U1M5fR-Y';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);