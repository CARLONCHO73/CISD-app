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

// Cuántas copias de respaldo se conservan por docente antes de empezar a
// descartar las más viejas. Son archivos livianos (texto), así que ser
// generoso acá no cuesta casi nada.
const MAX_RESPALDOS = 20;

// Antes de sobrescribir los datos principales (colegios/cursos/alumnos),
// guarda una copia de "cómo estaba todo un instante antes" en una tabla
// aparte. Es una red de seguridad invisible para el docente: no cambia
// nada de lo que ve ni de cómo usa la app, pero si algún día un guardado
// sale mal, hay de dónde recuperar lo de un ratito antes. Solo se
// respalda si la versión anterior tenía contenido real (para no llenar
// el historial de copias vacías sin sentido).
async function generarRespaldoSiHaceFalta(userId) {
  try {
    const { data: filaActual } = await supabase
      .from("datos_docente")
      .select("datos")
      .eq("user_id", userId)
      .maybeSingle();

    const anterior = filaActual && filaActual.datos;
    const teniaContenido =
      anterior &&
      ((Array.isArray(anterior.colegios) && anterior.colegios.length > 0) ||
        (Array.isArray(anterior.cursos) && anterior.cursos.length > 0));

    if (!teniaContenido) return;

    await supabase.from("respaldo_datos_docente").insert({ user_id: userId, datos: anterior });

    // Recorta el historial: se queda solo con las últimas MAX_RESPALDOS copias.
    const { data: viejos } = await supabase
      .from("respaldo_datos_docente")
      .select("id")
      .eq("user_id", userId)
      .order("creado_en", { ascending: false })
      .range(MAX_RESPALDOS, MAX_RESPALDOS + 200);

    if (viejos && viejos.length > 0) {
      await supabase.from("respaldo_datos_docente").delete().in("id", viejos.map((v) => v.id));
    }
  } catch (err) {
    // Si el respaldo falla por algún motivo, no bloqueamos el guardado
    // normal por eso — es una capa extra, no el guardado principal.
    console.error("No se pudo generar el respaldo automático:", err);
  }
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
      // Importante: acá NO devolvemos null. Devolver null se interpreta
      // como "todavía no hay nada guardado" (docente nuevo) — pero esto
      // es un error real de conexión, una cosa completamente distinta.
      // Si lo tratáramos igual, la app podía terminar guardando un
      // estado vacío encima de datos reales por un simple corte de red.
      console.error("No se pudo leer de Supabase (error de red, no se interpreta como vacío):", error);
      throw new Error("No se pudo confirmar la lectura de datos: " + error.message);
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

    if (columna === "datos") {
      await generarRespaldoSiHaceFalta(userId);
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
