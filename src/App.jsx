import React, { useState, useRef, useEffect } from "react";
import { supabase } from "./lib/supabaseClient.js";
import {
  Hand, ClipboardCheck, Folder, Smile, StickyNote, Search, ClipboardList,
  SlidersHorizontal, Plus, GraduationCap, School, ChevronLeft, ChevronRight, UserPlus,
  MoreVertical, HelpCircle, Printer, CalendarDays,
} from "lucide-react";

// ---------- Design tokens (mismos que el prototipo original) ----------
const FONT_URL =
  "https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600;9..144,700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@500;600&display=swap";

const COLORS = {
  paper: "#F1EFE8",
  paperDim: "#E7E4DA",
  ink: "#22201B",
  inkSoft: "#5B584F",
  pine: "#1F4C43",
  pineDark: "#153531",
  ochre: "#C98A3D",
  ochreSoft: "#E9C48E",
  rose: "#B85C50",
  line: "#D8D4C6",
  white: "#FFFDF8",
  avatarF: "#B85C50",
  avatarM: "#1F4C43",
  nombreM: "#2E5EAA",
  nombreF: "#A23E8C",
  notaVerde: "#2E7D46",
  notaRoja: "#C0392B",
};

const etiquetaCampoStyle = {
  fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, color: COLORS.pine,
  textTransform: "uppercase", letterSpacing: 0.6, marginBottom: 6,
};

function fechaISO() { return new Date().toISOString(); }
function fechaCorta(iso) {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yy = String(d.getFullYear()).slice(-2);
  return `${dd}/${mm}/${yy}`;
}
function nuevoId(prefijo) { return `${prefijo}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`; }

// ---------- Utilidades de fecha para Asistencia (formato "YYYY-MM-DD") ----------
const DIAS_SEMANA = [
  { code: "DO", label: "Dom" },
  { code: "LU", label: "Lun" },
  { code: "MA", label: "Mar" },
  { code: "MI", label: "Mié" },
  { code: "JU", label: "Jue" },
  { code: "VI", label: "Vie" },
  { code: "SA", label: "Sáb" },
];
function hoyISO() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function sumarDiasFecha(fechaStr, delta) {
  const d = new Date(fechaStr + "T00:00:00");
  d.setDate(d.getDate() + delta);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}
function codigoDiaSemana(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  return DIAS_SEMANA[d.getDay()].code;
}

// diasClaseConfig históricamente era un array de códigos de día (ej. ["LU","JU"]).
// Ahora cada día puede tener además un horario de inicio/fin (ej. { dia: "LU",
// inicio: "08:00", fin: "08:40" }). Estas funciones entienden ambos formatos,
// para que los datos ya guardados por un docente no se rompan.
function diaConfigCodigo(item) {
  return typeof item === "string" ? item : item.dia;
}
function tieneDiaConfigurado(diasClaseConfig, codigo) {
  return (diasClaseConfig || []).some((item) => diaConfigCodigo(item) === codigo);
}
function obtenerBloqueDia(diasClaseConfig, codigo) {
  const item = (diasClaseConfig || []).find((i) => diaConfigCodigo(i) === codigo);
  if (!item) return null;
  return typeof item === "string" ? { dia: item, inicio: "", fin: "" } : item;
}
function formatFechaLarga(fechaStr) {
  const d = new Date(fechaStr + "T00:00:00");
  const texto = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" });
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}
// Arma "YYYY-MM-DD" a partir de año, mes (0-11) y día, para las celdas
// del calendario mensual.
function fechaISOdesdeAnioMesDia(anio, mesIndex, dia) {
  const mm = String(mesIndex + 1).padStart(2, "0");
  const dd = String(dia).padStart(2, "0");
  return `${anio}-${mm}-${dd}`;
}
// Devuelve la grilla de un mes: null para el relleno inicial (para que el
// día 1 caiga en la columna correcta según su día de semana) y el número
// de día para el resto.
function construirGrillaMes(anio, mesIndex) {
  const primerDiaSemana = new Date(anio, mesIndex, 1).getDay(); // 0=Dom..6=Sáb
  const diasEnMes = new Date(anio, mesIndex + 1, 0).getDate();
  const celdas = [];
  for (let i = 0; i < primerDiaSemana; i++) celdas.push(null);
  for (let d = 1; d <= diasEnMes; d++) celdas.push(d);
  return celdas;
}

// Un día del curso cuenta como "clase dictada" solo si tiene al menos una
// marca (A/T/J) para algún alumno, y no está señalado como "día no
// trabajado" (esos se excluyen del todo, aunque conserven marcas viejas).
function fechasClaseDictada(diasCurso) {
  return Object.keys(diasCurso || {}).filter((f) => {
    const dia = diasCurso[f];
    if (!dia || dia.motivo) return false;
    const marcas = dia.marcas || {};
    return Object.values(marcas).some((v) => v === "A" || v === "T" || v === "J");
  });
}

// Calcula el % de asistencia de un alumno puntual: solo cuenta las clases
// dictadas desde su fecha de alta en el curso. Las tardanzas (T) sueltas
// no penalizan; cada 3 se convierten en 1 falta equivalente.
function calcularAsistenciaAlumno(alumno, diasCurso) {
  const fechaAlta = alumno.fechaAlta || "0000-00-00";
  const fechas = fechasClaseDictada(diasCurso).filter((f) => f >= fechaAlta);
  let a = 0, t = 0, j = 0;
  fechas.forEach((f) => {
    const marca = (diasCurso[f].marcas || {})[alumno.id];
    if (marca === "A") a++;
    else if (marca === "T") t++;
    else if (marca === "J") j++;
  });
  const total = fechas.length;
  if (total === 0) return { porcentaje: null, a, t, j, total };
  const faltasEquivalentes = a + j + Math.floor(t / 3);
  const porcentaje = Math.round(((total - faltasEquivalentes) / total) * 100);
  return { porcentaje, a, t, j, total };
}

// Determina el color de una nota numérica según el umbral de aprobación
// configurado por el docente. Si todavía no hay umbral, no colorea.
function colorNota(valor, notaAprobacion) {
  if (notaAprobacion == null || valor === "" || valor == null) return COLORS.ink;
  const num = Number(String(valor).replace(",", "."));
  if (Number.isNaN(num)) return COLORS.ink;
  return num >= notaAprobacion ? COLORS.notaVerde : COLORS.notaRoja;
}

// Reconoce "Aus" o "Ausente" (en cualquier combinación de mayúsculas/
// minúsculas) tipeado a mano en una celda de texto libre de la Planilla
// de Calificaciones oficial. Se usa para normalizar lo tipeado a "Aus",
// pintarlo en rojo y negrita, y contarlo como 0 en los promedios.
function esMarcaAusente(valor) {
  if (valor == null) return false;
  const v = String(valor).trim().toLowerCase();
  return v === "aus" || v === "ausente";
}

// ---------- Saludo de bienvenida por franja horaria ----------
// Determina la franja del momento en que se abre la app, para elegir el
// saludo correspondiente. Se muestra como máximo una vez por franja y por
// día (el registro se guarda en el perfil del docente).
function franjaHorariaActual() {
  const h = new Date().getHours();
  if (h >= 5 && h < 13) return "manana";
  if (h >= 13 && h < 19) return "tarde";
  return "noche";
}

// Variantes de saludo por franja: algunas incluyen el nombre elegido por
// el docente, otras no, para que no se sienta repetitivo con el uso diario.
const SALUDOS_POR_FRANJA = {
  manana: (nombre) => [`Buenos días, ${nombre}`, "Arrancamos el día", "Otro día de clase", "Buen día, profe"],
  tarde: (nombre) => [`Buenas tardes, ${nombre}`, "¿Cómo va la tarde?", "Seguimos con la tarde", "Buenas tardes, profe"],
  noche: (nombre) => [`Buenas noches, ${nombre}`, "Cerrando el día", "Terminando la jornada", "Buenas noches, profe"],
};

// Banco de frases cortas de acompañamiento/motivación docente, sin
// contenido religioso ni político. Se elige una al azar cada vez que se
// muestra el saludo, evitando repetir la misma dos veces seguidas.
const FRASES_ACOMPANAMIENTO = [
  "Cada clase deja una marca, aunque no se vea enseguida.",
  "Lo que hoy enseñás, alguien lo va a recordar.",
  "Educar es un trabajo que no siempre se aplaude, pero siempre se nota.",
  "Hoy alguien va a entender algo gracias a vos.",
  "Detrás de cada lista de asistencia hay una historia distinta.",
  "A veces enseñar es simplemente estar presente.",
  "Un día más, un paso más para cada uno de tus alumnos.",
  "Las cosas importantes se construyen de a poco, como esto.",
  "Otra jornada para seguir formando personas, no solo contenidos.",
  "Antes de cuidar aulas, cuidate vos también.",
  "Un buen día empieza por reconocer el esfuerzo que hacés.",
  "Gracias por elegir esto, otra vez, hoy.",
  "Cada alumno avanza a su propio ritmo, y vos lo acompañás.",
  "El orden de hoy es el alivio de mañana.",
  "Enseñar también es tener paciencia con el proceso.",
  "Gracias por estar.",
  "Un aula mejor gracias a vos.",
  "Hoy también sumás algo.",
  "Presente, como siempre.",
  "Se nota el esfuerzo, aunque no se diga.",
  "Cada día cuenta, literal.",
  "Formando futuro, una clase a la vez.",
  "Tu trabajo importa más de lo que parece.",
  "Otra huella que dejás hoy.",
  "El aula te espera.",
  "Constancia que se nota.",
  "Vos hacés la diferencia.",
  "Un paso más, con vos al frente.",
  "Gracias por elegir enseñar.",
  "Hoy también, gracias.",
];

// Elige un índice al azar dentro de la lista, evitando repetir el índice
// anterior cuando hay más de una opción disponible.
function elegirIndiceAlAzar(cantidad, indiceAEvitar) {
  if (cantidad <= 1) return 0;
  let idx = Math.floor(Math.random() * cantidad);
  if (idx === indiceAEvitar) idx = (idx + 1) % cantidad;
  return idx;
}

// ---------- Datos de ejemplo (vacíos: cada docente arranca desde cero) ----------
const COLEGIOS_SEED = [];
const CURSOS_SEED = [];
const ALUMNOS_SEED = {};

// Los 5 campos "de fábrica" ahora son criterios normales dentro de la misma
// tabla genérica. Arrancan como "disponibles" pero SIN estar activos en
// ningún curso: el docente los suma con el botón "Usar" cuando los necesita.
// "activadoEnCursos": lista explícita de cursos donde está en uso.
// "porDefecto": si es true, cualquier curso nuevo lo suma automáticamente.
const CRITERIOS_SEED = [
  { id: "crit-participacion", nombre: "Participación", tipo: "opcion", opciones: ["Nula", "Poca", "Buena", "Muy buena", "Excelente"], orden: 0, activadoEnCursos: [], porDefecto: false },
  { id: "crit-evaluacion", nombre: "Evaluación escrita", tipo: "numerico_instancias", max: 10, orden: 1, activadoEnCursos: [], porDefecto: false },
  { id: "crit-carpeta", nombre: "Carpeta", tipo: "texto", orden: 2, activadoEnCursos: [], porDefecto: false },
  { id: "crit-conducta", nombre: "Conducta", tipo: "opcion", opciones: ["Mala", "Regular", "Buena", "Muy buena", "Excelente"], conObservacion: true, orden: 3, activadoEnCursos: [], porDefecto: false },
  { id: "crit-observaciones", nombre: "Observaciones", tipo: "texto", orden: 4, activadoEnCursos: [], porDefecto: false },
  { id: "crit-asistencia", nombre: "Asistencia", tipo: "asistencia", orden: 5, activadoEnCursos: [], porDefecto: false },
];

// Ordena una lista de criterios para un curso dado: si ese curso tiene un
// orden propio guardado (lo arrastró el docente y eligió "solo este curso"),
// lo respeta; si no, usa el orden global (campo "orden" de cada criterio).
function ordenarCriteriosPorCurso(items, cursoId, ordenPorCurso) {
  const override = ordenPorCurso[cursoId];
  if (override && override.length) {
    const pos = new Map(override.map((id, i) => [id, i]));
    return [...items].sort((a, b) => {
      const pa = pos.has(a.id) ? pos.get(a.id) : 999 + (a.orden || 0);
      const pb = pos.has(b.id) ? pos.get(b.id) : 999 + (b.orden || 0);
      return pa - pb;
    });
  }
  return [...items].sort((a, b) => (a.orden || 0) - (b.orden || 0));
}

function etiquetaTipoCriterio(c) {
  if (c.tipo === "numerico_instancias") return `Numérica (0–${c.max || 10}) · instancias + recuperatorio`;
  if (c.tipo === "numerico") return `Numérica (0–${c.max || 10})`;
  if (c.tipo === "opcion") return `Opciones: ${(c.opciones || []).join(", ")}`;
  if (c.tipo === "asistencia") return "Asistencia · se carga desde el botón Asistencia del curso";
  return "Texto libre";
}

// Paleta pastel de baja fatiga visual (misma familia tonal que el resto de
// la app: saturación baja, buen contraste de texto). Cada criterio recibe
// un color calculado a partir de su id (estable entre pantallas), pero si
// dos criterios activos en el mismo curso coinciden, se resuelve la
// colisión corriendo al siguiente tono libre de la paleta.
const PALETA_BLOQUES_FICHA = [
  { fondo: "#E8F1EC", borde: "#BFDCC9", texto: "#2F6B4C" }, // salvia
  { fondo: "#F5E6E3", borde: "#DDB3A8", texto: "#8C4A3B" }, // terracota suave
  { fondo: "#E3EEF4", borde: "#B7D4E3", texto: "#2E5E78" }, // celeste polvo
  { fondo: "#FBF0DC", borde: "#E9C48E", texto: "#8A5A1E" }, // ocre suave
  { fondo: "#EEE6F2", borde: "#CDB8D6", texto: "#6B4A80" }, // lavanda
  { fondo: "#E2F0EE", borde: "#A9D2CB", texto: "#2B6E62" }, // verde azulado
  { fondo: "#F2E7E9", borde: "#D8B4BA", texto: "#7A3F49" }, // rosa viejo
  { fondo: "#EDEFE0", borde: "#C9CFA8", texto: "#5C6631" }, // oliva claro
  { fondo: "#EDE6DC", borde: "#CBB89E", texto: "#6B4E31" }, // arena tostada
  { fondo: "#E4E8EF", borde: "#AEBBD4", texto: "#354569" }, // azul grisáceo
  { fondo: "#F1E6EC", borde: "#D9AFC4", texto: "#7A3B58" }, // ciruela claro
  { fondo: "#E9EEE0", borde: "#BFCF9F", texto: "#516B2E" }, // musgo claro
];

function colorParaCriterio(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return hash % PALETA_BLOQUES_FICHA.length;
}

// Asigna un índice de paleta a cada criterio de la lista, sin repetir
// dentro de esa misma lista. Arranca del índice "preferido" (estable por
// id) y si ya está tomado, avanza al siguiente libre.
function asignarColoresSinRepetir(items) {
  const usados = new Set();
  const asignados = {};
  items.forEach((item) => {
    let idx = colorParaCriterio(item.id);
    let vueltas = 0;
    while (usados.has(idx) && vueltas < PALETA_BLOQUES_FICHA.length) {
      idx = (idx + 1) % PALETA_BLOQUES_FICHA.length;
      vueltas += 1;
    }
    usados.add(idx);
    asignados[item.id] = PALETA_BLOQUES_FICHA[idx];
  });
  return asignados;
}

// ================================================================
// CUADRO DE DIÁLOGO CONTEXTUAL GUIADO
// ================================================================
function CuadroGuia({ texto, compacto }) {
  return (
    <div
      style={{
        display: "flex", gap: compacto ? 8 : 10, alignItems: "flex-start",
        background: COLORS.paperDim, border: `1px solid ${COLORS.line}`,
        borderRadius: compacto ? 12 : 14, padding: compacto ? "7px 10px" : "10px 12px", marginBottom: compacto ? 8 : 14,
      }}
    >
      <div
        style={{
          width: compacto ? 20 : 26, height: compacto ? 20 : 26, borderRadius: "50%", background: COLORS.pine, color: COLORS.white,
          display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, marginTop: 1,
        }}
      >
        <GraduationCap size={compacto ? 11 : 14} strokeWidth={2.2} />
      </div>
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: compacto ? 11.5 : 12.5, color: COLORS.inkSoft, lineHeight: 1.4 }}>
        {texto}
      </div>
    </div>
  );
}

// Detecta si la app se está viendo en una pantalla ancha (computadora) o
// angosta (celular/tablet en vertical), para adaptar el diseño sin cambiar
// ninguna función. El umbral (900px) separa un celular grande/tablet
// vertical de una notebook o monitor.
function useEsEscritorio() {
  const [esEscritorio, setEsEscritorio] = useState(
    typeof window !== "undefined" ? window.innerWidth >= 900 : false
  );
  useEffect(() => {
    function chequear() { setEsEscritorio(window.innerWidth >= 900); }
    window.addEventListener("resize", chequear);
    return () => window.removeEventListener("resize", chequear);
  }, []);
  return esEscritorio;
}

// Menú lateral fijo que solo se muestra en pantallas anchas (computadora).
// Deja siempre a la vista los colegios y sus cursos, para moverse entre
// ellos sin perder de vista dónde se está parado. No reemplaza ninguna
// pantalla ni botón existente: es un atajo adicional.
function SidebarEscritorio({ colegios, cursosPorColegio, colegioId, cursoId, onIrAInicio, onIrAColegio, onIrACurso, onIrAHorario, onIrANotas }) {
  const [expandido, setExpandido] = useState(() => (colegioId ? { [colegioId]: true } : {}));

  useEffect(() => {
    if (colegioId) setExpandido((prev) => ({ ...prev, [colegioId]: true }));
  }, [colegioId]);

  return (
    <div
      style={{
        width: 260, flexShrink: 0, minHeight: "100vh", background: COLORS.pineDark, color: COLORS.white,
        padding: "20px 14px", position: "sticky", top: 0, alignSelf: "flex-start", overflowY: "auto", maxHeight: "100vh",
      }}
    >
      <div
        onClick={onIrAInicio}
        style={{ cursor: "pointer", marginBottom: 10, paddingLeft: 4 }}
      >
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, color: COLORS.ochreSoft, letterSpacing: 0.5 }}>CISD</div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 20, fontWeight: 600 }}>Mis colegios</div>
      </div>

      <div style={{ display: "flex", gap: 6, marginBottom: 14 }}>
        <div
          onClick={onIrAHorario}
          style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", padding: "6px 8px", borderRadius: 8, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, color: COLORS.ochreSoft }}
        >
          <CalendarDays size={13} strokeWidth={2.4} /> Horario
        </div>
        <div
          onClick={onIrANotas}
          style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", padding: "6px 8px", borderRadius: 8, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, color: COLORS.ochreSoft }}
        >
          <StickyNote size={13} strokeWidth={2.4} /> Bitácora
        </div>
      </div>

      {colegios.length === 0 && (
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.ochreSoft, padding: "0 4px" }}>
          Agregá tu primer colegio para empezar.
        </div>
      )}

      {colegios.map((col) => {
        const abierto = !!expandido[col.id];
        const activo = colegioId === col.id;
        const cursosDelColegio = cursosPorColegio[col.id] || [];
        return (
          <div key={col.id} style={{ marginBottom: 4 }}>
            <div
              onClick={() => {
                setExpandido((prev) => ({ ...prev, [col.id]: !abierto || !activo }));
                onIrAColegio(col);
              }}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "8px 8px", borderRadius: 10, cursor: "pointer",
                background: activo && !cursoId ? "rgba(255,255,255,0.14)" : "transparent",
              }}
            >
              <ChevronRight size={13} strokeWidth={2.4} style={{ transform: abierto ? "rotate(90deg)" : "none", transition: "transform 0.12s", flexShrink: 0, opacity: 0.7 }} />
              <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {col.nombre}
              </span>
            </div>
            {abierto && (
              <div style={{ paddingLeft: 24, marginTop: 2, marginBottom: 4 }}>
                {cursosDelColegio.length === 0 && (
                  <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: "rgba(255,255,255,0.5)", padding: "5px 8px" }}>
                    Sin cursos todavía
                  </div>
                )}
                {cursosDelColegio.map((curso) => {
                  const activoCurso = activo && cursoId === curso.id;
                  return (
                    <div
                      key={curso.id}
                      onClick={() => onIrACurso(col, curso)}
                      style={{
                        padding: "6px 8px", borderRadius: 8, cursor: "pointer", marginBottom: 1,
                        background: activoCurso ? COLORS.ochre : "transparent",
                        color: activoCurso ? COLORS.pineDark : COLORS.white,
                        fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: activoCurso ? 700 : 500,
                        whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      }}
                    >
                      {curso.nombre}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Toast({ text, show }) {
  return (
    <div
      style={{
        position: "fixed", left: "50%", bottom: show ? 24 : -60, transform: "translateX(-50%)",
        background: COLORS.pineDark, color: COLORS.white, padding: "10px 18px", borderRadius: 999,
        fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 500, letterSpacing: 0.2,
        boxShadow: "0 8px 24px rgba(21,53,49,0.35)", transition: "bottom 0.35s cubic-bezier(.4,0,.2,1)",
        zIndex: 80, whiteSpace: "nowrap",
      }}
    >
      {text}
    </div>
  );
}

// Referencia global (fuera de React) para poder abrir el popup de
// "Cambiar nombre" desde el menú "⋮" de cualquier pantalla, sin tener que
// pasar la función como prop a través de toda la app. La setea el
// componente principal (CISDNavegacion) apenas se monta.
let abrirCambiarNombreRef = null;

// Ref global (provisorio, mientras dure la prueba con los colegas) para
// abrir el popup de "Enviar sugerencia" desde el menú "⋮" de la
// pantalla de Mis colegios.
let abrirSugerenciaRef = null;

// ================================================================
// MENÚ "⋮" DE PANTALLA — "Ayuda de esta pantalla" (vuelve a mostrar el
// recorrido guiado) y "Cambiar nombre" (edita cómo lo saluda la app).
// ================================================================
function BotonMenuAyuda({ onAyuda, mostrarSugerencia }) {
  const [abierto, setAbierto] = useState(false);
  return (
    <div style={{ position: "relative" }}>
      <span
        onClick={() => setAbierto((v) => !v)}
        style={{ cursor: "pointer", padding: 4, display: "flex" }}
        aria-label="Menú de la pantalla"
      >
        <MoreVertical size={20} color={COLORS.ochreSoft} strokeWidth={2.2} />
      </span>
      {abierto && (
        <>
          <div onClick={() => setAbierto(false)} style={{ position: "fixed", inset: 0, zIndex: 95 }} />
          <div style={{ position: "absolute", top: 28, right: 0, background: COLORS.white, borderRadius: 14, boxShadow: "0 8px 24px rgba(0,0,0,0.28)", padding: 6, minWidth: 200, zIndex: 96 }}>
            <div
              onClick={() => { setAbierto(false); onAyuda(); }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.pineDark, fontWeight: 500 }}
            >
              <HelpCircle size={15} strokeWidth={2.2} /> Ayuda de esta pantalla
            </div>
            <div
              onClick={() => { setAbierto(false); if (abrirCambiarNombreRef) abrirCambiarNombreRef(); }}
              style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.pineDark, fontWeight: 500 }}
            >
              <Smile size={15} strokeWidth={2.2} /> Cambiar nombre
            </div>
            {mostrarSugerencia && (
              <div
                onClick={() => { setAbierto(false); if (abrirSugerenciaRef) abrirSugerenciaRef(); }}
                style={{ display: "flex", alignItems: "center", gap: 8, padding: "9px 10px", borderRadius: 10, cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.pineDark, fontWeight: 500 }}
              >
                <StickyNote size={15} strokeWidth={2.2} /> Enviar sugerencia
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ================================================================
// RECORRIDO GUIADO — recorre una lista de "pasos", cada uno con un
// texto y (opcionalmente) una referencia a un elemento real de la
// pantalla para resaltarlo con un recuadro y oscurecer el resto.
// ================================================================
function TourGuiado({ pasos, onCerrar }) {
  const [paso, setPaso] = useState(0);
  const [rect, setRect] = useState(null);
  const actual = pasos[paso];

  useEffect(() => {
    function medir() {
      const el = actual && actual.ref ? actual.ref.current : null;
      if (el) {
        // Si el elemento a señalar es muy alto (ocupa buena parte de la
        // pantalla), lo llevamos arriba del todo en vez de centrarlo, para
        // dejar la mayor cantidad de espacio libre posible debajo y que el
        // cartel de explicación tenga dónde ubicarse sin taparlo.
        const previo = el.getBoundingClientRect();
        const esAlto = previo.height > window.innerHeight * 0.45;
        el.scrollIntoView({ behavior: "smooth", block: esAlto ? "start" : "center" });
        const r = el.getBoundingClientRect();
        setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
      } else {
        setRect(null);
      }
    }
    medir();
    const t = setTimeout(medir, 280); // vuelve a medir después del scroll suave
    window.addEventListener("resize", medir);
    return () => { clearTimeout(t); window.removeEventListener("resize", medir); };
  }, [paso, actual]);

  if (!actual) return null;

  const pad = 6;
  const box = rect ? { top: rect.top - pad, left: rect.left - pad, width: rect.width + pad * 2, height: rect.height + pad * 2 } : null;
  const alturaVentana = typeof window !== "undefined" ? window.innerHeight : 800;
  const anchoVentana = typeof window !== "undefined" ? window.innerWidth : 400;
  const margen = 16;
  const anchoCartelMin = 240;
  const anchoCartelMax = 340;

  // El cartel se ubica del lado (arriba o abajo del recuadro resaltado)
  // donde haya más espacio libre en la pantalla, así nunca queda tapando
  // lo que se está señalando. Si el espacio de ese lado es más chico que
  // el contenido, el cartel se vuelve scrolleable en vez de invadir el
  // recuadro resaltado. Además, en vez de ocupar todo el ancho de la
  // pantalla, el cartel se angosta y se centra horizontalmente sobre el
  // propio elemento señalado (con una flechita que apunta hacia él), para
  // que quede claro y visualmente pegado a lo que está explicando.
  let cartelStyle = {};
  let flecha = null;
  if (box) {
    const anchoCartel = Math.min(anchoCartelMax, Math.max(anchoCartelMin, box.width + 48, anchoVentana - margen * 2));
    const centroBox = box.left + box.width / 2;
    let left = centroBox - anchoCartel / 2;
    left = Math.max(margen, Math.min(left, anchoVentana - margen - anchoCartel));

    const espacioAbajo = alturaVentana - (box.top + box.height) - 12;
    const espacioArriba = box.top - 12;
    const vaAbajo = espacioAbajo >= espacioArriba;

    cartelStyle = {
      left, width: anchoCartel,
      maxHeight: Math.max((vaAbajo ? espacioAbajo : espacioArriba) - margen, 120),
      overflowY: "auto",
    };
    if (vaAbajo) cartelStyle.top = box.top + box.height + 16;
    else cartelStyle.bottom = alturaVentana - box.top + 16;

    // Posición horizontal de la flecha: apunta al centro del elemento
    // señalado, pero se mantiene dentro de los bordes del cartel para
    // que nunca quede "flotando" afuera de la tarjeta.
    let puntaFlecha = centroBox - left;
    puntaFlecha = Math.max(18, Math.min(puntaFlecha, anchoCartel - 18));
    flecha = { left: puntaFlecha, apuntaArriba: vaAbajo };
  } else {
    cartelStyle = {
      left: "50%", top: "50%", width: Math.min(anchoCartelMax, anchoVentana - margen * 2),
      transform: "translate(-50%, -50%)",
    };
  }

  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 200 }}>
      {box ? (
        <div
          style={{
            position: "fixed", top: box.top, left: box.left, width: box.width, height: box.height,
            borderRadius: 14, boxShadow: "0 0 0 9999px rgba(21,53,49,0.74)", border: `2px solid ${COLORS.ochre}`,
            pointerEvents: "none", transition: "top 0.25s ease, left 0.25s ease, width 0.25s ease, height 0.25s ease",
          }}
        />
      ) : (
        <div style={{ position: "fixed", inset: 0, background: "rgba(21,53,49,0.74)" }} />
      )}

      <div
        style={{
          position: "fixed", background: COLORS.white, borderRadius: 14, padding: 16,
          boxShadow: "0 12px 30px rgba(0,0,0,0.35)", zIndex: 210, ...cartelStyle,
        }}
      >
        {flecha && (
          <div
            style={{
              position: "absolute", left: flecha.left, [flecha.apuntaArriba ? "top" : "bottom"]: -8,
              width: 16, height: 16, background: COLORS.white, transform: "translateX(-50%) rotate(45deg)",
              boxShadow: flecha.apuntaArriba ? "-3px -3px 4px -2px rgba(0,0,0,0.12)" : "3px 3px 4px -2px rgba(0,0,0,0.12)",
            }}
          />
        )}
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, fontWeight: 700, color: COLORS.ochre, letterSpacing: 0.4, marginBottom: 4 }}>
          PASO {paso + 1} DE {pasos.length}
        </div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16.5, fontWeight: 600, color: COLORS.pineDark, marginBottom: 5 }}>
          {actual.titulo}
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, lineHeight: 1.45, marginBottom: 14 }}>
          {actual.texto}
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span onClick={onCerrar} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine, padding: "8px 14px" }}>
            Saltar
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {paso > 0 && (
              <span onClick={() => setPaso((p) => p - 1)} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim, padding: "8px 14px" }}>
                Atrás
              </span>
            )}
            <span
              onClick={() => (paso < pasos.length - 1 ? setPaso((p) => p + 1) : onCerrar())}
              style={{ ...chipBase, color: COLORS.white, background: COLORS.pine, padding: "8px 16px" }}
            >
              {paso < pasos.length - 1 ? "Siguiente" : "Listo"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function EncabezadoNav({ eyebrow, titulo, subtitulo, accion, onAyuda, partes }) {
  return (
    <div style={{ background: COLORS.pineDark, padding: "10px 18px 10px 18px", color: COLORS.white, position: "relative" }}>
      {onAyuda && (
        <div style={{ position: "absolute", top: 6, right: 10 }}>
          <BotonMenuAyuda onAyuda={onAyuda} />
        </div>
      )}
      {partes ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, paddingRight: onAyuda ? 26 : 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "3px 6px", minWidth: 0 }}>
            <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ochreSoft }}>{partes.colegio}</span>
            <span style={{ color: COLORS.ochreSoft, fontSize: 13 }}>·</span>
            <span style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 700, color: COLORS.white }}>{partes.curso}</span>
            {partes.materia && (
              <>
                <span style={{ color: COLORS.ochreSoft, fontSize: 13 }}>·</span>
                <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ochreSoft }}>{partes.materia}</span>
              </>
            )}
          </div>
          {accion && <div style={{ flexShrink: 0 }}>{accion}</div>}
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, paddingRight: onAyuda ? 26 : 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.ochreSoft, letterSpacing: 0.4, marginBottom: 2 }}>
              {eyebrow}
            </div>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, lineHeight: 1.15 }}>{titulo}</div>
            {subtitulo && (
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.ochreSoft, marginTop: 1 }}>
                {subtitulo}
              </div>
            )}
          </div>
          {accion && <div style={{ flexShrink: 0 }}>{accion}</div>}
        </div>
      )}
    </div>
  );
}

// ================================================================
// MODAL DE CONFIRMACIÓN (pop-up real, centrado, con overlay) — usado
// para preguntas puntuales al docente: orden de criterios, nota de
// aprobación, etc. Reemplaza a los banners inline para que la pregunta
// sea imposible de pasar por alto.
// ================================================================
function ModalConfirmacion({ titulo, texto, children, botones }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(34,32,27,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 90, padding: 20 }}>
      <div style={{ background: COLORS.white, borderRadius: 14, padding: "20px 18px", width: "100%", maxWidth: 340, boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, color: COLORS.pineDark, marginBottom: 8 }}>{titulo}</div>
        {texto && (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.inkSoft, lineHeight: 1.45, marginBottom: 14 }}>
            {texto}
          </div>
        )}
        {children}
        <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end", flexWrap: "wrap" }}>
          {botones}
        </div>
      </div>
    </div>
  );
}

// Botón "Volver" flotante, siempre abajo a la izquierda, usado en todas
// las pantallas y modales con navegación hacia atrás.
function BotonVolverFlotante({ onVolver, zIndex }) {
  return (
    <button
      onClick={onVolver}
      style={{
        position: "fixed", left: 18, bottom: 22, height: 52, padding: "0 20px", borderRadius: 999,
        border: "none", background: COLORS.pineDark, color: COLORS.white, display: "flex",
        alignItems: "center", gap: 7, boxShadow: "0 8px 20px rgba(21,53,49,0.4)",
        cursor: "pointer", zIndex: zIndex || 30, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14.5, fontWeight: 600,
      }}
      aria-label="Volver"
    >
      <ChevronLeft size={18} strokeWidth={2.4} /> Volver
    </button>
  );
}

function FormularioInline({ placeholder, onConfirmar, textoBoton }) {
  const [valor, setValor] = useState("");
  function confirmar() {
    if (!valor.trim()) return;
    onConfirmar(valor.trim());
    setValor("");
  }
  return (
    <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
      <input
        value={valor} onChange={(e) => setValor(e.target.value)} placeholder={placeholder}
        onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
        autoFocus
        style={{ flex: 1, minWidth: 0, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "8px 10px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14 }}
      />
      <button
        onClick={confirmar}
        style={{ flexShrink: 0, padding: "8px 14px", borderRadius: 10, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 500, cursor: "pointer" }}
      >
        {textoBoton || "Crear"}
      </button>
    </div>
  );
}

function SelectorPeriodo({ periodo, onChange }) {
  return (
    <div style={{ display: "inline-flex", background: COLORS.paperDim, borderRadius: 999, padding: 2 }}>
      {["1", "2"].map((p) => (
        <button
          key={p} onClick={() => onChange(p)}
          style={{
            padding: "5px 10px", borderRadius: 999, border: "none",
            background: periodo === p ? COLORS.ochre : "transparent",
            color: periodo === p ? COLORS.pineDark : COLORS.inkSoft,
            fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
          }}
        >
          {p}° Cuatrim.
        </button>
      ))}
    </div>
  );
}

// ================================================================
// POPUP: NOTA MÍNIMA DE APROBACIÓN — se pregunta una sola vez, la
// primera vez que el docente guarda cualquier calificación numérica.
// A partir de ahí, toda nota de la app se pinta roja/verde según esto.
// ================================================================
function PopupNotaAprobacion({ valorInicial, onConfirmar, onCancelar }) {
  const [valor, setValor] = useState(valorInicial != null ? String(valorInicial) : "6");
  function confirmar() {
    const n = Number(valor.replace(",", "."));
    if (Number.isFinite(n) && n > 0) onConfirmar(n);
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(34,32,27,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 95, padding: 20 }}>
      <div style={{ background: COLORS.white, borderRadius: 14, padding: 20, width: "100%", maxWidth: 340, boxShadow: "0 12px 30px rgba(0,0,0,0.3)" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, color: COLORS.pineDark, marginBottom: 8 }}>
          Nota mínima de aprobación
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, marginBottom: 12, lineHeight: 1.4 }}>
          ¿Cuál es la nota mínima de aprobación? La usamos para pintar en rojo o verde todas las calificaciones de la app de ahora en más.
        </div>
        <input
          value={valor} onChange={(e) => setValor(e.target.value)} inputMode="decimal" autoFocus
          onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "9px 10px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 18, textAlign: "center", marginBottom: 14 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          {onCancelar && (
            <button
              onClick={onCancelar}
              style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${COLORS.line}`, background: "transparent", color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Cancelar
            </button>
          )}
          <button
            onClick={confirmar}
            style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================
// POPUP: ACTIVAR PROMEDIO AUTOMÁTICO — se ofrece la primera vez que el
// docente termina de cargar el 2º informe (de cualquiera de los dos
// cuatrimestres) en la planilla oficial de un curso, si todavía no está
// activado. Se aplica a todo el curso, tanto en la planilla individual
// como en la grupal.
// ================================================================
function PopupPromedioAuto({ onConfirmar, onCancelar }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(34,32,27,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 96, padding: 20 }}>
      <div style={{ background: COLORS.white, borderRadius: 14, padding: 20, width: "100%", maxWidth: 340, boxShadow: "0 12px 30px rgba(0,0,0,0.3)" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600, color: COLORS.pineDark, marginBottom: 8 }}>
          ¿Calcular el promedio solo?
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, marginBottom: 16, lineHeight: 1.4 }}>
          Ya cargaste el 2° informe. ¿Querés activar el cálculo automático del promedio para este curso? Vas a poder desactivarlo cuando quieras.
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={onCancelar}
            style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1px solid ${COLORS.line}`, background: "transparent", color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Ahora no
          </button>
          <button
            onClick={onConfirmar}
            style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
          >
            Activar
          </button>
        </div>
      </div>
    </div>
  );
}

// ================================================================
// FILA CON ACCIONES (renombrar / eliminar) — usada por Colegios y Cursos.
// ================================================================
const chipBase = {
  fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600,
  padding: "5px 10px", borderRadius: 999, cursor: "pointer", flexShrink: 0, whiteSpace: "nowrap",
};

