# AtHouse

Aplicación para organizar compras, eventos y tareas del hogar.

## Funcionalidades

- **Compras:** lista de pendientes y completadas, con precio en pesos y conversión a dólares blue.
- **Calendario:** navegación mensual, selección directa de mes y año, asignación de compras y programación de eventos. Los eventos se identifican con un color por integrante: administrador verde, y miembros violeta, azul, rojo y amarillo según su orden de ingreso.
- **Eventos:** creación y edición de eventos con rangos de fechas, vencimientos y estados.
- **Cuentas y hogares:** registro con contraseña; el enlace de verificación también inicia la sesión automáticamente. Incluye recuperación de contraseña, invitaciones, acceso por nickname para miembros y administración del hogar. Cada hogar admite un administrador y hasta cuatro miembros; las invitaciones pendientes reservan lugar.
- **Persistencia:** compras, asignaciones, eventos, cuentas y hogares se guardan en PostgreSQL.

Las tareas y los eventos vencidos se conservan; el calendario permite mostrarlos con la opción de incluir vencidos.

## Requisitos

- Node.js 22 LTS.
- PostgreSQL instalado y en ejecución.
- Una cuenta SMTP para verificación de correo, recuperación, invitaciones, acceso de miembros y autenticación adicional por correo.

Sin SMTP, la API informa que los flujos que necesitan correo no están disponibles; no crea cuentas ni invitaciones como si el mensaje se hubiera enviado.

## Desarrollo local en Windows

1. Instalá PostgreSQL y creá el usuario y la base de datos. En `psql`, por ejemplo:

   ```sql
   CREATE ROLE athouse LOGIN PASSWORD 'elegí-una-clave-local';
   CREATE DATABASE athouse OWNER athouse;
   ```

2. Instalá dependencias y prepará la configuración:

   ```powershell
   npm ci
   Copy-Item .env.example .env
   ```

3. En `.env`, configurá `DATABASE_URL` con la clave elegida. Si contiene caracteres especiales, codificalos para URL. Completá SMTP para habilitar los flujos de correo.

   Generá un secreto local para las sesiones:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
   ```

   Pegá el resultado en `SESSION_SECRET`. Verificá también que `APP_ORIGIN` coincida con la dirección de Vite (por defecto `http://localhost:5173`).

4. Aplicá el esquema e iniciá la interfaz y la API:

   ```powershell
   npm run db:migrate
   npm run dev:full
   ```

   Abrí `http://localhost:5173`. La API queda disponible en `http://127.0.0.1:3001`; su estado se puede revisar en `/api/health`.

El comando `npm run dev` inicia solamente Vite. Para usar autenticación y datos se necesitan PostgreSQL y `npm run dev:full`.

## Compilación

```powershell
npm run build
```

## Despliegue

El frontend puede desplegarse en Netlify y la API Express en un servicio Node.js como Render. La API debe conectarse a una base PostgreSQL accesible desde internet; la base local de desarrollo no está disponible para el servicio desplegado. Configurá en el servicio de la API las variables `NODE_ENV=production`, `APP_ORIGIN` (URL exacta del sitio publicado en Netlify), `DATABASE_URL`, `SESSION_SECRET` (al menos 32 caracteres aleatorios) y las variables SMTP. No publiques `.env` ni subas secretos al repositorio.

Configurá Netlify para redirigir/proxificar `/api/*` hacia la URL pública de la API, conservando el prefijo `/api`. El cliente usa rutas relativas `/api`; el proxy permite que frontend y API compartan el origen para las cookies de sesión. El servidor escucha en el puerto asignado por la plataforma mediante `PORT`.

La autenticación adicional disponible es por código de correo. Passkeys/WebAuthn y la selección de varios hogares por una misma cuenta aún no están implementados.
