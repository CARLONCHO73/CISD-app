# CISD — Cuaderno Integral de Seguimiento Docente

## Probar en tu computadora (opcional)

```bash
npm install
npm run dev
```

Abre la dirección que te muestre la terminal (normalmente `http://localhost:5173`).

## Subir a GitHub

1. Creá un repositorio nuevo en GitHub (podés dejarlo vacío, sin README).
2. En la pantalla de bienvenida del repositorio vacío, buscá el link "uploading an existing file".
3. Abrí esta carpeta en tu computadora, seleccioná TODO lo que está adentro (Ctrl+A o Cmd+A) y arrastralo al cuadro punteado de GitHub. Esperá a que la barra llegue al 100%.
4. Abajo, "Commit changes" (botón verde).

## Desplegar en Vercel

1. Entrá a vercel.com → "Sign Up" (o "Log in") → "Continue with GitHub".
2. "Add New..." → "Project".
3. Elegí el repositorio que acabás de crear → "Import".
4. No cambies nada de la configuración (ya está todo preparado) → "Deploy".
5. Esperá un minuto. Al final te da un link (tipo cisd-xxxxx.vercel.app).

Ese es el link para compartir con tus colegas.

## Instalar en el celular como app (pantalla completa, sin barra del navegador)

1. Abrí el link en el celular con Chrome (Android) o Safari (iPhone).
2. Tocá el menú (tres puntitos en Android, ícono de compartir en iPhone) → "Agregar a pantalla de inicio" / "Instalar app".
3. Confirmá.

Va a quedar un ícono de CISD en la pantalla de inicio. Al abrirlo desde ahí, se ve en pantalla completa, sin la barra de direcciones del navegador.

## Importante sobre los datos guardados

Cada docente que abra el link guarda sus datos (nombre, colegios, alumnos, notas) en su propio navegador/dispositivo, no en un servidor compartido. Esto significa:

- Nadie ve los datos de otro colega.
- Si un docente entra desde el celular y después desde la computadora, va a ver dos "espacios" distintos (no se sincronizan solos entre dispositivos).
- Si borra el historial/datos de navegación del navegador, pierde lo cargado en CISD.

Si en algún momento quieren que los datos se guarden en un servidor real (con usuarios, contraseña, y sincronización entre dispositivos), es un paso más grande — avisame cuando lleguen a esa necesidad y lo armamos.