function FilaEntidad({ Icono, titulo, subtitulo, onAbrir, onRenombrar, onEliminar, advertencia }) {
  const [modo, setModo] = useState("normal");
  const [valor, setValor] = useState(titulo);

  useEffect(() => { setValor(titulo); }, [titulo]);

  const rowStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    background: COLORS.white, border: `1px solid ${COLORS.line}`, borderRadius: 14,
    padding: "12px 14px", marginBottom: 8, minHeight: 20, boxShadow: "0 1px 3px rgba(21,53,49,0.06)",
  };

  if (modo === "editando") {
    return (
      <div style={rowStyle}>
        <input
          value={valor} onChange={(e) => setValor(e.target.value)} autoFocus
          onKeyDown={(e) => { if (e.key === "Enter" && valor.trim()) { onRenombrar(valor.trim()); setModo("normal"); } }}
          style={{ flex: 1, minWidth: 0, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "6px 8px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14 }}
        />
        <span
          onClick={() => { if (valor.trim()) { onRenombrar(valor.trim()); setModo("normal"); } }}
          style={{ ...chipBase, color: COLORS.white, background: COLORS.pine }}
        >Guardar</span>
        <span
          onClick={() => { setValor(titulo); setModo("normal"); }}
          style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim }}
        >Cancelar</span>
      </div>
    );
  }

  if (modo === "confirmarBorrar") {
    return (
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ink }}>
          {advertencia || `¿Eliminar "${titulo}"?`}
        </div>
        <span onClick={onEliminar} style={{ ...chipBase, color: COLORS.white, background: COLORS.rose }}>Sí, eliminar</span>
        <span onClick={() => setModo("normal")} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim }}>Cancelar</span>
      </div>
    );
  }

  return (
    <div style={rowStyle}>
      <div onClick={onAbrir} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1, cursor: "pointer" }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: COLORS.pine, color: COLORS.white, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icono size={16} strokeWidth={2.2} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 17, fontWeight: 600, color: COLORS.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {titulo}
          </div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.inkSoft }}>{subtitulo}</div>
        </div>
      </div>

      {modo === "menu" ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <span onClick={() => setModo("editando")} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine }}>Editar</span>
          <span onClick={() => setModo("confirmarBorrar")} style={{ ...chipBase, color: COLORS.white, background: COLORS.rose }}>Eliminar</span>
          <span onClick={() => setModo("normal")} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim, padding: "5px 8px" }}>×</span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span
            onClick={() => setModo("menu")}
            style={{ padding: "4px 8px", fontSize: 16, color: COLORS.inkSoft, cursor: "pointer", lineHeight: 1 }}
            aria-label="Más opciones"
          >⋮</span>
          <span onClick={onAbrir} style={{ cursor: "pointer", display: "flex" }}>
            <ChevronRight size={16} color={COLORS.inkSoft} strokeWidth={2.2} />
          </span>
        </div>
      )}
    </div>
  );
}


// ================================================================
// FORMULARIO Y FILA ESPECÍFICOS DE CURSO (nombre + materia, obligatoria)
// ================================================================
function FormularioCurso({ onConfirmar, textoBoton }) {
  const [nombre, setNombre] = useState("");
  const [materia, setMateria] = useState("");
  function confirmar() {
    if (!nombre.trim() || !materia.trim()) return;
    onConfirmar(nombre.trim(), materia.trim());
    setNombre("");
    setMateria("");
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
      <input
        value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre del curso (ej: 5° Año A - Turno Mañana)"
        onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
        autoFocus
        style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "8px 10px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14 }}
      />
      <input
        value={materia} onChange={(e) => setMateria(e.target.value)} placeholder="Materia que dictás en este curso (ej: Matemática)"
        onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
        style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "8px 10px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14 }}
      />
      <button
        onClick={confirmar}
        disabled={!nombre.trim() || !materia.trim()}
        style={{ alignSelf: "flex-start", padding: "8px 14px", borderRadius: 10, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 500, cursor: nombre.trim() && materia.trim() ? "pointer" : "default", opacity: nombre.trim() && materia.trim() ? 1 : 0.5 }}
      >
        {textoBoton || "Crear"}
      </button>
    </div>
  );
}

function FilaCurso({ Icono, titulo, materia, subtitulo, onAbrir, onRenombrar, onEliminar, advertencia }) {
  const [modo, setModo] = useState("normal");
  const [valorNombre, setValorNombre] = useState(titulo);
  const [valorMateria, setValorMateria] = useState(materia || "");

  useEffect(() => { setValorNombre(titulo); setValorMateria(materia || ""); }, [titulo, materia]);

  const rowStyle = {
    display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8,
    background: COLORS.white, border: `1px solid ${COLORS.line}`, borderRadius: 14,
    padding: "12px 14px", marginBottom: 8, minHeight: 20, boxShadow: "0 1px 3px rgba(21,53,49,0.06)",
  };

  function guardar() {
    if (!valorNombre.trim() || !valorMateria.trim()) return;
    onRenombrar(valorNombre.trim(), valorMateria.trim());
    setModo("normal");
  }

  if (modo === "editando") {
    return (
      <div style={{ ...rowStyle, flexDirection: "column", alignItems: "stretch", gap: 6 }}>
        <input
          value={valorNombre} onChange={(e) => setValorNombre(e.target.value)} autoFocus
          placeholder="Nombre del curso"
          onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
          style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "6px 8px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14 }}
        />
        <input
          value={valorMateria} onChange={(e) => setValorMateria(e.target.value)}
          placeholder="Materia"
          onKeyDown={(e) => { if (e.key === "Enter") guardar(); }}
          style={{ border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "6px 8px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14 }}
        />
        <div style={{ display: "flex", gap: 6 }}>
          <span onClick={guardar} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine }}>Guardar</span>
          <span onClick={() => { setValorNombre(titulo); setValorMateria(materia || ""); setModo("normal"); }} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim }}>Cancelar</span>
        </div>
      </div>
    );
  }

  if (modo === "confirmarBorrar") {
    return (
      <div style={rowStyle}>
        <div style={{ flex: 1, minWidth: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ink }}>
          {advertencia || `¿Eliminar "${titulo}"?`}
        </div>
        <span onClick={onEliminar} style={{ ...chipBase, color: COLORS.white, background: COLORS.rose }}>Sí, eliminar</span>
        <span onClick={() => setModo("normal")} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim }}>Cancelar</span>
      </div>
    );
  }

  return (
    <div style={rowStyle}>
      <div onClick={onAbrir} style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, flex: 1, cursor: "pointer" }}>
        <div style={{ width: 32, height: 32, borderRadius: 10, background: COLORS.pine, color: COLORS.white, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
          <Icono size={16} strokeWidth={2.2} />
        </div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 17, fontWeight: 600, color: COLORS.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {titulo}
          </div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.inkSoft }}>{subtitulo}</div>
        </div>
      </div>

      {modo === "menu" ? (
        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
          <span onClick={() => setModo("editando")} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine }}>Editar</span>
          <span onClick={() => setModo("confirmarBorrar")} style={{ ...chipBase, color: COLORS.white, background: COLORS.rose }}>Eliminar</span>
          <span onClick={() => setModo("normal")} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim, padding: "5px 8px" }}>×</span>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
          <span onClick={() => setModo("menu")} style={{ padding: "4px 8px", fontSize: 16, color: COLORS.inkSoft, cursor: "pointer", lineHeight: 1 }} aria-label="Más opciones">⋮</span>
          <span onClick={onAbrir} style={{ cursor: "pointer", display: "flex" }}>
            <ChevronRight size={16} color={COLORS.inkSoft} strokeWidth={2.2} />
          </span>
        </div>
      )}
    </div>
  );
}


function PantallaColegios({ colegios, cursosPorColegio, onAbrir, onAgregar, onRenombrar, onEliminar, tourVisto, onMarcarTourVisto, onAyudaRef }) {
  const [agregando, setAgregando] = useState(colegios.length === 0);
  const [tourActivo, setTourActivo] = useState(!tourVisto);
  const refAgregar = useRef(null);

  useEffect(() => { if (onAyudaRef) onAyudaRef.current = () => setTourActivo(true); }, [onAyudaRef]);

  const pasos = [
    { titulo: "Bienvenido a CISD (Cuaderno Integral de Seguimiento Docente)", texto: "Aquí organizás todo en tres niveles: Colegios → Cursos → Alumnos. Empezá cargando los colegios donde trabajás." },
    { titulo: "Agregar un colegio", texto: "Escribí el nombre de tu colegio o institución y presioná Enter (o tocá \"Agregar colegio\"). Después vas a poder sumar los cursos que dictás ahí.", ref: refAgregar },
  ];

  const texto = colegios.length === 0
    ? "Empecemos por lo básico: cargá el nombre de tu colegio o institución. Después vas a poder sumar los cursos que dictás ahí."
    : "Tocá un colegio para ver sus cursos, o sumá uno nuevo con el botón de abajo. Tocá el ⋮ para editarlo o eliminarlo.";

  return (
    <div style={{ padding: "14px 16px 24px 16px" }}>
      <CuadroGuia texto={texto} />

      {colegios.map((col) => {
        const cantidad = (cursosPorColegio[col.id] || []).length;
        return (
          <FilaEntidad
            key={col.id}
            Icono={School}
            titulo={col.nombre}
            subtitulo={cantidad === 0 ? "Sin cursos todavía" : `${cantidad} curso${cantidad === 1 ? "" : "s"}`}
            onAbrir={() => onAbrir(col)}
            onRenombrar={(nombre) => onRenombrar(col.id, nombre)}
            onEliminar={() => onEliminar(col.id)}
            advertencia={cantidad === 0 ? `¿Eliminar "${col.nombre}"?` : `¿Eliminar "${col.nombre}" y sus ${cantidad} curso${cantidad === 1 ? "" : "s"} (con sus alumnos)?`}
          />
        );
      })}

      {agregando ? (
        <FormularioInline
          placeholder="Ej: Escuela Técnica N°4"
          textoBoton="Crear colegio"
          onConfirmar={(nombre) => { onAgregar(nombre); setAgregando(colegios.length === 0); }}
        />
      ) : (
        <button
          ref={refAgregar}
          onClick={() => setAgregando(true)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
            padding: "11px 12px", borderRadius: 14, border: `1.5px dashed ${COLORS.ochre}`, background: "transparent",
            color: COLORS.ochre, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 4,
          }}
        >
          <Plus size={14} strokeWidth={2.6} /> Agregar colegio
        </button>
      )}

      {tourActivo && (
        <TourGuiado pasos={pasos} onCerrar={() => { setTourActivo(false); onMarcarTourVisto(); }} />
      )}
    </div>
  );
}

// ================================================================
// PANTALLA 2: CURSOS (de un colegio)
// ================================================================
function PantallaCursos({ colegio, cursos, alumnosPorCurso, onAbrir, onAgregar, onVolver, onRenombrar, onEliminar, tourVisto, onMarcarTourVisto }) {
  const [agregando, setAgregando] = useState(cursos.length === 0);
  const [tourActivo, setTourActivo] = useState(!tourVisto);
  const refAgregar = useRef(null);

  const pasos = [
    { titulo: "Los cursos de este colegio", texto: `Aquí cargás los cursos que dictás en ${colegio.nombre}. Cada curso tiene su materia, y sus propios alumnos, criterios y planillas.` },
    { titulo: "Agregar un curso", texto: "Escribí el nombre (ej. \"3° Año A\") y la materia que dictás ahí, y tocá \"Crear curso\".", ref: refAgregar },
  ];

  const texto = cursos.length === 0
    ? `${colegio.nombre} todavía no tiene cursos. Agregá el primero, con su materia (ej. "3° Año B - Turno Mañana", materia "Matemática").`
    : "Tocá un curso para cargar y ver a tus alumnos, o sumá uno nuevo. Tocá el ⋮ para editarlo o eliminarlo.";

  return (
    <div>
      <EncabezadoNav eyebrow="Mis colegios" titulo={colegio.nombre} onAyuda={() => setTourActivo(true)} />
      <div style={{ padding: "14px 16px 90px 16px" }}>
        <CuadroGuia texto={texto} />

        {cursos.map((curso) => {
          const cantidad = (alumnosPorCurso[curso.id] || []).length;
          const subt = cantidad === 0 ? "Sin alumnos cargados" : `${cantidad} alumno${cantidad === 1 ? "" : "s"}`;
          return (
            <FilaCurso
              key={curso.id}
              Icono={ClipboardList}
              titulo={curso.nombre}
              materia={curso.materia}
              subtitulo={curso.materia ? `${curso.materia} · ${subt}` : subt}
              onAbrir={() => onAbrir(curso)}
              onRenombrar={(nombre, materia) => onRenombrar(curso.id, nombre, materia)}
              onEliminar={() => onEliminar(curso.id)}
              advertencia={cantidad === 0 ? `¿Eliminar "${curso.nombre}"?` : `¿Eliminar "${curso.nombre}" y sus ${cantidad} alumno${cantidad === 1 ? "" : "s"}?`}
            />
          );
        })}

        {agregando ? (
          <FormularioCurso
            textoBoton="Crear curso"
            onConfirmar={(nombre, materia) => { onAgregar(colegio.id, nombre, materia); setAgregando(cursos.length === 0); }}
          />
        ) : (
          <button
            ref={refAgregar}
            onClick={() => setAgregando(true)}
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
              padding: "11px 12px", borderRadius: 14, border: `1.5px dashed ${COLORS.ochre}`, background: "transparent",
              color: COLORS.ochre, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer", marginTop: 4,
            }}
          >
            <Plus size={14} strokeWidth={2.6} /> Agregar curso
          </button>
        )}
      </div>

      {tourActivo && (
        <TourGuiado pasos={pasos} onCerrar={() => { setTourActivo(false); onMarcarTourVisto(); }} />
      )}

      <BotonVolverFlotante onVolver={onVolver} />
    </div>
  );
}

// ================================================================
// MÓDULO DE CRITERIOS DE SEGUIMIENTO
// ================================================================
const TIPOS_CRITERIO = [
  ["numerico", "Cuantitativa (número)"],
  ["opcion", "Cualitativa (opciones)"],
  ["texto", "Bloque de texto"],
];

function CamposCriterio({ nombre, setNombre, tipo, setTipo, opcionesTexto, setOpcionesTexto, maxNum, setMaxNum }) {
  return (
    <>
      <input
        value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre (ej: Trabajo en equipo)" autoFocus
        style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "7px 9px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13 }}
      />
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.inkSoft, margin: "8px 0 5px 0" }}>¿Cómo se califica?</div>
      <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
        {TIPOS_CRITERIO.map(([val, label]) => (
          <button key={val} onClick={() => setTipo(val)}
            style={{ padding: "6px 10px", borderRadius: 999, border: `1.5px solid ${tipo === val ? COLORS.pine : COLORS.line}`, background: tipo === val ? COLORS.pine : COLORS.white, color: tipo === val ? COLORS.white : COLORS.ink, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}
          >{label}</button>
        ))}
      </div>
      {tipo === "opcion" && (
        <input value={opcionesTexto} onChange={(e) => setOpcionesTexto(e.target.value)} placeholder="Opciones separadas por coma: Malo, Regular, Bueno…"
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "7px 9px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, marginTop: 8 }}
        />
      )}
      {(tipo === "numerico" || tipo === "numerico_instancias") && (
        <input value={maxNum} onChange={(e) => setMaxNum(e.target.value)} placeholder="Nota máxima (ej: 10)"
          style={{ width: 100, boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "7px 9px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, marginTop: 8 }}
        />
      )}
    </>
  );
}

function armarCampoDesdeForm(base, nombre, tipo, opcionesTexto, maxNum) {
  const campo = { ...base, nombre: nombre.trim(), tipo };
  delete campo.opciones;
  delete campo.max;
  if (tipo === "opcion") {
    campo.opciones = opcionesTexto.split(",").map((s) => s.trim()).filter(Boolean);
  }
  if (tipo === "numerico" || tipo === "numerico_instancias") {
    const m = Number(maxNum);
    campo.max = Number.isFinite(m) && m > 0 ? m : 10;
  }
  return campo;
}

function AgregarCriterioForm({ onCrear, onCancelar }) {
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState(null);
  const [opcionesTexto, setOpcionesTexto] = useState("");
  const [maxNum, setMaxNum] = useState("10");

  function crear() {
    if (!nombre.trim() || !tipo) return;
    if (tipo === "opcion" && opcionesTexto.split(",").map((s) => s.trim()).filter(Boolean).length < 2) return;
    onCrear(armarCampoDesdeForm({ id: nuevoId("crit"), activadoEnCursos: [], porDefecto: false }, nombre, tipo, opcionesTexto, maxNum));
  }

  return (
    <div style={{ border: `1.5px solid ${COLORS.ochreSoft}`, borderRadius: 14, padding: 10, background: COLORS.white, marginTop: 6 }}>
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 700, color: COLORS.pine, marginBottom: 6 }}>
        Nuevo criterio
      </div>
      <CamposCriterio nombre={nombre} setNombre={setNombre} tipo={tipo} setTipo={setTipo} opcionesTexto={opcionesTexto} setOpcionesTexto={setOpcionesTexto} maxNum={maxNum} setMaxNum={setMaxNum} />
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button onClick={crear} style={{ padding: "7px 14px", borderRadius: 999, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>Crear</button>
        <button onClick={onCancelar} style={{ padding: "7px 14px", borderRadius: 999, border: `1px solid ${COLORS.line}`, background: COLORS.white, color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>Cancelar</button>
      </div>
    </div>
  );
}

function EditarCriterioForm({ criterio, onGuardar, onCancelar }) {
  const [nombre, setNombre] = useState(criterio.nombre);
  const [tipo, setTipo] = useState(criterio.tipo === "numerico_instancias" ? "numerico_instancias" : criterio.tipo);
  const [opcionesTexto, setOpcionesTexto] = useState((criterio.opciones || []).join(", "));
  const [maxNum, setMaxNum] = useState(String(criterio.max || 10));

  function guardar() {
    if (!nombre.trim()) return;
    if (criterio.tipo === "asistencia") { onGuardar({ ...criterio, nombre: nombre.trim() }); return; }
    if (!tipo) return;
    if (tipo === "opcion" && opcionesTexto.split(",").map((s) => s.trim()).filter(Boolean).length < 2) return;
    onGuardar(armarCampoDesdeForm(criterio, nombre, tipo, opcionesTexto, maxNum));
  }

  const tiposDisponibles = criterio.tipo === "numerico_instancias"
    ? [["numerico_instancias", "Numérica · instancias + recuperatorio"], ...TIPOS_CRITERIO]
    : TIPOS_CRITERIO;

  return (
    <div style={{ border: `1.5px solid ${COLORS.ochreSoft}`, borderRadius: 14, padding: 10, background: COLORS.white }}>
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 700, color: COLORS.pine, marginBottom: 6 }}>
        Editar criterio
      </div>
      <input
        value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Nombre" autoFocus
        style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "7px 9px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13 }}
      />
      {criterio.tipo === "asistencia" ? (
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, color: COLORS.inkSoft, marginTop: 8, fontStyle: "italic" }}>
          Este criterio se calcula solo desde el botón "Asistencia" del curso; no tiene tipo de calificación para elegir.
        </div>
      ) : (
        <>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.inkSoft, margin: "8px 0 5px 0" }}>¿Cómo se califica?</div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap" }}>
            {tiposDisponibles.map(([val, label]) => (
              <button key={val} onClick={() => setTipo(val)}
                style={{ padding: "6px 10px", borderRadius: 999, border: `1.5px solid ${tipo === val ? COLORS.pine : COLORS.line}`, background: tipo === val ? COLORS.pine : COLORS.white, color: tipo === val ? COLORS.white : COLORS.ink, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}
              >{label}</button>
            ))}
          </div>
          {tipo === "opcion" && (
            <input value={opcionesTexto} onChange={(e) => setOpcionesTexto(e.target.value)} placeholder="Opciones separadas por coma"
              style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "7px 9px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, marginTop: 8 }}
            />
          )}
          {(tipo === "numerico" || tipo === "numerico_instancias") && (
            <input value={maxNum} onChange={(e) => setMaxNum(e.target.value)} placeholder="Nota máxima (ej: 10)"
              style={{ width: 100, boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "7px 9px", fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, marginTop: 8 }}
            />
          )}
        </>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
        <button onClick={guardar} style={{ padding: "7px 14px", borderRadius: 999, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>Guardar</button>
        <button onClick={onCancelar} style={{ padding: "7px 14px", borderRadius: 999, border: `1px solid ${COLORS.line}`, background: COLORS.white, color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 500, cursor: "pointer" }}>Cancelar</button>
      </div>
    </div>
  );
}

function FilaCriterio({ criterio, activo, onUsar, onUsarEnTodos, onQuitar, onEditar, onEliminarDefinitivo }) {
  const [modo, setModo] = useState("normal");

  const rowStyle = {
    background: activo ? COLORS.white : COLORS.paperDim, border: `1px solid ${COLORS.line}`,
    borderRadius: 12, padding: "9px 11px", marginBottom: 6,
  };

  if (modo === "editando") {
    return (
      <div style={{ marginBottom: 6 }}>
        <EditarCriterioForm criterio={criterio} onGuardar={(campo) => { onEditar(campo); setModo("normal"); }} onCancelar={() => setModo("normal")} />
      </div>
    );
  }

  if (modo === "confirmarEliminar") {
    return (
      <div style={{ ...rowStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.ink }}>
          ¿Eliminar "{criterio.nombre}" de TODOS tus cursos? No se puede deshacer.
        </div>
        <span onClick={onEliminarDefinitivo} style={{ ...chipBase, color: COLORS.white, background: COLORS.rose }}>Sí, eliminar</span>
        <span onClick={() => setModo("normal")} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim }}>Cancelar</span>
      </div>
    );
  }

  return (
    <div style={{ ...rowStyle, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, opacity: activo ? 1 : 0.9 }}>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 500, color: COLORS.ink }}>{criterio.nombre}</div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10.5, color: COLORS.inkSoft }}>{etiquetaTipoCriterio(criterio)}</div>
      </div>
      {modo === "menu" ? (
        <div style={{ display: "flex", gap: 5, flexShrink: 0, flexWrap: "wrap", justifyContent: "flex-end" }}>
          <span onClick={() => setModo("editando")} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine }}>Editar</span>
          {activo ? (
            <span onClick={() => { onQuitar(); setModo("normal"); }} style={{ ...chipBase, color: COLORS.pineDark, background: COLORS.ochreSoft }}>Quitar de este curso</span>
          ) : (
            <>
              <span onClick={() => { onUsar(); setModo("normal"); }} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine }}>Usar</span>
              <span onClick={() => { onUsarEnTodos(); setModo("normal"); }} style={{ ...chipBase, color: COLORS.pineDark, background: COLORS.ochreSoft }}>Usar en todos mis cursos</span>
            </>
          )}
          <span onClick={() => setModo("confirmarEliminar")} style={{ ...chipBase, color: COLORS.white, background: COLORS.rose }}>Eliminar definitivamente</span>
          <span onClick={() => setModo("normal")} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim, padding: "5px 8px" }}>×</span>
        </div>
      ) : activo ? (
        <span onClick={() => setModo("menu")} style={{ padding: "4px 8px", fontSize: 16, color: COLORS.inkSoft, cursor: "pointer", lineHeight: 1 }} aria-label="Más opciones">⋮</span>
      ) : (
        <div style={{ display: "flex", gap: 5, flexShrink: 0 }}>
          <span onClick={onUsar} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine }}>Usar</span>
          <span onClick={() => setModo("menu")} style={{ padding: "4px 6px", fontSize: 16, color: COLORS.inkSoft, cursor: "pointer", lineHeight: 1 }} aria-label="Más opciones">⋮</span>
        </div>
      )}
    </div>
  );
}

// Cartel de confirmación de alcance al reordenar bloques (ítem 1).
function BannerConfirmarOrden({ onSi, onNo }) {
  return (
    <ModalConfirmacion
      titulo="Cambiaste el orden"
      texto="¿Deseas aplicar este nuevo orden a todos los cursos o únicamente a este curso?"
      botones={
        <>
          <button onClick={onNo} style={{ padding: "9px 14px", borderRadius: 999, border: `1px solid ${COLORS.line}`, background: COLORS.white, color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Solo este curso</button>
          <button onClick={onSi} style={{ padding: "9px 14px", borderRadius: 999, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Todos los cursos</button>
        </>
      }
    />
  );
}

// Igual que BannerConfirmarOrden, pero para elegir el alcance de un
// encabezado de columna renombrado: solo el colegio actual, o todos.
function BannerConfirmarColegios({ onSi, onNo }) {
  return (
    <ModalConfirmacion
      titulo="Renombraste una columna"
      texto="¿Aplicás este nombre a todos tus colegios o únicamente a este colegio?"
      botones={
        <>
          <button onClick={onNo} style={{ padding: "9px 14px", borderRadius: 999, border: `1px solid ${COLORS.line}`, background: COLORS.white, color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Solo este colegio</button>
          <button onClick={onSi} style={{ padding: "9px 14px", borderRadius: 999, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Todos los colegios</button>
        </>
      }
    />
  );
}

// Modal para escribir el nuevo nombre de un encabezado de columna
// (ej: cambiar "1° inf" por "1° bim"). Se abre manteniendo presionado
// el encabezado en la Planilla del curso.
function ModalRenombrarColumna({ etiquetaActual, onGuardar, onCancelar }) {
  const [valor, setValor] = useState(etiquetaActual);
  return (
    <ModalConfirmacion
      titulo="Renombrar columna"
      texto="Este nombre reemplaza al de fábrica en toda la planilla oficial."
      botones={
        <>
          <button onClick={onCancelar} style={{ padding: "9px 14px", borderRadius: 999, border: `1px solid ${COLORS.line}`, background: COLORS.white, color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
          <button onClick={() => onGuardar(valor)} style={{ padding: "9px 14px", borderRadius: 999, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Guardar</button>
        </>
      }
    >
      <input
        autoFocus
        value={valor}
        onChange={(e) => setValor(e.target.value)}
        maxLength={12}
        style={{ width: "100%", boxSizing: "border-box", padding: "9px 10px", borderRadius: 8, border: `1px solid ${COLORS.line}`, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, color: COLORS.ink }}
      />
    </ModalConfirmacion>
  );
}

// Encabezado de columna de la planilla oficial: mantener presionado un
// instante abre el modal para renombrarlo.
function EncabezadoColumnaEditable({ columna, refAdicional, onAbrirRenombrar }) {
  const timerRef = useRef(null);
  function empezar() { timerRef.current = setTimeout(() => onAbrirRenombrar(columna), 480); }
  function cancelar() { clearTimeout(timerRef.current); }
  return (
    <div
      ref={refAdicional || null}
      onTouchStart={empezar} onTouchEnd={cancelar} onMouseDown={empezar} onMouseUp={cancelar} onMouseLeave={cancelar}
      style={{
        background: ESTILO_TIPO_NOTA[columna.tipo].header, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif",
        fontSize: 9.5, fontWeight: 600, textAlign: "center", padding: "6px 1px", lineHeight: 1.15,
        display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", userSelect: "none",
      }}
    >
      {columna.label}
    </div>
  );
}

// ================================================================
// LISTA ORDENABLE — mantener presionado un ítem un instante y
// arrastrarlo hacia arriba/abajo desplaza al resto hasta soltarlo en
// el lugar deseado. Sin librerías externas: pointer events + medición
// de posiciones. onReordenar solo se dispara si el orden cambió.
// ================================================================
function ListaOrdenable({ ids, renderItem, onReordenar }) {
  const [orden, setOrden] = useState(ids);
  const [arrastrandoId, setArrastrandoId] = useState(null);
  const [offsetY, setOffsetY] = useState(0);
  const refs = useRef({});
  const holdTimer = useRef(null);
  const startY = useRef(0);
  const ordenAlEmpezar = useRef(ids);
  const ordenRef = useRef(ids);
  const arrastrandoRef = useRef(null);

  useEffect(() => { ordenRef.current = orden; }, [orden]);
  useEffect(() => { if (!arrastrandoId) setOrden(ids); }, [ids, arrastrandoId]);
  useEffect(() => { arrastrandoRef.current = arrastrandoId; }, [arrastrandoId]);

  function moverSiCorresponde(clientY, id) {
    const delta = clientY - startY.current;
    setOffsetY(delta);
    const ordenActual = ordenRef.current;
    const idx = ordenActual.indexOf(id);
    const elDrag = refs.current[id];
    if (!elDrag) return;
    const rectDrag = elDrag.getBoundingClientRect();
    const centro = rectDrag.top + rectDrag.height / 2 + delta;

    if (idx > 0) {
      const arribaId = ordenActual[idx - 1];
      const arribaEl = refs.current[arribaId];
      if (arribaEl) {
        const r = arribaEl.getBoundingClientRect();
        if (centro < r.top + r.height / 2) {
          const nuevo = [...ordenActual];
          nuevo[idx - 1] = id; nuevo[idx] = arribaId;
          setOrden(nuevo);
          startY.current = clientY;
          setOffsetY(0);
          return;
        }
      }
    }
    if (idx < ordenActual.length - 1) {
      const abajoId = ordenActual[idx + 1];
      const abajoEl = refs.current[abajoId];
      if (abajoEl) {
        const r = abajoEl.getBoundingClientRect();
        if (centro > r.top + r.height / 2) {
          const nuevo = [...ordenActual];
          nuevo[idx + 1] = id; nuevo[idx] = abajoId;
          setOrden(nuevo);
          startY.current = clientY;
          setOffsetY(0);
        }
      }
    }
  }

  function soltar() {
    const id = arrastrandoRef.current;
    if (!id) return;
    setArrastrandoId(null);
    setOffsetY(0);
    if (JSON.stringify(ordenRef.current) !== JSON.stringify(ordenAlEmpezar.current)) {
      onReordenar(ordenRef.current);
    }
  }

  // Mientras se arrastra, escuchamos a nivel ventana: así el gesto no se
  // pierde si el puntero se mueve rápido y sale del área del bloque.
  useEffect(() => {
    if (!arrastrandoId) return;
    const id = arrastrandoId;
    function onWinMove(e) {
      const y = e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
      moverSiCorresponde(y, id);
    }
    function onWinUp() { soltar(); }
    window.addEventListener("pointermove", onWinMove, { passive: true });
    window.addEventListener("touchmove", onWinMove, { passive: true });
    window.addEventListener("pointerup", onWinUp);
    window.addEventListener("pointercancel", onWinUp);
    window.addEventListener("touchend", onWinUp);
    window.addEventListener("touchcancel", onWinUp);
    return () => {
      window.removeEventListener("pointermove", onWinMove);
      window.removeEventListener("touchmove", onWinMove);
      window.removeEventListener("pointerup", onWinUp);
      window.removeEventListener("pointercancel", onWinUp);
      window.removeEventListener("touchend", onWinUp);
      window.removeEventListener("touchcancel", onWinUp);
    };
  }, [arrastrandoId]);

  function onDown(e, id) {
    startY.current = e.clientY;
    holdTimer.current = setTimeout(() => {
      ordenAlEmpezar.current = ordenRef.current;
      setArrastrandoId(id);
    }, 420);
  }
  function onMoveInicial(e, id) {
    if (arrastrandoId === id) return;
    if (Math.abs(e.clientY - startY.current) > 10) clearTimeout(holdTimer.current);
  }
  function onUpInicial() {
    clearTimeout(holdTimer.current);
  }

  return (
    <div>
      {orden.map((id) => (
        <div
          key={id}
          ref={(el) => { refs.current[id] = el; }}
          onPointerDown={(e) => onDown(e, id)}
          onPointerMove={(e) => onMoveInicial(e, id)}
          onPointerUp={onUpInicial}
          onPointerCancel={onUpInicial}
          onContextMenu={(e) => { if (arrastrandoId === id) e.preventDefault(); }}
          style={{
            touchAction: arrastrandoId === id ? "none" : "pan-y",
            transform: arrastrandoId === id ? `translateY(${offsetY}px) scale(1.015)` : "none",
            transition: arrastrandoId === id ? "none" : "transform 0.15s ease",
            position: "relative", zIndex: arrastrandoId === id ? 25 : 1,
            filter: arrastrandoId === id ? "drop-shadow(0 10px 18px rgba(0,0,0,0.2))" : "none",
            cursor: "grab", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none",
          }}
        >
          {renderItem(id, arrastrandoId === id)}
        </div>
      ))}
    </div>
  );
}


function BannerReplicar({ nombre, onSi, onNo }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#FBF3E4", border: `1px solid ${COLORS.ochreSoft}`, borderRadius: 12, padding: "9px 11px", marginBottom: 6 }}>
      <div style={{ flex: 1, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.ink }}>
        "{nombre}" se activó en este curso. ¿Lo usás también en el resto de tus cursos? (Vale para los demás criterios que sumes ahora, no te lo volvemos a preguntar en esta visita.)
      </div>
      <span onClick={onSi} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine }}>Sí, a todos</span>
      <span onClick={onNo} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim }}>Solo acá</span>
    </div>
  );
}

// Chip persistente para ver y editar la nota mínima de aprobación desde
// el Aula, cerca de Criterios: aplica por igual a todos los criterios
// numéricos, notas oficiales y recuperatorios de este curso.
function ChipNotaAprobacion({ notaAprobacion, onAbrir }) {
  return (
    <button
      onClick={onAbrir}
      style={{
        display: "flex", alignItems: "center", gap: 6, flexShrink: 0, cursor: "pointer",
        border: `1px solid ${COLORS.line}`, borderRadius: 10, background: COLORS.white, padding: "8px 10px",
        fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, color: COLORS.pine,
      }}
    >
      <SlidersHorizontal size={14} color={COLORS.pine} strokeWidth={2.2} />
      {notaAprobacion != null ? `Aprueba con ${notaAprobacion}` : "Definir nota mínima"}
    </button>
  );
}

function SeccionCriterios({ curso, criterios, ordenPorCurso, onReordenar, onAgregar, onUsar, onUsarEnTodos, onQuitar, onEditar, onEliminarDefinitivo, elementoJunto }) {
  const [abierto, setAbierto] = useState(false);
  const [agregando, setAgregando] = useState(false);
  const [pendienteReplicar, setPendienteReplicar] = useState(null);
  const [decisionReplicarSesion, setDecisionReplicarSesion] = useState(null); // null | "todos" | "solo"
  const [pendienteOrden, setPendienteOrden] = useState(null);

  const activos = ordenarCriteriosPorCurso(criterios.filter((c) => c.activadoEnCursos.includes(curso.id)), curso.id, ordenPorCurso);
  const disponibles = criterios.filter((c) => !c.activadoEnCursos.includes(curso.id));
  const mapaCriterios = new Map(criterios.map((c) => [c.id, c]));

  // Actriva un criterio en este curso. Si todavía no se decidió nada en esta
  // sesión (pantalla abierta), activa acá y pregunta. Si ya se decidió antes
  // (creando u activando otro criterio), aplica esa misma decisión sin
  // volver a preguntar.
  function intentarUsar(id, nombre) {
    if (decisionReplicarSesion === "todos") { onUsarEnTodos(id); return; }
    onUsar(id);
    if (decisionReplicarSesion === null) setPendienteReplicar({ id, nombre });
  }
  function intentarAgregar(campo) {
    onAgregar({ ...campo, activadoEnCursos: [curso.id] });
    if (decisionReplicarSesion === "todos") { onUsarEnTodos(campo.id); return; }
    if (decisionReplicarSesion === null) setPendienteReplicar({ id: campo.id, nombre: campo.nombre });
  }

  return (
    <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8, marginBottom: 10 }}>
      <div
        onClick={() => setAbierto((v) => !v)}
        style={{
          display: "flex", alignItems: "center", gap: 6, flexShrink: 0, cursor: "pointer",
          border: `1px solid ${COLORS.line}`, borderRadius: 10, background: COLORS.white, padding: "8px 10px",
        }}
      >
        <SlidersHorizontal size={14} color={COLORS.pine} strokeWidth={2.2} />
        <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, color: COLORS.pine, whiteSpace: "nowrap" }}>
          Criterios de Seguimiento ({activos.length})
        </span>
        <span style={{ color: COLORS.inkSoft, fontSize: 12 }}>{abierto ? "▲" : "▼"}</span>
      </div>

      {elementoJunto}

      {abierto && (
        <div style={{ flexBasis: "100%", border: `1px solid ${COLORS.line}`, borderRadius: 14, background: COLORS.white, padding: "10px 12px", boxShadow: "0 1px 3px rgba(21,53,49,0.06)" }}>
          {activos.length === 0 && (
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.inkSoft, fontStyle: "italic", marginBottom: 8 }}>
              Todavía no activaste ningún criterio acá. Elegí de la lista de abajo o creá uno nuevo.
            </div>
          )}

          {pendienteReplicar && (
            <BannerReplicar
              nombre={pendienteReplicar.nombre}
              onSi={() => { onUsarEnTodos(pendienteReplicar.id); setDecisionReplicarSesion("todos"); setPendienteReplicar(null); }}
              onNo={() => { setDecisionReplicarSesion("solo"); setPendienteReplicar(null); }}
            />
          )}

          {pendienteOrden && (
            <BannerConfirmarOrden
              onSi={() => { onReordenar(pendienteOrden, true); setPendienteOrden(null); }}
              onNo={() => { onReordenar(pendienteOrden, false); setPendienteOrden(null); }}
            />
          )}

          {activos.length > 0 && (
            <ListaOrdenable
              ids={activos.map((c) => c.id)}
              onReordenar={(nuevoOrden) => setPendienteOrden(nuevoOrden)}
              renderItem={(id) => {
                const c = mapaCriterios.get(id);
                return (
                  <FilaCriterio criterio={c} activo
                    onQuitar={() => onQuitar(c.id)}
                    onEditar={(campo) => onEditar(campo)}
                    onEliminarDefinitivo={() => onEliminarDefinitivo(c.id)}
                  />
                );
              }}
            />
          )}

          {disponibles.length > 0 && (
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, color: COLORS.inkSoft, margin: "8px 2px 6px 2px", fontStyle: "italic" }}>
              Disponibles (no usados en este curso todavía)
            </div>
          )}
          {disponibles.map((c) => (
            <FilaCriterio key={c.id} criterio={c} activo={false}
              onUsar={() => intentarUsar(c.id, c.nombre)}
              onUsarEnTodos={() => { onUsarEnTodos(c.id); setDecisionReplicarSesion("todos"); }}
              onEditar={(campo) => onEditar(campo)}
              onEliminarDefinitivo={() => onEliminarDefinitivo(c.id)}
            />
          ))}

          {agregando ? (
            <AgregarCriterioForm
              onCrear={(campo) => { intentarAgregar(campo); setAgregando(false); }}
              onCancelar={() => setAgregando(false)}
            />
          ) : (
            <button
              onClick={() => setAgregando(true)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%", padding: "9px 12px", borderRadius: 10, border: `1.5px dashed ${COLORS.ochre}`, background: "transparent", color: COLORS.ochre, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600, cursor: "pointer", marginTop: 4 }}
            >
              <Plus size={13} strokeWidth={2.6} /> Agregar criterio de seguimiento
            </button>
          )}
        </div>
      )}
    </div>
  );
}


