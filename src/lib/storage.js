// Reemplazo de "window.storage" (API exclusiva de los artifacts de
// Claude.ai) por una versión que guarda los datos en Supabase, en la
// tabla "datos_docente". Mantiene la misma forma de respuesta que la
// original (get -> {key, value, shared} | null) para que App.jsx no
// necesite ningún cambio en la forma de leer/guardar.
//
// Cada docente tiene su propia fila en la tabla, identificada por su
// user_id de Supabase. La Seguridad a Nivel de Fila (RLS) ya configurada
// en la tabla impide que un docente pueda leer o escribir la fila de
// otro, aunque lo intentara a propósito.

import { supabase } from "./supabaseClient.js";

// App.jsx solo usa estas dos claves; cada una vive en su propia columna
// de la tabla, para no pisarse entre sí al guardar.
const COLUMNA_POR_CLAVE = {
  "cisd-instituciones": "datos",
  "cisd-perfil-docente": "perfil",
};

async function obtenerUserId() {
  const { data } = await supabase.auth.getSession();
  return data && data.session ? data.session.user.id : null;
}

function estaVacio(valor) {
  return (
    valor === null ||
    valor === undefined ||
    (typeof valor === "object" && !Array.isArray(valor) && Object.keys(valor).length === 0)
  );
}

window.storage = {
  async get(key) {
    const columna = COLUMNA_POR_CLAVE[key];
    if (!columna) return null;

    const userId = await obtenerUserId();
    if (!userId) return null;

    const { data, error } = await supabase
      .from("datos_docente")
      .select(columna)
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("No se pudo leer de Supabase:", error);
      return null;
    }
    if (!data || estaVacio(data[columna])) return null;

    return { key, value: JSON.stringify(data[columna]), shared: false };
  },

  async set(key, value) {
    const columna = COLUMNA_POR_CLAVE[key];
    if (!columna) return null;

    const userId = await obtenerUserId();
    if (!userId) return null;

    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = value;
    }

    const { error } = await supabase
      .from("datos_docente")
      .upsert(
        { user_id: userId, [columna]: parsed, actualizado_en: new Date().toISOString() },
        { onConflict: "user_id" }
      );

    if (error) {
      console.error("No se pudo guardar en Supabase:", error);
      return null;
    }
    return { key, value, shared: false };
  },

  async delete(key) {
    const columna = COLUMNA_POR_CLAVE[key];
    if (!columna) return null;

    const userId = await obtenerUserId();
    if (!userId) return null;

    const { error } = await supabase
      .from("datos_docente")
      .update({ [columna]: {} })
      .eq("user_id", userId);

    return { key, deleted: !error, shared: false };
  },

  async list(prefix = "") {
    const claves = Object.keys(COLUMNA_POR_CLAVE).filter((k) => k.startsWith(prefix));
    return { keys: claves, prefix, shared: false };
  },
};
