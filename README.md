# Tablero

Tareas en columnas y calendario, en local, con avisos en el iPhone a través de
Recordatorios de Apple. Se usa como una app de Chrome; los datos se quedan en el Mac.

## Instalar o actualizar

```bash
npm install       # solo la primera vez
npm run instalar  # compila, empaqueta e instala (las tareas se conservan)
```

`npm run instalar` deja todo en `~/Library/Application Support/Tablero/`:

- `app/` — la app instalada: servidor local (con su propio Node), web compilada y el ayudante de avisos.
- `datos/board.json` — tus tareas, con una copia diaria en `datos/copias/` (se guardan 30).
- `datos/servidor.log`, `datos/avisos.log` — registros.

Y registra dos servicios que arrancan solos al iniciar sesión (y se reinician si se caen):

| Servicio | Qué hace |
| --- | --- |
| `com.tablero.servidor` | Servidor en `http://127.0.0.1:4747` (solo accesible desde este Mac). |
| `com.tablero.avisos` | «Tablero Avisos»: sincroniza Tablero con Recordatorios (y así con el iPhone). |

Para tenerlo en el Dock, abre `http://127.0.0.1:4747` en Chrome y pulsa **Instalar**.
`npm run abrir` abre la ventana (o la arranca si hiciera falta).

## En el iPhone (Recordatorios)

Tablero se sincroniza en los dos sentidos con Recordatorios de Apple, que lo lleva al
iPhone por iCloud:

- Cada columna es una lista: «Tablero · Personal», «Tablero · Trabajo»… con su color.
- Lo que añadas, cambies, completes, muevas de lista o borres en el iPhone aparece en
  Tablero (en cuanto el Mac está encendido), y al revés. Si se cambia lo mismo en los dos
  sitios a la vez, gana Tablero.
- Las columnas se crean y se borran desde Tablero. Si se borra una lista en el iPhone, se
  vuelve a crear; renombrarla sí renombra la columna.
- Avisos: las tareas con hora avisan a la hora de inicio (o antes, configurable en cada
  tarea); las de todo el día, ese día a las 9:00 (hora local de cada Mac).
- Por seguridad, si desaparecen muchos recordatorios de golpe (iCloud resincronizando),
  no se borra nada en Tablero; y un borrado solo se aplica si se mantiene unos segundos.

Que los avisos salgan como globo y con sonido depende de los ajustes de notificaciones de
Recordatorios en cada dispositivo (la campana de Tablero lleva a ellos). El estado de la
sincronización se guarda en `datos/sincronizacion.json` y su registro en `datos/avisos.log`.

## Atajos

| Tecla | Acción |
| --- | --- |
| `T` / `C` | Tablero / Calendario |
| `N` | Nueva tarea (en el calendario, para hoy) |
| `1`–`9` | Nueva tarea en esa columna |
| `⇧N` | Nueva columna |
| `←` `→` · `H` · `S` / `M` | Calendario: anterior/siguiente · hoy · semana/mes |
| `⌘Z` / `⇧⌘Z` | Deshacer / rehacer |
| `?` | Todos los atajos |

En el calendario se puede escribir la hora con la tarea: «Dentista 10:30», «18h Pádel»,
«Cena a las 9».

## Publicar actualizaciones

```bash
npm run publicar -- "Qué hay de nuevo"           # 0.2.0 → 0.2.1
npm run publicar -- --menor "Vista de año"       # 0.2.1 → 0.3.0
```

Sube el código y una versión nueva a [GitHub](https://github.com/Lanzadrd/tablero/releases).
Cada Tablero instalado mira cada 6 horas (y al arrancar) si hay una versión nueva y se
actualiza solo, sin tocar las tareas; la ventana abierta ofrece «Recargar». Este Mac se
actualiza al momento.

Las versiones van firmadas con una clave que solo está en este Mac
(`~/.config/tablero/clave-privada.pem`) y los Tablero instalados solo aceptan lo firmado
con ella. **Guarda una copia de esa clave**: sin ella habría que reinstalar a mano en
cada Mac. El repositorio es público (código, nunca tareas).

Si una actualización cambia el ayudante de avisos (`avisos/`), macOS vuelve a pedir el
permiso de Recordatorios en cada Mac.

## Instalar en otro Mac

`npm run publicar` deja `Tablero.zip` en el Escritorio. Se manda por AirDrop y se instala
con `Instalar Tablero.command` (instrucciones en el `LEEME.txt` del zip). Requisitos:
Mac con chip Apple, macOS 14+ y Google Chrome. Cada Mac tiene sus propias tareas.

## Desarrollo

```bash
npm run dev    # Vite con recarga en caliente en http://127.0.0.1:5173 (datos de prueba en data/)
npm run build  # comprueba tipos y compila a dist/
```

- `src/` — la app (React + TypeScript). Modelo en `src/model.ts`, fusión de cambios en `src/merge.ts`.
- `server/` — servidor sin dependencias: web, API `/api/board`, eventos en vivo `/api/eventos`
  y actualizaciones automáticas (`actualizador.mjs`).
- `avisos/` — el ayudante de Recordatorios (Swift + EventKit): `Modelo.swift` (fusión, sin
  EventKit) y `Avisos.swift`. Pruebas: `swiftc -parse-as-library avisos/Modelo.swift
  avisos/Pruebas.swift -o /tmp/pruebas && /tmp/pruebas`. Solo se recompila si cambia,
  porque cada compilación nueva hace que macOS vuelva a pedir permiso.
- Probar sin tocar tus datos: `TABLERO_DATA_DIR=/tmp/prueba PORT=4848 npm start`.