// ================================================================
// CARGA ULTRA RÁPIDA DE ALUMNOS
// Un casillero en blanco. Escribís y Enter: guarda, numera y abre
// automáticamente el casillero del siguiente alumno. Si el docente no
// usa Enter, el botón "Agregar" clásico hace lo mismo. El botón
// flotante sirve para incorporaciones tardías, en cualquier momento.
// ================================================================
function ListaAlumnosRapida({ alumnos, onAgregar, onBorrar, onEditar, onAbrirFicha }) {
  const [draft, setDraft] = useState("");
  const [generoDraft, setGeneroDraft] = useState("F");
  const [popupGeneroAbierto, setPopupGeneroAbierto] = useState(false);
  const [menuAbierto, setMenuAbierto] = useState(null);
  // Edición del nombre de un alumno ya cargado, por si se tipeó mal.
  const [editandoId, setEditandoId] = useState(null);
  const [editDraft, setEditDraft] = useState("");
  const editInputRef = useRef(null);
  // El bloque de alta rápida (F/M + nombre + "Agregar") aparece solo, sin
  // pedirlo, cuando el curso todavía no tiene ningún alumno. Una vez que ya
  // hay al menos uno, ese bloque queda oculto y solo vuelve a mostrarse
  // cuando el docente lo pide desde el botón redondo flotante.
  const [formAbierto, setFormAbierto] = useState(false);
  const inputRef = useRef(null);

  const esPrimerAlumno = alumnos.length === 0;
  const mostrarForm = esPrimerAlumno || formAbierto;

  function intentarAgregar() {
    if (!draft.trim()) return;
    setPopupGeneroAbierto(true);
  }

  function confirmarConGenero(g) {
    const nombre = draft.trim();
    if (!nombre) return;
    onAgregar(nombre, g);
    setGeneroDraft(g);
    setDraft("");
    setPopupGeneroAbierto(false);
    if (esPrimerAlumno) {
      requestAnimationFrame(() => inputRef.current && inputRef.current.focus());
    } else {
      // Se agregó vía el botón redondo: cerramos el bloque hasta la próxima vez.
      setFormAbierto(false);
    }
  }

  function abrirForm() {
    setFormAbierto(true);
    requestAnimationFrame(() => {
      inputRef.current && inputRef.current.focus();
      inputRef.current && inputRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  function cerrarForm() {
    setDraft("");
    setPopupGeneroAbierto(false);
    setFormAbierto(false);
  }

  function abrirEdicion(al) {
    setEditandoId(al.id);
    setEditDraft(al.nombre);
    setMenuAbierto(null);
    requestAnimationFrame(() => editInputRef.current && editInputRef.current.focus());
  }

  function guardarEdicion() {
    const nombre = editDraft.trim();
    if (nombre) onEditar(editandoId, nombre);
    setEditandoId(null);
    setEditDraft("");
  }

  function cancelarEdicion() {
    setEditandoId(null);
    setEditDraft("");
  }

  return (
    <div style={{ position: "relative" }}>
      <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 14, background: COLORS.white, boxShadow: "0 1px 3px rgba(21,53,49,0.06)" }}>
        {alumnos.map((al, i) => (
          <div
            key={al.id}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              borderBottom: `1px solid ${COLORS.line}`,
            }}
          >
            {editandoId === al.id ? (
              <div style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0 }}>
                <span style={{ minWidth: 20, flexShrink: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: COLORS.inkSoft }}>
                  {i + 1}.
                </span>
                <input
                  ref={editInputRef}
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") guardarEdicion();
                    if (e.key === "Escape") cancelarEdicion();
                  }}
                  style={{ flex: 1, minWidth: 0, border: `1px solid ${COLORS.pine}`, borderRadius: 6, padding: "3px 6px", outline: "none", background: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15.5, fontWeight: 700, color: COLORS.ink }}
                />
              </div>
            ) : (
              <div
                onClick={() => onAbrirFicha(al)}
                style={{ display: "flex", alignItems: "center", gap: 8, flex: 1, minWidth: 0, cursor: "pointer" }}
              >
                <span style={{ minWidth: 20, flexShrink: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: COLORS.inkSoft }}>
                  {i + 1}.
                </span>
                <div
                  style={{
                    flex: 1, minWidth: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15.5, fontWeight: 700,
                    color: al.genero === "M" ? COLORS.nombreM : COLORS.nombreF,
                    whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}
                >
                  {al.nombre}
                </div>
              </div>
            )}

            {editandoId === al.id ? (
              <>
                <span
                  onClick={(e) => { e.stopPropagation(); guardarEdicion(); }}
                  style={{ ...chipBase, color: COLORS.white, background: COLORS.pine }}
                >
                  Guardar
                </span>
                <span
                  onClick={(e) => { e.stopPropagation(); cancelarEdicion(); }}
                  style={{ padding: "4px 6px", fontSize: 16, color: COLORS.inkSoft, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}
                  aria-label="Cancelar"
                >×</span>
              </>
            ) : menuAbierto === al.id ? (
              <>
                <span
                  onClick={(e) => { e.stopPropagation(); abrirEdicion(al); }}
                  style={{ ...chipBase, color: COLORS.pine, background: COLORS.white, border: `1.5px solid ${COLORS.pine}` }}
                >
                  Editar
                </span>
                <span
                  onClick={(e) => { e.stopPropagation(); onBorrar(al.id); setMenuAbierto(null); }}
                  style={{ ...chipBase, color: COLORS.white, background: COLORS.rose }}
                >
                  Confirmar borrado
                </span>
                <span
                  onClick={(e) => { e.stopPropagation(); setMenuAbierto(null); }}
                  style={{ padding: "4px 6px", fontSize: 16, color: COLORS.inkSoft, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}
                  aria-label="Cerrar menú"
                >×</span>
              </>
            ) : (
              <span
                onClick={(e) => { e.stopPropagation(); setMenuAbierto(al.id); }}
                style={{ padding: "4px 6px", fontSize: 16, color: COLORS.inkSoft, cursor: "pointer", lineHeight: 1, flexShrink: 0 }}
                aria-label="Más opciones"
              >⋮</span>
            )}
          </div>
        ))}

        {mostrarForm && (
          <div style={{ position: "relative", display: "flex", alignItems: "center", gap: 8, padding: "10px 12px" }}>
            <span style={{ minWidth: 20, textAlign: "left", flexShrink: 0, fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, color: COLORS.ochre }}>
              {alumnos.length + 1}.
            </span>
            <input
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") intentarAgregar(); }}
              placeholder="Apellido, Nombre"
              autoFocus
              style={{ flex: 1, minWidth: 0, border: "none", outline: "none", background: "transparent", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14.5, color: COLORS.ink }}
            />
            <button
              onClick={intentarAgregar}
              style={{ flexShrink: 0, padding: "6px 12px", borderRadius: 999, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600, cursor: "pointer" }}
            >
              Agregar
            </button>
            {!esPrimerAlumno && (
              <span
                onClick={cerrarForm}
                style={{ flexShrink: 0, padding: "4px 6px", fontSize: 16, color: COLORS.inkSoft, cursor: "pointer", lineHeight: 1 }}
                aria-label="Cerrar"
              >×</span>
            )}

            {popupGeneroAbierto && (
              <>
                <div onClick={() => setPopupGeneroAbierto(false)} style={{ position: "fixed", inset: 0, zIndex: 95 }} />
                <div
                  style={{
                    position: "absolute", bottom: "calc(100% + 8px)", left: 12, right: 12, background: COLORS.white,
                    borderRadius: 14, boxShadow: "0 10px 28px rgba(0,0,0,0.28)", padding: 14, zIndex: 96,
                  }}
                >
                  <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 10 }}>
                    ¿Mujer o varón? Al elegir, se guarda a <strong>{draft.trim()}</strong>.
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <span
                      onClick={() => confirmarConGenero("F")}
                      style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 10, cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, background: COLORS.avatarF, color: COLORS.white }}
                    >
                      Mujer
                    </span>
                    <span
                      onClick={() => confirmarConGenero("M")}
                      style={{ flex: 1, textAlign: "center", padding: "10px 6px", borderRadius: 10, cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, background: COLORS.avatarM, color: COLORS.white }}
                    >
                      Varón
                    </span>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {!esPrimerAlumno && (
        <button
          onClick={abrirForm}
          style={{
            position: "fixed", right: 20, bottom: 24, width: 52, height: 52, borderRadius: "50%",
            border: "none", background: COLORS.ochre, color: COLORS.white, display: "flex",
            alignItems: "center", justifyContent: "center", boxShadow: "0 8px 20px rgba(201,138,61,0.45)",
            cursor: "pointer", zIndex: 30,
          }}
          aria-label="Agregar alumno"
        >
          <UserPlus size={22} strokeWidth={2.2} />
        </button>
      )}
    </div>
  );
}

// ================================================================
// CARGA DE DATOS POR CRITERIO
// Cada alumno guarda sus registros en alumno.eventos:
// { id, criterioId, valor, periodo, fecha, instanciaId?, recuperatorio?: {valor} }
// ================================================================
function eventosDeCriterio(alumno, criterioId, periodo) {
  return (alumno.eventos || []).filter((e) => e.criterioId === criterioId && e.periodo === periodo);
}
function ultimoValorSimple(alumno, criterioId, periodo) {
  const evs = eventosDeCriterio(alumno, criterioId, periodo);
  return evs.length ? evs[evs.length - 1].valor : null;
}

// Texto de una nota ya cargada, con su recuperatorio (si tiene) fusionado
// en la misma línea: "Nota" o "Nota / R: NotaRecuperatorio", cada número
// coloreado según el umbral de aprobación.
function ValorEventoTexto({ ev, notaAprobacion }) {
  if (ev.valor === AUSENTE) {
    return <span style={{ color: COLORS.notaRoja, fontWeight: 700 }}>Aus</span>;
  }
  return (
    <>
      <span style={{ color: colorNota(ev.valor, notaAprobacion), fontWeight: 700 }}>{String(ev.valor)}</span>
      {ev.recuperatorio ? (
        <>
          {" / R: "}
          <span style={{ color: colorNota(ev.recuperatorio.valor, notaAprobacion), fontWeight: 700 }}>{String(ev.recuperatorio.valor)}</span>
        </>
      ) : null}
    </>
  );
}

function CampoOpciones({ opciones, valorActual, onGuardar }) {
  const [guardando, setGuardando] = useState(null);
  function tocar(op) {
    if (guardando) return;
    onGuardar(op);
    setGuardando(op);
    setTimeout(() => setGuardando(null), 300);
  }
  return (
    <div style={{ display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: 4, paddingBottom: 2 }}>
      {opciones.map((op) => {
        const mostrandoCheck = guardando === op;
        const activo = valorActual === op || mostrandoCheck;
        return (
          <button key={op} onClick={() => tocar(op)} disabled={!!guardando}
            style={{
              padding: "5px 8px", borderRadius: 999, border: `1.5px solid ${activo ? COLORS.pine : COLORS.line}`,
              background: activo ? COLORS.pine : COLORS.white, color: activo ? COLORS.white : COLORS.ink,
              fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 500,
              cursor: guardando ? "default" : "pointer", opacity: guardando && !mostrandoCheck ? 0.6 : 1,
              whiteSpace: "nowrap", flexShrink: 0, minWidth: mostrandoCheck ? 28 : undefined, textAlign: "center",
            }}
          >{mostrandoCheck ? <span className="tilde-anim">✓</span> : op}</button>
        );
      })}
    </div>
  );
}

function CampoNumerico({ max, valorActual, notaAprobacion, onGuardar }) {
  const nums = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0];
  const [buffer, setBuffer] = useState("");
  const [bloqueado, setBloqueado] = useState(false);

  function tap(n) {
    if (bloqueado) return;
    const next = buffer.length === 0 ? String(n) : buffer + String(n);
    if (Number(next.replace(",", ".")) > max) return;
    setBuffer(next);
  }
  function tocarComa() {
    if (bloqueado || buffer === "" || buffer.includes(",")) return;
    setBuffer(buffer + ",");
  }
  function confirmar() {
    if (buffer === "" || buffer.endsWith(",") || bloqueado) return;
    onGuardar(buffer);
    setBuffer("");
    setBloqueado(true);
    setTimeout(() => setBloqueado(false), 300);
  }
  // El alumno no estuvo presente para esta instancia: guarda el marcador
  // AUSENTE directamente, sin pasar por el buffer numérico.
  function marcarAusente() {
    if (bloqueado) return;
    onGuardar(AUSENTE);
    setBuffer("");
    setBloqueado(true);
    setTimeout(() => setBloqueado(false), 300);
  }

  const esAusenteActual = !buffer && valorActual === AUSENTE;
  const colorValor = buffer ? COLORS.pineDark : (esAusenteActual ? COLORS.notaRoja : colorNota(valorActual, notaAprobacion));

  return (
    <div>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color: colorValor, marginBottom: 8, minHeight: 28 }}>
        {buffer || (esAusenteActual ? "Aus" : (valorActual != null ? String(valorActual) : "—"))}
        <span style={{ fontSize: 14, color: COLORS.inkSoft, fontWeight: 500 }}> / {max}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 44px)", gap: 6 }}>
        {nums.map((n) => (
          <button key={n} onClick={() => tap(n)}
            style={{ width: 44, height: 40, borderRadius: 10, border: `1px solid ${COLORS.line}`, background: COLORS.white, fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 600, color: COLORS.ink, cursor: "pointer" }}
          >{n}</button>
        ))}
        <button onClick={tocarComa} disabled={bloqueado || buffer === "" || buffer.includes(",")}
          style={{ width: 44, height: 40, borderRadius: 10, border: `1px solid ${COLORS.line}`, background: COLORS.white, fontFamily: "'IBM Plex Mono', monospace", fontSize: 16, fontWeight: 600, color: buffer === "" || buffer.includes(",") ? COLORS.line : COLORS.ink, cursor: bloqueado ? "default" : "pointer" }}
        >,</button>
        <button onClick={confirmar} disabled={bloqueado}
          style={{ width: 44, height: 40, borderRadius: 10, border: "none", background: bloqueado ? COLORS.line : COLORS.ochre, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: bloqueado ? "default" : "pointer" }}
        >{bloqueado ? <span className="tilde-anim">✓</span> : "OK"}</button>
      </div>
      <button onClick={marcarAusente} disabled={bloqueado}
        style={{ marginTop: 6, width: 144, height: 36, borderRadius: 10, border: "none", background: bloqueado ? COLORS.line : COLORS.notaRoja, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, cursor: bloqueado ? "default" : "pointer" }}
      >Ausente</button>
    </div>
  );
}

function CampoTexto({ onGuardar, placeholder }) {
  const [texto, setTexto] = useState("");
  const [bloqueado, setBloqueado] = useState(false);
  function guardar() {
    if (!texto.trim() || bloqueado) return;
    onGuardar(texto.trim());
    setTexto("");
    setBloqueado(true);
    setTimeout(() => setBloqueado(false), 300);
  }
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
      <textarea
        value={texto} onChange={(e) => setTexto(e.target.value)} placeholder={placeholder || "Escribir…"} rows={1}
        style={{ flex: 1, minWidth: 0, boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "8px 10px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, color: COLORS.ink, resize: "vertical", background: COLORS.white }}
      />
      <button onClick={guardar} disabled={bloqueado}
        style={{ flexShrink: 0, minWidth: 64, padding: "9px 14px", borderRadius: 10, border: "none", background: bloqueado ? COLORS.line : COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 500, cursor: bloqueado ? "default" : "pointer", textAlign: "center" }}
      >{bloqueado ? <span className="tilde-anim">✓</span> : "Guardar"}</button>
    </div>
  );
}

function FilaHistorial({ ev, etiqueta, revelado, onLongPress, onBorrar, notaAprobacion, permiteRecuperatorio, onAgregarRecuperatorio, maxRecuperatorio }) {
  const timerRef = useRef(null);
  const [confirmando, setConfirmando] = useState(false);
  const [modoRecup, setModoRecup] = useState(false);
  useEffect(() => { if (!revelado) { setConfirmando(false); setModoRecup(false); } }, [revelado]);

  function empezar() { timerRef.current = setTimeout(() => onLongPress(ev.id), 480); }
  function cancelar() { clearTimeout(timerRef.current); }

  if (modoRecup) {
    return (
      <div style={{ padding: "8px 6px", background: "#FBF3E4", borderRadius: 8, marginBottom: 2 }}>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, color: COLORS.inkSoft, marginBottom: 6 }}>
          Recuperatorio de {etiqueta || "esta nota"}
        </div>
        <CampoNumerico
          max={maxRecuperatorio || 10} valorActual={ev.recuperatorio ? ev.recuperatorio.valor : null} notaAprobacion={notaAprobacion}
          onGuardar={(v) => { onAgregarRecuperatorio(ev.id, v); setModoRecup(false); }}
        />
        <span onClick={() => setModoRecup(false)} style={{ ...chipBase, marginTop: 6, color: COLORS.inkSoft, background: COLORS.paperDim }}>Cancelar</span>
      </div>
    );
  }

  return (
    <div
      onTouchStart={empezar} onTouchEnd={cancelar} onMouseDown={empezar} onMouseUp={cancelar} onMouseLeave={cancelar}
      style={{
        display: "flex", justifyContent: "space-between", alignItems: "baseline",
        fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ink,
        padding: "3px 4px", userSelect: "none", background: revelado ? "#FBEEEC" : "transparent", borderRadius: 8,
      }}
    >
      <span style={{ maxWidth: "62%" }}>
        {etiqueta ? <b>{etiqueta}: </b> : null}
        <ValorEventoTexto ev={ev} notaAprobacion={notaAprobacion} />
      </span>
      {revelado ? (
        confirmando ? (
          <span style={{ display: "flex", gap: 4 }}>
            <span onClick={(e) => { e.stopPropagation(); onBorrar(ev.id); }} style={{ ...chipBase, fontSize: 11, color: COLORS.white, background: COLORS.rose }}>Sí, borrar</span>
            <span onClick={(e) => { e.stopPropagation(); setConfirmando(false); }} style={{ ...chipBase, fontSize: 11, color: COLORS.inkSoft, background: COLORS.paperDim }}>Cancelar</span>
          </span>
        ) : (
          <span style={{ display: "flex", gap: 4 }}>
            {permiteRecuperatorio && (
              <span onClick={(e) => { e.stopPropagation(); setModoRecup(true); }} style={{ ...chipBase, fontSize: 11, color: COLORS.white, background: COLORS.pine }}>
                {ev.recuperatorio ? "Editar recup." : "Agregar Recuperatorio"}
              </span>
            )}
            <span onClick={(e) => { e.stopPropagation(); setConfirmando(true); }} style={{ ...chipBase, fontSize: 11, color: COLORS.white, background: COLORS.rose }}>Borrar</span>
          </span>
        )
      ) : (
        <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: COLORS.inkSoft }}>{fechaCorta(ev.fecha)}</span>
      )}
    </div>
  );
}

function MiniHistorial({ eventos, onBorrar, etiquetaPorEvento, notaAprobacion, permiteRecuperatorio, onAgregarRecuperatorio, maxRecuperatorio }) {
  const [revelado, setRevelado] = useState(null);
  if (!eventos || eventos.length === 0) return null;
  return (
    <div style={{ marginTop: 8 }}>
      {eventos.map((ev) => (
        <FilaHistorial key={ev.id} ev={ev} etiqueta={etiquetaPorEvento ? etiquetaPorEvento(ev) : null}
          revelado={revelado === ev.id} onLongPress={setRevelado}
          onBorrar={(id) => { onBorrar(id); setRevelado(null); }}
          notaAprobacion={notaAprobacion}
          permiteRecuperatorio={permiteRecuperatorio}
          onAgregarRecuperatorio={onAgregarRecuperatorio}
          maxRecuperatorio={maxRecuperatorio}
        />
      ))}
    </div>
  );
}

// Evaluación escrita: instancias con nombre propio. Cargar una nota
// nueva sobre una instancia ya calificada la reemplaza directamente
// (upsert); el recuperatorio se agrega aparte, tocando la nota ya
// registrada en el historial de abajo.
function CampoEvaluaciones({ alumno, criterio, periodo, instancias, notaAprobacion, onGuardar, onAgregarInstancia, onBorrar, onSetRecuperatorio }) {
  const [seleccion, setSeleccion] = useState(null);
  const [agregando, setAgregando] = useState(instancias.length === 0);
  const [nombreNuevo, setNombreNuevo] = useState("");

  const eventosEval = eventosDeCriterio(alumno, criterio.id, periodo);

  function valorPrevio(instanciaId) {
    const ev = eventosEval.find((e) => e.instanciaId === instanciaId);
    return ev ? ev.valor : null;
  }
  function confirmarNuevaInstancia() {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;
    const id = onAgregarInstancia(nombre);
    setSeleccion(id);
    setNombreNuevo("");
    setAgregando(false);
  }

  return (
    <div>
      {instancias.length > 0 && (
        <div style={{ display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: 4, paddingBottom: 2 }}>
          {instancias.map((inst) => {
            const activo = seleccion === inst.id;
            return (
              <button key={inst.id} onClick={() => setSeleccion(activo ? null : inst.id)}
                style={{ padding: "5px 8px", borderRadius: 999, border: `1.5px solid ${activo ? COLORS.pine : COLORS.line}`, background: activo ? COLORS.pine : COLORS.white, color: activo ? COLORS.white : COLORS.ink, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}
              >{inst.nombre}</button>
            );
          })}
          <button onClick={() => setAgregando((v) => !v)}
            style={{ padding: "5px 8px", borderRadius: 999, border: `1.5px dashed ${COLORS.ochre}`, background: COLORS.white, color: COLORS.ochre, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}
          >+ Nueva</button>
        </div>
      )}

      {instancias.length === 0 && !agregando && (
        <button onClick={() => setAgregando(true)}
          style={{ padding: "6px 12px", borderRadius: 999, border: `1.5px dashed ${COLORS.ochre}`, background: COLORS.white, color: COLORS.ochre, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
        >+ Nueva instancia de evaluación</button>
      )}

      {agregando && (
        <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
          <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} placeholder="Ej: 1ra evaluación, TP1, Recuperatorio…"
            onKeyDown={(e) => { if (e.key === "Enter") confirmarNuevaInstancia(); }}
            style={{ flex: 1, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "6px 8px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5 }}
          />
          <button onClick={confirmarNuevaInstancia}
            style={{ padding: "6px 12px", borderRadius: 999, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
          >Crear</button>
        </div>
      )}

      {seleccion && (
        <div style={{ marginTop: 10 }} key={seleccion}>
          <CampoNumerico max={criterio.max || 10} valorActual={valorPrevio(seleccion)} notaAprobacion={notaAprobacion} onGuardar={(v) => onGuardar(seleccion, v)} />
        </div>
      )}

      <MiniHistorial
        eventos={eventosEval} onBorrar={onBorrar}
        etiquetaPorEvento={(ev) => (instancias.find((i) => i.id === ev.instanciaId) || {}).nombre}
        notaAprobacion={notaAprobacion}
        permiteRecuperatorio
        onAgregarRecuperatorio={onSetRecuperatorio}
        maxRecuperatorio={criterio.max || 10}
      />
    </div>
  );
}

function CampoAsistenciaResumen({ alumno, diasCurso, compacto }) {
  const r = calcularAsistenciaAlumno(alumno, diasCurso || {});
  if (r.total === 0) {
    return (
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: compacto ? 11.5 : 12.5, color: COLORS.inkSoft, fontStyle: "italic" }}>
        Sin clases con asistencia tomada
      </div>
    );
  }
  if (compacto) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        <span style={{
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 700, color: COLORS.white,
          background: COLORS.pineDark, padding: "3px 8px", borderRadius: 999, lineHeight: 1.3,
        }}>
          {r.porcentaje}%
        </span>
        <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 600, color: COLORS.inkSoft, whiteSpace: "nowrap" }}>
          {r.a} A / {r.t} T / {r.j} J
        </span>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color: COLORS.pineDark }}>
        {r.porcentaje}%
      </span>
      <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600, color: COLORS.inkSoft }}>
        {r.a} A / {r.t} T / {r.j} J
      </span>
    </div>
  );
}

function CampoCriterio({ alumno, criterio, periodo, instancias, notaAprobacion, diasCurso, onGuardarEvento, onGuardarNotaInstancia, onAgregarInstancia, onBorrarEvento, onSetRecuperatorio }) {
  if (criterio.tipo === "asistencia") {
    return <CampoAsistenciaResumen alumno={alumno} diasCurso={diasCurso} />;
  }
  if (criterio.tipo === "opcion") {
    return (
      <>
        <CampoOpciones opciones={criterio.opciones || []} valorActual={ultimoValorSimple(alumno, criterio.id, periodo)} onGuardar={(v) => onGuardarEvento(criterio.id, v)} />
        {criterio.conObservacion && (
          <div style={{ marginTop: 8 }}>
            <CampoTexto placeholder={`Observación sobre ${criterio.nombre.toLowerCase()}…`} onGuardar={(v) => onGuardarEvento(criterio.id, v)} />
          </div>
        )}
        <MiniHistorial eventos={eventosDeCriterio(alumno, criterio.id, periodo)} onBorrar={onBorrarEvento} notaAprobacion={notaAprobacion} />
      </>
    );
  }
  if (criterio.tipo === "texto") {
    return (
      <>
        <CampoTexto onGuardar={(v) => onGuardarEvento(criterio.id, v)} />
        <MiniHistorial eventos={eventosDeCriterio(alumno, criterio.id, periodo)} onBorrar={onBorrarEvento} notaAprobacion={notaAprobacion} />
      </>
    );
  }
  if (criterio.tipo === "numerico") {
    return (
      <>
        <CampoNumerico max={criterio.max || 10} valorActual={ultimoValorSimple(alumno, criterio.id, periodo)} notaAprobacion={notaAprobacion} onGuardar={(v) => onGuardarEvento(criterio.id, v)} />
        <MiniHistorial eventos={eventosDeCriterio(alumno, criterio.id, periodo)} onBorrar={onBorrarEvento} notaAprobacion={notaAprobacion} />
      </>
    );
  }
  // numerico_instancias
  return (
    <CampoEvaluaciones
      alumno={alumno} criterio={criterio} periodo={periodo} instancias={instancias || []} notaAprobacion={notaAprobacion}
      onGuardar={(instanciaId, valor) => onGuardarNotaInstancia(criterio.id, instanciaId, valor)}
      onAgregarInstancia={(nombre) => onAgregarInstancia(criterio.id, nombre)}
      onBorrar={onBorrarEvento}
      onSetRecuperatorio={(eventoId, valor) => onSetRecuperatorio(eventoId, valor)}
    />
  );
}

// ================================================================
// TABLA DE NOTAS OFICIALES (portada del boceto original)
// ================================================================
const COLUMNAS_NOTAS = [
  { key: "inf1c1", label: "1° inf", tipo: "inf" },
  { key: "inf2c1", label: "2° inf", tipo: "inf" },
  { key: "cuat1", label: "1° Cuat", tipo: "cuat" },
  { key: "inf1c2", label: "1° inf", tipo: "inf" },
  { key: "inf2c2", label: "2° inf", tipo: "inf" },
  { key: "cuat2", label: "2° Cuat", tipo: "cuat" },
  { key: "nota", label: "Nota", tipo: "nota" },
];

const ESTILO_TIPO_NOTA = {
  inf: { header: COLORS.pineDark, celda: COLORS.white, texto: COLORS.pineDark },
  cuat: { header: "#2C6358", celda: "#E3EFEC", texto: COLORS.pineDark },
  nota: { header: COLORS.ochre, celda: "#F7E7C9", texto: "#8A5A1E" },
};

// Los encabezados de la planilla oficial (1° inf, 2° inf, 1° Cuat, etc.)
// se pueden renombrar por colegio (ej: "1° inf" -> "1° bim"). Esta función
// combina las etiquetas por defecto con los nombres personalizados que el
// docente haya guardado para el colegio actual.
function resolverColumnasNotas(colegioId, nombresColumnasPorColegio) {
  const overrides = (nombresColumnasPorColegio && nombresColumnasPorColegio[colegioId]) || {};
  return COLUMNAS_NOTAS.map((c) => ({ ...c, label: overrides[c.key] || c.label }));
}

// Estilo de una celda de la planilla oficial. Solo la columna "Nota"
// (la nota final) se pinta entera de rojo/verde según aprobación, con
// el número siempre en negro y en negrita; el resto de las columnas
// mantiene su color de tipo habitual.
function estiloCeldaOficial(tipo, valor, notaAprobacion) {
  if (esMarcaAusente(valor)) {
    return { background: tipo === "nota" ? "#F9E1DE" : ESTILO_TIPO_NOTA[tipo].celda, color: COLORS.notaRoja };
  }
  if (tipo === "nota" && valor !== "" && notaAprobacion != null) {
    const num = Number(String(valor).replace(",", "."));
    if (!Number.isNaN(num)) {
      const aprobo = num >= notaAprobacion;
      return { background: aprobo ? "#E3F3E7" : "#F9E1DE", color: COLORS.ink };
    }
  }
  const colorTexto = valor !== "" && notaAprobacion != null ? colorNota(valor, notaAprobacion) : ESTILO_TIPO_NOTA[tipo].texto;
  return { background: ESTILO_TIPO_NOTA[tipo].celda, color: colorTexto };
}

// ---------- Promedios automáticos (opcionales, por curso) ----------
// Convierte "7,4" o "7.4" a número; devuelve null si no es una nota válida.
function parseNota(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(String(v).replace(",", "."));
  return Number.isNaN(n) ? null : n;
}
// Promedio de dos notas, redondeado a un decimal y con coma (formato AR).
// Si falta alguna de las dos, no hay promedio posible (cadena vacía).
function promedioNotas(a, b) {
  const na = esMarcaAusente(a) ? 0 : parseNota(a);
  const nb = esMarcaAusente(b) ? 0 : parseNota(b);
  if (na === null || nb === null) return "";
  return ((na + nb) / 2).toFixed(1).replace(".", ",");
}

// Dadas las notas cargadas a mano de un alumno, arma los valores a mostrar
// en la planilla: 1° Cuat = promedio(1° inf, 2° inf) del 1° cuat; 2° Cuat =
// promedio(1° inf, 2° inf) del 2° cuat; Nota = promedio(1° Cuat, 2° Cuat).
// Solo rige si el curso tiene el cálculo automático activado, y SIEMPRE
// respeta lo que el docente haya cargado a mano en esas mismas celdas: el
// cálculo es una sugerencia que se ve mientras la celda esté vacía. También
// devuelve qué claves quedaron "sugeridas" (no cargadas a mano) para poder
// pintarlas distinto.
function notasConPromedios(notas, autoActivo) {
  const base = notas || {};
  if (!autoActivo) return { valores: base, calculadas: new Set() };
  const valores = { ...base };
  const calculadas = new Set();
  if (!valores.cuat1) {
    const p = promedioNotas(valores.inf1c1, valores.inf2c1);
    if (p !== "") { valores.cuat1 = p; calculadas.add("cuat1"); }
  }
  if (!valores.cuat2) {
    const p = promedioNotas(valores.inf1c2, valores.inf2c2);
    if (p !== "") { valores.cuat2 = p; calculadas.add("cuat2"); }
  }
  if (!valores.nota) {
    const p = promedioNotas(valores.cuat1, valores.cuat2);
    if (p !== "") { valores.nota = p; calculadas.add("nota"); }
  }
  return { valores, calculadas };
}

function TablaNotasOficiales({ notas, notaAprobacion, onCambiar, columnas = COLUMNAS_NOTAS, promedioAuto = false, onTogglePromedioAuto }) {
  const { valores, calculadas } = notasConPromedios(notas, promedioAuto);
  return (
    <div style={{ marginBottom: 18 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4, padding: "0 2px" }}>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 600, color: COLORS.inkSoft, letterSpacing: 0.4 }}>
          PLANILLA DE CALIFICACIONES
        </div>
        {onTogglePromedioAuto && (
          <div onClick={onTogglePromedioAuto} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
            <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10.5, fontWeight: 600, color: COLORS.inkSoft }}>
              Calcular promedio
            </span>
            <div style={{
              width: 30, height: 17, borderRadius: 999, background: promedioAuto ? COLORS.ochre : COLORS.line,
              position: "relative", transition: "background 0.15s", flexShrink: 0,
            }}>
              <div style={{
                position: "absolute", top: 2, left: promedioAuto ? 15 : 2, width: 13, height: 13, borderRadius: "50%",
                background: COLORS.white, transition: "left 0.15s",
              }} />
            </div>
          </div>
        )}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", border: `1px solid ${COLORS.line}`, borderRadius: 10, overflow: "hidden" }}>
        {columnas.map((c) => (
          <div key={c.key + "-h"} style={{ background: ESTILO_TIPO_NOTA[c.tipo].header, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 9.5, fontWeight: 600, textAlign: "center", padding: "5px 1px", lineHeight: 1.15 }}>
            {c.label}
          </div>
        ))}
        {columnas.map((c) => {
          const valor = valores[c.key] || "";
          const esCalculada = calculadas.has(c.key);
          const { background, color } = estiloCeldaOficial(c.tipo, valor, notaAprobacion);
          return (
            <input
              key={c.key + "-v"}
              value={valor}
              onChange={(e) => onCambiar(c.key, e.target.value)}
              onBlur={(e) => { if (esMarcaAusente(e.target.value)) onCambiar(c.key, "Aus"); }}
              style={{
                width: "100%", boxSizing: "border-box", textAlign: "center", border: "none",
                borderTop: `1px solid ${COLORS.line}`, background,
                fontFamily: "'IBM Plex Mono', monospace", fontSize: 13.5,
                fontWeight: esCalculada ? 500 : 700, fontStyle: esCalculada ? "italic" : "normal",
                color: esCalculada ? COLORS.inkSoft : color,
                padding: "6px 1px", minWidth: 0,
              }}
            />
          );
        })}
      </div>
      {promedioAuto && (
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10.5, color: COLORS.inkSoft, fontStyle: "italic", marginTop: 3, padding: "0 2px" }}>
          Los valores en cursiva son promedios sugeridos; podés sobrescribirlos.
        </div>
      )}
    </div>
  );
}

function FilaHistorialCompacta({ ev, onBorrar, notaAprobacion }) {
  const [confirmando, setConfirmando] = useState(false);
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "3px 2px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.ink }}>
      <span style={{ maxWidth: "62%" }}>
        {ev.etiqueta ? <b>{ev.etiqueta}: </b> : null}
        <ValorEventoTexto ev={ev} notaAprobacion={notaAprobacion} />
      </span>
      {confirmando ? (
        <span style={{ display: "flex", gap: 4 }}>
          <span onClick={() => onBorrar(ev.id)} style={{ ...chipBase, fontSize: 10, padding: "2px 7px", color: COLORS.white, background: COLORS.rose }}>Sí, borrar</span>
          <span onClick={() => setConfirmando(false)} style={{ ...chipBase, fontSize: 10, padding: "2px 7px", color: COLORS.inkSoft, background: COLORS.paperDim }}>Cancelar</span>
        </span>
      ) : (
        <span onClick={() => setConfirmando(true)} style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10, color: COLORS.inkSoft, cursor: "pointer" }}>
          {fechaCorta(ev.fecha)} · borrar
        </span>
      )}
    </div>
  );
}

