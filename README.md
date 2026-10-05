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

**Captura rápida**: «Tablero Avisos» pone un icono en la barra de menús. `⌥Espacio` abre un panel
para apuntar una tarea desde cualquier app (entiende lo mismo que «Nueva tarea») y `⌥⇧Espacio`, lo
mismo con la página abierta en Chrome (la primera vez macOS pide el permiso de Automatización para
Chrome). Los atajos se cambian en `datos/ajustes.json` (`{"atajoCaptura": "option+space",
"atajoCapturaPagina": "option+shift+space"}`; `""` desactiva uno).

Que los avisos salgan como globo y con sonido depende de los ajustes de notificaciones de
Recordatorios en cada dispositivo (la campana de Tablero lleva a ellos). El estado de la
sincronización se guarda en `datos/sincronizacion.json` y su registro en `datos/avisos.log`.

## Día a día

- **Hoy** (D): lo que vence hoy o está atrasado, de todas las columnas. «Lo primero» arriba
  (F), «Pasar todas a hoy», y la siguiente tarea de cada proyecto sin nada para hoy. El
  icono del Dock muestra cuántas quedan; la primera vez que se abre cada día, arranca aquí.
- **Escribir en lenguaje natural**: «Llamar a Marta mañana 10:30 #Trabajo», «Copias cada
  lunes», «Leer Sapiens algún día», «Pagar seguro 15/10». Solo se entienden fechas y horas
  al principio o al final; ⌥↩ guarda el texto tal cual.
- **Enlaces**: las URLs salen como píldoras; pegar una URL sola crea la tarea con el título
  de la página (los de GitHub, con `gh`). **Checklist**: líneas «- [ ] paso» en las notas.
  **Repetición**: en el detalle; al completarla se crea la siguiente.
- **Proyectos**: cada columna tiene ficha (carpeta, repo, producción, staging, entrega,
  enlaces), un pulso («Entrega vie», «Parada · 12 d»), «Lo hecho» para copiar al cliente,
  y se puede contraer o archivar. «Archivar completadas» las saca a `datos/archivo.json`.
- **Bandeja + Siri**: lo que llega de Siri o de la captura entra en la Bandeja; «#columna»
  al final lo manda a su sitio. Para Siri: en el iPhone, Ajustes › Recordatorios › Lista
  por omisión › «Tablero · Bandeja».
- **Captura global**: ⌥Espacio desde cualquier app (icono en la barra de menús);
  ⌥⇧Espacio añade la pestaña activa de Chrome. Atajos en `datos/ajustes.json`
  (`{"atajoCaptura": "option+space", "atajoCapturaPagina": "option+shift+space"}`).
- **Claude Code**: «Abrir en Claude Code» en una tarea abre una sesión en la carpeta del
  proyecto con la tarea escrita. Y el MCP (`npm run mcp` muestra cómo registrarlo) deja
  pedir a Claude «apunta esto en Tablero» o «¿qué tengo hoy?».

## Atajos

| Tecla | Acción |
| --- | --- |
| `D` / `T` / `C` | Hoy / Tablero / Calendario |
| `N` · `1`–`9` · `⇧N` | Nueva tarea · en esa columna · nueva columna |
| `⌘K` o `/` | Buscar (también completadas y archivadas) |
| `↑↓` `←→` (o `J`/`K`) | Moverse entre tareas y columnas |
| `X` · `H` · `M` · `L` · `0` | Completar · hoy · mañana · próxima semana · sin fecha |
| `A` · `F` · `⌥1`–`9` · `⌘D` · `⌫` | Algún día · lo primero · mover · duplicar · eliminar |
| `⌘clic` / `⇧clic` | Seleccionar varias (las teclas se aplican a todas) |
| `⌘Z` / `⇧⌘Z` | Deshacer / rehacer |
| `?` | Todos los atajos |

Las teclas de tareas actúan sobre la selección, la tarea enfocada o la que está bajo el
ratón. Cada tarea tiene enlace propio (`/t/<id>`, «Copiar enlace» en su detalle).

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

`npm run firma` crea (una vez) la identidad «Tablero (firma propia)» en el llavero, para que macOS
recuerde los permisos del ayudante entre versiones; su copia de seguridad (`firma-codigo.p12` y su
contraseña, `firma-codigo.clave`) va en la misma carpeta. **`~/.config/tablero` guarda claves
privadas**: no la subas a ningún repositorio (tiene un `.gitignore` con `*`) ni la sincronices; cópiala
solo a un sitio seguro (p. ej. un disco cifrado).

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
- MCP para Claude Code: `npm run mcp` imprime cómo registrarlo. Habla con el servidor de
  `TABLERO_PORT` (4747 por defecto; no usa `PORT`, que suele venir de otros proyectos) y antes
  comprueba que de verdad es Tablero.
