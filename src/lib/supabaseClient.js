// Conexión a Supabase (proyecto "Aplicación CISD"). La clave usada acá es
// la "Clave publicable" (pública, segura para el navegador): la
// protección real de los datos de cada docente la da la Seguridad a
// Nivel de Fila (RLS) configurada en la tabla, no el secreto de esta
// clave.
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://gmgvggiiaqlysmublxfa.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_hM8nzMMykl0jSSv-aRvVuA_0v_qrhom";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