// ================================================================
// MODAL "TODOS LOS REGISTROS" (portado del Perfil del boceto original)
// ================================================================
function ModalHistorial({ alumno, criterios, cursoId, ordenPorCurso, onReordenarCriterios, instanciasPorCriterio, periodoInicial, notaAprobacion, onBorrar, onCambiarNotaOficial, columnas, onClose, promedioAuto, onTogglePromedioAuto }) {
  const [tab, setTab] = useState(periodoInicial);
  const [pendienteOrden, setPendienteOrden] = useState(null);
  const criteriosOrdenados = ordenarCriteriosPorCurso(criterios, cursoId, ordenPorCurso);
  const coloresPorCriterio = asignarColoresSinRepetir(criteriosOrdenados);

  const tarjetas = criteriosOrdenados
    .map((c) => {
      let eventos = eventosDeCriterio(alumno, c.id, tab);
      if (c.tipo === "numerico_instancias") {
        const instancias = instanciasPorCriterio[c.id] || [];
        eventos = eventos.map((e) => ({ ...e, etiqueta: (instancias.find((i) => i.id === e.instanciaId) || {}).nombre }));
      }
      return { criterio: c, eventos };
    })
    .filter((t) => t.eventos.length > 0);
  const mapaTarjetas = new Map(tarjetas.map((t) => [t.criterio.id, t]));

  return (
    <div style={{ position: "fixed", inset: 0, background: COLORS.paper, zIndex: 70, overflowY: "auto" }}>
      <div
        style={{ width: "100%", maxWidth: 480, margin: "0 auto", minHeight: "100%", padding: "18px 16px 90px 16px" }}
      >
        <div style={{ marginBottom: 12, padding: "0 2px" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: COLORS.pineDark }}>Registros de {alumno.nombre}</div>
        </div>

        <TablaNotasOficiales notas={alumno.notasOficiales} notaAprobacion={notaAprobacion} onCambiar={onCambiarNotaOficial} columnas={columnas} promedioAuto={promedioAuto} onTogglePromedioAuto={onTogglePromedioAuto} />

        <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
          {["1", "2"].map((p) => (
            <button key={p} onClick={() => setTab(p)}
              style={{
                flex: 1, padding: "8px 4px", borderRadius: 10,
                border: `1.5px solid ${tab === p ? COLORS.pine : COLORS.line}`,
                background: tab === p ? COLORS.pine : COLORS.white,
                color: tab === p ? COLORS.white : COLORS.ink,
                fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer",
              }}
            >{p}° Cuatrimestre</button>
          ))}
        </div>

        {pendienteOrden && (
          <BannerConfirmarOrden
            onSi={() => { onReordenarCriterios(pendienteOrden, true); setPendienteOrden(null); }}
            onNo={() => { onReordenarCriterios(pendienteOrden, false); setPendienteOrden(null); }}
          />
        )}

        {tarjetas.length === 0 ? (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.inkSoft, fontStyle: "italic", textAlign: "center", padding: "20px 10px" }}>
            Sin registros en este cuatrimestre todavía.
          </div>
        ) : (
          <ListaOrdenable
            ids={tarjetas.map((t) => t.criterio.id)}
            onReordenar={(nuevoOrden) => setPendienteOrden(nuevoOrden)}
            renderItem={(id) => {
              const t = mapaTarjetas.get(id);
              const color = coloresPorCriterio[id];
              return (
                <div style={{ background: color.fondo, border: `1px solid ${color.borde}`, borderRadius: 12, padding: "9px 10px", marginBottom: 8 }}>
                  <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 800, letterSpacing: 0.2, color: color.texto, borderBottom: `1.5px solid ${color.borde}`, paddingBottom: 5, marginBottom: 6 }}>
                    {t.criterio.nombre}
                  </div>
                  {t.eventos.map((ev) => (
                    <FilaHistorialCompacta key={ev.id} ev={ev} onBorrar={onBorrar} notaAprobacion={notaAprobacion} />
                  ))}
                </div>
              );
            }}
          />
        )}
      </div>

      <BotonVolverFlotante onVolver={onClose} zIndex={75} />
    </div>
  );
}

function PantallaFichaAlumno({ colegio, curso, alumno, periodo, criteriosActivos, todosLosCriterios, ordenPorCurso, onReordenarCriterios, instanciasPorCriterio, notaAprobacion, diasCurso, onGuardarEvento, onGuardarNotaInstancia, onAgregarInstancia, onBorrarEvento, onSetRecuperatorio, onCambiarNotaOficial, nombresColumnasPorColegio, onVolver, tourVisto, onMarcarTourVisto, promedioAuto, onTogglePromedioAuto }) {
  const activosOrdenados = ordenarCriteriosPorCurso(criteriosActivos, curso.id, ordenPorCurso);
  const coloresPorCriterio = asignarColoresSinRepetir(activosOrdenados);
  const mapaCriterios = new Map(activosOrdenados.map((c) => [c.id, c]));
  const columnas = resolverColumnasNotas(colegio.id, nombresColumnasPorColegio);
  const [historialAbierto, setHistorialAbierto] = useState(false);
  const [pendienteOrden, setPendienteOrden] = useState(null);
  const [tourActivo, setTourActivo] = useState(!tourVisto);
  const refTablaNotas = useRef(null);
  const refCriteriosFicha = useRef(null);
  const refVerRegistros = useRef(null);

  const pasos = [
    { titulo: "Planilla de Calificaciones de este alumno", texto: "Aquí cargás la Planilla de Calificaciones (informes y cuatrimestres), igual que en el papel. La celda \"Nota\" se pinta según aprueba o no. Podés modificar cualquier celda cuando quieras: el cambio se refleja también en la Planilla del curso. Y si mantenés presionado un encabezado (como \"1° inf\") desde esa Planilla, podés renombrarlo (por ejemplo a \"1° bim\").", ref: refTablaNotas },
    { titulo: "Criterios de seguimiento", texto: "Tocá cualquier bloque para cargar un registro nuevo. Mantené presionado un instante para arrastrarlo y cambiar el orden.", ref: refCriteriosFicha },
    { titulo: "Historial completo", texto: "Aquí ves y editás todos los registros de este alumno, de cualquier criterio y período, en un solo lugar.", ref: refVerRegistros },
  ];

  return (
    <div>
      <EncabezadoNav
        eyebrow={`${colegio.nombre} · ${curso.nombre}`}
        titulo={alumno.nombre}
        subtitulo={`Registrando en ${periodo}° Cuatrimestre`}
        onAyuda={() => setTourActivo(true)}
        accion={
          <button
            ref={refVerRegistros}
            onClick={() => setHistorialAbierto(true)}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "7px 12px", borderRadius: 999, border: `1.5px solid ${COLORS.white}`, background: "transparent", color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <ClipboardList size={13} strokeWidth={2.4} /> Ver todos los registros
          </button>
        }
      />
      <div style={{ padding: "14px 16px 100px 16px" }}>
        <div ref={refTablaNotas}>
          <TablaNotasOficiales notas={alumno.notasOficiales} notaAprobacion={notaAprobacion} onCambiar={(campo, valor) => onCambiarNotaOficial(alumno.id, campo, valor)} columnas={columnas} promedioAuto={promedioAuto} onTogglePromedioAuto={onTogglePromedioAuto} />
        </div>

        <CuadroGuia texto="Mantené presionado un bloque un instante para arrastrarlo y cambiar el orden. Tocá un criterio para cargar un registro." />

        {pendienteOrden && (
          <BannerConfirmarOrden
            onSi={() => { onReordenarCriterios(pendienteOrden, true); setPendienteOrden(null); }}
            onNo={() => { onReordenarCriterios(pendienteOrden, false); setPendienteOrden(null); }}
          />
        )}

        <div ref={refCriteriosFicha}>
        {activosOrdenados.length === 0 ? (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.inkSoft, fontStyle: "italic", textAlign: "center", padding: "24px 10px" }}>
            Este curso todavía no tiene criterios activos. Volvé y activá alguno desde "Criterios de Seguimiento".
          </div>
        ) : (
          <ListaOrdenable
            ids={activosOrdenados.map((c) => c.id)}
            onReordenar={(nuevoOrden) => setPendienteOrden(nuevoOrden)}
            renderItem={(id) => {
              const c = mapaCriterios.get(id);
              const color = coloresPorCriterio[id];
              return (
                <div style={{ marginBottom: 16, background: color.fondo, border: `1px solid ${color.borde}`, borderRadius: 14, padding: "12px 12px 14px 12px" }}>
                  {c.tipo === "asistencia" ? (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
                      <div style={{ ...etiquetaCampoStyle, color: color.texto, marginBottom: 0 }}>{c.nombre}</div>
                      <CampoAsistenciaResumen alumno={alumno} diasCurso={diasCurso} compacto />
                    </div>
                  ) : (
                    <>
                      <div style={{ ...etiquetaCampoStyle, color: color.texto, marginBottom: 8 }}>{c.nombre}</div>
                      <CampoCriterio
                        alumno={alumno} criterio={c} periodo={periodo} instancias={instanciasPorCriterio[c.id]} notaAprobacion={notaAprobacion}
                        diasCurso={diasCurso}
                        onGuardarEvento={(criterioId, valor, extra) => onGuardarEvento(alumno.id, criterioId, valor, extra)}
                        onGuardarNotaInstancia={(criterioId, instanciaId, valor) => onGuardarNotaInstancia(alumno.id, criterioId, instanciaId, valor)}
                        onAgregarInstancia={onAgregarInstancia}
                        onBorrarEvento={(eventoId) => onBorrarEvento(alumno.id, eventoId)}
                        onSetRecuperatorio={(eventoId, valor) => onSetRecuperatorio(alumno.id, eventoId, valor)}
                      />
                    </>
                  )}
                </div>
              );
            }}
          />
        )}
      </div>
      </div>

      <BotonVolverFlotante onVolver={onVolver} />

      {tourActivo && (
        <TourGuiado pasos={pasos} onCerrar={() => { setTourActivo(false); onMarcarTourVisto(); }} />
      )}

      {historialAbierto && (
        <ModalHistorial
          alumno={alumno}
          criterios={todosLosCriterios}
          cursoId={curso.id}
          ordenPorCurso={ordenPorCurso}
          onReordenarCriterios={onReordenarCriterios}
          instanciasPorCriterio={instanciasPorCriterio}
          periodoInicial={periodo}
          notaAprobacion={notaAprobacion}
          onBorrar={(eventoId) => onBorrarEvento(alumno.id, eventoId)}
          onCambiarNotaOficial={(campo, valor) => onCambiarNotaOficial(alumno.id, campo, valor)}
          columnas={columnas}
          onClose={() => setHistorialAbierto(false)}
          promedioAuto={promedioAuto}
          onTogglePromedioAuto={onTogglePromedioAuto}
        />
      )}
    </div>
  );
}


// ================================================================
// CARGA MASIVA — solo para criterios numérico_instancias.
// ================================================================
// Fila individual de la planilla de carga masiva. Tiene un botón "Aus"
// fijo (igual que en las planillas de Diciembre/Febrero) para marcar que el
// alumno estuvo ausente en esa instancia. Además, si el docente empieza a
// escribir una letra en el casillero de nota (por ejemplo "a" o "aus"),
// aparece un cartelito flotante ofreciendo marcarlo como ausente con un
// solo toque, sin tener que ir a buscar el botón.
function FilaCorreccionMasivaAlumno({ alumno, valorGuardado, inputRef, onGuardarNumero, onMarcarAusente, onQuitarAusente }) {
  const esAusenteGuardado = valorGuardado === AUSENTE;
  const [texto, setTexto] = useState(esAusenteGuardado ? "" : (valorGuardado || ""));
  const [mostrarSugerencia, setMostrarSugerencia] = useState(false);

  function pareceLetraDeAusente(v) {
    const t = v.trim().toLowerCase();
    if (!t) return false;
    if (!Number.isNaN(Number(t.replace(",", ".")))) return false; // ya es un número válido
    return t.charAt(0) === "a"; // "a", "au", "aus", "ausente"…
  }

  function handleChange(e) {
    const v = e.target.value;
    setTexto(v);
    setMostrarSugerencia(pareceLetraDeAusente(v));
  }

  function confirmarSugerencia() {
    setTexto("");
    setMostrarSugerencia(false);
    onMarcarAusente();
  }

  function handleBlur(e) {
    if (mostrarSugerencia) {
      // Era una letra suelta ("a", "aus"…) y el docente no confirmó: no es
      // un valor válido, así que no se guarda nada raro.
      setMostrarSugerencia(false);
      return;
    }
    if (e.target.value !== "") onGuardarNumero(e.target.value);
  }

  function handleKeyDown(e) {
    if (e.key === "Enter") {
      if (mostrarSugerencia) { confirmarSugerencia(); return; }
      e.target.blur();
      onGuardarNumero(e.target.value);
    }
    if (e.key === "Escape") setMostrarSugerencia(false);
  }

  function alternarBotonAus() {
    if (esAusenteGuardado) {
      onQuitarAusente();
    } else {
      setTexto("");
      setMostrarSugerencia(false);
      onMarcarAusente();
    }
  }

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "10px 0", borderBottom: `1px solid ${COLORS.line}` }}>
      <span style={{ flex: 1, minWidth: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14.5, color: COLORS.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {alumno.nombre}
      </span>

      <button
        onClick={alternarBotonAus}
        style={{
          flexShrink: 0, padding: "6px 9px", borderRadius: 10, border: `1px solid ${esAusenteGuardado ? COLORS.notaRoja : COLORS.line}`,
          background: esAusenteGuardado ? COLORS.notaRoja : COLORS.white, color: esAusenteGuardado ? COLORS.white : COLORS.inkSoft,
          fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 600, cursor: "pointer",
        }}
      >
        Aus
      </button>

      <input
        ref={inputRef}
        type="text" inputMode="decimal"
        value={esAusenteGuardado ? "" : texto}
        placeholder={esAusenteGuardado ? "—" : ""}
        disabled={esAusenteGuardado}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
        style={{
          width: 56, textAlign: "center", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "6px 4px",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 600, color: COLORS.pineDark,
          background: esAusenteGuardado ? COLORS.paperDim : COLORS.white, opacity: esAusenteGuardado ? 0.6 : 1,
        }}
      />

      {mostrarSugerencia && (
        <div
          style={{
            position: "absolute", right: 0, top: "100%", marginTop: 4, zIndex: 5,
            display: "flex", alignItems: "center", gap: 6, padding: "6px 8px", borderRadius: 10,
            background: COLORS.pineDark, boxShadow: "0 4px 12px rgba(21,53,49,0.25)",
          }}
        >
          <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, color: COLORS.white, whiteSpace: "nowrap" }}>
            ¿Marcar ausente?
          </span>
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={confirmarSugerencia}
            style={{ flexShrink: 0, padding: "4px 8px", borderRadius: 999, border: "none", background: COLORS.notaRoja, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, fontWeight: 700, cursor: "pointer" }}
          >
            Sí, Aus
          </button>
        </div>
      )}
    </div>
  );
}

