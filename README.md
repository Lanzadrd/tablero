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

## Atajos

Todos están en la ayuda (`?`). Sin un campo de texto activo ni un panel abierto:

| Tecla | Acción |
| --- | --- |
| `D` / `T` / `C` | Hoy / Tablero / Calendario |
| `N` · `⇧N` | Nueva tarea (en la vista abierta) · nueva columna |
| `1`–`9` | Nueva tarea en esa columna |
| `⌘K` o `/` | Buscar |
| `⌘Z` / `⇧⌘Z` | Deshacer / rehacer |
| `?` | Todos los atajos |

Sobre una tarea (las seleccionadas; si no, la que tiene el foco; si no, la que está bajo el
ratón en Hoy y Tablero):

| Tecla | Acción |
| --- | --- |
| `↑` `↓` (`J` `K`) · `←` `→` | Moverse · cambiar de columna |
| `↩` | Abrir |
| `X` | Completar |
| `H` / `M` / `L` / `0` | Para hoy / mañana / el próximo lunes / sin fecha |
| `A` · `F` | Algún día · «Lo primero» de hoy |
| `⌥1`–`⌥9` | Mover a esa columna |
| `⌘D` · `⌫` | Duplicar · eliminar |
| `Esc` | Soltar la selección |
| `Espacio` | Arrastrar con el teclado |

En el calendario, `←` `→` · `H` · `S` / `M` son anterior/siguiente · hoy · semana/mes, salvo
que haya una tarea con el foco o seleccionada (entonces actúan sobre ella).

## Buscar, seleccionar y enlazar

- **Buscar** (`⌘K` o `/`, o la lupa): tareas pendientes y completadas, las archivadas, las
  columnas («Ir a…») y los comandos, sin distinguir mayúsculas ni acentos. `↩` lleva a la
  tarea en el tablero con su detalle abierto.
- **Seleccionar varias**: `⌘clic` añade o quita, `⇧clic` coge un tramo de la misma columna y
  `⇧↑` `⇧↓` amplían. Con dos o más sale una barra abajo (Hoy, Mañana, Mover a…, Completar,
  Eliminar). Cada cambio en grupo se deshace de una vez.
- **Enlace a una tarea**: «Copiar enlace» en su detalle (`http://127.0.0.1:4747/t/<id>`). Al
  abrirlo, Tablero enseña esa tarea con su detalle abierto.

## Escribir tareas

«Nueva tarea» entiende lo que escribes y lo enseña debajo antes de añadirlo:
«Llamar a Marta mañana 10:30 #trabajo», «Dentista el viernes a las 9», «Revisar copias
cada lunes», «Leer Sapiens algún día». `#columna` la manda a esa columna. `⌥↩` añade el
texto tal cual, sin interpretar. Pegar varias líneas crea una tarea por línea. En el
calendario el día es el de la celda (se usan la hora, la `#columna` y la repetición).

- **Enlaces**: las URL del título salen como una píldora con el dominio (clic = se abre en
  otra pestaña). Si añades solo una URL, la tarea toma el título de la página y la URL va
  a las notas.
- **Pasos**: las líneas `- [ ] paso` de las notas se ven como casillas en el detalle; la
  fila muestra «2/5».
- **Repetir**: en el detalle (cada día, laborables, cada N semanas…, contando desde la
  fecha o desde que se completa). Al completarla aparece la siguiente; esto vive solo en
  Tablero (al iPhone llega cada tarea suelta).

## Hoy, algún día y el Dock

- **Hoy**: arriba «Lo primero» (marca una tarea con la estrella; solo una por día), luego
  las atrasadas («Pasar todas a hoy») y las de hoy por columna, ordenadas por hora. Al pasar
  por encima de una fila: estrella y «Mañana». Debajo, lo hecho hoy y la siguiente tarea sin
  fecha de cada proyecto que no tiene nada para hoy («Para hoy»). La primera vez que se abre
  la app cada día, arranca aquí.
- **Algún día**: en el detalle de una tarea; la deja sin fecha y la aparca en un grupo
  plegable al pie de su columna. Ponerle fecha la saca de ahí. No sale en Hoy ni en el
  calendario (y no viaja a Recordatorios: allí es una tarea sin fecha).
- **Sin fecha**: en la semana del calendario, el botón «Sin fecha» abre un panel con las
  tareas sin día para arrastrarlas a uno (y soltar una ahí le quita la fecha).
- **Dock**: el icono muestra cuántas tareas quedan para hoy o atrasadas. Su menú (clic
  derecho) tiene «Nueva tarea», «Hoy» y «Calendario».

## Proyectos, Bandeja y lo hecho

Cada columna puede ser un proyecto. En su menú (`…`):

- **Ficha del proyecto…**: carpeta del Mac (`~/Desktop/Claude Code/lto`), repositorio, producción,
  staging, fecha de entrega y otros enlaces. Lo que esté relleno sale como iconos bajo el nombre:
  la carpeta se abre en el Finder, los enlaces en otra pestaña y la terminal abre **Claude Code**
  en esa carpeta. Con ficha, bajo el nombre va también el pulso: «Entrega vie 9 oct» (en rojo si
  quedan dos días o menos), «Sin próxima acción» o «Parada · 12 d» (más de una semana sin crear ni
  completar nada, y nada con fecha para los próximos días).
- **Nueva sesión de Claude Code**: una sesión nueva en la carpeta del proyecto. Desde el detalle de
  una tarea, «Abrir en Claude Code» la empieza con la tarea ya escrita (título, notas y proyecto).
- **Lo hecho…**: lo completado esta semana, la pasada, este mes, el pasado o todo (también lo
  archivado), con «Copiar» en texto plano para el cliente o la factura.
- **Archivar completadas…**: tras confirmarlo, las pasa a `datos/archivo.json` (siguen en «Lo hecho» y
  en la búsqueda; no se puede deshacer).
- **Contraer**: la deja en una franja estrecha (se recuerda en cada Mac). Un clic la expande.
- **Archivar columna**: desaparece del tablero, Hoy, el calendario, `#columna` y `⌥1`–`⌥9`. Se
  restaura con «N archivadas», al final del tablero. En Recordatorios su lista sigue: si desde el
  iPhone se añade o se mueve una tarea a esa lista, la columna vuelve al tablero.

La **Bandeja** es la primera columna y siempre existe (no se archiva ni se borra): ahí llega lo que
se captura sin `#columna`. Para que lo que le dictes a Siri llegue también, en el iPhone: Ajustes ›
Recordatorios › Lista por omisión › Tablero · Bandeja.

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
