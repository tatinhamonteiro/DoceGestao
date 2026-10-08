// =====================================================================
//  Configuração do Supabase
//  Supabase → Project Settings → API:
//    - Project URL          → supabaseUrl
//    - anon / public key    → supabaseAnonKey
//  A chave "anon" é pública por natureza: a segurança fica nas regras
//  (RLS) criadas pelo supabase/schema.sql. NUNCA coloque aqui a "service_role".
// =====================================================================
window.DOCE_CONFIG = {
  supabaseUrl: 'https://SEU-PROJETO.supabase.co',
  supabaseAnonKey: 'COLE-AQUI-A-CHAVE-ANON',
};