function CorreccionMasiva({ alumnos, criteriosInstancias, periodo, instanciasPorCriterio, onGuardar, onAgregarInstancia, onCerrar }) {
  const [criterioId, setCriterioId] = useState(criteriosInstancias.length ? criteriosInstancias[0].id : null);
  const [instanciaId, setInstanciaId] = useState(null);
  const [agregando, setAgregando] = useState(false);
  const [nombreNuevo, setNombreNuevo] = useState("");
  const inputsRef = useRef([]);

  const criterioActual = criteriosInstancias.find((c) => c.id === criterioId) || null;
  const instancias = instanciasPorCriterio[criterioId] || [];

  useEffect(() => {
    setInstanciaId((instanciasPorCriterio[criterioId] || []).length ? instanciasPorCriterio[criterioId][0].id : null);
    setAgregando((instanciasPorCriterio[criterioId] || []).length === 0);
  }, [criterioId]);

  function valorActual(alumno) {
    const evs = (alumno.eventos || []).filter((e) => e.criterioId === criterioId && e.instanciaId === instanciaId && e.periodo === periodo);
    return evs.length ? evs[evs.length - 1].valor : "";
  }
  function guardar(alumno, valorCrudo, index) {
    if (valorCrudo === "" || valorCrudo == null) return;
    const normalizado = valorCrudo.trim();
    const num = Number(normalizado.replace(",", "."));
    const max = (criterioActual && criterioActual.max) || 10;
    if (Number.isNaN(num) || num < 0 || num > max) return;
    onGuardar(alumno.id, criterioId, normalizado, instanciaId);
    const siguiente = inputsRef.current[index + 1];
    if (siguiente) siguiente.focus();
  }
  // Marca directamente al alumno como ausente en esta instancia (mismo
  // marcador AUSENTE que usa la ficha individual), y avanza el foco al
  // siguiente casillero, igual que al guardar una nota numérica.
  function guardarAusente(alumno, index) {
    onGuardar(alumno.id, criterioId, AUSENTE, instanciaId);
    const siguiente = inputsRef.current[index + 1];
    if (siguiente) siguiente.focus();
  }
  function quitarAusente(alumno) {
    onGuardar(alumno.id, criterioId, "", instanciaId);
  }
  function confirmarNuevaInstancia() {
    const nombre = nombreNuevo.trim();
    if (!nombre) return;
    const id = onAgregarInstancia(criterioId, nombre);
    setInstanciaId(id);
    setNombreNuevo("");
    setAgregando(false);
  }

  if (!criterioActual) return null;

  return (
    <div style={{ position: "fixed", inset: 0, background: COLORS.paper, zIndex: 60, display: "flex", flexDirection: "column" }}>
      <div style={{ background: COLORS.pineDark, color: COLORS.white, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600 }}>
            <ClipboardList size={18} strokeWidth={2.2} /> Carga masiva
          </div>
          <span onClick={onCerrar} style={{ cursor: "pointer", fontSize: 20 }}>×</span>
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ochreSoft, marginTop: 4 }}>
          {periodo}° Cuatrimestre · Enter guarda y avanza al siguiente.
        </div>
      </div>

      {criteriosInstancias.length > 1 && (
        <div style={{ padding: "10px 16px", display: "flex", gap: 6, flexWrap: "wrap", borderBottom: `1px solid ${COLORS.line}` }}>
          {criteriosInstancias.map((c) => (
            <button key={c.id} onClick={() => setCriterioId(c.id)}
              style={{ padding: "6px 12px", borderRadius: 999, border: `1.5px solid ${criterioId === c.id ? COLORS.pine : COLORS.line}`, background: criterioId === c.id ? COLORS.pine : COLORS.white, color: criterioId === c.id ? COLORS.white : COLORS.ink, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
            >{c.nombre}</button>
          ))}
        </div>
      )}

      {instancias.length > 0 && (
        <div style={{ padding: "12px 16px", display: "flex", flexWrap: "nowrap", overflowX: "auto", gap: 6, borderBottom: `1px solid ${COLORS.line}` }}>
          {instancias.map((inst) => (
            <button key={inst.id} onClick={() => setInstanciaId(inst.id)}
              style={{ padding: "6px 12px", borderRadius: 999, border: `1.5px solid ${instanciaId === inst.id ? COLORS.pine : COLORS.line}`, background: instanciaId === inst.id ? COLORS.pine : COLORS.white, color: instanciaId === inst.id ? COLORS.white : COLORS.ink, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 500, whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}
            >{inst.nombre}</button>
          ))}
          <button onClick={() => setAgregando((v) => !v)}
            style={{ padding: "6px 12px", borderRadius: 999, border: `1.5px dashed ${COLORS.ochre}`, background: COLORS.white, color: COLORS.ochre, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", flexShrink: 0, cursor: "pointer" }}
          >+ Nueva</button>
        </div>
      )}

      {agregando && (
        <div style={{ display: "flex", gap: 6, padding: "10px 16px" }}>
          <input value={nombreNuevo} onChange={(e) => setNombreNuevo(e.target.value)} placeholder="Ej: 1ra evaluación, TP1, Recuperatorio…" autoFocus
            onKeyDown={(e) => { if (e.key === "Enter") confirmarNuevaInstancia(); }}
            style={{ flex: 1, border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "6px 8px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5 }}
          />
          <button onClick={confirmarNuevaInstancia}
            style={{ padding: "6px 12px", borderRadius: 999, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 500, cursor: "pointer" }}
          >Crear</button>
        </div>
      )}

      {instanciaId ? (
        <div key={instanciaId} style={{ flex: 1, overflowY: "auto", padding: "8px 16px 24px 16px" }}>
          {alumnos.map((a, i) => (
            <FilaCorreccionMasivaAlumno
              key={a.id}
              alumno={a}
              valorGuardado={valorActual(a)}
              inputRef={(el) => (inputsRef.current[i] = el)}
              onGuardarNumero={(v) => guardar(a, v, i)}
              onMarcarAusente={() => guardarAusente(a, i)}
              onQuitarAusente={() => quitarAusente(a)}
            />
          ))}
        </div>
      ) : (
        <div style={{ padding: "30px 16px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, fontStyle: "italic", textAlign: "center" }}>
          Creá o elegí una instancia para empezar a cargar notas.
        </div>
      )}
    </div>
  );
}

// ================================================================
// PLANILLA DE NOTAS OFICIALES — consolida en una sola grilla lo que ya
// se cargó en la Tabla de Notas de cada alumno, pensada para volcarla
// tal cual a la planilla en papel del colegio (misma forma: 1° inf,
// 2° inf, 1° Cuat, 1° inf, 2° inf, 2° Cuat, Nota). Es de solo lectura
// salvo que el docente toque una celda puntual para corregir un error;
// en ese caso se confirma antes de guardar, y el cambio impacta la
// misma ficha individual del alumno (es el mismo dato).
// ================================================================
function CeldaNotaOficial({ valor, tipo, notaAprobacion, onIntentarCambiar, calculado = false, soloLectura = false }) {
  const [editando, setEditando] = useState(false);
  const [borrador, setBorrador] = useState(valor || "");

  useEffect(() => { if (!editando) setBorrador(valor || ""); }, [valor, editando]);

  const { background, color } = estiloCeldaOficial(tipo, borrador, notaAprobacion);

  function confirmarSalida() {
    setEditando(false);
    const normalizado = esMarcaAusente(borrador) ? "Aus" : borrador;
    if (normalizado !== (valor || "")) onIntentarCambiar(normalizado);
  }

  return (
    <input
      value={borrador}
      readOnly={soloLectura}
      onFocus={() => setEditando(true)}
      onChange={(e) => setBorrador(e.target.value)}
      onBlur={confirmarSalida}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
      style={{
        width: "100%", boxSizing: "border-box", textAlign: "center", border: "none",
        borderTop: `1px solid ${COLORS.line}`, background,
        fontFamily: "'IBM Plex Mono', monospace", fontSize: 13,
        fontWeight: calculado && !editando ? 500 : 700, fontStyle: calculado && !editando ? "italic" : "normal",
        color: calculado && !editando ? COLORS.inkSoft : color,
        padding: "7px 2px", minWidth: 0, cursor: soloLectura ? "default" : "text",
      }}
    />
  );
}

// ================================================================
// RECUPERATORIOS DE DICIEMBRE Y FEBRERO
// Se calculan a partir de la nota anual ("Nota" de la planilla oficial)
// y del umbral de aprobación ya configurado. No pisan la nota original:
// el resultado de cada instancia se guarda aparte y se muestra como
// estado.
//
// La planilla de Diciembre es un respaldo permanente: una vez que un
// alumno queda con la nota anual desaprobada, siempre aparece ahí
// (con su nota o su "Ausente" cargados o vacíos), sin importar qué
// pase después en Febrero. La de Febrero se arma solo con quienes
// desaprobaron Diciembre o estuvieron ausentes en Diciembre.
// ================================================================
const AUSENTE = "AUSENTE";

function notaAnualDesaprobada(alumno, notaAprobacion) {
  const notaAnualRaw = (alumno.notasOficiales && alumno.notasOficiales.nota) || "";
  if (notaAprobacion == null || notaAnualRaw === "") return false;
  const notaAnual = Number(String(notaAnualRaw).replace(",", "."));
  if (Number.isNaN(notaAnual)) return false;
  return notaAnual < notaAprobacion;
}

// Estado puntual de la instancia de Diciembre de un alumno.
function estadoDiciembre(alumno) {
  const raw = alumno.notaDiciembre;
  if (raw === AUSENTE) return { tipo: "ausente" };
  if (raw != null && raw !== "") {
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isNaN(n)) return { tipo: "nota", valor: n };
  }
  return { tipo: "pendiente" };
}

// Estado puntual de la instancia de Febrero de un alumno. Igual que en
// Diciembre, "ausente" es un valor explícito (botón "Aus"), distinto de
// no haber cargado nada todavía.
function estadoFebrero(alumno) {
  const raw = alumno.notaFebrero;
  if (raw === AUSENTE) return { tipo: "ausente" };
  if (raw != null && raw !== "") {
    const n = Number(String(raw).replace(",", "."));
    if (!Number.isNaN(n)) return { tipo: "nota", valor: n };
  }
  return { tipo: "pendiente" };
}

function calcularEstadoMateria(alumno, notaAprobacion) {
  const notaAnualRaw = (alumno.notasOficiales && alumno.notasOficiales.nota) || "";

  if (notaAprobacion == null) return { estado: "sin-umbral", texto: "Definí la nota de aprobación primero" };
  if (notaAnualRaw === "") return { estado: "sin-nota", texto: "Sin nota anual cargada todavía" };
  if (!notaAnualDesaprobada(alumno, notaAprobacion)) return { estado: "aprobada", texto: "Aprobó (regular)" };

  const dic = estadoDiciembre(alumno);
  if (dic.tipo === "pendiente") return { estado: "pendiente-diciembre", texto: "Pendiente de Diciembre" };
  if (dic.tipo === "nota" && dic.valor >= notaAprobacion) return { estado: "aprobo-diciembre", texto: "Aprobó la materia en Diciembre" };

  // Acá el alumno o estuvo ausente en Diciembre, o rindió y desaprobó: en
  // ambos casos pasa a Febrero.
  const feb = estadoFebrero(alumno);
  if (feb.tipo === "pendiente") return { estado: "pendiente-febrero", texto: "Pendiente de Febrero" };
  if (feb.tipo === "ausente") return { estado: "previa", texto: "Queda previa" };
  if (feb.tipo === "nota" && feb.valor >= notaAprobacion) return { estado: "aprobo-febrero", texto: "Aprobó la materia en Febrero" };
  return { estado: "previa", texto: "Queda previa" };
}

function colorParaEstado(estado) {
  if (estado === "aprobada" || estado === "aprobo-diciembre" || estado === "aprobo-febrero") return COLORS.notaVerde;
  if (estado === "previa") return COLORS.notaRoja;
  return COLORS.ochre;
}

// La planilla de Diciembre es un respaldo permanente: todo alumno con la
// nota anual desaprobada aparece siempre ahí, tenga o no ya cargado un
// resultado de Diciembre.
function estaEnListaDiciembre(alumno, notaAprobacion) {
  return notaAnualDesaprobada(alumno, notaAprobacion);
}

// Febrero se arma solo con quienes desaprobaron Diciembre (con nota) o
// estuvieron ausentes en Diciembre. Quienes todavía no rindieron
// Diciembre no aparecen acá.
function estaEnListaFebrero(alumno, notaAprobacion) {
  if (!notaAnualDesaprobada(alumno, notaAprobacion)) return false;
  const dic = estadoDiciembre(alumno);
  if (dic.tipo === "ausente") return true;
  if (dic.tipo === "nota" && dic.valor < notaAprobacion) return true;
  return false;
}

// Resumen de cierre de una planilla de recuperatorio (Diciembre o
// Febrero): cuenta cuántos alumnos de la lista filtrada quedaron en
// cada una de las 4 categorías posibles al cierre. Solo se cuentan
// alumnos con nota numérica o "Ausente" cargados; quienes todavía
// están pendientes no suman en ninguna categoría (el total refleja
// la cantidad de alumnos de la planilla, no solo los ya cerrados).
function calcularResumenRecuperatorio(alumnosFiltrados, esDiciembre, notaAprobacion) {
  let aprobados = 0, desaprobados = 0, ausentes = 0;
  alumnosFiltrados.forEach((al) => {
    const estado = esDiciembre ? estadoDiciembre(al) : estadoFebrero(al);
    if (estado.tipo === "ausente") ausentes++;
    else if (estado.tipo === "nota") {
      if (estado.valor >= notaAprobacion) aprobados++;
      else desaprobados++;
    }
  });
  return { total: alumnosFiltrados.length, aprobados, desaprobados, ausentes };
}

// Franja de resumen al pie de la planilla de recuperatorio, con las
// 4 categorías de cierre.
function ResumenRecuperatorio({ resumen }) {
  const items = [
    { etiqueta: "Total alumnos", valor: resumen.total, color: COLORS.ink },
    { etiqueta: "Aprobados", valor: resumen.aprobados, color: COLORS.notaVerde },
    { etiqueta: "Desaprobados", valor: resumen.desaprobados, color: COLORS.notaRoja },
    { etiqueta: "Ausentes", valor: resumen.ausentes, color: COLORS.inkSoft },
  ];
  return (
    <div style={{ display: "flex", borderTop: `2px solid ${COLORS.pine}`, background: COLORS.paperDim }}>
      {items.map((it, i) => (
        <div
          key={it.etiqueta}
          style={{
            flex: 1, padding: "10px 6px", textAlign: "center",
            borderLeft: i === 0 ? "none" : `1px solid ${COLORS.line}`,
          }}
        >
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 17, fontWeight: 700, color: it.color }}>
            {it.valor}
          </div>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 9.5, fontWeight: 700, color: COLORS.inkSoft, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 2 }}>
            {it.etiqueta}
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- Fila de la planilla de Diciembre ----------
// Apellido y nombre + botón "Aus" (excluyente con la nota) + casillero
// de nota. El botón activo se pinta en rojo; la celda de nota se pinta
// entera roja o verde según aprobación, con el número en negro y en
// negrita.
function FilaDiciembre({ alumno, notaAprobacion, onCambiar }) {
  const colorNombre = alumno.genero === "M" ? COLORS.nombreM : COLORS.nombreF;
  const dic = estadoDiciembre(alumno);
  const esAusente = dic.tipo === "ausente";
  const valorNota = dic.tipo === "nota" ? alumno.notaDiciembre : "";
  const tieneNota = dic.tipo === "nota" && notaAprobacion != null;
  const aprobo = tieneNota && dic.valor >= notaAprobacion;

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${COLORS.line}`, background: COLORS.white }}>
      <div style={{ flex: 1, minWidth: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14.5, fontWeight: 700, color: colorNombre, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
        {alumno.nombre}
      </div>
      <button
        onClick={() => onCambiar(esAusente ? "" : AUSENTE)}
        style={{
          flexShrink: 0, padding: "7px 10px", borderRadius: 10, border: `1px solid ${esAusente ? COLORS.notaRoja : COLORS.line}`,
          background: esAusente ? COLORS.notaRoja : COLORS.white, color: esAusente ? COLORS.white : COLORS.inkSoft,
          fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}
      >
        Aus
      </button>
      <input
        value={valorNota}
        onChange={(e) => onCambiar(e.target.value)}
        placeholder="Nota"
        disabled={esAusente}
        inputMode="decimal"
        style={{
          width: 58, textAlign: "center", borderRadius: 10, padding: "8px 4px",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 700, color: COLORS.ink,
          border: `1px solid ${tieneNota ? (aprobo ? COLORS.notaVerde : COLORS.notaRoja) : COLORS.line}`,
          background: esAusente ? COLORS.paperDim : (tieneNota ? (aprobo ? "#E3F3E7" : "#F9E1DE") : COLORS.white),
          opacity: esAusente ? 0.5 : 1, flexShrink: 0,
        }}
      />
    </div>
  );
}

// ---------- Fila de la planilla de Febrero ----------
// Apellido y nombre (+ aviso "Aus Dic" si corresponde), botón "Aus" y
// casillero de nota. Tocar "Aus" desaprueba directamente la materia
// (queda previa), sin necesidad de cargar un número. La celda de nota
// se pinta roja/verde según aprobación, con el número en negro y en
// negrita; si desaprueba (por nota o por Aus), se muestra "Previa".
function FilaFebrero({ alumno, notaAprobacion, onCambiar }) {
  const colorNombre = alumno.genero === "M" ? COLORS.nombreM : COLORS.nombreF;
  const fueAusenteDiciembre = estadoDiciembre(alumno).tipo === "ausente";
  const feb = estadoFebrero(alumno);
  const esAusente = feb.tipo === "ausente";
  const valorNota = feb.tipo === "nota" ? alumno.notaFebrero : "";
  const tieneNota = feb.tipo === "nota" && notaAprobacion != null;
  const aprobo = tieneNota && feb.valor >= notaAprobacion;
  const desaprobo = esAusente || (tieneNota && feb.valor < notaAprobacion);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", borderBottom: `1px solid ${COLORS.line}`, background: COLORS.white }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
          <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14.5, fontWeight: 700, color: colorNombre, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {alumno.nombre}
          </span>
          {fueAusenteDiciembre && (
            <span style={{ flexShrink: 0, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 9.5, fontWeight: 700, color: COLORS.rose, background: "#F5E6E3", padding: "2px 6px", borderRadius: 999 }}>
              Aus Dic
            </span>
          )}
        </div>
        {desaprobo && (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, fontWeight: 700, color: COLORS.notaRoja, marginTop: 3 }}>
            Previa
          </div>
        )}
      </div>
      <button
        onClick={() => onCambiar(esAusente ? "" : AUSENTE)}
        style={{
          flexShrink: 0, padding: "7px 10px", borderRadius: 10, border: `1px solid ${esAusente ? COLORS.notaRoja : COLORS.line}`,
          background: esAusente ? COLORS.notaRoja : COLORS.white, color: esAusente ? COLORS.white : COLORS.inkSoft,
          fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer",
        }}
      >
        Aus
      </button>
      <input
        value={valorNota}
        onChange={(e) => onCambiar(e.target.value)}
        placeholder="Nota"
        disabled={esAusente}
        inputMode="decimal"
        style={{
          width: 64, textAlign: "center", borderRadius: 10, padding: "8px 4px",
          fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 700, color: COLORS.ink,
          border: `1px solid ${tieneNota ? (aprobo ? COLORS.notaVerde : COLORS.notaRoja) : COLORS.line}`,
          background: esAusente ? COLORS.paperDim : (tieneNota ? (aprobo ? "#E3F3E7" : "#F9E1DE") : COLORS.white),
          opacity: esAusente ? 0.5 : 1, flexShrink: 0,
        }}
      />
    </div>
  );
}

// ================================================================
// ASISTENCIA — planilla diaria del curso
// ================================================================
function FilaAsistencia({ alumno, estado, onTocar }) {
  const colorNombre = alumno.genero === "M" ? COLORS.nombreM : COLORS.nombreF;
  const ESTILOS = {
    "": { bg: COLORS.white, color: COLORS.inkSoft, borde: COLORS.line, letra: "" },
    A: { bg: COLORS.notaRoja, color: COLORS.white, borde: COLORS.notaRoja, letra: "A" },
    T: { bg: COLORS.ochre, color: COLORS.white, borde: COLORS.ochre, letra: "T" },
    J: { bg: "#3B7EA6", color: COLORS.white, borde: "#3B7EA6", letra: "J" },
  };
  const est = ESTILOS[estado] || ESTILOS[""];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "9px 12px", borderBottom: `1px solid ${COLORS.line}` }}>
      <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 700, color: colorNombre, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", flex: 1, minWidth: 0 }}>
        {alumno.nombre}
      </span>
      <button
        onClick={onTocar}
        style={{
          width: 46, height: 38, borderRadius: 10, border: `1px solid ${est.borde}`,
          background: est.bg, color: est.color, fontFamily: "'IBM Plex Mono', monospace", fontSize: 15, fontWeight: 700,
          cursor: "pointer", flexShrink: 0,
        }}
      >
        {est.letra}
      </button>
    </div>
  );
}

// ================================================================
// CALENDARIO MENSUAL DE ASISTENCIA — vista de consulta que pinta de
// naranja los días marcados como "no trabajado". Al tocar uno de esos
// días se abre un cartel (bloque gris) con el motivo, sin cerrar el
// calendario, con accesos rápidos para editar o quitar la marca. Tocar
// un día que NO está marcado cierra el calendario y salta a esa fecha
// en la pantalla de asistencia.
// ================================================================
function CalendarioAsistencia({ fechaInicial, diasCurso, diasClaseConfig, onSeleccionarFecha, onEditarDia, onQuitarDia, onCerrar }) {
  const inicio = new Date(fechaInicial + "T00:00:00");
  const [anio, setAnio] = useState(inicio.getFullYear());
  const [mes, setMes] = useState(inicio.getMonth());
  const [popoverFecha, setPopoverFecha] = useState(null);
  const [confirmarQuitarFecha, setConfirmarQuitarFecha] = useState(null);

  const celdas = construirGrillaMes(anio, mes);
  const totalFilas = Math.ceil(celdas.length / 7);
  const nombreMesTexto = new Date(anio, mes, 1).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
  const hoy = hoyISO();

  const flechaMesStyle = {
    width: 30, height: 30, borderRadius: 9, border: `1px solid ${COLORS.line}`, background: COLORS.white,
    color: COLORS.pineDark, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
  };

  function irMesAnterior() {
    setPopoverFecha(null);
    if (mes === 0) { setAnio(anio - 1); setMes(11); } else setMes(mes - 1);
  }
  function irMesSiguiente() {
    setPopoverFecha(null);
    if (mes === 11) { setAnio(anio + 1); setMes(0); } else setMes(mes + 1);
  }
  function tocarCelda(fechaCelda, marcado) {
    if (marcado) {
      setPopoverFecha((actual) => (actual === fechaCelda ? null : fechaCelda));
    } else {
      onSeleccionarFecha(fechaCelda);
    }
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(34,32,27,0.5)", zIndex: 80, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ background: COLORS.paper, borderRadius: 16, width: "100%", maxWidth: 420, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 12px 40px rgba(0,0,0,0.3)" }}>
        <div style={{ background: COLORS.pineDark, color: COLORS.white, padding: "14px 16px", borderRadius: "16px 16px 0 0", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'Fraunces', serif", fontSize: 18, fontWeight: 600 }}>
            <CalendarDays size={17} strokeWidth={2.2} /> Calendario
          </div>
          <span onClick={onCerrar} style={{ cursor: "pointer", fontSize: 20 }}>×</span>
        </div>

        <div style={{ padding: "14px 16px 18px 16px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
            <span onClick={irMesAnterior} style={flechaMesStyle}><ChevronLeft size={16} strokeWidth={2.4} /></span>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14.5, fontWeight: 700, color: COLORS.pineDark, textTransform: "capitalize" }}>
              {nombreMesTexto}
            </div>
            <span onClick={irMesSiguiente} style={flechaMesStyle}><ChevronRight size={16} strokeWidth={2.4} /></span>
          </div>

          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 12, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10.5, color: COLORS.inkSoft }}>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: COLORS.ochre, display: "inline-block" }} /> No trabajado
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, border: `2px solid ${COLORS.pine}`, display: "inline-block", boxSizing: "border-box" }} /> Seleccionado
            </span>
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 5, height: 5, borderRadius: "50%", background: COLORS.pine, display: "inline-block" }} /> Día de clase
            </span>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {DIAS_SEMANA.map((d) => (
              <div key={d.code} style={{ textAlign: "center", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10.5, fontWeight: 700, color: COLORS.inkSoft, paddingBottom: 4 }}>
                {d.label}
              </div>
            ))}

            {celdas.map((dia, i) => {
              if (dia == null) return <div key={`vacio-${i}`} />;
              const fechaCelda = fechaISOdesdeAnioMesDia(anio, mes, dia);
              const registro = diasCurso[fechaCelda];
              const marcado = !!(registro && registro.motivo);
              const esSeleccionado = fechaCelda === fechaInicial;
              const esHoy = fechaCelda === hoy;
              const codigoSemana = DIAS_SEMANA[new Date(anio, mes, dia).getDay()].code;
              const esDiaConfigurado = tieneDiaConfigurado(diasClaseConfig, codigoSemana);
              const filaIndex = Math.floor(i / 7);
              const mostrarArriba = filaIndex >= totalFilas - 2;

              return (
                <div key={fechaCelda} style={{ position: "relative" }}>
                  <div
                    onClick={() => tocarCelda(fechaCelda, marcado)}
                    style={{
                      aspectRatio: "1", display: "flex", alignItems: "center", justifyContent: "center",
                      borderRadius: 8, cursor: "pointer", position: "relative",
                      background: marcado ? COLORS.ochre : (esHoy ? COLORS.paperDim : COLORS.white),
                      border: esSeleccionado ? `2px solid ${COLORS.pine}` : `1px solid ${marcado ? COLORS.ochre : COLORS.line}`,
                      color: marcado ? COLORS.white : COLORS.ink,
                      fontFamily: "'IBM Plex Mono', monospace", fontSize: 12.5, fontWeight: marcado ? 700 : 500,
                    }}
                  >
                    {dia}
                    {esDiaConfigurado && !marcado && (
                      <span style={{ position: "absolute", bottom: 3, width: 4, height: 4, borderRadius: "50%", background: COLORS.pine }} />
                    )}
                  </div>

                  {popoverFecha === fechaCelda && (
                    <div
                      style={{
                        position: "absolute", zIndex: 85, left: "50%", transform: "translateX(-50%)",
                        [mostrarArriba ? "bottom" : "top"]: "112%",
                        width: 186, background: COLORS.paperDim, border: `1px solid ${COLORS.line}`, borderRadius: 10,
                        padding: "10px 12px", boxShadow: "0 6px 20px rgba(21,53,49,0.22)",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: -3, marginRight: -4 }}>
                        <span onClick={() => setPopoverFecha(null)} style={{ cursor: "pointer", fontSize: 15, color: COLORS.inkSoft, lineHeight: 1 }}>×</span>
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 700, color: COLORS.pineDark, marginBottom: 4 }}>
                        Día marcado como no trabajado
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, color: COLORS.inkSoft, marginBottom: 9, wordBreak: "break-word" }}>
                        {registro.motivo}
                      </div>
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                        <span onClick={() => onEditarDia(fechaCelda)} style={{ ...chipBase, background: COLORS.pine, color: COLORS.white }}>Editar</span>
                        <span onClick={() => setConfirmarQuitarFecha(fechaCelda)} style={{ ...chipBase, background: COLORS.rose, color: COLORS.white }}>Quitar marca</span>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {confirmarQuitarFecha && (
        <ModalConfirmacion
          titulo="Quitar marca de día no trabajado"
          texto={`¿Confirmás que querés quitar la marca de "día no trabajado" del ${formatFechaLarga(confirmarQuitarFecha)}? El motivo cargado se va a borrar (aunque las marcas de asistencia previas, si había, no se pierden).`}
          botones={[
            <span
              key="si"
              onClick={() => { onQuitarDia(confirmarQuitarFecha); setConfirmarQuitarFecha(null); setPopoverFecha(null); }}
              style={{ ...chipBase, color: COLORS.white, background: COLORS.rose, padding: "8px 14px" }}
            >
              Sí, quitar
            </span>,
            <span key="no" onClick={() => setConfirmarQuitarFecha(null)} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim, padding: "8px 14px" }}>
              Cancelar
            </span>,
          ]}
        />
      )}
    </div>
  );
}

function PantallaAsistencia({ curso, alumnos, diasCurso, diasClaseConfig, onAlternarCelda, onSetMotivo, onSetDiasClase, onCerrar, tourVisto, onMarcarTourVisto }) {
  const [fecha, setFecha] = useState(hoyISO());
  const [motivoAbierto, setMotivoAbierto] = useState(false);
  const [borradorMotivo, setBorradorMotivo] = useState("");
  const [pendienteCelda, setPendienteCelda] = useState(null); // { alumnoId }
  const [autorizadoEdicionPasada, setAutorizadoEdicionPasada] = useState(false);
  const [confirmarSobrescribir, setConfirmarSobrescribir] = useState(false);
  const [calendarioAbierto, setCalendarioAbierto] = useState(false);
  const [tourActivo, setTourActivo] = useState(!tourVisto);
  const refFecha = useRef(null);
  const refMotivo = useRef(null);
  const refCelda = useRef(null);
  const refCalendario = useRef(null);

  const pasos = [
    { titulo: "Tomar asistencia", texto: "Por defecto es el día de hoy. Usá las flechas para ir al día anterior o siguiente, o tocá la fecha para elegir cualquier día del calendario.", ref: refFecha },
    { titulo: "Día no trabajado", texto: "Si no hubo clase (licencia, artículo, etc.), marcalo aquí y detallá el motivo. Ese día se pinta gris y no cuenta para el % de asistencia.", ref: refMotivo },
    { titulo: "Marcar a cada alumno", texto: "Tocá el casillero de un alumno para ir alternando: presente (blanco) → ausente (rojo, A) → tardanza (naranja, T) → justificado (celeste, J).", ref: refCelda },
    { titulo: "Calendario del mes", texto: "Acá ves el mes completo: los días pintados de naranja son los marcados como no trabajado. Tocá uno para ver el motivo, editarlo o quitar la marca.", ref: refCalendario },
  ];

  const hoy = hoyISO();
  const esPasado = fecha < hoy;
  const diaActual = diasCurso[fecha] || { motivo: null, marcas: {} };
  const noTrabajado = !!diaActual.motivo;
  const diaSemana = codigoDiaSemana(fecha);
  const esDiaConfigurado = tieneDiaConfigurado(diasClaseConfig, diaSemana);

  function intentarAlternar(alumnoId) {
    if (noTrabajado) return;
    if (esPasado && !autorizadoEdicionPasada) { setPendienteCelda({ alumnoId }); return; }
    onAlternarCelda(fecha, alumnoId);
  }
  function confirmarEdicionPasada() {
    setAutorizadoEdicionPasada(true);
    if (pendienteCelda) onAlternarCelda(fecha, pendienteCelda.alumnoId);
    setPendienteCelda(null);
  }
  function abrirMotivo() {
    setBorradorMotivo(diaActual.motivo || "");
    setMotivoAbierto(true);
  }
  function onTocarBotonMotivo() {
    if (noTrabajado) { abrirMotivo(); return; }
    const hayMarcas = Object.values(diaActual.marcas || {}).some((v) => v);
    if (hayMarcas) { setConfirmarSobrescribir(true); return; }
    abrirMotivo();
  }
  function confirmarMotivo() {
    onSetMotivo(fecha, borradorMotivo.trim());
    setMotivoAbierto(false);
  }
  function quitarMotivo() {
    onSetMotivo(fecha, null);
    setMotivoAbierto(false);
  }
  // Editar el motivo de un día desde el cartel del calendario mensual:
  // llevamos ese día a la fecha activa y abrimos el mismo modal de
  // motivo que se usa desde el botón principal, ya precargado.
  function editarDesdeCalendario(f) {
    const dia = diasCurso[f] || { motivo: null, marcas: {} };
    setFecha(f);
    setBorradorMotivo(dia.motivo || "");
    setMotivoAbierto(true);
    setCalendarioAbierto(false);
  }

  const flechaBtnStyle = {
    width: 34, height: 34, borderRadius: 10, border: `1px solid ${COLORS.line}`, background: COLORS.white,
    color: COLORS.pineDark, display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer", flexShrink: 0,
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: COLORS.paper, zIndex: 70, display: "flex", flexDirection: "column" }}>
      <div style={{ background: COLORS.pineDark, color: COLORS.white, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600 }}>
            <ClipboardCheck size={18} strokeWidth={2.2} /> Asistencia
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BotonMenuAyuda onAyuda={() => setTourActivo(true)} />
            <span onClick={onCerrar} style={{ cursor: "pointer", fontSize: 20 }}>×</span>
          </div>
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ochreSoft, marginTop: 4 }}>
          {curso.nombre}
        </div>
      </div>

      <div ref={refFecha} style={{ padding: "12px 14px", borderBottom: `1px solid ${COLORS.line}`, background: COLORS.white }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <span onClick={() => setFecha(sumarDiasFecha(fecha, -1))} style={flechaBtnStyle}><ChevronLeft size={18} strokeWidth={2.4} /></span>
          <div style={{ flex: 1, textAlign: "center", minWidth: 0 }}>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 700, color: COLORS.pineDark, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {formatFechaLarga(fecha)}
            </div>
            {esDiaConfigurado && (
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10.5, fontWeight: 600, color: COLORS.ochre, marginTop: 1 }}>
                ● día de clase configurado
              </div>
            )}
            <input
              type="date" value={fecha} onChange={(e) => e.target.value && setFecha(e.target.value)}
              style={{ marginTop: 3, border: "none", background: "transparent", fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: COLORS.inkSoft }}
            />
          </div>
          <span onClick={() => setFecha(sumarDiasFecha(fecha, 1))} style={flechaBtnStyle}><ChevronRight size={18} strokeWidth={2.4} /></span>
        </div>

        <div style={{ marginTop: 10 }}>
          <button
            ref={refMotivo}
            onClick={onTocarBotonMotivo}
            style={{
              width: "100%", padding: "8px", borderRadius: 10, cursor: "pointer",
              border: `1px solid ${COLORS.ochre}`, background: noTrabajado ? COLORS.ochre : COLORS.ochreSoft,
              color: noTrabajado ? COLORS.white : COLORS.pineDark, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600,
            }}
          >
            {noTrabajado ? `Día no trabajado: ${diaActual.motivo} (tocar para editar)` : "Marcar día no trabajado"}
          </button>
        </div>

        <button
          ref={refCalendario}
          onClick={() => setCalendarioAbierto(true)}
          style={{
            marginTop: 8, width: "100%", padding: "8px", borderRadius: 10, cursor: "pointer",
            border: `1px solid ${COLORS.pine}`, background: COLORS.white, color: COLORS.pineDark,
            fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600,
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
          }}
        >
          <CalendarDays size={14} strokeWidth={2.2} /> Ver calendario del mes
        </button>

        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, color: COLORS.inkSoft, marginTop: 6, textAlign: "center" }}>
          El horario de este curso se carga desde "Mi horario".
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "10px 12px 24px 12px" }}>
        {noTrabajado ? (
          <div style={{ background: COLORS.paperDim, borderRadius: 14, textAlign: "center", padding: "26px 16px" }}>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.pineDark, fontWeight: 700 }}>
              Día marcado como no trabajado
            </div>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, marginTop: 6, wordBreak: "break-word" }}>
              {diaActual.motivo}
            </div>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, color: COLORS.inkSoft, fontStyle: "italic", marginTop: 12 }}>
              No se puede tomar asistencia.
            </div>
          </div>
        ) : alumnos.length === 0 ? (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, fontStyle: "italic", textAlign: "center", padding: "30px 10px" }}>
            Este curso todavía no tiene alumnos cargados.
          </div>
        ) : (
          <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 14, overflow: "hidden", background: COLORS.white, boxShadow: "0 1px 3px rgba(21,53,49,0.06)" }}>
            {alumnos.map((al, i) => (
              <div key={al.id} ref={i === 0 ? refCelda : null}>
                <FilaAsistencia
                  alumno={al}
                  estado={(diaActual.marcas || {})[al.id] || ""}
                  onTocar={() => intentarAlternar(al.id)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {pendienteCelda && (
        <ModalConfirmacion
          titulo="Editar un día anterior"
          texto={`Estás por cambiar la asistencia del ${formatFechaLarga(fecha)}, un día anterior a hoy. ¿Confirmás el cambio? Mientras tengas esta pantalla abierta, no te lo vamos a volver a preguntar para otros días anteriores.`}
          botones={[
            <span key="si" onClick={confirmarEdicionPasada} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine, padding: "8px 14px" }}>Sí, confirmar</span>,
            <span key="no" onClick={() => setPendienteCelda(null)} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim, padding: "8px 14px" }}>Cancelar</span>,
          ]}
        />
      )}

      {confirmarSobrescribir && (
        <ModalConfirmacion
          titulo="Ya hay asistencia cargada"
          texto="Este día ya tiene marcas cargadas. Si lo marcás como no trabajado, se van a ignorar para el cálculo (pero no se borran: si después quitás la marca, reaparecen). ¿Continuar?"
          botones={[
            <span key="si" onClick={() => { setConfirmarSobrescribir(false); abrirMotivo(); }} style={{ ...chipBase, color: COLORS.white, background: COLORS.rose, padding: "8px 14px" }}>Sí, continuar</span>,
            <span key="no" onClick={() => setConfirmarSobrescribir(false)} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim, padding: "8px 14px" }}>Cancelar</span>,
          ]}
        />
      )}

      {motivoAbierto && (
        <ModalConfirmacion titulo="Día no trabajado" texto="Detallá el motivo (licencia, artículo utilizado, etc.).">
          <textarea
            value={borradorMotivo}
            onChange={(e) => setBorradorMotivo(e.target.value)}
            placeholder="Motivo…"
            rows={3}
            autoFocus
            style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "8px 10px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, resize: "vertical" }}
          />
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <span onClick={confirmarMotivo} style={{ ...chipBase, color: COLORS.white, background: COLORS.pine, padding: "8px 14px" }}>Guardar</span>
            {noTrabajado && <span onClick={quitarMotivo} style={{ ...chipBase, color: COLORS.white, background: COLORS.rose, padding: "8px 14px" }}>Quitar marca</span>}
            <span onClick={() => setMotivoAbierto(false)} style={{ ...chipBase, color: COLORS.inkSoft, background: COLORS.paperDim, padding: "8px 14px" }}>Cancelar</span>
          </div>
        </ModalConfirmacion>
      )}

      {tourActivo && (
        <TourGuiado pasos={pasos} onCerrar={() => { setTourActivo(false); onMarcarTourVisto(); }} />
      )}

      {calendarioAbierto && (
        <CalendarioAsistencia
          fechaInicial={fecha}
          diasCurso={diasCurso}
          diasClaseConfig={diasClaseConfig}
          onSeleccionarFecha={(f) => { setFecha(f); setCalendarioAbierto(false); }}
          onEditarDia={editarDesdeCalendario}
          onQuitarDia={(f) => onSetMotivo(f, null)}
          onCerrar={() => setCalendarioAbierto(false)}
        />
      )}

      <BotonVolverFlotante onVolver={onCerrar} zIndex={75} />
    </div>
  );
}

function PantallaRecuperatorio({ instancia, curso, alumnos, notaAprobacion, onCambiarNotaRecuperatorio, onCerrar, tourVisto, onMarcarTourVisto }) {
  const esDiciembre = instancia === "diciembre";
  const alumnosFiltrados = alumnos.filter((a) => (esDiciembre ? estaEnListaDiciembre(a, notaAprobacion) : estaEnListaFebrero(a, notaAprobacion)));
  const [tourActivo, setTourActivo] = useState(!tourVisto);
  const refFila = useRef(null);

  const pasos = esDiciembre
    ? [
        { titulo: "Diciembre: respaldo permanente", texto: "Aquí aparece, y se queda, todo alumno con la materia desaprobada al terminar el año. Es un registro fijo: no desaparece aunque después apruebe." },
        { titulo: "Ausente o nota", texto: "Tocá \"Aus\" si el alumno no se presentó a rendir, o cargá la nota directamente. Ambas opciones son excluyentes entre sí.", ref: refFila },
      ]
    : [
        { titulo: "Febrero", texto: "Aquí aparecen solo quienes desaprobaron Diciembre o estuvieron ausentes ahí. Si el alumno estuvo ausente en Diciembre, lo vas a ver aclarado junto al nombre." },
        { titulo: "Aprobar o quedar previa", texto: "Cargá la nota, o tocá \"Aus\" si no se presenta (queda previa directamente). La celda se pinta verde o roja según el resultado.", ref: refFila },
      ];

  return (
    <div style={{ position: "fixed", inset: 0, background: COLORS.paper, zIndex: 60, display: "flex", flexDirection: "column" }}>
      <div style={{ background: COLORS.pineDark, color: COLORS.white, padding: "16px 18px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600 }}>
            <ClipboardList size={18} strokeWidth={2.2} /> Recuperatorio {esDiciembre ? "Diciembre" : "Febrero"}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <BotonMenuAyuda onAyuda={() => setTourActivo(true)} />
            <span onClick={onCerrar} style={{ cursor: "pointer", fontSize: 20 }}>×</span>
          </div>
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ochreSoft, marginTop: 4 }}>
          {curso.nombre} · {esDiciembre
            ? "respaldo permanente de quienes desaprobaron el año: marcá Ausente o cargá la nota de cada uno."
            : "quienes desaprobaron Diciembre o estuvieron ausentes. Si aprueban acá, aprueban la materia; si no, queda previa."}
        </div>
      </div>

      <div style={{ flex: 1, overflowY: "auto", padding: "12px 12px 24px 12px" }}>
        {notaAprobacion == null ? (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, fontStyle: "italic", textAlign: "center", padding: "30px 10px" }}>
            Todavía no definiste la nota mínima de aprobación. Cargá alguna nota numérica en la Ficha de un alumno para que te la pida.
          </div>
        ) : alumnosFiltrados.length === 0 ? (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, fontStyle: "italic", textAlign: "center", padding: "30px 10px" }}>
            {esDiciembre ? "Nadie con la materia desaprobada por ahora." : "Nadie pendiente para Febrero por ahora."}
          </div>
        ) : (
          <div style={{ border: `1px solid ${COLORS.line}`, borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 3px rgba(21,53,49,0.06)" }}>
            {alumnosFiltrados.map((al, i) => (
              <div key={al.id} ref={i === 0 ? refFila : null}>
                {esDiciembre ? (
                  <FilaDiciembre
                    alumno={al}
                    notaAprobacion={notaAprobacion}
                    onCambiar={(valor) => onCambiarNotaRecuperatorio(al.id, instancia, valor)}
                  />
                ) : (
                  <FilaFebrero
                    alumno={al}
                    notaAprobacion={notaAprobacion}
                    onCambiar={(valor) => onCambiarNotaRecuperatorio(al.id, instancia, valor)}
                  />
                )}
              </div>
            ))}
            <ResumenRecuperatorio resumen={calcularResumenRecuperatorio(alumnosFiltrados, esDiciembre, notaAprobacion)} />
          </div>
        )}
      </div>

      {tourActivo && (
        <TourGuiado pasos={pasos} onCerrar={() => { setTourActivo(false); onMarcarTourVisto(); }} />
      )}

      <BotonVolverFlotante onVolver={onCerrar} zIndex={65} />
    </div>
  );
}

function PantallaPlanillaNotas({ colegio, curso, alumnos, notaAprobacion, onCambiarNotaOficial, nombresColumnasPorColegio, onRenombrarColumnaNota, onCerrar, tourVisto, onMarcarTourVisto, promedioAuto, onTogglePromedioAuto }) {
  const [pendiente, setPendiente] = useState(null); // { alumnoId, alumnoNombre, campo, columnaLabel, valorAnterior, valorNuevo }
  const [renombrando, setRenombrando] = useState(null); // { key, label } — modal de texto abierto
  const [pendienteRenombre, setPendienteRenombre] = useState(null); // { key, labelNuevo } — falta elegir alcance
  const [tourActivo, setTourActivo] = useState(!tourVisto);
  const [modoEdicion, setModoEdicion] = useState(false);
  const refGrilla = useRef(null);
  const refNota = useRef(null);
  const refPrimeraColumna = useRef(null);
  const refDescargar = useRef(null);

  const columnas = resolverColumnasNotas(colegio.id, nombresColumnasPorColegio);

  const pasos = [
    { titulo: "Planilla oficial del curso", texto: "Es la misma tabla de 7 columnas que ves en la Ficha de cada alumno, pero de todo el curso junto. Se arma sola con lo que vas cargando.", ref: refGrilla },
    { titulo: "Corregir una celda", texto: "Tocá \"Editar\" arriba para habilitar la edición. Con eso activo, tocá cualquier celda para corregirla; te va a pedir confirmación antes de guardar el cambio. Tocá \"Listo\" para volver a bloquear la planilla.", ref: refNota },
    { titulo: "Renombrar un encabezado", texto: "Mantené presionado cualquier encabezado (por ejemplo, éste) para cambiarle el nombre, como \"1° bim\" en vez de \"1° inf\". Te va a preguntar si el nuevo nombre aplica solo a este colegio o a todos.", ref: refPrimeraColumna },
    { titulo: "Descargar la planilla", texto: "Bajá la planilla completa, con todos los alumnos y sus notas, en un documento Word listo para imprimir o archivar.", ref: refDescargar },
  ];

  const esEscritorio = useEsEscritorio();
  const anchoNombre = esEscritorio ? 190 : 150;
  const anchoColumna = esEscritorio ? 76 : 62;

  function confirmarNuevoNombre(labelNuevo) {
    const key = renombrando.key;
    const limpio = labelNuevo.trim();
    setRenombrando(null);
    if (!limpio || limpio === renombrando.label) return;
    setPendienteRenombre({ key, labelNuevo: limpio });
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: COLORS.paper, zIndex: 65, display: "flex", flexDirection: "column" }}>
      <div style={{ background: COLORS.pineDark, color: COLORS.white, padding: "10px 18px 12px 18px", position: "relative" }}>
        <div style={{ position: "absolute", top: 8, right: 12 }}>
          <BotonMenuAyuda onAyuda={() => setTourActivo(true)} />
        </div>
        <div style={{ display: "flex", alignItems: "baseline", flexWrap: "wrap", gap: "3px 6px", paddingRight: 26 }}>
          <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ochreSoft }}>{colegio.nombre}</span>
          <span style={{ color: COLORS.ochreSoft, fontSize: 13 }}>·</span>
          <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, fontWeight: 700, color: COLORS.white }}>{curso.nombre}</span>
          <span style={{ color: COLORS.ochreSoft, fontSize: 13 }}>·</span>
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: COLORS.white }}>Planilla de Calificaciones</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "8px 10px", marginTop: 10 }}>
          <div
            onClick={onTogglePromedioAuto}
            style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", width: "fit-content" }}
          >
            <div style={{
              width: 34, height: 19, borderRadius: 999, background: promedioAuto ? COLORS.ochre : "rgba(255,255,255,0.25)",
              position: "relative", transition: "background 0.15s", flexShrink: 0,
            }}>
              <div style={{
                position: "absolute", top: 2, left: promedioAuto ? 17 : 2, width: 15, height: 15, borderRadius: "50%",
                background: COLORS.white, transition: "left 0.15s",
              }} />
            </div>
            <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, color: COLORS.white }}>
              Cálculo de promedio
            </span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
            <button
              onClick={() => setModoEdicion((v) => !v)}
              style={{
                display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 10,
                border: modoEdicion ? "none" : `1px solid rgba(255,255,255,0.35)`,
                background: modoEdicion ? COLORS.ochre : "transparent",
                color: modoEdicion ? COLORS.pineDark : COLORS.white,
                fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 700, cursor: "pointer",
              }}
            >
              {modoEdicion ? "Listo" : "Editar"}
            </button>
            <button
              ref={refDescargar}
              onClick={() => {
                const html = construirHTMLPlanillaCompleta({ colegio, curso, alumnos, columnas, notaAprobacion, promedioAuto });
                generarWordInformes(html, `Planilla de ${curso.nombre}; ${colegio.nombre}`.replace(/[^\w\-; ]/g, ""));
              }}
              style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 10, border: `1px solid rgba(255,255,255,0.35)`, background: "transparent", color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              <Printer size={14} strokeWidth={2.4} /> Descargar planilla
            </button>
          </div>
        </div>
      </div>

      <div ref={refGrilla} style={{ flex: 1, overflow: "auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: `${anchoNombre}px repeat(7, ${anchoColumna}px)`, width: "fit-content" }}>
          <div style={{ position: "sticky", left: 0, zIndex: 3, background: COLORS.pineDark, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, fontWeight: 700, padding: "6px 8px", display: "flex", alignItems: "center" }}>
            Alumno
          </div>
          {columnas.map((c, idx) => (
            <EncabezadoColumnaEditable
              key={c.key + "-h"}
              columna={c}
              refAdicional={c.tipo === "nota" ? refNota : (idx === 0 ? refPrimeraColumna : null)}
              onAbrirRenombrar={(col) => setRenombrando({ key: col.key, label: col.label })}
            />
          ))}

          {alumnos.map((al, i) => {
            const { valores, calculadas } = notasConPromedios(al.notasOficiales, promedioAuto);
            return (
            <React.Fragment key={al.id}>
              <div
                style={{
                  position: "sticky", left: 0, zIndex: 2, background: COLORS.white, borderTop: `1px solid ${COLORS.line}`, borderRight: `1px solid ${COLORS.line}`,
                  padding: "7px 8px", display: "flex", alignItems: "center", gap: 4, minWidth: 0,
                }}
              >
                <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 10.5, color: COLORS.inkSoft, flexShrink: 0 }}>{i + 1}.</span>
                <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 700, color: al.genero === "M" ? COLORS.nombreM : COLORS.nombreF, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {al.nombre}
                </span>
              </div>
              {columnas.map((c) => (
                <CeldaNotaOficial
                  key={al.id + "-" + c.key}
                  valor={valores[c.key] || ""}
                  calculado={calculadas.has(c.key)}
                  tipo={c.tipo}
                  notaAprobacion={notaAprobacion}
                  soloLectura={!modoEdicion}
                  onIntentarCambiar={(valorNuevo) => setPendiente({
                    alumnoId: al.id, alumnoNombre: al.nombre, campo: c.key, columnaLabel: c.label,
                    valorAnterior: (al.notasOficiales && al.notasOficiales[c.key]) || "(vacío)",
                    valorNuevo: valorNuevo || "(vacío)",
                  })}
                />
              ))}
            </React.Fragment>
            );
          })}
        </div>
      </div>

      <BotonVolverFlotante onVolver={onCerrar} zIndex={70} />

      {tourActivo && (
        <TourGuiado pasos={pasos} onCerrar={() => { setTourActivo(false); onMarcarTourVisto(); }} />
      )}

      {pendiente && (
        <ModalConfirmacion
          titulo="Confirmar corrección"
          texto={`${pendiente.alumnoNombre} · ${pendiente.columnaLabel}: "${pendiente.valorAnterior}" → "${pendiente.valorNuevo}". Se actualiza también en la ficha del alumno.`}
          botones={
            <>
              <button onClick={() => setPendiente(null)} style={{ padding: "9px 14px", borderRadius: 999, border: `1px solid ${COLORS.line}`, background: COLORS.white, color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Cancelar</button>
              <button
                onClick={() => { onCambiarNotaOficial(pendiente.alumnoId, pendiente.campo, pendiente.valorNuevo === "(vacío)" ? "" : pendiente.valorNuevo); setPendiente(null); }}
                style={{ padding: "9px 14px", borderRadius: 999, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
              >Confirmar</button>
            </>
          }
        />
      )}

      {renombrando && (
        <ModalRenombrarColumna
          etiquetaActual={renombrando.label}
          onCancelar={() => setRenombrando(null)}
          onGuardar={confirmarNuevoNombre}
        />
      )}

      {pendienteRenombre && (
        <BannerConfirmarColegios
          onNo={() => { onRenombrarColumnaNota(colegio.id, pendienteRenombre.key, pendienteRenombre.labelNuevo, false); setPendienteRenombre(null); }}
          onSi={() => { onRenombrarColumnaNota(colegio.id, pendienteRenombre.key, pendienteRenombre.labelNuevo, true); setPendienteRenombre(null); }}
        />
      )}
    </div>
  );
}

// ================================================================
// INFORMES PARA TUTORES — genera un documento (PDF vía impresión del
// navegador, o Word vía descarga .doc) con el informe individual y
// completo de cada alumno tildado. Cada bloque es autocontenido
// (alumno, escuela, curso, materia, fecha) porque se entrega por
// separado a cada tutor. Apunta a 2 informes por hoja A4, sin cortar
// contenido nunca: si un alumno tiene mucho historial, ocupa más
// espacio y entran menos en esa hoja.
// ================================================================
function escapeHtml(str) {
  return String(str == null ? "" : str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fechaEmisionHoy() {
  const d = new Date();
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}/${mm}/${d.getFullYear()}`;
}

const CLAVES_NOTAS_POR_PERIODO = { "1": ["inf1c1", "inf2c1", "cuat1"], "2": ["inf1c2", "inf2c2", "cuat2"] };
function columnasNotasDelPeriodo(columnas, periodo) {
  const claves = CLAVES_NOTAS_POR_PERIODO[periodo] || [];
  return columnas.filter((c) => claves.includes(c.key));
}

// Historial completo (registro por registro, con fecha) de un criterio
// para un alumno y período dados, ya como HTML listo para imprimir.
function historialCriterioHTML(alumno, criterio, periodo, instancias, notaAprobacion) {
  const evs = eventosDeCriterio(alumno, criterio.id, periodo);
  if (!evs.length) return `<div class="muted">Sin registros</div>`;
  return evs.map((ev) => {
    let etiqueta = "";
    let valorTexto = escapeHtml(String(ev.valor));
    const esNumerico = criterio.tipo === "numerico" || criterio.tipo === "numerico_instancias";
    if (criterio.tipo === "numerico_instancias") {
      const inst = (instancias || []).find((i) => i.id === ev.instanciaId);
      etiqueta = inst ? `${escapeHtml(inst.nombre)}: ` : "";
    }
    if (esNumerico) {
      valorTexto = `<span style="color:${colorNota(ev.valor, notaAprobacion)};font-weight:700;">${valorTexto}</span>`;
      if (ev.recuperatorio) {
        valorTexto += ` / R: <span style="color:${colorNota(ev.recuperatorio.valor, notaAprobacion)};font-weight:700;">${escapeHtml(String(ev.recuperatorio.valor))}</span>`;
      }
    }
    return `<div class="registro"><span class="registro-fecha">${fechaCorta(ev.fecha)}</span> ${etiqueta}${valorTexto}</div>`;
  }).join("");
}

// Asistencia acumulada a la fecha de emisión (no está separada por
// cuatrimestre en los datos, así que se muestra siempre como un único
// total acumulado, sin importar qué cuatrimestre(s) se estén imprimiendo).
function resumenAsistenciaTexto(alumno, diasCurso) {
  const r = calcularAsistenciaAlumno(alumno, diasCurso);
  if (r.porcentaje == null) return "Sin clases registradas todavía";
  const partes = [];
  if (r.a) partes.push(`${r.a} falta${r.a === 1 ? "" : "s"}`);
  if (r.t) partes.push(`${r.t} tarde${r.t === 1 ? "" : "s"}`);
  if (r.j) partes.push(`${r.j} falta${r.j === 1 ? "" : "s"} justificada${r.j === 1 ? "" : "s"}`);
  return `${r.porcentaje}%` + (partes.length ? ` · ${partes.join(", ")}` : " · sin faltas");
}

function construirBloqueAlumnoHTML({ alumno, colegio, curso, cuatrimestres, criteriosSeleccionados, incluirNotasOficiales, columnasNotas, notaAprobacion, instanciasPorCriterio, diasCurso, fechaEmision, promedioAuto }) {
  const criteriosSeguimiento = criteriosSeleccionados.filter((c) => c.tipo !== "asistencia");
  const incluyeAsistencia = criteriosSeleccionados.some((c) => c.tipo === "asistencia");
  const { valores: notasFinales, calculadas } = notasConPromedios(alumno.notasOficiales, promedioAuto);

  const celdas = cuatrimestres.map((periodo) => {
    let interno = "";
    if (incluirNotasOficiales) {
      const cols = columnasNotasDelPeriodo(columnasNotas, periodo);
      if (cols.length) {
        const encabezados = cols.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");
        const valores = cols.map((c) => {
          const valor = notasFinales[c.key] || "";
          if (!valor) return `<td class="muted">—</td>`;
          const sufijo = calculadas.has(c.key) ? ` <span class="prom-marca">(prom.)</span>` : "";
          return `<td style="color:${colorNota(valor, notaAprobacion)};font-weight:700;">${escapeHtml(valor)}${sufijo}</td>`;
        }).join("");
        interno += `<div class="bloque-item"><div class="criterio-nombre">Planilla de Calificaciones</div>
          <table class="tabla-notas-oficiales"><tr>${encabezados}</tr><tr>${valores}</tr></table></div>`;
      }
    }
    criteriosSeguimiento.forEach((crit) => {
      interno += `<div class="bloque-item"><div class="criterio-nombre">${escapeHtml(crit.nombre)}</div>${historialCriterioHTML(alumno, crit, periodo, instanciasPorCriterio[crit.id], notaAprobacion)}</div>`;
    });
    return `<td class="columna">
      <div class="columna-titulo">${periodo}° cuatrimestre</div>
      ${interno || '<div class="muted">Sin datos seleccionados</div>'}
    </td>`;
  });

  let notaFinalHTML = "";
  if (incluirNotasOficiales && cuatrimestres.length === 2) {
    const valor = notasFinales.nota || "";
    const colNota = columnasNotas.find((c) => c.key === "nota");
    if (valor) {
      const sufijo = calculadas.has("nota") ? " <i>(promedio sugerido)</i>" : "";
      notaFinalHTML = `<div class="nota-final">${escapeHtml(colNota ? colNota.label : "Nota final")}: <span style="color:${colorNota(valor, notaAprobacion)};font-weight:700;">${escapeHtml(valor)}</span>${sufijo}</div>`;
    }
  }

  const asistenciaHTML = incluyeAsistencia
    ? `<div class="asistencia-linea"><b>Asistencia al ${fechaEmision}:</b> ${resumenAsistenciaTexto(alumno, diasCurso)}</div>`
    : "";

  return `<div class="bloque-alumno">
    <div class="bloque-header">
      <div>
        <div class="alumno-nombre">${escapeHtml(alumno.nombre)}</div>
        <div class="bloque-meta">${escapeHtml(colegio.nombre)} · ${escapeHtml(curso.nombre)}${curso.materia ? " · " + escapeHtml(curso.materia) : ""}</div>
      </div>
      <div class="bloque-fecha">Emitido<br/>${fechaEmision}</div>
    </div>
    <table class="tabla-columnas"><tr>${celdas.join("")}</tr></table>
    ${notaFinalHTML}
    ${asistenciaHTML}
  </div>`;
}

// PLANILLA DE CALIFICACIONES COMPLETA — genera un documento Word con la
// grilla entera del curso (todos los alumnos, las 7 columnas oficiales),
// tal como se ve en PantallaPlanillaNotas, lista para imprimir o archivar.
function construirHTMLPlanillaCompleta({ colegio, curso, alumnos, columnas, notaAprobacion, promedioAuto }) {
  const fechaEmision = fechaEmisionHoy();
  const encabezados = columnas.map((c) => `<th>${escapeHtml(c.label)}</th>`).join("");

  const filas = alumnos.map((al, i) => {
    const { valores } = notasConPromedios(al.notasOficiales, promedioAuto);
    const celdas = columnas.map((c) => {
      const valor = valores[c.key] || "";
      if (!valor) return `<td class="celda-vacia">—</td>`;
      if (esMarcaAusente(valor)) return `<td style="color:${COLORS.notaRoja};font-weight:700;">Aus</td>`;
      const color = c.tipo === "nota" ? colorNota(valor, notaAprobacion) : COLORS.ink;
      const negrita = c.tipo === "nota" ? 700 : 400;
      return `<td style="color:${color};font-weight:${negrita};">${escapeHtml(valor)}</td>`;
    }).join("");
    return `<tr><td class="col-num">${i + 1}</td><td class="col-nombre">${escapeHtml(al.nombre)}</td>${celdas}</tr>`;
  }).join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Planilla de ${escapeHtml(curso.nombre)}; ${escapeHtml(colegio.nombre)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm; }
  body { font-family: Arial, sans-serif; color: ${COLORS.ink}; }
  h1 { font-size: 15pt; margin: 0 0 2px 0; }
  .meta { font-size: 10pt; color: ${COLORS.inkSoft}; margin-bottom: 14px; }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid ${COLORS.line}; padding: 5px 6px; font-size: 9.5pt; text-align: center; }
  th { background: ${COLORS.pineDark}; color: ${COLORS.white}; }
  .col-nombre { text-align: left; font-weight: 700; }
  .col-num { color: #999; font-size: 8.5pt; }
  .celda-vacia { color: #bbb; }
</style>
</head>
<body>
<h1>Planilla de Calificaciones</h1>
<div class="meta">${escapeHtml(colegio.nombre)} · ${escapeHtml(curso.nombre)}${curso.materia ? " · " + escapeHtml(curso.materia) : ""} · Emitido ${fechaEmision}</div>
<table>
<tr><th></th><th>Alumno</th>${encabezados}</tr>
${filas}
</table>
</body>
</html>`;
}

function construirHTMLInformes({ alumnosSeleccionados, colegio, curso, cuatrimestres, criteriosSeleccionados, incluirNotasOficiales, columnasNotas, notaAprobacion, instanciasPorCriterio, diasCurso, promedioAuto }) {
  const fechaEmision = fechaEmisionHoy();
  const bloques = alumnosSeleccionados.map((alumno) => construirBloqueAlumnoHTML({
    alumno, colegio, curso, cuatrimestres, criteriosSeleccionados, incluirNotasOficiales, columnasNotas, notaAprobacion, instanciasPorCriterio, diasCurso, fechaEmision, promedioAuto,
  })).join("\n");

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8" />
<title>Informe de ${escapeHtml(curso.nombre)}; ${escapeHtml(colegio.nombre)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: Calibri, Carlito, Arial, sans-serif; font-size: 11pt; color: #222; margin: 0; }
  .bloque-alumno { border: 1px solid #ccc; border-radius: 4px; padding: 10px 14px 12px 14px; margin-bottom: 12px; break-inside: avoid; page-break-inside: avoid; }
  .bloque-alumno:nth-of-type(2n) { page-break-after: always; break-after: page; }
  .bloque-alumno:last-of-type { page-break-after: auto; break-after: auto; }
  .bloque-header { display: flex; justify-content: space-between; align-items: baseline; border-bottom: 1px solid #ddd; padding-bottom: 6px; margin-bottom: 8px; }
  .alumno-nombre { font-size: 13pt; font-weight: 700; }
  .bloque-meta { color: #555; font-size: 10pt; }
  .bloque-fecha { color: #555; font-size: 9.5pt; text-align: right; }
  .tabla-columnas { width: 100%; border-collapse: collapse; }
  .tabla-columnas td.columna { vertical-align: top; padding: 0 8px; width: 50%; border-left: 1px solid #e2e2e2; }
  .tabla-columnas td.columna:first-child { border-left: none; padding-left: 0; }
  .tabla-notas-oficiales { border-collapse: collapse; margin-top: 3px; }
  .tabla-notas-oficiales th, .tabla-notas-oficiales td { border: 1px solid #ddd; padding: 3px 7px; font-size: 9.5pt; text-align: center; }
  .tabla-notas-oficiales th { background: #eee; color: #555; font-weight: 600; }
  .tabla-notas-oficiales td.muted { color: #999; font-style: italic; }
  .prom-marca { font-style: italic; font-weight: 400; font-size: 8.5pt; }
  .columna-titulo { font-weight: 700; color: #555; font-size: 10pt; margin-bottom: 4px; }
  .bloque-item { margin-bottom: 6px; }
  .criterio-nombre { font-weight: 600; }
  .registro { color: #444; font-size: 10pt; }
  .registro-fecha { color: #888; font-size: 9pt; margin-right: 3px; }
  .muted { color: #999; font-style: italic; }
  .nota-final { margin-top: 6px; font-weight: 700; }
  .asistencia-linea { margin-top: 6px; font-size: 10pt; }
</style>
</head>
<body>
${bloques}
</body>
</html>`;
}

function generarPDFInformes(html) {
  const w = window.open("", "_blank");
  if (!w) { alert("El navegador bloqueó la ventana de impresión. Habilitá los pop-ups para este sitio e intentá de nuevo."); return; }
  w.document.open();
  w.document.write(html);
  w.document.close();
  setTimeout(() => { w.focus(); w.print(); }, 350);
}

function generarWordInformes(html, nombreArchivo) {
  const blob = new Blob(["\ufeff", html], { type: "application/msword" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${nombreArchivo}.doc`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function ModalInformesTutores({ colegio, curso, alumnos, criteriosActivos, notaAprobacion, diasCurso, instanciasPorCriterio, nombresColumnasPorColegio, periodoActual, onCerrar, promedioAuto }) {
  const [seleccion, setSeleccion] = useState(() => new Set());
  const [cuat1, setCuat1] = useState(periodoActual !== "2");
  const [cuat2, setCuat2] = useState(periodoActual === "2");
  const [criteriosSel, setCriteriosSel] = useState(() => new Set(criteriosActivos.map((c) => c.id)));
  const [incluirNotas, setIncluirNotas] = useState(true);

  function alternarAlumno(id) {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function alternarTodos() {
    setSeleccion((prev) => (prev.size === alumnos.length ? new Set() : new Set(alumnos.map((a) => a.id))));
  }
  function alternarCriterio(id) {
    setCriteriosSel((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const cuatrimestres = [cuat1 ? "1" : null, cuat2 ? "2" : null].filter(Boolean);
  const puedeGenerar = seleccion.size > 0 && cuatrimestres.length > 0;

  function generar(formato) {
    if (!puedeGenerar) return;
    const alumnosSeleccionados = alumnos.filter((a) => seleccion.has(a.id));
    const criteriosSeleccionados = criteriosActivos.filter((c) => criteriosSel.has(c.id));
    const columnasNotas = resolverColumnasNotas(colegio.id, nombresColumnasPorColegio);
    const html = construirHTMLInformes({
      alumnosSeleccionados, colegio, curso, cuatrimestres, criteriosSeleccionados,
      incluirNotasOficiales: incluirNotas, columnasNotas, notaAprobacion, instanciasPorCriterio, diasCurso, promedioAuto,
    });
    if (formato === "pdf") generarPDFInformes(html);
    else generarWordInformes(html, `Informe de ${curso.nombre}; ${colegio.nombre}`.replace(/[^\w\-; ]/g, ""));
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(34,32,27,0.55)", display: "flex", alignItems: "flex-end", justifyContent: "center", zIndex: 96 }}>
      <div style={{ background: COLORS.white, borderRadius: "18px 18px 0 0", padding: 18, width: "100%", maxWidth: 480, maxHeight: "88vh", overflowY: "auto", boxShadow: "0 -8px 30px rgba(0,0,0,0.25)" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: COLORS.pineDark, marginBottom: 4 }}>
          Informes para imprimir
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.inkSoft, marginBottom: 14, lineHeight: 1.4 }}>
          Tildá los alumnos, elegí qué incluir y generá el documento.
        </div>

        <div style={etiquetaCampoStyle}>Alumnos</div>
        <div
          onClick={alternarTodos}
          style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 4px", cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, color: COLORS.pine }}
        >
          <input type="checkbox" readOnly checked={seleccion.size === alumnos.length && alumnos.length > 0} />
          {seleccion.size === alumnos.length ? "Destildar todos" : "Tildar todos"}
        </div>
        <div style={{ maxHeight: 160, overflowY: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "4px 8px", marginBottom: 14 }}>
          {alumnos.map((a) => (
            <div key={a.id} onClick={() => alternarAlumno(a.id)} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 2px", cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.ink }}>
              <input type="checkbox" readOnly checked={seleccion.has(a.id)} />
              {a.nombre}
            </div>
          ))}
          {alumnos.length === 0 && <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.inkSoft, padding: "4px 2px" }}>Este curso todavía no tiene alumnos.</div>}
        </div>

        <div style={etiquetaCampoStyle}>Cuatrimestre</div>
        <div style={{ display: "flex", gap: 14, marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={cuat1} onChange={() => setCuat1((v) => !v)} /> 1° cuatrimestre
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 6, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={cuat2} onChange={() => setCuat2((v) => !v)} /> 2° cuatrimestre
          </label>
        </div>

        <div style={etiquetaCampoStyle}>Qué incluir</div>
        <div style={{ marginBottom: 14 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.ink, cursor: "pointer" }}>
            <input type="checkbox" checked={incluirNotas} onChange={() => setIncluirNotas((v) => !v)} /> Planilla de Calificaciones
          </label>
          {criteriosActivos.map((c) => (
            <label key={c.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.ink, cursor: "pointer" }}>
              <input type="checkbox" checked={criteriosSel.has(c.id)} onChange={() => alternarCriterio(c.id)} /> {c.nombre}
            </label>
          ))}
          {criteriosActivos.length === 0 && <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.inkSoft, padding: "4px 2px" }}>Este curso todavía no tiene criterios activos.</div>}
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => generar("pdf")}
            disabled={!puedeGenerar}
            style={{ flex: 1, padding: "11px 8px", borderRadius: 10, border: "none", background: puedeGenerar ? COLORS.pine : COLORS.paperDim, color: puedeGenerar ? COLORS.white : COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 700, cursor: puedeGenerar ? "pointer" : "default" }}
          >
            Generar PDF
          </button>
          <button
            onClick={() => generar("word")}
            disabled={!puedeGenerar}
            style={{ flex: 1, padding: "11px 8px", borderRadius: 10, border: `1.5px solid ${puedeGenerar ? COLORS.pine : COLORS.line}`, background: COLORS.white, color: puedeGenerar ? COLORS.pine : COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, fontWeight: 700, cursor: puedeGenerar ? "pointer" : "default" }}
          >
            Generar Word
          </button>
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, color: COLORS.inkSoft, marginTop: 8, lineHeight: 1.4, textAlign: "center" }}>
          El PDF se abre en el diálogo de impresión: elegí "Guardar como PDF" si querés guardarlo, o una impresora si preferís imprimirlo directo.
        </div>
        <button
          onClick={onCerrar}
          style={{ width: "100%", marginTop: 8, padding: "9px 8px", borderRadius: 10, border: "none", background: "transparent", color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
        >
          Cancelar
        </button>
      </div>
    </div>
  );
}

// Junta, en una sola vista semanal, los horarios que el docente ya marcó
// en "Asistencia → días de clase" de cada curso. No pide cargar nada de
// nuevo: solo reordena por horario lo que ya existe.
// Paleta de colores para diferenciar colegios a simple vista en la grilla
// de horario (como el naranja/verde de una planilla armada a mano). Se
// asigna siempre el mismo color al mismo colegio, por orden de aparición.
const PALETA_COLEGIOS = [
  { fondo: "#F3C77A", texto: "#5C3B0A", borde: "#D9A94E" }, // ocre/naranja
  { fondo: "#9FCBA8", texto: "#0F3D22", borde: "#6FA97F" }, // verde
  { fondo: "#A9C6E8", texto: "#0E2E52", borde: "#7FA6D4" }, // celeste
  { fondo: "#E3A7B8", texto: "#5A1A2A", borde: "#CB7C93" }, // rosado
  { fondo: "#CBB8E0", texto: "#3A215A", borde: "#A98BC9" }, // lila
  { fondo: "#E3C398", texto: "#4A2F0C", borde: "#C79F63" }, // arena
];
function colorDeColegio(colegios, colegioId) {
  const indice = colegios.findIndex((c) => c.id === colegioId);
  return PALETA_COLEGIOS[(indice >= 0 ? indice : 0) % PALETA_COLEGIOS.length];
}
function minutosDesdeHora(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Grilla visual del horario semanal: un día por columna, y cada clase
// ocupa un bloque cuyo tamaño es proporcional a su duración real (un
// módulo de 80 minutos se ve el doble de alto que uno de 40), con un
// color fijo por colegio para identificar todo de un vistazo.
function GrillaHorarioSemanal({ colegios, bloquesPorDia, diasHorario, nombreDia, onTocarBloque, refReferenciaColores }) {
  const PX_POR_MINUTO = 1.0;

  const todosLosBloques = [];
  diasHorario.forEach((d) => {
    bloquesPorDia[d.code].forEach((b) => {
      if (b.inicio && b.fin) todosLosBloques.push(b);
    });
  });
  const sinHorario = [];
  diasHorario.forEach((d) => {
    bloquesPorDia[d.code].forEach((b) => {
      if (!b.inicio || !b.fin) sinHorario.push({ ...b, dia: d.code });
    });
  });

  let inicioGrilla = 8 * 60;
  let finGrilla = 18 * 60;
  if (todosLosBloques.length > 0) {
    const inicios = todosLosBloques.map((b) => minutosDesdeHora(b.inicio));
    const fines = todosLosBloques.map((b) => minutosDesdeHora(b.fin));
    inicioGrilla = Math.floor(Math.min(...inicios) / 60) * 60;
    finGrilla = Math.ceil(Math.max(...fines) / 60) * 60;
  }
  const alturaTotal = (finGrilla - inicioGrilla) * PX_POR_MINUTO;

  const marcasHora = [];
  for (let m = inicioGrilla; m <= finGrilla; m += 60) marcasHora.push(m);

  return (
    <div>
      <div ref={refReferenciaColores} style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {colegios.map((col, i) => (
          <div key={col.id} style={{ display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 12, height: 12, borderRadius: 4, background: PALETA_COLEGIOS[i % PALETA_COLEGIOS.length].fondo, display: "inline-block", flexShrink: 0 }} />
            <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, color: COLORS.inkSoft }}>{col.nombre}</span>
          </div>
        ))}
      </div>

      <div style={{ overflowX: "auto", border: `1px solid ${COLORS.line}`, borderRadius: 12, background: COLORS.white }}>
        <div style={{ display: "flex", minWidth: 560 }}>
          <div style={{ width: 46, flexShrink: 0, borderRight: `1px solid ${COLORS.line}`, position: "relative", height: alturaTotal }}>
            {marcasHora.map((m) => (
              <div
                key={m}
                style={{
                  position: "absolute", top: (m - inicioGrilla) * PX_POR_MINUTO - 7, left: 0, right: 4,
                  textAlign: "right", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 600, color: COLORS.inkSoft,
                }}
              >
                {String(Math.floor(m / 60)).padStart(2, "0")}:00
              </div>
            ))}
          </div>

          {diasHorario.map((d) => (
            <div key={d.code} style={{ flex: 1, minWidth: 88, position: "relative", height: alturaTotal, borderRight: `1px solid ${COLORS.line}` }}>
              <div style={{
                position: "sticky", top: 0, textAlign: "center", padding: "6px 2px", fontFamily: "'IBM Plex Sans', sans-serif",
                fontSize: 11.5, fontWeight: 700, color: COLORS.pineDark, background: COLORS.paperDim, borderBottom: `1px solid ${COLORS.line}`,
              }}>
                {d.label}
              </div>
              {marcasHora.map((m) => (
                <div key={m} style={{ position: "absolute", top: (m - inicioGrilla) * PX_POR_MINUTO, left: 0, right: 0, borderTop: `1px solid ${COLORS.paperDim}` }} />
              ))}
              {bloquesPorDia[d.code].filter((b) => b.inicio && b.fin).map((b, i) => {
                const inicioMin = minutosDesdeHora(b.inicio);
                const finMin = minutosDesdeHora(b.fin);
                const color = colorDeColegio(colegios, b.colegio.id);
                return (
                  <div
                    key={i}
                    onClick={() => onTocarBloque(b.colegio, b.curso)}
                    style={{
                      position: "absolute", top: (inicioMin - inicioGrilla) * PX_POR_MINUTO + 1, left: 2, right: 2,
                      height: (finMin - inicioMin) * PX_POR_MINUTO - 2, background: color.fondo, border: `1px solid ${color.borde}`,
                      borderRadius: 8, padding: "4px 5px", overflow: "hidden", cursor: "pointer", boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", gap: 1,
                    }}
                  >
                    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10, fontWeight: 700, color: color.texto, opacity: 0.9 }}>
                      {b.inicio}-{b.fin}
                    </div>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 12, fontWeight: 600, color: color.texto, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", maxWidth: "100%" }}>
                      {b.curso.nombre}{b.curso.materia ? ` · ${b.curso.materia}` : ""}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {sinHorario.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 700, color: COLORS.inkSoft, marginBottom: 6 }}>
            Sin horario definido todavía
          </div>
          {sinHorario.map((b, i) => (
            <div
              key={i}
              onClick={() => onTocarBloque(b.colegio, b.curso)}
              style={{
                display: "flex", alignItems: "center", gap: 8, padding: "7px 10px", marginBottom: 5,
                background: COLORS.paperDim, borderRadius: 10, cursor: "pointer",
              }}
            >
              <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 700, color: COLORS.pineDark }}>{nombreDia[b.dia]}</span>
              <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, color: COLORS.inkSoft }}>
                {b.curso.nombre}{b.curso.materia ? ` · ${b.curso.materia}` : ""} — {b.colegio.nombre}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// Pantalla "Mi horario": se navega igual que el resto de la app (colegios
// → cursos), y al entrar a un curso se abre el editor de bloques de
// horario de ESE curso. Permite cargar cuantos bloques se necesiten por
// día (incluso varios el mismo día para el mismo curso, para el caso de
// un docente con dos módulos separados de la misma materia). También hay
// una vista "semana armada" que junta todo lo cargado en un solo vistazo.
// Espacio libre para que el docente anote reuniones, ideas o cualquier
// cosa que se le ocurra. Cada nota puede quedar suelta, o atada a un
// colegio/curso puntual (por ejemplo "Pedir el aula de música" para 3° A).
function PantallaNotas({ colegios, cursosPorColegio, notas, onAgregarNota, onEditarNota, onEliminarNota, onVolver, tourVisto, onMarcarTourVisto }) {
  const [formAbierto, setFormAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [colegioIdSel, setColegioIdSel] = useState("");
  const [cursoIdSel, setCursoIdSel] = useState("");
  const [editandoId, setEditandoId] = useState(null);
  const [textoEdicion, setTextoEdicion] = useState("");
  const [filtro, setFiltro] = useState("todas"); // "todas" | "generales" | "curso"
  const [tourActivo, setTourActivo] = useState(!tourVisto);
  const refNuevaNota = useRef(null);
  const refFiltros = useRef(null);

  const pasos = [
    { titulo: "Anotá lo que quieras", texto: "Reuniones, ideas, recordatorios, cualquier cosa que se te ocurra. Podés dejarla suelta, o atarla a un colegio/curso puntual si querés que quede relacionada con él.", ref: refNuevaNota },
    { titulo: "Filtrá tus notas", texto: "Mostrá todas, solo las generales, o solo las que atastes a un curso, para encontrar lo que buscás más rápido.", ref: refFiltros },
  ];

  function nombreCurso(cursoId) {
    for (const col of colegios) {
      const curso = (cursosPorColegio[col.id] || []).find((c) => c.id === cursoId);
      if (curso) return { colegio: col, curso };
    }
    return null;
  }

  function confirmarNota() {
    const limpio = texto.trim();
    if (!limpio) return;
    onAgregarNota(limpio, colegioIdSel || null, cursoIdSel || null);
    setTexto("");
    setColegioIdSel("");
    setCursoIdSel("");
    setFormAbierto(false);
  }

  const notasFiltradas = notas.filter((n) => {
    if (filtro === "generales") return !n.cursoId;
    if (filtro === "curso") return !!n.cursoId;
    return true;
  });

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, paddingBottom: 90 }}>
      <div style={{ background: COLORS.pineDark, padding: "10px 18px 12px 18px", color: COLORS.white, position: "relative" }}>
        <div style={{ position: "absolute", top: 8, right: 12 }}>
          <BotonMenuAyuda onAyuda={() => setTourActivo(true)} />
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ochreSoft, letterSpacing: 0.4, marginBottom: 2, paddingRight: 26 }}>CISD</div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600 }}>Bitácora</div>
      </div>

      <div style={{ padding: "14px 16px" }}>
        <button
          ref={refNuevaNota}
          onClick={() => setFormAbierto((v) => !v)}
          style={{
            display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
            padding: "10px", marginBottom: 12, borderRadius: 12, border: `1.5px solid ${COLORS.pine}`,
            background: formAbierto ? COLORS.pine : COLORS.white, color: formAbierto ? COLORS.white : COLORS.pineDark,
            fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
          }}
        >
          {formAbierto ? "Cancelar" : "+ Nueva nota"}
        </button>

        {formAbierto && (
          <div style={{ padding: 12, background: COLORS.paperDim, borderRadius: 12, border: `1px dashed ${COLORS.line}`, marginBottom: 14 }}>
            <textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              placeholder="Escribí tu nota…"
              rows={3}
              autoFocus
              style={{ width: "100%", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: 8, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.ink, resize: "vertical", marginBottom: 8 }}
            />
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, color: COLORS.inkSoft, marginBottom: 4 }}>
              ¿La atamos a un colegio/curso? (opcional)
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
              <select
                value={colegioIdSel}
                onChange={(e) => { setColegioIdSel(e.target.value); setCursoIdSel(""); }}
                style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "6px 6px", fontSize: 12.5, fontFamily: "'IBM Plex Sans', sans-serif", color: COLORS.ink }}
              >
                <option value="">Sin colegio (nota general)</option>
                {colegios.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
              </select>
              {colegioIdSel && (
                <select
                  value={cursoIdSel}
                  onChange={(e) => setCursoIdSel(e.target.value)}
                  style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "6px 6px", fontSize: 12.5, fontFamily: "'IBM Plex Sans', sans-serif", color: COLORS.ink }}
                >
                  <option value="">Todo el colegio</option>
                  {(cursosPorColegio[colegioIdSel] || []).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              )}
            </div>
            <button
              onClick={confirmarNota}
              disabled={!texto.trim()}
              style={{
                padding: "7px 16px", borderRadius: 999, border: "none", cursor: texto.trim() ? "pointer" : "default",
                background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600,
                opacity: texto.trim() ? 1 : 0.5,
              }}
            >
              Guardar nota
            </button>
          </div>
        )}

        <div ref={refFiltros} style={{ display: "flex", gap: 6, marginBottom: 12 }}>
          {[{ id: "todas", label: "Todas" }, { id: "generales", label: "Generales" }, { id: "curso", label: "De un curso" }].map((f) => (
            <span
              key={f.id}
              onClick={() => setFiltro(f.id)}
              style={{
                padding: "5px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer",
                fontFamily: "'IBM Plex Sans', sans-serif", background: filtro === f.id ? COLORS.ochre : COLORS.paperDim,
                color: filtro === f.id ? COLORS.pineDark : COLORS.inkSoft,
              }}
            >
              {f.label}
            </span>
          ))}
        </div>

        {notasFiltradas.length === 0 && (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.inkSoft, fontStyle: "italic", textAlign: "center", padding: "20px 10px" }}>
            No hay notas para mostrar acá todavía.
          </div>
        )}

        {notasFiltradas.map((n) => {
          const ref = n.cursoId ? nombreCurso(n.cursoId) : null;
          const enEdicion = editandoId === n.id;
          return (
            <div key={n.id} style={{ background: COLORS.white, border: `1px solid ${COLORS.line}`, borderRadius: 12, padding: "10px 12px", marginBottom: 8 }}>
              {enEdicion ? (
                <>
                  <textarea
                    value={textoEdicion}
                    onChange={(e) => setTextoEdicion(e.target.value)}
                    rows={3}
                    autoFocus
                    style={{ width: "100%", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: 8, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.ink, resize: "vertical", marginBottom: 6 }}
                  />
                  <div style={{ display: "flex", gap: 12 }}>
                    <span
                      onClick={() => { if (textoEdicion.trim()) { onEditarNota(n.id, textoEdicion.trim()); setEditandoId(null); } }}
                      style={{ cursor: "pointer", color: COLORS.pine, fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600 }}
                    >
                      Guardar
                    </span>
                    <span onClick={() => setEditandoId(null)} style={{ cursor: "pointer", color: COLORS.inkSoft, fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600 }}>
                      Cancelar
                    </span>
                  </div>
                </>
              ) : (
                <>
                  {ref && (
                    <div style={{ display: "inline-block", padding: "2px 8px", borderRadius: 999, background: COLORS.ochreSoft, color: COLORS.pineDark, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10.5, fontWeight: 700, marginBottom: 6 }}>
                      {ref.colegio.nombre} · {ref.curso.nombre}
                    </div>
                  )}
                  <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.ink, whiteSpace: "pre-wrap", marginBottom: 6 }}>
                    {n.texto}
                  </div>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                    <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 10.5, color: COLORS.inkSoft }}>
                      {fechaCorta(n.fecha)}
                    </span>
                    <div style={{ display: "flex", gap: 12 }}>
                      <span
                        onClick={() => { setEditandoId(n.id); setTextoEdicion(n.texto); }}
                        style={{ cursor: "pointer", color: COLORS.pine, fontSize: 12.5, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600 }}
                      >
                        Editar
                      </span>
                      <span
                        onClick={() => onEliminarNota(n.id)}
                        style={{ cursor: "pointer", color: COLORS.rose, fontSize: 12.5, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600 }}
                      >
                        Eliminar
                      </span>
                    </div>
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>

      {tourActivo && (
        <TourGuiado pasos={pasos} onCerrar={() => { setTourActivo(false); onMarcarTourVisto(); }} />
      )}

      <BotonVolverFlotante onVolver={onVolver} />
    </div>
  );
}

function PantallaHorarioDocente({ colegios, cursosPorColegio, diasClasePorCurso, onSetDiasClaseCurso, onVolverApp, tourVistoPorPantalla, onMarcarTourVistoPantalla }) {
  const [subvista, setSubvista] = useState("colegios"); // "colegios" | "cursos" | "editor" | "semana"
  const [colSel, setColSel] = useState(null);
  const [cursoSel, setCursoSel] = useState(null);
  const [nuevoDia, setNuevoDia] = useState("LU");
  const [nuevoInicio, setNuevoInicio] = useState("");
  const [nuevoFin, setNuevoFin] = useState("");
  const [editandoIndice, setEditandoIndice] = useState(null);

  const tvp = tourVistoPorPantalla || {};
  const [tourActivoColegios, setTourActivoColegios] = useState(!tvp.horarioColegios);
  const [tourActivoCursos, setTourActivoCursos] = useState(!tvp.horarioCursos);
  const [tourActivoEditor, setTourActivoEditor] = useState(!tvp.horarioEditor);
  const [tourActivoSemana, setTourActivoSemana] = useState(!tvp.horarioSemana);
  const refVerSemana = useRef(null);
  const refListaColegios = useRef(null);
  const refListaCursos = useRef(null);
  const refBloquesCargados = useRef(null);
  const refFormBloque = useRef(null);
  const refReferenciaColores = useRef(null);
  const refGrillaSemana = useRef(null);

  const pasosColegios = [
    { titulo: "Ver mi horario armado", texto: "Acá vas a poder ver, en cualquier momento, todo tu horario ya armado en una sola vista semanal.", ref: refVerSemana },
    { titulo: "Elegí un colegio", texto: "Tocá un colegio para ver sus cursos y cargarles el horario.", ref: refListaColegios },
  ];
  const pasosCursos = [
    { titulo: "Elegí un curso", texto: "Tocá un curso para abrir su editor de horario y cargar los días y bloques de esa materia.", ref: refListaCursos },
  ];
  const pasosEditor = [
    { titulo: "Bloques cargados", texto: "Acá ves los horarios ya cargados para este curso. Podés tocar \"Editar\" para modificar uno, o \"Quitar\" para borrarlo.", ref: refBloquesCargados },
    { titulo: "Agregar un bloque", texto: "Elegí el día y el horario de inicio/fin, y tocá \"Agregar\". Podés cargar todos los bloques que necesites, incluso varios el mismo día (por ejemplo, dos módulos separados de la misma materia).", ref: refFormBloque },
  ];
  const pasosSemana = [
    { titulo: "Un color por colegio", texto: "Cada colegio tiene su propio color fijo, para identificar de un vistazo a qué colegio pertenece cada clase.", ref: refReferenciaColores },
    { titulo: "Tamaño real de cada clase", texto: "Cada bloque ocupa un tamaño proporcional a su duración real: un módulo de 80 minutos se ve más grande que uno de 40. Tocá cualquier bloque para ir directo a su editor.", ref: refGrillaSemana },
  ];

  const DIAS_HORARIO = DIAS_SEMANA.filter((d) => d.code !== "DO" && d.code !== "SA");
  const NOMBRE_DIA = { LU: "Lunes", MA: "Martes", MI: "Miércoles", JU: "Jueves", VI: "Viernes", SA: "Sábado" };

  function irACurso(colegio, curso) {
    setColSel(colegio);
    setCursoSel(curso);
    setEditandoIndice(null);
    setNuevoInicio("");
    setNuevoFin("");
    setSubvista("editor");
  }

  function volver() {
    if (subvista === "editor") setSubvista("cursos");
    else if (subvista === "cursos") setSubvista("colegios");
    else if (subvista === "semana") setSubvista("colegios");
    else onVolverApp();
  }

  function editarBloque(indice) {
    const item = (diasClasePorCurso[cursoSel.id] || [])[indice];
    setNuevoDia(diaConfigCodigo(item));
    setNuevoInicio(typeof item === "object" ? item.inicio || "" : "");
    setNuevoFin(typeof item === "object" ? item.fin || "" : "");
    setEditandoIndice(indice);
  }

  function cancelarEdicion() {
    setEditandoIndice(null);
    setNuevoInicio("");
    setNuevoFin("");
  }

  function guardarBloque() {
    if (!nuevoInicio || !nuevoFin) return;
    const base = diasClasePorCurso[cursoSel.id] || [];
    if (editandoIndice !== null) {
      const nuevo = base.map((item, i) => i === editandoIndice ? { dia: nuevoDia, inicio: nuevoInicio, fin: nuevoFin } : item);
      onSetDiasClaseCurso(cursoSel.id, nuevo);
      setEditandoIndice(null);
    } else {
      onSetDiasClaseCurso(cursoSel.id, [...base, { dia: nuevoDia, inicio: nuevoInicio, fin: nuevoFin }]);
    }
    setNuevoInicio("");
    setNuevoFin("");
  }

  function quitarBloque(indice) {
    const base = diasClasePorCurso[cursoSel.id] || [];
    onSetDiasClaseCurso(cursoSel.id, base.filter((_, i) => i !== indice));
    if (editandoIndice === indice) cancelarEdicion();
  }

  // --- Vista: semana armada (junta todos los cursos) ---
  const bloquesPorDia = {};
  DIAS_HORARIO.forEach((d) => { bloquesPorDia[d.code] = []; });
  colegios.forEach((colegio) => {
    (cursosPorColegio[colegio.id] || []).forEach((curso) => {
      (diasClasePorCurso[curso.id] || []).forEach((item) => {
        const dia = diaConfigCodigo(item);
        const inicio = typeof item === "object" ? item.inicio : "";
        const fin = typeof item === "object" ? item.fin : "";
        if (bloquesPorDia[dia]) bloquesPorDia[dia].push({ colegio, curso, inicio: inicio || "", fin: fin || "" });
      });
    });
  });
  Object.keys(bloquesPorDia).forEach((dia) => {
    bloquesPorDia[dia].sort((a, b) => {
      if (!a.inicio && !b.inicio) return 0;
      if (!a.inicio) return 1;
      if (!b.inicio) return -1;
      return a.inicio.localeCompare(b.inicio);
    });
  });
  const hayAlgunBloque = Object.values(bloquesPorDia).some((arr) => arr.length > 0);

  const encabezado = (titulo, subtitulo, onAyuda) => (
    <div style={{ background: COLORS.pineDark, padding: "10px 18px 12px 18px", color: COLORS.white, position: "relative" }}>
      {onAyuda && (
        <div style={{ position: "absolute", top: 8, right: 12 }}>
          <BotonMenuAyuda onAyuda={onAyuda} />
        </div>
      )}
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ochreSoft, letterSpacing: 0.4, marginBottom: 2, paddingRight: onAyuda ? 26 : 0 }}>
        {subtitulo || "CISD"}
      </div>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600 }}>{titulo}</div>
    </div>
  );

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, paddingBottom: 90 }}>
      {subvista === "colegios" && (
        <>
          {encabezado("Mi horario", null, () => setTourActivoColegios(true))}
          <div style={{ padding: "14px 16px" }}>
            <button
              ref={refVerSemana}
              onClick={() => setSubvista("semana")}
              style={{
                display: "flex", alignItems: "center", justifyContent: "center", gap: 6, width: "100%",
                padding: "10px", marginBottom: 14, borderRadius: 12, border: `1.5px solid ${COLORS.pine}`,
                background: COLORS.white, color: COLORS.pineDark, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, cursor: "pointer",
              }}
            >
              <CalendarDays size={15} strokeWidth={2.4} /> Ver mi horario armado
            </button>

            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.inkSoft, marginBottom: 8 }}>
              Tocá un colegio para cargar el horario de sus cursos.
            </div>

            {colegios.length === 0 && (
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.inkSoft, fontStyle: "italic", textAlign: "center", padding: "20px 10px" }}>
                Todavía no cargaste ningún colegio.
              </div>
            )}

            <div ref={refListaColegios}>
              {colegios.map((col) => (
                <div
                  key={col.id}
                  onClick={() => { setColSel(col); setSubvista("cursos"); }}
                  style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", marginBottom: 8,
                    background: COLORS.white, border: `1px solid ${COLORS.line}`, borderRadius: 12, cursor: "pointer",
                  }}
                >
                  <span style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, fontWeight: 600, color: COLORS.ink }}>{col.nombre}</span>
                  <ChevronRight size={16} color={COLORS.inkSoft} strokeWidth={2.2} />
                </div>
              ))}
            </div>
          </div>
          {tourActivoColegios && (
            <TourGuiado pasos={pasosColegios} onCerrar={() => { setTourActivoColegios(false); onMarcarTourVistoPantalla("horarioColegios"); }} />
          )}
        </>
      )}

      {subvista === "cursos" && colSel && (
        <>
          {encabezado(colSel.nombre, "Mi horario", () => setTourActivoCursos(true))}
          <div style={{ padding: "14px 16px" }}>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.inkSoft, marginBottom: 8 }}>
              Tocá un curso para cargar o revisar su horario.
            </div>
            {(cursosPorColegio[colSel.id] || []).length === 0 && (
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.inkSoft, fontStyle: "italic", textAlign: "center", padding: "20px 10px" }}>
                Este colegio todavía no tiene cursos cargados.
              </div>
            )}
            <div ref={refListaCursos}>
              {(cursosPorColegio[colSel.id] || []).map((curso) => {
                const cantBloques = (diasClasePorCurso[curso.id] || []).length;
                return (
                  <div
                    key={curso.id}
                    onClick={() => irACurso(colSel, curso)}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 14px", marginBottom: 8,
                      background: COLORS.white, border: `1px solid ${COLORS.line}`, borderRadius: 12, cursor: "pointer",
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, fontWeight: 600, color: COLORS.ink }}>
                        {curso.nombre}{curso.materia ? ` · ${curso.materia}` : ""}
                      </div>
                      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, color: COLORS.inkSoft }}>
                        {cantBloques === 0 ? "Sin horario cargado" : `${cantBloques} bloque${cantBloques === 1 ? "" : "s"} cargado${cantBloques === 1 ? "" : "s"}`}
                      </div>
                    </div>
                    <ChevronRight size={16} color={COLORS.inkSoft} strokeWidth={2.2} />
                  </div>
                );
              })}
            </div>
          </div>
          {tourActivoCursos && (
            <TourGuiado pasos={pasosCursos} onCerrar={() => { setTourActivoCursos(false); onMarcarTourVistoPantalla("horarioCursos"); }} />
          )}
        </>
      )}

      {subvista === "editor" && cursoSel && (
        <>
          {encabezado(cursoSel.nombre, `${colSel.nombre} · Mi horario`, () => setTourActivoEditor(true))}
          <div style={{ padding: "14px 16px" }}>
            <div ref={refBloquesCargados}>
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 700, color: COLORS.pineDark, marginBottom: 8 }}>
                Bloques cargados
              </div>
              {(diasClasePorCurso[cursoSel.id] || []).length === 0 && (
                <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, color: COLORS.inkSoft, fontStyle: "italic", marginBottom: 10 }}>
                  Todavía no cargaste ningún bloque para este curso.
                </div>
              )}
              {(diasClasePorCurso[cursoSel.id] || []).map((item, i) => {
                const dia = diaConfigCodigo(item);
                const inicio = typeof item === "object" ? item.inicio : "";
                const fin = typeof item === "object" ? item.fin : "";
                return (
                  <div
                    key={i}
                    style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "9px 12px", marginBottom: 6,
                      background: editandoIndice === i ? COLORS.ochreSoft : COLORS.white, border: `1px solid ${editandoIndice === i ? COLORS.ochre : COLORS.line}`, borderRadius: 10,
                    }}
                  >
                    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.ink }}>
                      <strong>{NOMBRE_DIA[dia] || dia}</strong>{" "}
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", color: COLORS.ochre, fontWeight: 700 }}>
                        {inicio && fin ? `${inicio}–${fin}` : "sin horario"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 12, flexShrink: 0 }}>
                      <span onClick={() => editarBloque(i)} style={{ cursor: "pointer", color: COLORS.pine, fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600 }}>
                        Editar
                      </span>
                      <span onClick={() => quitarBloque(i)} style={{ cursor: "pointer", color: COLORS.rose, fontSize: 13, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600 }}>
                        Quitar
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div ref={refFormBloque} style={{ marginTop: 14, padding: "12px", background: editandoIndice !== null ? COLORS.ochreSoft : COLORS.paperDim, borderRadius: 12, border: `1px dashed ${editandoIndice !== null ? COLORS.ochre : COLORS.line}` }}>
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 700, color: COLORS.pineDark, marginBottom: 8 }}>
                {editandoIndice !== null ? "Editar bloque" : "+ Agregar bloque"}
              </div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <select
                  value={nuevoDia}
                  onChange={(e) => setNuevoDia(e.target.value)}
                  style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "6px 6px", fontSize: 12.5, fontFamily: "'IBM Plex Sans', sans-serif", color: COLORS.ink }}
                >
                  {DIAS_HORARIO.map((d) => <option key={d.code} value={d.code}>{NOMBRE_DIA[d.code]}</option>)}
                </select>
                <input
                  type="time" value={nuevoInicio} onChange={(e) => setNuevoInicio(e.target.value)}
                  style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "6px 6px", fontSize: 12.5, fontFamily: "'IBM Plex Sans', sans-serif", color: COLORS.ink }}
                />
                <span style={{ fontSize: 12, color: COLORS.inkSoft }}>a</span>
                <input
                  type="time" value={nuevoFin} onChange={(e) => setNuevoFin(e.target.value)}
                  style={{ border: `1px solid ${COLORS.line}`, borderRadius: 8, padding: "6px 6px", fontSize: 12.5, fontFamily: "'IBM Plex Sans', sans-serif", color: COLORS.ink }}
                />
                <button
                  onClick={guardarBloque}
                  disabled={!nuevoInicio || !nuevoFin}
                  style={{
                    padding: "6px 14px", borderRadius: 999, border: "none", cursor: nuevoInicio && nuevoFin ? "pointer" : "default",
                    background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, fontWeight: 600,
                    opacity: nuevoInicio && nuevoFin ? 1 : 0.5,
                  }}
                >
                  {editandoIndice !== null ? "Guardar cambios" : "Agregar"}
                </button>
                {editandoIndice !== null && (
                  <span onClick={cancelarEdicion} style={{ cursor: "pointer", color: COLORS.inkSoft, fontSize: 12.5, fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 600 }}>
                    Cancelar
                  </span>
                )}
              </div>
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11, color: COLORS.inkSoft, marginTop: 8 }}>
                Podés agregar varios bloques el mismo día para este curso (por ejemplo, dos módulos separados).
              </div>
            </div>
          </div>
          {tourActivoEditor && (
            <TourGuiado pasos={pasosEditor} onCerrar={() => { setTourActivoEditor(false); onMarcarTourVistoPantalla("horarioEditor"); }} />
          )}
        </>
      )}

      {subvista === "semana" && (
        <>
          {encabezado("Mi horario armado", null, () => setTourActivoSemana(true))}
          <div style={{ padding: "14px 16px" }}>
            {!hayAlgunBloque ? (
              <CuadroGuia texto={'Todavía no cargaste ningún bloque. Entrá a un colegio → un curso, y agregá los días y horarios de esa materia.'} />
            ) : (
              <div ref={refGrillaSemana}>
                <GrillaHorarioSemanal colegios={colegios} bloquesPorDia={bloquesPorDia} diasHorario={DIAS_HORARIO} nombreDia={NOMBRE_DIA} onTocarBloque={irACurso} refReferenciaColores={refReferenciaColores} />
              </div>
            )}
          </div>
          {tourActivoSemana && hayAlgunBloque && (
            <TourGuiado pasos={pasosSemana} onCerrar={() => { setTourActivoSemana(false); onMarcarTourVistoPantalla("horarioSemana"); }} />
          )}
        </>
      )}

      <BotonVolverFlotante onVolver={volver} />
    </div>
  );
}

function PantallaAula({ colegio, curso, alumnos, onAgregarAlumno, onBorrarAlumno, onEditarAlumno, onAbrirFicha, onVolver, criterios, ordenPorCurso, onReordenarCriterios, onAgregarCriterio, onUsarCriterio, onUsarCriterioEnTodos, onQuitarCriterio, onEditarCriterio, onEliminarCriterioDefinitivo, periodo, onCambiarPeriodo, instanciasPorCriterio, onGuardarMasivo, onAgregarInstancia, notaAprobacion, onCambiarNotaAprobacion, onCambiarNotaOficial, onCambiarNotaRecuperatorio, nombresColumnasPorColegio, onRenombrarColumnaNota, diasCurso, diasClaseConfig, onAlternarCeldaAsistencia, onSetMotivoNoTrabajado, onSetDiasClase, tourVisto, onMarcarTourVisto, tourVistoPorPantalla, onMarcarTourVistoPantalla, promedioAuto, onTogglePromedioAuto }) {
  const [busqueda, setBusqueda] = useState("");
  const [masivaAbierta, setMasivaAbierta] = useState(false);
  const [planillaAbierta, setPlanillaAbierta] = useState(false);
  const [recuperatorioAbierto, setRecuperatorioAbierto] = useState(null); // null | "diciembre" | "febrero"
  const [asistenciaAbierta, setAsistenciaAbierta] = useState(false);
  const [informesAbierto, setInformesAbierto] = useState(false);
  const [menuRecuperatoriosAbierto, setMenuRecuperatoriosAbierto] = useState(false);
  const [editarNotaAprobacionAbierto, setEditarNotaAprobacionAbierto] = useState(false);
  const [tourActivo, setTourActivo] = useState(!tourVisto);
  const refAsistencia = useRef(null);
  const refCriterios = useRef(null);
  const refCargaMasiva = useRef(null);
  const refPlanillaGrupo = useRef(null);
  const refInformes = useRef(null);
  const refAlumnos = useRef(null);

  const pasos = [
    { titulo: "Tomá asistencia", texto: "Tocá este botón para abrir la planilla de asistencia del día.", ref: refAsistencia },
    { titulo: "Criterios de seguimiento", texto: "Aquí activás los criterios que vas a usar en este curso (Participación, Evaluación escrita, Conducta, etc.) o creás los tuyos propios.", ref: refCriterios },
    { titulo: "Carga masiva", texto: "Cargá de una sola vez las notas de una evaluación escrita: aquí aparece el listado completo de alumnos para completar rápido, uno tras otro.", ref: refCargaMasiva },
    { titulo: "Planilla oficial y recuperatorios", texto: "Desde aquí accedés a la planilla oficial de notas, y a los recuperatorios de Diciembre y Febrero.", ref: refPlanillaGrupo },
    { titulo: "Informes para imprimir", texto: "Este botón genera un informe en PDF o Word con las notas y el seguimiento de cada alumno, listo para entregar a las familias.", ref: refInformes },
    { titulo: "Sumar alumnos", texto: "Escribí un Apellido y Nombre y presioná Enter para agregarlo rápido; tocá un alumno para abrir su ficha.", ref: refAlumnos },
    { titulo: "Mujer o Varón", texto: "Al tocar \"Agregar\" (o presionar Enter), aparece un cartel para elegir Mujer o Varón. Al tocar una opción, se guarda el alumno directamente. No es solo un dato: define el color con el que se muestra el nombre en todas las planillas, para identificar a cada alumno de un vistazo.", ref: refAlumnos },
  ];

  const criteriosInstancias = criterios.filter((c) => c.tipo === "numerico_instancias" && c.activadoEnCursos.includes(curso.id));
  const alumnosFiltrados = alumnos.filter((a) => a.nombre.toLowerCase().includes(busqueda.toLowerCase()));

  return (
    <div>
      <EncabezadoNav
        partes={{ colegio: colegio.nombre, curso: curso.nombre, materia: curso.materia }}
        onAyuda={() => setTourActivo(true)}
        accion={
          <button
            ref={refAsistencia}
            onClick={() => setAsistenciaAbierta(true)}
            style={{ display: "flex", alignItems: "center", gap: 5, padding: "6px 10px", borderRadius: 999, border: "none", background: COLORS.ochre, color: COLORS.pineDark, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            <ClipboardCheck size={13} strokeWidth={2.4} /> Asistencia
          </button>
        }
      />
      <div style={{ padding: "10px 16px 90px 16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "nowrap" }}>
          <SelectorPeriodo periodo={periodo} onChange={onCambiarPeriodo} />
          <button
            ref={refCargaMasiva}
            onClick={() => criteriosInstancias.length > 0 && setMasivaAbierta(true)}
            style={{ display: "flex", alignItems: "center", gap: 4, padding: "5px 10px", borderRadius: 999, border: `1.5px solid ${COLORS.pine}`, background: "transparent", color: COLORS.pine, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 600, cursor: criteriosInstancias.length > 0 ? "pointer" : "default", opacity: criteriosInstancias.length > 0 ? 1 : 0.45, whiteSpace: "nowrap", flexShrink: 0 }}
          >
            <ClipboardList size={12} strokeWidth={2.4} /> Carga masiva
          </button>
        </div>

        <div ref={refPlanillaGrupo} style={{ display: "flex", gap: 6, marginBottom: 6 }}>
          <button
            onClick={() => setPlanillaAbierta(true)}
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, flex: 1, padding: "6px 8px", borderRadius: 10, border: `1px solid ${COLORS.line}`, background: COLORS.white, color: COLORS.pineDark, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            <ClipboardList size={13} strokeWidth={2.4} /> Planilla
          </button>

          <div style={{ position: "relative", flex: 1 }}>
            <button
              onClick={() => setMenuRecuperatoriosAbierto((v) => !v)}
              style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, width: "100%", padding: "6px 8px", borderRadius: 10, border: `1px solid ${COLORS.ochre}`, background: COLORS.white, color: COLORS.ochre, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
            >
              Recuperatorios <ChevronLeft size={12} strokeWidth={2.6} style={{ transform: "rotate(-90deg)" }} />
            </button>
            {menuRecuperatoriosAbierto && (
              <>
                <div onClick={() => setMenuRecuperatoriosAbierto(false)} style={{ position: "fixed", inset: 0, zIndex: 95 }} />
                <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, right: 0, background: COLORS.white, borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,0.28)", padding: 6, zIndex: 96 }}>
                  <div
                    onClick={() => { setRecuperatorioAbierto("diciembre"); setMenuRecuperatoriosAbierto(false); }}
                    style={{ padding: "9px 10px", borderRadius: 8, color: COLORS.ochre, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    Diciembre
                  </div>
                  <div
                    onClick={() => { setRecuperatorioAbierto("febrero"); setMenuRecuperatoriosAbierto(false); }}
                    style={{ padding: "9px 10px", borderRadius: 8, color: COLORS.rose, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, cursor: "pointer" }}
                  >
                    Febrero
                  </div>
                </div>
              </>
            )}
          </div>

          <button
            ref={refInformes}
            onClick={() => setInformesAbierto(true)}
            title="Informes para imprimir"
            style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 5, flexShrink: 0, padding: "6px 10px", borderRadius: 10, border: `1px solid ${COLORS.line}`, background: COLORS.white, color: COLORS.pineDark, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12, fontWeight: 600, cursor: "pointer" }}
          >
            <Printer size={14} strokeWidth={2.4} /> Informe
          </button>
        </div>

        <div ref={refCriterios} style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
          <SeccionCriterios
            curso={curso}
            criterios={criterios}
            ordenPorCurso={ordenPorCurso}
            onReordenar={(nuevoOrden, aplicarATodos) => onReordenarCriterios(curso.id, nuevoOrden, aplicarATodos)}
            onAgregar={onAgregarCriterio}
            onUsar={(id) => onUsarCriterio(id, curso.id)}
            onUsarEnTodos={onUsarCriterioEnTodos}
            onQuitar={(id) => onQuitarCriterio(id, curso.id)}
            onEditar={onEditarCriterio}
            onEliminarDefinitivo={onEliminarCriterioDefinitivo}
            elementoJunto={
              alumnos.length > 0 && (
                <div style={{ flex: 1, minWidth: 140, display: "flex", alignItems: "center", gap: 7, background: COLORS.white, border: `1px solid ${COLORS.line}`, borderRadius: 999, padding: "7px 12px" }}>
                  <Search size={14} color={COLORS.inkSoft} strokeWidth={2.2} />
                  <input
                    value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Buscar alumno…"
                    style={{ flex: 1, border: "none", outline: "none", background: "transparent", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, color: COLORS.ink }}
                  />
                </div>
              )
            }
          />
          <ChipNotaAprobacion notaAprobacion={notaAprobacion} onAbrir={() => setEditarNotaAprobacionAbierto(true)} />
        </div>

        {editarNotaAprobacionAbierto && (
          <PopupNotaAprobacion
            valorInicial={notaAprobacion}
            onCancelar={() => setEditarNotaAprobacionAbierto(false)}
            onConfirmar={(n) => { onCambiarNotaAprobacion(n); setEditarNotaAprobacionAbierto(false); }}
          />
        )}

        <div ref={refAlumnos}>
          <ListaAlumnosRapida alumnos={alumnosFiltrados} onAgregar={onAgregarAlumno} onBorrar={onBorrarAlumno} onEditar={onEditarAlumno} onAbrirFicha={onAbrirFicha} />
        </div>
      </div>

      {tourActivo && (
        <TourGuiado pasos={pasos} onCerrar={() => { setTourActivo(false); onMarcarTourVisto(); }} />
      )}

      {masivaAbierta && (
        <CorreccionMasiva
          alumnos={alumnos}
          criteriosInstancias={criteriosInstancias}
          periodo={periodo}
          instanciasPorCriterio={instanciasPorCriterio}
          onGuardar={onGuardarMasivo}
          onAgregarInstancia={onAgregarInstancia}
          onCerrar={() => setMasivaAbierta(false)}
        />
      )}

      {planillaAbierta && (
        <PantallaPlanillaNotas
          colegio={colegio}
          curso={curso}
          alumnos={alumnos}
          notaAprobacion={notaAprobacion}
          onCambiarNotaOficial={onCambiarNotaOficial}
          nombresColumnasPorColegio={nombresColumnasPorColegio}
          onRenombrarColumnaNota={onRenombrarColumnaNota}
          onCerrar={() => setPlanillaAbierta(false)}
          tourVisto={!!(tourVistoPorPantalla || {}).planilla}
          onMarcarTourVisto={() => onMarcarTourVistoPantalla("planilla")}
          promedioAuto={promedioAuto}
          onTogglePromedioAuto={onTogglePromedioAuto}
        />
      )}

      {recuperatorioAbierto && (
        <PantallaRecuperatorio
          instancia={recuperatorioAbierto}
          curso={curso}
          alumnos={alumnos}
          notaAprobacion={notaAprobacion}
          onCambiarNotaRecuperatorio={onCambiarNotaRecuperatorio}
          onCerrar={() => setRecuperatorioAbierto(null)}
          tourVisto={!!(tourVistoPorPantalla || {}).recuperatorio}
          onMarcarTourVisto={() => onMarcarTourVistoPantalla("recuperatorio")}
        />
      )}

      {asistenciaAbierta && (
        <PantallaAsistencia
          curso={curso}
          alumnos={alumnos}
          diasCurso={diasCurso || {}}
          diasClaseConfig={diasClaseConfig || []}
          onAlternarCelda={onAlternarCeldaAsistencia}
          onSetMotivo={onSetMotivoNoTrabajado}
          onSetDiasClase={onSetDiasClase}
          onCerrar={() => setAsistenciaAbierta(false)}
          tourVisto={!!(tourVistoPorPantalla || {}).asistencia}
          onMarcarTourVisto={() => onMarcarTourVistoPantalla("asistencia")}
        />
      )}

      {informesAbierto && (
        <ModalInformesTutores
          colegio={colegio}
          curso={curso}
          alumnos={alumnos}
          criteriosActivos={ordenarCriteriosPorCurso(criterios.filter((c) => c.activadoEnCursos.includes(curso.id)), curso.id, ordenPorCurso)}
          notaAprobacion={notaAprobacion}
          diasCurso={diasCurso || {}}
          instanciasPorCriterio={instanciasPorCriterio}
          nombresColumnasPorColegio={nombresColumnasPorColegio}
          periodoActual={periodo}
          onCerrar={() => setInformesAbierto(false)}
          promedioAuto={promedioAuto}
        />
      )}

      <BotonVolverFlotante onVolver={onVolver} />
    </div>
  );
}

// ================================================================
// APP PRINCIPAL — maneja la navegación Colegios → Cursos → Aula
// ================================================================
// Fondo compartido por la bienvenida y el saludo diario: un verde profundo
// con una textura muy sutil de renglones (como la hoja de un cuaderno),
// coherente con "Cuaderno Integral de Seguimiento Docente".
function FondoCuaderno({ children }) {
  return (
    <div style={{ position: "fixed", inset: 0, background: COLORS.pineDark, display: "flex", flexDirection: "column", zIndex: 200, overflow: "hidden" }}>
      <div
        style={{
          position: "absolute", inset: 0, opacity: 0.05, pointerEvents: "none",
          backgroundImage: `repeating-linear-gradient(to bottom, transparent, transparent 34px, ${COLORS.white} 34px, ${COLORS.white} 35px)`,
        }}
      />
      <div style={{ position: "absolute", top: 0, bottom: 0, left: 46, width: 1, background: COLORS.rose, opacity: 0.3, pointerEvents: "none" }} />
      {children}
    </div>
  );
}

// ================================================================
// PANTALLA DE BIENVENIDA — se muestra una única vez, la primera vez que
// se abre CISD en un dispositivo (todavía no hay nombre de docente
// guardado). Después de esta pantalla se le pide el nombre.
// ================================================================
function PantallaBienvenidaCISD({ onSiguiente }) {
  return (
    <FondoCuaderno>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "40px 32px", textAlign: "center" }}>
        <div
          style={{
            width: 58, height: 58, borderRadius: "50%", background: COLORS.ochre, display: "flex",
            alignItems: "center", justifyContent: "center", marginBottom: 22, boxShadow: "0 10px 24px rgba(0,0,0,0.35)",
          }}
        >
          <GraduationCap size={28} color={COLORS.pineDark} strokeWidth={2.2} />
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 600, letterSpacing: 2.2, textTransform: "uppercase", color: COLORS.ochreSoft, marginBottom: 14 }}>
          Bienvenido a
        </div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 48, fontWeight: 700, color: COLORS.white, lineHeight: 1.05, marginBottom: 18 }}>
          CISD
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, color: "rgba(255,253,248,0.75)", lineHeight: 1.5, maxWidth: 300 }}>
          Cuaderno Integral de Seguimiento Docente
        </div>
      </div>
      <div style={{ position: "relative", padding: "0 28px 40px 28px" }}>
        <button
          onClick={onSiguiente}
          style={{ width: "100%", padding: "15px", borderRadius: 14, border: "none", background: COLORS.ochre, color: COLORS.pineDark, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15.5, fontWeight: 700, cursor: "pointer", letterSpacing: 0.2 }}
        >
          Siguiente
        </button>
      </div>
    </FondoCuaderno>
  );
}

// ================================================================
// CARTEL FLOTANTE: ELEGIR / CAMBIAR NOMBRE — se usa tanto la primera vez
// (después de la bienvenida) como cuando el docente quiere cambiarlo
// después, desde el menú "⋮ → Cambiar nombre".
// ================================================================
function PopupElegirNombre({ valorInicial = "", titulo, subtitulo, textoBoton, onConfirmar, onCancelar }) {
  const [valor, setValor] = useState(valorInicial);
  function confirmar() {
    const limpio = valor.trim();
    if (limpio) onConfirmar(limpio);
  }
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(21,53,49,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 210, padding: 20 }}>
      <div style={{ background: COLORS.white, borderRadius: 16, padding: 22, width: "100%", maxWidth: 340, boxShadow: "0 16px 40px rgba(0,0,0,0.35)" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: COLORS.pineDark, marginBottom: 6 }}>
          {titulo}
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, marginBottom: 14, lineHeight: 1.45 }}>
          {subtitulo}
        </div>
        <input
          value={valor} onChange={(e) => setValor(e.target.value)} autoFocus
          placeholder="Ej: Profe Luis, Seño Ana..."
          onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
          style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "10px 12px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, marginBottom: 14 }}
        />
        <div style={{ display: "flex", gap: 8 }}>
          {onCancelar && (
            <button
              onClick={onCancelar}
              style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${COLORS.line}`, background: "transparent", color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Cancelar
            </button>
          )}
          <button
            onClick={confirmar}
            disabled={!valor.trim()}
            style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: valor.trim() ? COLORS.pine : COLORS.line, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, cursor: valor.trim() ? "pointer" : "default" }}
          >
            {textoBoton}
          </button>
        </div>
      </div>
    </div>
  );
}

// Popup provisorio (mientras dure la prueba con los colegas) para que
// cualquier docente le mande a Carloncho una sugerencia o comentario
// sobre la app, sin salir de donde está.
function PopupSugerencia({ onEnviar, onCerrar }) {
  const [texto, setTexto] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function confirmar() {
    const limpio = texto.trim();
    if (!limpio) return;
    setEnviando(true);
    const ok = await onEnviar(limpio);
    setEnviando(false);
    if (ok) setEnviado(true);
  }

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(21,53,49,0.65)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 210, padding: 20 }}>
      <div style={{ background: COLORS.white, borderRadius: 16, padding: 22, width: "100%", maxWidth: 360, boxShadow: "0 16px 40px rgba(0,0,0,0.35)" }}>
        {enviado ? (
          <>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: COLORS.pineDark, marginBottom: 6 }}>
              ¡Gracias!
            </div>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.inkSoft, marginBottom: 16, lineHeight: 1.45 }}>
              Tu sugerencia ya está en camino.
            </div>
            <button
              onClick={onCerrar}
              style={{ width: "100%", padding: "10px", borderRadius: 10, border: "none", background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
            >
              Cerrar
            </button>
          </>
        ) : (
          <>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, fontWeight: 600, color: COLORS.pineDark, marginBottom: 6 }}>
              Enviar sugerencia
            </div>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.inkSoft, marginBottom: 14, lineHeight: 1.45 }}>
              La app está a prueba: contame lo que se te ocurra, un error que veas, o una idea para mejorarla.
            </div>
            <textarea
              value={texto} onChange={(e) => setTexto(e.target.value)} autoFocus rows={4}
              placeholder="Escribí acá tu sugerencia…"
              style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${COLORS.line}`, borderRadius: 10, padding: "10px 12px", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, marginBottom: 14, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={onCerrar}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: `1.5px solid ${COLORS.line}`, background: "transparent", color: COLORS.inkSoft, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, cursor: "pointer" }}
              >
                Cancelar
              </button>
              <button
                onClick={confirmar}
                disabled={!texto.trim() || enviando}
                style={{ flex: 1, padding: "10px", borderRadius: 10, border: "none", background: texto.trim() ? COLORS.pine : COLORS.line, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, fontWeight: 600, cursor: texto.trim() ? "pointer" : "default" }}
              >
                {enviando ? "Enviando…" : "Enviar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ================================================================
// SALUDO POR FRANJA HORARIA — aparece como máximo una vez por franja
// (mañana / tarde / noche) y por día. Elige al azar una variante de
// saludo y una frase de acompañamiento, evitando repetir esta última
// respecto de la vez anterior.
// ================================================================
function PantallaSaludoFranja({ nombre, franja, indiceFraseAnterior, onContinuar }) {
  const [saludo] = useState(() => {
    const variantes = SALUDOS_POR_FRANJA[franja](nombre);
    return variantes[Math.floor(Math.random() * variantes.length)];
  });
  const [indiceFrase] = useState(() => elegirIndiceAlAzar(FRASES_ACOMPANAMIENTO.length, indiceFraseAnterior));
  const frase = FRASES_ACOMPANAMIENTO[indiceFrase];

  return (
    <FondoCuaderno>
      <div style={{ position: "relative", flex: 1, display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center", padding: "40px 32px", textAlign: "center" }}>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 34, fontWeight: 600, color: COLORS.white, lineHeight: 1.25, marginBottom: 18, maxWidth: 340 }}>
          {saludo}
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, color: "rgba(255,253,248,0.78)", lineHeight: 1.5, maxWidth: 300 }}>
          {frase}
        </div>
      </div>
      <div style={{ position: "relative", padding: "0 28px 40px 28px" }}>
        <button
          onClick={() => onContinuar(indiceFrase)}
          style={{ width: "100%", padding: "15px", borderRadius: 14, border: "none", background: COLORS.ochre, color: COLORS.pineDark, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15.5, fontWeight: 700, cursor: "pointer", letterSpacing: 0.2 }}
        >
          Continuar
        </button>
      </div>
    </FondoCuaderno>
  );
}

function CISDNavegacion() {
  const [colegios, setColegios] = useState(COLEGIOS_SEED);
  const [cursos, setCursos] = useState(CURSOS_SEED);
  const [alumnosPorCurso, setAlumnosPorCurso] = useState(ALUMNOS_SEED);
  const [criterios, setCriterios] = useState(CRITERIOS_SEED);
  const [instanciasPorCurso, setInstanciasPorCurso] = useState({});
  const [periodoPorCurso, setPeriodoPorCurso] = useState({});
  // Registro histórico de qué criterios estuvieron activos en cada curso
  // durante el 1° cuatrimestre (aunque el docente los haya quitado
  // después). Se usa para repetirlos automáticamente al pasar a 2°.
  // { [cursoId]: [criterioId, ...] }
  const [criteriosUsadosP1PorCurso, setCriteriosUsadosP1PorCurso] = useState({});
  // Marca si ya se hizo la reactivación automática de criterios al entrar
  // por primera vez al 2° cuatrimestre en cada curso, para que no se
  // repita en cambios de período posteriores. { [cursoId]: true }
  const [p2ReactivadoPorCurso, setP2ReactivadoPorCurso] = useState({});
  const [ordenPorCurso, setOrdenPorCurso] = useState({});
  // Asistencia: { [cursoId]: { [fecha "YYYY-MM-DD"]: { motivo: string|null, marcas: { [alumnoId]: "A"|"T"|"J" } } } }
  const [asistenciaPorCurso, setAsistenciaPorCurso] = useState({});
  // Días de la semana que se dictan en cada curso (solo orientativo, para
  // resaltar en el selector de calendario). { [cursoId]: ["LU","JU"] }
  const [diasClasePorCurso, setDiasClasePorCurso] = useState({});
  // Umbral de aprobación (número) que pinta rojo/verde todas las notas de
  // la app. null hasta que el docente lo defina la primera vez que guarda
  // una calificación numérica.
  const [notaAprobacion, setNotaAprobacion] = useState(null);
  // Cálculo automático de promedios en la planilla oficial: opcional, por
  // curso. { [cursoId]: true|false }. Por defecto (ausente) está apagado.
  const [promedioAutoPorCurso, setPromedioAutoPorCurso] = useState({});
  // Nombres personalizados de las columnas de la planilla oficial (1° inf,
  // 2° inf, 1° Cuat, etc.), por colegio. { [colegioId]: { [columnKey]: label } }
  const [nombresColumnasPorColegio, setNombresColumnasPorColegio] = useState({});
  // Recorrido guiado: qué pantallas ya vio el docente al menos una vez,
  // para que el recorrido automático no se repita solo. Se puede volver
  // a ver siempre desde el menú "⋮ → Ayuda de esta pantalla".
  const [tourVistoPorPantalla, setTourVistoPorPantalla] = useState({});
  // Guarda temporalmente la acción de guardado que quedó pendiente
  // mientras se le pregunta al docente la nota mínima de aprobación.
  const [pendienteGuardado, setPendienteGuardado] = useState(null);
  // Popup que ofrece activar el cálculo automático de promedio: se
  // dispara solo la primera vez que se completa el 2º informe de un
  // cuatrimestre en un curso (y se repite en el 2º cuatrimestre si el
  // docente no lo activó en el 1°). { curId, campo } o null.
  const [preguntaPromedio, setPreguntaPromedio] = useState(null);
  const [colegioId, setColegioId] = useState(null);
  const [cursoId, setCursoId] = useState(null);
  const [fichaAlumnoId, setFichaAlumnoId] = useState(null);
  const [cargado, setCargado] = useState(false);
  const [toast, setToast] = useState({ show: false, text: "" });
  const toastTimer = useRef(null);
  const refAyudaColegios = useRef(null);

  // Nombre elegido por el docente (ej. "Profe Luis") y registro de qué
  // franjas horarias (mañana/tarde/noche) ya se saludaron hoy, para no
  // repetir el saludo más de una vez por franja y por día. Se guardan en
  // una clave de almacenamiento aparte de la de colegios/cursos.
  const [nombreDocente, setNombreDocente] = useState(null);
  const [registroSaludo, setRegistroSaludo] = useState({ fecha: null, franjas: [] });
  const [ultimaFraseIndex, setUltimaFraseIndex] = useState(null);
  const [pasoBienvenida, setPasoBienvenida] = useState("intro"); // "intro" | "nombre"
  const [mostrarCambiarNombre, setMostrarCambiarNombre] = useState(false);
  const [cargadoPerfil, setCargadoPerfil] = useState(false);
  const [mostrarHorario, setMostrarHorario] = useState(false);
  const [mostrarNotas, setMostrarNotas] = useState(false);
  // Notas libres del docente: reuniones, ideas, cualquier cosa. Cada una
  // puede quedar suelta (colegioId/cursoId null) o atada a un curso puntual.
  const [notas, setNotas] = useState([]);
  const [mostrarSugerencia, setMostrarSugerencia] = useState(false);
  const esEscritorio = useEsEscritorio();

  // Habilita "Cambiar nombre" desde el menú "⋮" de cualquier pantalla.
  useEffect(() => {
    abrirCambiarNombreRef = () => setMostrarCambiarNombre(true);
    return () => { abrirCambiarNombreRef = null; };
  }, []);

  // Habilita "Enviar sugerencia" (provisorio, mientras dure la prueba).
  useEffect(() => {
    abrirSugerenciaRef = () => setMostrarSugerencia(true);
    return () => { abrirSugerenciaRef = null; };
  }, []);

  useEffect(() => {
    let activo = true;
    async function cargarPerfil() {
      try {
        const resultado = await window.storage.get("cisd-perfil-docente");
        if (activo && resultado && resultado.value) {
          const datos = JSON.parse(resultado.value);
          if (datos.nombre) setNombreDocente(datos.nombre);
          if (datos.registroSaludo) setRegistroSaludo(datos.registroSaludo);
          if (typeof datos.ultimaFraseIndex === "number") setUltimaFraseIndex(datos.ultimaFraseIndex);
        }
      } catch (err) {
        // Primera vez: todavía no eligió un nombre.
      } finally {
        if (activo) setCargadoPerfil(true);
      }
    }
    cargarPerfil();
    return () => { activo = false; };
  }, []);

  useEffect(() => {
    if (!cargadoPerfil) return;
    window.storage.set("cisd-perfil-docente", JSON.stringify({ nombre: nombreDocente, registroSaludo, ultimaFraseIndex })).catch((err) => {
      console.error("No se pudo guardar el perfil del docente", err);
    });
  }, [nombreDocente, registroSaludo, ultimaFraseIndex, cargadoPerfil]);

  useEffect(() => {
    let activo = true;
    async function cargar() {
      try {
        const resultado = await window.storage.get("cisd-instituciones");
        if (activo && resultado && resultado.value) {
          const datos = JSON.parse(resultado.value);
          if (datos.colegios) setColegios(datos.colegios);
          if (datos.cursos) setCursos(datos.cursos);
          if (datos.alumnosPorCurso) setAlumnosPorCurso(datos.alumnosPorCurso);
          if (datos.criterios) setCriterios(datos.criterios);
          if (datos.instanciasPorCurso) setInstanciasPorCurso(datos.instanciasPorCurso);
          if (datos.periodoPorCurso) setPeriodoPorCurso(datos.periodoPorCurso);
          if (datos.criteriosUsadosP1PorCurso) setCriteriosUsadosP1PorCurso(datos.criteriosUsadosP1PorCurso);
          if (datos.p2ReactivadoPorCurso) setP2ReactivadoPorCurso(datos.p2ReactivadoPorCurso);
          if (datos.ordenPorCurso) setOrdenPorCurso(datos.ordenPorCurso);
          if (datos.asistenciaPorCurso) setAsistenciaPorCurso(datos.asistenciaPorCurso);
          if (datos.diasClasePorCurso) setDiasClasePorCurso(datos.diasClasePorCurso);
          if (typeof datos.notaAprobacion === "number") setNotaAprobacion(datos.notaAprobacion);
          if (datos.promedioAutoPorCurso) setPromedioAutoPorCurso(datos.promedioAutoPorCurso);
          if (datos.nombresColumnasPorColegio) setNombresColumnasPorColegio(datos.nombresColumnasPorColegio);
          if (datos.tourVistoPorPantalla) setTourVistoPorPantalla(datos.tourVistoPorPantalla);
          if (datos.notas) setNotas(datos.notas);
        }
      } catch (err) {
        // Primera vez: no hay nada guardado todavía.
      } finally {
        if (activo) setCargado(true);
      }
    }
    cargar();
    return () => { activo = false; };
  }, []);

  useEffect(() => {
    if (!cargado) return;
    window.storage.set("cisd-instituciones", JSON.stringify({ colegios, cursos, alumnosPorCurso, criterios, instanciasPorCurso, periodoPorCurso, criteriosUsadosP1PorCurso, p2ReactivadoPorCurso, ordenPorCurso, asistenciaPorCurso, diasClasePorCurso, notaAprobacion, nombresColumnasPorColegio, tourVistoPorPantalla, promedioAutoPorCurso, notas })).catch((err) => {
      console.error("No se pudo guardar automáticamente", err);
    });
  }, [colegios, cursos, alumnosPorCurso, criterios, instanciasPorCurso, periodoPorCurso, criteriosUsadosP1PorCurso, p2ReactivadoPorCurso, ordenPorCurso, asistenciaPorCurso, diasClasePorCurso, notaAprobacion, nombresColumnasPorColegio, tourVistoPorPantalla, promedioAutoPorCurso, notas, cargado]);

  // Mientras un curso está en 1° cuatrimestre, registra qué criterios
  // están activos en él. Es un registro acumulativo (nunca se borra algo
  // ya anotado, aunque el docente después quite el criterio), porque lo
  // que importa es "estuvo activo en algún momento del 1° cuatrimestre".
  useEffect(() => {
    if (!cargado) return;
    setCriteriosUsadosP1PorCurso((prev) => {
      let cambio = false;
      const siguiente = { ...prev };
      cursos.forEach((curso) => {
        const periodoActual = periodoPorCurso[curso.id] || "1";
        if (periodoActual !== "1") return;
        const activosAhora = criterios.filter((c) => c.activadoEnCursos.includes(curso.id)).map((c) => c.id);
        const previos = siguiente[curso.id] || [];
        const union = Array.from(new Set([...previos, ...activosAhora]));
        if (union.length !== previos.length) {
          siguiente[curso.id] = union;
          cambio = true;
        }
      });
      return cambio ? siguiente : prev;
    });
  }, [criterios, cursos, periodoPorCurso, cargado]);

  function mostrarToast(texto) {
    setToast({ show: true, text: texto });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast({ show: false, text: "" }), 1400);
  }

  function esCriterioNumerico(criterioId) {
    const c = criterios.find((x) => x.id === criterioId);
    return !!c && (c.tipo === "numerico" || c.tipo === "numerico_instancias");
  }

  // Si todavía no hay umbral de aprobación y la acción es sobre un
  // criterio numérico, la deja pendiente y muestra el popup una sola vez.
  function conAprobacionSiHaceFalta(criterioId, accion) {
    if (notaAprobacion == null && esCriterioNumerico(criterioId)) {
      setPendienteGuardado(() => accion);
    } else {
      accion();
    }
  }

  function agregarColegio(nombre) {
    const id = nuevoId("col");
    setColegios((prev) => [...prev, { id, nombre }]);
    mostrarToast("¡Listo, colegio creado!");
  }

  function renombrarColegio(id, nombre) {
    setColegios((prev) => prev.map((c) => (c.id === id ? { ...c, nombre } : c)));
    mostrarToast("Colegio actualizado");
  }

  // Renombra un encabezado de la planilla oficial (ej: "1° inf" -> "1° bim").
  // Si aplicarATodos es true, el nuevo nombre se guarda para todos los
  // colegios existentes; si no, solo para el colegio indicado.
  function renombrarColumnaNota(colegioIdActual, key, nuevoLabel, aplicarATodos) {
    setNombresColumnasPorColegio((prev) => {
      if (aplicarATodos) {
        const actualizado = { ...prev };
        colegios.forEach((c) => {
          actualizado[c.id] = { ...(actualizado[c.id] || {}), [key]: nuevoLabel };
        });
        return actualizado;
      }
      return { ...prev, [colegioIdActual]: { ...(prev[colegioIdActual] || {}), [key]: nuevoLabel } };
    });
    mostrarToast("¡Encabezado actualizado!");
  }

  function eliminarColegio(id) {
    const idsCursos = cursos.filter((c) => c.colegioId === id).map((c) => c.id);
    setColegios((prev) => prev.filter((c) => c.id !== id));
    setCursos((prev) => prev.filter((c) => c.colegioId !== id));
    setAlumnosPorCurso((prev) => {
      const copia = { ...prev };
      idsCursos.forEach((cid) => delete copia[cid]);
      return copia;
    });
    setInstanciasPorCurso((prev) => {
      const copia = { ...prev };
      idsCursos.forEach((cid) => delete copia[cid]);
      return copia;
    });
    if (colegioId === id) setColegioId(null);
    mostrarToast("Colegio eliminado");
  }

  function agregarCurso(colId, nombre, materia) {
    const id = nuevoId("curso");
    setCursos((prev) => [...prev, { id, colegioId: colId, nombre, materia: (materia || "").trim() }]);
    setCriterios((prev) => prev.map((c) => (
      c.porDefecto ? { ...c, activadoEnCursos: [...c.activadoEnCursos, id] } : c
    )));
    mostrarToast("¡Listo, curso creado!");
  }

  function renombrarCurso(id, nombre, materia) {
    setCursos((prev) => prev.map((c) => (c.id === id ? { ...c, nombre, materia: materia != null ? materia : c.materia } : c)));
    mostrarToast("Curso actualizado");
  }

  function eliminarCurso(id) {
    setCursos((prev) => prev.filter((c) => c.id !== id));
    setAlumnosPorCurso((prev) => {
      const copia = { ...prev };
      delete copia[id];
      return copia;
    });
    setInstanciasPorCurso((prev) => {
      const copia = { ...prev };
      delete copia[id];
      return copia;
    });
    setOrdenPorCurso((prev) => {
      const copia = { ...prev };
      delete copia[id];
      return copia;
    });
    setCriteriosUsadosP1PorCurso((prev) => {
      const copia = { ...prev };
      delete copia[id];
      return copia;
    });
    setP2ReactivadoPorCurso((prev) => {
      const copia = { ...prev };
      delete copia[id];
      return copia;
    });
    setCriterios((prev) => prev.map((c) => ({ ...c, activadoEnCursos: c.activadoEnCursos.filter((cid) => cid !== id) })));
    if (cursoId === id) setCursoId(null);
    if (fichaAlumnoId && cursoId === id) setFichaAlumnoId(null);
    mostrarToast("Curso eliminado");
  }

  function agregarAlumno(curId, nombre, genero) {
    const id = nuevoId("al");
    setAlumnosPorCurso((prev) => {
      const listaNueva = [...(prev[curId] || []), { id, nombre, genero: genero === "M" ? "M" : "F", eventos: [], notasOficiales: {}, fechaAlta: hoyISO() }];
      listaNueva.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
      return { ...prev, [curId]: listaNueva };
    });
  }

  function actualizarNotaOficial(curId, alumnoId, campo, valor) {
    // ¿Es la primera vez que se completa el 2º informe (de cualquiera de
    // los dos cuatrimestres) en este curso, y el promedio automático
    // todavía no está activado? Si es así, al terminar de guardar le
    // ofrecemos al docente activarlo (se aplica a todo el curso).
    const esInf2 = campo === "inf2c1" || campo === "inf2c2";
    let primeraCarga = false;
    if (esInf2 && String(valor).trim() !== "" && !promedioAutoPorCurso[curId]) {
      const alumnosDelCurso = alumnosPorCurso[curId] || [];
      const alumnoActual = alumnosDelCurso.find((a) => a.id === alumnoId);
      const yaTeniaValor = alumnoActual && (alumnoActual.notasOficiales || {})[campo];
      const otroAlumnoYaLoTiene = alumnosDelCurso.some(
        (a) => a.id !== alumnoId && (a.notasOficiales || {})[campo]
      );
      primeraCarga = !yaTeniaValor && !otroAlumnoYaLoTiene;
    }

    setAlumnosPorCurso((prev) => ({
      ...prev,
      [curId]: (prev[curId] || []).map((a) => (
        a.id === alumnoId ? { ...a, notasOficiales: { ...(a.notasOficiales || {}), [campo]: valor } } : a
      )),
    }));

    if (primeraCarga) {
      setPreguntaPromedio({ curId, campo });
    }
  }

  function actualizarNotaRecuperatorio(curId, alumnoId, instancia, valor) {
    const campo = instancia === "diciembre" ? "notaDiciembre" : "notaFebrero";
    setAlumnosPorCurso((prev) => ({
      ...prev,
      [curId]: (prev[curId] || []).map((a) => (
        a.id === alumnoId ? { ...a, [campo]: valor } : a
      )),
    }));
  }

  function borrarAlumno(curId, alumnoId) {
    setAlumnosPorCurso((prev) => ({
      ...prev,
      [curId]: (prev[curId] || []).filter((a) => a.id !== alumnoId),
    }));
    mostrarToast("Alumno eliminado");
  }

  // Permite corregir el nombre de un alumno ya cargado (por ejemplo, si se
  // tipeó mal). Como la lista se muestra ordenada alfabéticamente, al
  // cambiar el nombre se vuelve a ordenar.
  function renombrarAlumno(curId, alumnoId, nuevoNombre) {
    const nombre = nuevoNombre.trim();
    if (!nombre) return;
    setAlumnosPorCurso((prev) => {
      const listaNueva = (prev[curId] || []).map((a) => (a.id === alumnoId ? { ...a, nombre } : a));
      listaNueva.sort((a, b) => a.nombre.localeCompare(b.nombre, "es", { sensitivity: "base" }));
      return { ...prev, [curId]: listaNueva };
    });
    mostrarToast("Nombre actualizado");
  }

  // Hace avanzar el ciclo de una celda de asistencia: blanco → A → T → J → blanco.
  // Marca el recorrido guiado de una pantalla como ya visto, para que no
  // vuelva a abrirse solo (el docente igual puede volver a verlo desde
  // el menú "⋮ → Ayuda de esta pantalla").
  function marcarTourVisto(pantallaId) {
    setTourVistoPorPantalla((prev) => (prev[pantallaId] ? prev : { ...prev, [pantallaId]: true }));
  }

  function alternarCeldaAsistencia(curId, fecha, alumnoId) {
    const SIGUIENTE = { "": "A", A: "T", T: "J", J: "" };
    setAsistenciaPorCurso((prev) => {
      const diasCurso = prev[curId] || {};
      const dia = diasCurso[fecha] || { motivo: null, marcas: {} };
      const actual = (dia.marcas || {})[alumnoId] || "";
      const siguiente = SIGUIENTE[actual];
      const nuevasMarcas = { ...dia.marcas, [alumnoId]: siguiente };
      if (siguiente === "") delete nuevasMarcas[alumnoId];
      return {
        ...prev,
        [curId]: { ...diasCurso, [fecha]: { ...dia, marcas: nuevasMarcas } },
      };
    });
  }

  // Marca, edita o quita el motivo de "día no trabajado" para una fecha.
  // motivo === null quita la marca (el día vuelve a estar disponible).
  function setMotivoNoTrabajado(curId, fecha, motivo) {
    setAsistenciaPorCurso((prev) => {
      const diasCurso = prev[curId] || {};
      const dia = diasCurso[fecha] || { motivo: null, marcas: {} };
      return {
        ...prev,
        [curId]: { ...diasCurso, [fecha]: { ...dia, motivo: motivo && motivo.trim() ? motivo.trim() : null } },
      };
    });
  }

  // Configura (o reconfigura) los días de la semana que se dictan en un
  // curso. Es solo orientativo: no borra ni afecta asistencia ya cargada.
  function setDiasClaseCurso(curId, dias) {
    setDiasClasePorCurso((prev) => ({ ...prev, [curId]: dias }));
  }

  function agregarNota(texto, colegioId, cursoId) {
    const nueva = { id: fechaISO() + "-" + Math.random().toString(36).slice(2, 8), texto, fecha: fechaISO(), colegioId: colegioId || null, cursoId: cursoId || null };
    setNotas((prev) => [nueva, ...prev]);
  }
  function editarNota(id, texto) {
    setNotas((prev) => prev.map((n) => n.id === id ? { ...n, texto } : n));
  }
  function eliminarNota(id) {
    setNotas((prev) => prev.filter((n) => n.id !== id));
  }

  // Guarda la sugerencia directo en Supabase (tabla "sugerencias"), sin
  // pasar por window.storage: es un canal aparte, provisorio mientras
  // dure la prueba con los colegas.
  async function enviarSugerencia(texto) {
    const { data } = await supabase.auth.getSession();
    const sesionActual = data && data.session;
    if (!sesionActual) return false;
    const { error } = await supabase.from("sugerencias").insert({
      user_id: sesionActual.user.id,
      correo: sesionActual.user.email,
      texto,
    });
    return !error;
  }

  // Prende/apaga el cálculo automático de promedios de la planilla oficial
  // para un curso puntual (no afecta a los demás cursos).
  function alternarPromedioAuto(curId) {
    setPromedioAutoPorCurso((prev) => ({ ...prev, [curId]: !prev[curId] }));
  }

  // Guardado simple (opción / texto / numérico sin instancias): siempre
  // agrega un registro nuevo al historial.
  function guardarEvento(curId, alumnoId, criterioId, valor, extra) {
    conAprobacionSiHaceFalta(criterioId, () => {
      const periodo = periodoPorCurso[curId] || "1";
      const nuevo = { id: nuevoId("ev"), criterioId, valor, periodo, fecha: fechaISO(), ...(extra || {}) };
      setAlumnosPorCurso((prev) => ({
        ...prev,
        [curId]: (prev[curId] || []).map((a) => (
          a.id === alumnoId ? { ...a, eventos: [...(a.eventos || []), nuevo] } : a
        )),
      }));
      mostrarToast("¡Guardado!");
    });
  }

  // Guardado de una nota de Evaluación escrita (criterio con instancias):
  // si la instancia ya tenía nota en este período, la actualiza en el
  // mismo registro (conserva id, fecha y recuperatorio); si no, crea uno.
  function guardarNotaInstancia(curId, alumnoId, criterioId, instanciaId, valor) {
    conAprobacionSiHaceFalta(criterioId, () => {
      const periodo = periodoPorCurso[curId] || "1";
      setAlumnosPorCurso((prev) => ({
        ...prev,
        [curId]: (prev[curId] || []).map((a) => {
          if (a.id !== alumnoId) return a;
          const eventos = a.eventos || [];
          const idx = eventos.findIndex((e) => e.criterioId === criterioId && e.instanciaId === instanciaId && e.periodo === periodo);
          if (idx >= 0) {
            const copia = [...eventos];
            copia[idx] = { ...copia[idx], valor };
            return { ...a, eventos: copia };
          }
          const nuevo = { id: nuevoId("ev"), criterioId, valor, periodo, instanciaId, fecha: fechaISO() };
          return { ...a, eventos: [...eventos, nuevo] };
        }),
      }));
      mostrarToast("¡Guardado!");
    });
  }

  // Adjunta (o edita) el recuperatorio de una nota ya registrada. Comparte
  // la misma fecha del registro original, porque no se toca `.fecha`.
  function setRecuperatorio(curId, alumnoId, eventoId, valor) {
    setAlumnosPorCurso((prev) => ({
      ...prev,
      [curId]: (prev[curId] || []).map((a) => (
        a.id === alumnoId
          ? { ...a, eventos: (a.eventos || []).map((e) => (e.id === eventoId ? { ...e, recuperatorio: { valor } } : e)) }
          : a
      )),
    }));
    mostrarToast("¡Recuperatorio guardado!");
  }

  function setPeriodoCurso(curId, periodo) {
    const periodoAnterior = periodoPorCurso[curId] || "1";
    const esPrimeraEntradaA2 = periodo === "2" && periodoAnterior === "1" && !p2ReactivadoPorCurso[curId];
    if (esPrimeraEntradaA2) {
      const usadosEnP1 = criteriosUsadosP1PorCurso[curId] || [];
      if (usadosEnP1.length > 0) {
        setCriterios((prev) => prev.map((c) => (
          usadosEnP1.includes(c.id) && !c.activadoEnCursos.includes(curId)
            ? { ...c, activadoEnCursos: [...c.activadoEnCursos, curId] }
            : c
        )));
        mostrarToast("Se repitieron los criterios del 1° cuatrimestre");
      }
      setP2ReactivadoPorCurso((prev) => ({ ...prev, [curId]: true }));
    }
    setPeriodoPorCurso((prev) => ({ ...prev, [curId]: periodo }));
  }

  function reordenarCriterios(curId, nuevoOrdenIds, aplicarATodos) {
    if (aplicarATodos) {
      setCriterios((prev) => {
        const pos = new Map(nuevoOrdenIds.map((id, i) => [id, i]));
        return prev.map((c) => (pos.has(c.id) ? { ...c, orden: pos.get(c.id) } : c));
      });
      setOrdenPorCurso((prev) => {
        const copia = { ...prev };
        delete copia[curId];
        return copia;
      });
      mostrarToast("Listo, se aplicó a todos tus cursos");
    } else {
      setOrdenPorCurso((prev) => ({ ...prev, [curId]: nuevoOrdenIds }));
      mostrarToast("Orden actualizado en este curso");
    }
  }

  function borrarEvento(curId, alumnoId, eventoId) {
    setAlumnosPorCurso((prev) => ({
      ...prev,
      [curId]: (prev[curId] || []).map((a) => (
        a.id === alumnoId ? { ...a, eventos: (a.eventos || []).filter((e) => e.id !== eventoId) } : a
      )),
    }));
  }

  function agregarInstanciaEvaluacion(curId, criterioId, nombre) {
    const id = nuevoId("inst");
    setInstanciasPorCurso((prev) => {
      const delCurso = prev[curId] || {};
      const delCriterio = delCurso[criterioId] || [];
      return { ...prev, [curId]: { ...delCurso, [criterioId]: [...delCriterio, { id, nombre }] } };
    });
    return id;
  }

  function agregarCriterio(campo) {
    setCriterios((prev) => {
      const maxOrden = prev.reduce((m, c) => Math.max(m, c.orden || 0), -1);
      return [...prev, { ...campo, orden: maxOrden + 1 }];
    });
    mostrarToast("¡Listo! Por ahora activo solo en este curso");
  }

  function usarCriterio(criterioId, curId) {
    setCriterios((prev) => prev.map((c) => (
      c.id === criterioId && !c.activadoEnCursos.includes(curId)
        ? { ...c, activadoEnCursos: [...c.activadoEnCursos, curId] }
        : c
    )));
    mostrarToast("Sumado a este curso");
  }

  function usarCriterioEnTodos(criterioId) {
    const idsTodosLosCursos = cursos.map((c) => c.id);
    setCriterios((prev) => prev.map((c) => (
      c.id === criterioId ? { ...c, activadoEnCursos: idsTodosLosCursos, porDefecto: true } : c
    )));
    mostrarToast("Sumado a todos tus cursos");
  }

  function quitarCriterioDeCurso(criterioId, curId) {
    setCriterios((prev) => prev.map((c) => (
      c.id === criterioId ? { ...c, activadoEnCursos: c.activadoEnCursos.filter((id) => id !== curId) } : c
    )));
    mostrarToast("Quitado de este curso");
  }

  function editarCriterio(campoEditado) {
    setCriterios((prev) => prev.map((c) => (c.id === campoEditado.id ? { ...c, ...campoEditado } : c)));
    mostrarToast("Criterio actualizado");
  }

  function eliminarCriterioDefinitivo(criterioId) {
    setCriterios((prev) => prev.filter((c) => c.id !== criterioId));
    mostrarToast("Eliminado de todos los cursos");
  }

  function cursosDe(colId) {
    return cursos.filter((c) => c.colegioId === colId);
  }

  const cursosPorColegio = {};
  colegios.forEach((c) => { cursosPorColegio[c.id] = cursosDe(c.id); });

  if (!cargado || !cargadoPerfil) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.paper }}>
        <style>{`@import url('${FONT_URL}');`}</style>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, color: COLORS.inkSoft }}>Cargando…</div>
      </div>
    );
  }

  // Primera vez que se abre CISD en este dispositivo: todavía no hay
  // nombre de docente guardado. Se muestra la bienvenida y, después, el
  // cartel para elegir el nombre.
  if (!nombreDocente) {
    if (pasoBienvenida === "intro") {
      return <PantallaBienvenidaCISD onSiguiente={() => setPasoBienvenida("nombre")} />;
    }
    return (
      <>
        <PantallaBienvenidaCISD onSiguiente={() => {}} />
        <PopupElegirNombre
          titulo="¿Cómo querés que te llamemos?"
          subtitulo="Por ejemplo: Profe Luis, Seño Ana, o el apodo que prefieras. Lo vamos a usar para saludarte."
          textoBoton="Empezar"
          onConfirmar={(nombre) => setNombreDocente(nombre)}
        />
      </>
    );
  }

  // Ya hay nombre guardado: si todavía no se mostró el saludo de la
  // franja horaria actual en el día de hoy, se muestra antes de entrar
  // a la app.
  const franjaHoy = franjaHorariaActual();
  const yaVioSaludoHoy = registroSaludo.fecha === hoyISO() && (registroSaludo.franjas || []).includes(franjaHoy);
  if (!yaVioSaludoHoy) {
    return (
      <PantallaSaludoFranja
        nombre={nombreDocente}
        franja={franjaHoy}
        indiceFraseAnterior={ultimaFraseIndex}
        onContinuar={(indiceFrase) => {
          setUltimaFraseIndex(indiceFrase);
          setRegistroSaludo((prev) => {
            const mismaFecha = prev.fecha === hoyISO();
            const franjas = mismaFecha ? [...(prev.franjas || []), franjaHoy] : [franjaHoy];
            return { fecha: hoyISO(), franjas };
          });
        }}
      />
    );
  }

  const colegioActual = colegios.find((c) => c.id === colegioId) || null;
  const cursoActual = cursos.find((c) => c.id === cursoId) || null;
  const alumnoActual = cursoActual ? (alumnosPorCurso[cursoActual.id] || []).find((a) => a.id === fichaAlumnoId) || null : null;

  let pantalla = "colegios";
  if (colegioActual && cursoActual && alumnoActual) pantalla = "ficha";
  else if (colegioActual && cursoActual) pantalla = "aula";
  else if (colegioActual) pantalla = "cursos";

  if (mostrarHorario) {
    return (
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
        <style>{`@import url('${FONT_URL}'); * { box-sizing: border-box; }`}</style>
        <PantallaHorarioDocente
          colegios={colegios}
          cursosPorColegio={cursosPorColegio}
          diasClasePorCurso={diasClasePorCurso}
          onSetDiasClaseCurso={setDiasClaseCurso}
          onVolverApp={() => setMostrarHorario(false)}
          tourVistoPorPantalla={tourVistoPorPantalla}
          onMarcarTourVistoPantalla={marcarTourVisto}
        />
      </div>
    );
  }

  if (mostrarNotas) {
    return (
      <div style={{ fontFamily: "'IBM Plex Sans', sans-serif" }}>
        <style>{`@import url('${FONT_URL}'); * { box-sizing: border-box; }`}</style>
        <PantallaNotas
          colegios={colegios}
          cursosPorColegio={cursosPorColegio}
          notas={notas}
          onAgregarNota={agregarNota}
          onEditarNota={editarNota}
          onEliminarNota={eliminarNota}
          onVolver={() => setMostrarNotas(false)}
          tourVisto={!!tourVistoPorPantalla.bitacora}
          onMarcarTourVisto={() => marcarTourVisto("bitacora")}
        />
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", background: COLORS.paper, minHeight: "100vh", display: "flex", justifyContent: esEscritorio ? "flex-start" : "center" }}>
      <style>{`@import url('${FONT_URL}');
        * { box-sizing: border-box; }
        button:focus-visible, span:focus-visible { outline: 2px solid ${COLORS.ochre}; outline-offset: 2px; }
        @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
        @keyframes tildePop {
          0% { transform: scale(0.5); opacity: 0; }
          35% { transform: scale(1.3); opacity: 1; }
          60% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1); opacity: 0; }
        }
        .tilde-anim { display: inline-block; animation: tildePop 300ms ease forwards; }
      `}</style>

      {esEscritorio && (
        <SidebarEscritorio
          colegios={colegios}
          cursosPorColegio={cursosPorColegio}
          colegioId={colegioId}
          cursoId={cursoId}
          onIrAInicio={() => { setColegioId(null); setCursoId(null); setFichaAlumnoId(null); }}
          onIrAColegio={(col) => { setColegioId(col.id); setCursoId(null); setFichaAlumnoId(null); }}
          onIrACurso={(col, curso) => { setColegioId(col.id); setCursoId(curso.id); setFichaAlumnoId(null); }}
          onIrAHorario={() => setMostrarHorario(true)}
          onIrANotas={() => setMostrarNotas(true)}
        />
      )}

      <div style={{ width: "100%", maxWidth: esEscritorio ? 760 : 480, margin: esEscritorio ? "0 auto" : 0, flex: esEscritorio ? "1 1 0%" : "none", minWidth: 0 }}>
        {pantalla === "colegios" && (
          <>
            <div style={{ background: COLORS.pineDark, padding: "8px 18px 8px 18px", color: COLORS.white, position: "relative" }}>
              <div style={{ position: "absolute", top: 5, right: 10 }}>
                <BotonMenuAyuda onAyuda={() => refAyudaColegios.current && refAyudaColegios.current()} mostrarSugerencia />
              </div>
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, fontWeight: 700, color: COLORS.ochreSoft, letterSpacing: 0.4, marginBottom: 2, paddingRight: 26 }}>
                CISD
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600 }}>Mis colegios</div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <span
                    onClick={() => setMostrarHorario(true)}
                    style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 700, color: COLORS.pineDark, background: COLORS.ochre, padding: "7px 10px", borderRadius: 999 }}
                  >
                    <CalendarDays size={13} strokeWidth={2.4} /> Horario
                  </span>
                  <span
                    onClick={() => setMostrarNotas(true)}
                    style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 11.5, fontWeight: 700, color: COLORS.pineDark, background: COLORS.ochre, padding: "7px 10px", borderRadius: 999 }}
                  >
                    <StickyNote size={13} strokeWidth={2.4} /> Bitácora
                  </span>
                </div>
              </div>
            </div>
            <PantallaColegios
              colegios={colegios}
              cursosPorColegio={cursosPorColegio}
              onAbrir={(col) => setColegioId(col.id)}
              onAgregar={agregarColegio}
              onRenombrar={renombrarColegio}
              onEliminar={eliminarColegio}
              tourVisto={!!tourVistoPorPantalla.colegios}
              onMarcarTourVisto={() => marcarTourVisto("colegios")}
              onAyudaRef={refAyudaColegios}
            />
          </>
        )}

        {pantalla === "cursos" && (
          <PantallaCursos
            colegio={colegioActual}
            cursos={cursosDe(colegioActual.id)}
            alumnosPorCurso={alumnosPorCurso}
            onAbrir={(curso) => setCursoId(curso.id)}
            onAgregar={agregarCurso}
            onVolver={() => setColegioId(null)}
            onRenombrar={renombrarCurso}
            onEliminar={eliminarCurso}
            tourVisto={!!tourVistoPorPantalla.cursos}
            onMarcarTourVisto={() => marcarTourVisto("cursos")}
          />
        )}

        {pantalla === "aula" && (
          <PantallaAula
            colegio={colegioActual}
            curso={cursoActual}
            alumnos={alumnosPorCurso[cursoActual.id] || []}
            onAgregarAlumno={(nombre, genero) => agregarAlumno(cursoActual.id, nombre, genero)}
            onBorrarAlumno={(alumnoId) => borrarAlumno(cursoActual.id, alumnoId)}
            onEditarAlumno={(alumnoId, nuevoNombre) => renombrarAlumno(cursoActual.id, alumnoId, nuevoNombre)}
            onAbrirFicha={(al) => setFichaAlumnoId(al.id)}
            onVolver={() => setCursoId(null)}
            criterios={criterios}
            onAgregarCriterio={agregarCriterio}
            onUsarCriterio={usarCriterio}
            onUsarCriterioEnTodos={usarCriterioEnTodos}
            onQuitarCriterio={quitarCriterioDeCurso}
            onEditarCriterio={editarCriterio}
            onEliminarCriterioDefinitivo={eliminarCriterioDefinitivo}
            ordenPorCurso={ordenPorCurso}
            onReordenarCriterios={reordenarCriterios}
            periodo={periodoPorCurso[cursoActual.id] || "1"}
            onCambiarPeriodo={(p) => setPeriodoCurso(cursoActual.id, p)}
            instanciasPorCriterio={instanciasPorCurso[cursoActual.id] || {}}
            onGuardarMasivo={(alumnoId, criterioId, valor, instanciaId) => guardarNotaInstancia(cursoActual.id, alumnoId, criterioId, instanciaId, valor)}
            onAgregarInstancia={(criterioId, nombre) => agregarInstanciaEvaluacion(cursoActual.id, criterioId, nombre)}
            notaAprobacion={notaAprobacion}
            onCambiarNotaAprobacion={setNotaAprobacion}
            onCambiarNotaOficial={(alumnoId, campo, valor) => actualizarNotaOficial(cursoActual.id, alumnoId, campo, valor)}
            onCambiarNotaRecuperatorio={(alumnoId, instancia, valor) => actualizarNotaRecuperatorio(cursoActual.id, alumnoId, instancia, valor)}
            nombresColumnasPorColegio={nombresColumnasPorColegio}
            onRenombrarColumnaNota={renombrarColumnaNota}
            diasCurso={asistenciaPorCurso[cursoActual.id] || {}}
            diasClaseConfig={diasClasePorCurso[cursoActual.id] || []}
            onAlternarCeldaAsistencia={(fecha, alumnoId) => alternarCeldaAsistencia(cursoActual.id, fecha, alumnoId)}
            onSetMotivoNoTrabajado={(fecha, motivo) => setMotivoNoTrabajado(cursoActual.id, fecha, motivo)}
            onSetDiasClase={(dias) => setDiasClaseCurso(cursoActual.id, dias)}
            tourVisto={!!tourVistoPorPantalla.aula}
            onMarcarTourVisto={() => marcarTourVisto("aula")}
            tourVistoPorPantalla={tourVistoPorPantalla}
            onMarcarTourVistoPantalla={marcarTourVisto}
            promedioAuto={!!promedioAutoPorCurso[cursoActual.id]}
            onTogglePromedioAuto={() => alternarPromedioAuto(cursoActual.id)}
          />
        )}

        {pantalla === "ficha" && (
          <PantallaFichaAlumno
            colegio={colegioActual}
            curso={cursoActual}
            alumno={alumnoActual}
            periodo={periodoPorCurso[cursoActual.id] || "1"}
            criteriosActivos={criterios.filter((c) => c.activadoEnCursos.includes(cursoActual.id))}
            todosLosCriterios={criterios}
            ordenPorCurso={ordenPorCurso}
            onReordenarCriterios={(nuevoOrden, aplicarATodos) => reordenarCriterios(cursoActual.id, nuevoOrden, aplicarATodos)}
            instanciasPorCriterio={instanciasPorCurso[cursoActual.id] || {}}
            notaAprobacion={notaAprobacion}
            diasCurso={asistenciaPorCurso[cursoActual.id] || {}}
            onGuardarEvento={(alumnoId, criterioId, valor, extra) => guardarEvento(cursoActual.id, alumnoId, criterioId, valor, extra)}
            onGuardarNotaInstancia={(alumnoId, criterioId, instanciaId, valor) => guardarNotaInstancia(cursoActual.id, alumnoId, criterioId, instanciaId, valor)}
            onAgregarInstancia={(criterioId, nombre) => agregarInstanciaEvaluacion(cursoActual.id, criterioId, nombre)}
            onBorrarEvento={(alumnoId, eventoId) => borrarEvento(cursoActual.id, alumnoId, eventoId)}
            onSetRecuperatorio={(alumnoId, eventoId, valor) => setRecuperatorio(cursoActual.id, alumnoId, eventoId, valor)}
            onCambiarNotaOficial={(alumnoId, campo, valor) => actualizarNotaOficial(cursoActual.id, alumnoId, campo, valor)}
            nombresColumnasPorColegio={nombresColumnasPorColegio}
            onVolver={() => setFichaAlumnoId(null)}
            tourVisto={!!tourVistoPorPantalla.ficha}
            onMarcarTourVisto={() => marcarTourVisto("ficha")}
            promedioAuto={!!promedioAutoPorCurso[cursoActual.id]}
            onTogglePromedioAuto={() => alternarPromedioAuto(cursoActual.id)}
          />
        )}
      </div>

      {pendienteGuardado && (
        <PopupNotaAprobacion
          onConfirmar={(n) => {
            setNotaAprobacion(n);
            const accion = pendienteGuardado;
            setPendienteGuardado(null);
            accion();
          }}
        />
      )}

      {preguntaPromedio && (
        <PopupPromedioAuto
          onConfirmar={() => {
            setPromedioAutoPorCurso((prev) => ({ ...prev, [preguntaPromedio.curId]: true }));
            setPreguntaPromedio(null);
          }}
          onCancelar={() => setPreguntaPromedio(null)}
        />
      )}

      {mostrarCambiarNombre && (
        <PopupElegirNombre
          valorInicial={nombreDocente || ""}
          titulo="Cambiar tu nombre"
          subtitulo="Así te vamos a saludar de ahora en más."
          textoBoton="Guardar"
          onConfirmar={(nombre) => { setNombreDocente(nombre); setMostrarCambiarNombre(false); }}
          onCancelar={() => setMostrarCambiarNombre(false)}
        />
      )}

      {mostrarSugerencia && (
        <PopupSugerencia
          onEnviar={enviarSugerencia}
          onCerrar={() => setMostrarSugerencia(false)}
        />
      )}

      <Toast show={toast.show} text={toast.text} />
    </div>
  );
}

// Pantalla que se muestra antes de entrar a la app: pide el correo del
// docente y le manda un link mágico para iniciar sesión (sin contraseña
// que recordar). Al tocar el link del mail, Supabase detecta sola la
// sesión y AuthGate deja pasar a la app.
// El PIN nunca se guarda "tal cual" en el celular: se guarda un hash
// (una huella digital irreversible) usando la Web Crypto del propio
// navegador, sin depender de ninguna librería externa.
async function hashPin(pin) {
  const datos = new TextEncoder().encode(pin);
  const buffer = await crypto.subtle.digest("SHA-256", datos);
  return Array.from(new Uint8Array(buffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function CasillerosPin({ valor }) {
  return (
    <div style={{ display: "flex", gap: 12, justifyContent: "center", marginBottom: 18 }}>
      {[0, 1, 2, 3].map((i) => (
        <div
          key={i}
          style={{
            width: 46, height: 54, borderRadius: 12, border: `1.5px solid ${COLORS.line}`,
            display: "flex", alignItems: "center", justifyContent: "center",
            fontFamily: "'IBM Plex Mono', monospace", fontSize: 22, fontWeight: 700, color: COLORS.pineDark,
            background: COLORS.white,
          }}
        >
          {valor[i] ? "•" : ""}
        </div>
      ))}
    </div>
  );
}

// Se muestra la primera vez que este dispositivo tiene sesión iniciada
// (o después de "¿Olvidaste tu PIN?"). Pide el PIN dos veces para
// confirmarlo, y lo guarda (hasheado) solo en este dispositivo.
function PantallaCrearPin({ onListo }) {
  const [paso, setPaso] = useState(1);
  const [pin1, setPin1] = useState("");
  const [pin2, setPin2] = useState("");
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current && inputRef.current.focus(); }, [paso]);

  function manejarCambio(valor) {
    const limpio = valor.replace(/\D/g, "").slice(0, 4);
    setError("");
    if (paso === 1) {
      setPin1(limpio);
      if (limpio.length === 4) setPaso(2);
    } else {
      setPin2(limpio);
      if (limpio.length === 4) confirmar(limpio);
    }
  }

  async function confirmar(segundo) {
    if (segundo !== pin1) {
      setError("Los códigos no coinciden. Empecemos de nuevo.");
      setPaso(1);
      setPin1("");
      setPin2("");
      return;
    }
    const hash = await hashPin(pin1);
    localStorage.setItem("cisd-pin-hash", hash);
    localStorage.removeItem("cisd-pin-recuperando");
    onListo();
  }

  const valorActual = paso === 1 ? pin1 : pin2;

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`@import url('${FONT_URL}'); * { box-sizing: border-box; }`}</style>
      <div style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, color: COLORS.ochre, letterSpacing: 0.5, marginBottom: 6 }}>CISD</div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 600, color: COLORS.pineDark, marginBottom: 6 }}>
          {paso === 1 ? "Creá tu PIN" : "Repetilo para confirmar"}
        </div>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.inkSoft, marginBottom: 20, lineHeight: 1.5 }}>
          {paso === 1 ? "Elegí 4 números. Los vas a usar para entrar rápido en este dispositivo." : "Escribilo una vez más, para estar seguros."}
        </div>
        <div style={{ position: "relative" }}>
          <CasillerosPin valor={valorActual} />
          <input
            ref={inputRef}
            type="tel"
            inputMode="numeric"
            value={valorActual}
            onChange={(e) => manejarCambio(e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, textAlign: "center", fontSize: 24 }}
          />
        </div>
        {error && <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.rose }}>{error}</div>}
      </div>
    </div>
  );
}

// Se muestra cada vez que se abre la app en un dispositivo que ya tiene
// un PIN creado. Si se olvida, "¿Olvidaste tu PIN?" manda un nuevo link
// al correo (por seguridad) y, al volver, deja crear un PIN nuevo.
function PantallaPedirPin({ correo, onDesbloqueado }) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [recuperando, setRecuperando] = useState(false);
  const [correoEnviado, setCorreoEnviado] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { inputRef.current && inputRef.current.focus(); }, []);

  async function verificar(valor) {
    const hashGuardado = localStorage.getItem("cisd-pin-hash");
    const hash = await hashPin(valor);
    if (hash === hashGuardado) {
      onDesbloqueado();
    } else {
      setError("PIN incorrecto. Probá de nuevo.");
      setPin("");
    }
  }

  function manejarCambio(valor) {
    const limpio = valor.replace(/\D/g, "").slice(0, 4);
    setPin(limpio);
    setError("");
    if (limpio.length === 4) verificar(limpio);
  }

  async function olvidoPin() {
    localStorage.setItem("cisd-pin-recuperando", "1");
    setRecuperando(true);
    await supabase.auth.signInWithOtp({ email: correo, options: { emailRedirectTo: window.location.origin } });
    setCorreoEnviado(true);
  }

  if (recuperando) {
    return (
      <div style={{ minHeight: "100vh", background: COLORS.paper, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
        <style>{`@import url('${FONT_URL}'); * { box-sizing: border-box; }`}</style>
        <div style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 600, color: COLORS.pineDark, marginBottom: 10 }}>
            {correoEnviado ? "Revisá tu correo" : "Enviando…"}
          </div>
          {correoEnviado && (
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.inkSoft, lineHeight: 1.5 }}>
              Te mandamos un link a <strong>{correo}</strong>. Abrilo desde este mismo dispositivo para crear un PIN nuevo.
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`@import url('${FONT_URL}'); * { box-sizing: border-box; }`}</style>
      <div style={{ width: "100%", maxWidth: 320, textAlign: "center" }}>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, color: COLORS.ochre, letterSpacing: 0.5, marginBottom: 6 }}>CISD</div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 600, color: COLORS.pineDark, marginBottom: 20 }}>Ingresá tu PIN</div>
        <div style={{ position: "relative" }}>
          <CasillerosPin valor={pin} />
          <input
            ref={inputRef}
            type="tel"
            inputMode="numeric"
            value={pin}
            onChange={(e) => manejarCambio(e.target.value)}
            style={{ position: "absolute", inset: 0, opacity: 0, textAlign: "center", fontSize: 24 }}
          />
        </div>
        {error && <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.rose, marginBottom: 10 }}>{error}</div>}
        <span onClick={olvidoPin} style={{ cursor: "pointer", fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, color: COLORS.pine, fontWeight: 600 }}>
          ¿Olvidaste tu PIN?
        </span>
      </div>
    </div>
  );
}

function PantallaLogin() {
  const [correo, setCorreo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [error, setError] = useState("");

  async function enviarLink() {
    const limpio = correo.trim();
    if (!limpio || !limpio.includes("@")) {
      setError("Escribí un correo válido.");
      return;
    }
    setError("");
    setEnviando(true);
    const { error: err } = await supabase.auth.signInWithOtp({
      email: limpio,
      options: { emailRedirectTo: window.location.origin },
    });
    setEnviando(false);
    if (err) {
      setError("No se pudo enviar el correo. Probá de nuevo en un momento.");
      return;
    }
    setEnviado(true);
  }

  return (
    <div style={{ minHeight: "100vh", background: COLORS.paper, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <style>{`@import url('${FONT_URL}'); * { box-sizing: border-box; }`}</style>
      <div style={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13, fontWeight: 700, color: COLORS.ochre, letterSpacing: 0.5, marginBottom: 6 }}>CISD</div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 26, fontWeight: 600, color: COLORS.pineDark, marginBottom: 8 }}>
          {enviado ? "Revisá tu correo" : "Ingresá tu correo"}
        </div>

        {enviado ? (
          <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, color: COLORS.inkSoft, lineHeight: 1.5 }}>
            Te mandamos un link a <strong>{correo.trim()}</strong>. Abrilo desde este mismo dispositivo para entrar.
          </div>
        ) : (
          <>
            <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 13.5, color: COLORS.inkSoft, marginBottom: 18, lineHeight: 1.5 }}>
              Te vamos a mandar un link para entrar, sin necesidad de contraseña.
            </div>
            <input
              type="email"
              value={correo}
              onChange={(e) => setCorreo(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") enviarLink(); }}
              placeholder="tu-correo@ejemplo.com"
              autoFocus
              style={{ width: "100%", padding: "12px 14px", borderRadius: 12, border: `1.5px solid ${COLORS.line}`, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 15, color: COLORS.ink, marginBottom: 10, textAlign: "center" }}
            />
            {error && (
              <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 12.5, color: COLORS.rose, marginBottom: 10 }}>{error}</div>
            )}
            <button
              onClick={enviarLink}
              disabled={enviando}
              style={{
                width: "100%", padding: "12px", borderRadius: 999, border: "none", cursor: enviando ? "default" : "pointer",
                background: COLORS.pine, color: COLORS.white, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14.5, fontWeight: 700,
                opacity: enviando ? 0.6 : 1,
              }}
            >
              {enviando ? "Enviando…" : "Enviarme el link"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// Portón de acceso: mientras se confirma si hay sesión iniciada, muestra
// un loader. Sin sesión, muestra la pantalla de login. Con sesión activa,
// deja pasar directo a la app.
function AuthGate() {
  const [cargando, setCargando] = useState(true);
  const [sesion, setSesion] = useState(null);
  const [estadoPin, setEstadoPin] = useState(null); // "crear" | "pedir" | "desbloqueado"

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSesion(data.session);
      setCargando(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_evento, nuevaSesion) => {
      setSesion(nuevaSesion);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!sesion) {
      setEstadoPin(null);
      return;
    }
    const recuperando = localStorage.getItem("cisd-pin-recuperando") === "1";
    const hashGuardado = localStorage.getItem("cisd-pin-hash");
    setEstadoPin(recuperando || !hashGuardado ? "crear" : "pedir");
  }, [sesion]);

  if (cargando) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: COLORS.paper }}>
        <div style={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: 14, color: COLORS.inkSoft }}>Cargando…</div>
      </div>
    );
  }

  if (!sesion) return <PantallaLogin />;

  if (estadoPin === "crear") {
    return <PantallaCrearPin onListo={() => setEstadoPin("desbloqueado")} />;
  }
  if (estadoPin === "pedir") {
    return <PantallaPedirPin correo={sesion.user.email} onDesbloqueado={() => setEstadoPin("desbloqueado")} />;
  }
  if (estadoPin === "desbloqueado") {
    return <CISDNavegacion />;
  }
  return null;
}

export default function App() {
  return <AuthGate />;
}
