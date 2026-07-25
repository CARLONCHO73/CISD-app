// Reemplazo de "window.storage" (API exclusiva de los artifacts de
// Claude.ai) por una versión que guarda los datos en el localStorage del
// propio navegador. Mantiene la misma forma de respuesta que la original
// (get -> {key, value, shared} | null) para que App.jsx no necesite
// ningún cambio.
//
// Cada docente que abra la app en su navegador tiene su propio espacio
// guardado (nadie ve los datos de otro), y los datos quedan en su
// dispositivo: no se borran solos, pero tampoco se sincronizan entre
// dispositivos distintos del mismo docente.

const PREFIJO = "cisd:";

function claveCompleta(key) {
  return PREFIJO + key;
}

window.storage = {
  async get(key) {
    const raw = localStorage.getItem(claveCompleta(key));
    if (raw === null) return null;
    return { key, value: raw, shared: false };
  },

  async set(key, value) {
    localStorage.setItem(claveCompleta(key), value);
    return { key, value, shared: false };
  },

  async delete(key) {
    const existia = localStorage.getItem(claveCompleta(key)) !== null;
    localStorage.removeItem(claveCompleta(key));
    return { key, deleted: existia, shared: false };
  },

  async list(prefix = "") {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIJO)) {
        const bare = k.slice(PREFIJO.length);
        if (bare.startsWith(prefix)) keys.push(bare);
      }
    }
    return { keys, prefix, shared: false };
  },
};
