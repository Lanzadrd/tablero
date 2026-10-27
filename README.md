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
  pedir a Claude «apunta esto en Tablero», «¿qué tengo hoy?» o «¿cuánto pago al mes en
  suscripciones?».

## Suscripciones

La vista **Suscripciones** (`U`) apunta lo que pagas cada semana, mes, trimestre, semestre o año:
cuánto suma al mes y al año (por moneda: euros, dólares y libras nunca se mezclan) y el próximo
cobro. Las dadas de baja quedan plegadas al final y se pueden reactivar.

- **Por empresa**: cada suscripción pertenece a una columna del tablero («Personal», «LTO»…; una
  empresa nueva es una columna nueva). Se ven en columnas lado a lado, como el tablero, cada una con
  lo que suma al mes; dentro, por próximo cobro. Se arrastran de una columna a otra (con el teclado:
  `Espacio`, `←` `→` y `Espacio`) o se elige «Columna» en su ficha; «+ Suscripción» al pie de una
  columna la crea ahí. Las que no tienen columna salen en «Sin columna». Borrar una columna las deja
  sin columna (con deshacer); archivarla no las toca. En la **ficha del proyecto** de una columna,
  «Suscripciones · 3 · 28,22 € / mes» lleva a ellas.
- **Tarjetas**: cada suscripción puede llevar una tarjeta, que es solo un nombre y un color
  («BBVA», «Revolut»). **Nunca el número**: Tablero rechaza 6 cifras o más (vale «BBVA ··1234»).
  Pulsar una tarjeta filtra las columnas y los totales.
- **Avisos**: con «Aviso» (el mismo día, 1, 3 o 7 días antes), el servidor crea una tarea «Netflix
  se cobra el 15 oct · 12,99 € · BBVA» en la columna de la suscripción (en la Bandeja si no tiene o
  está archivada), que llega al iPhone como cualquier otra (con dos días de margen, por si el Mac se
  duerme). Una sola vez por cobro; si cambias el precio, la fecha o la tarjeta mientras está
  pendiente, se rehace, y si la cambias de columna, se va con ella (si borras o archivas su columna,
  pasa a la Bandeja). En el detalle de esa tarea, «Ver suscripción» lleva a su ficha. `TABLERO_SIN_AVISOS_SUSCRIPCIONES=1` los desactiva.
- Se guardan en `datos/board.json` con las tareas (copias diarias, deshacer y sincronización
  entre ventanas incluidos). Claude Code las ve con la herramienta `tablero_suscripciones` del MCP,
  con su columna, los totales por columna y, si se pide, solo las de una (`columna`) o una tarjeta.

## Anuncios

La vista **Anuncios** (`P`, en el menú lateral) enseña cómo van las campañas de las cuentas publicitarias de
todos tus portfolios y lanza campañas de mensajes a WhatsApp en Meta con tus opciones ya puestas.

- **Conectar (una vez)**: hace falta una app de Meta propia (developers.facebook.com, caso de uso «Crear y
  gestionar anuncios con la API de marketing»; sin revisión, pero publicada: en modo desarrollo Meta no deja
  crear anuncios, y para publicarla pide una URL de política de privacidad: sirve [PRIVACIDAD.md](PRIVACIDAD.md)).
  En su inicio de sesión con Facebook, añade `http://localhost:4747/api/meta/volver` a las URI de
  redireccionamiento (en desarrollo, también la del puerto 5173). Tablero pide su identificador y su clave secreta y abre la ventana de Meta; si la app usa
  «Inicio de sesión con Facebook para empresas», también el identificador de una configuración con token de
  usuario. La conexión dura unos 60 días (avisa una semana antes); «Volver a conectar» la renueva.
- **En marcha**: las campañas activas de la cuenta con su presupuesto y sus métricas de hoy, ayer, 7 o 30
  días, y los totales. «Métricas» elige cuáles se ven: gasto, conversaciones de WhatsApp, coste por
  conversación, contactos nuevos, alcance, impresiones, frecuencia, CPM, clics, CTR, CPC y bloqueos. Al pulsar
  una campaña se ven sus conjuntos, y al pulsar un conjunto, sus anuncios (con miniatura); las migas llevan de
  vuelta. Debajo de cada nombre sale lo que pasa de verdad (conjuntos en pausa, terminada, rechazado…). El
  interruptor pausa enseguida o activa (pide confirmación) campañas, conjuntos y anuncios; lo que está en pausa
  sin gasto en el periodo va plegado. Las campañas creadas desde Tablero se encienden enteras la primera vez y
  luego solo la campaña, para no reactivar lo que se pausara en Meta. Ocupa todo el ancho; el botón junto al
  nombre de la cuenta oculta la lista de cuentas para que quepan más columnas.
- **Nuevo conjunto**: dentro de una campaña (de interacción, clientes potenciales o ventas), el mismo formulario
  que una campaña nueva crea un conjunto de mensajes a WhatsApp con sus anuncios. Usa la página de los demás
  conjuntos y, si mandan los mensajes a un número concreto, ese número; si la campaña reparte su presupuesto,
  el conjunto no lleva. Se crea en pausa con los anuncios listos: se enciende con su interruptor.
- **Nueva campaña**: eliges la cuenta (agrupadas por portfolio), una **plantilla** (página, Instagram,
  presupuesto diario, lugares, edad, sexo, Advantage+, ubicaciones, textos, chat de WhatsApp y mejoras de Meta)
  y arrastras imágenes o vídeos: cada uno es un anuncio del mismo conjunto. «Crear en pausa» sube todo y crea
  campaña, conjunto y anuncios **en pausa**; si algo falla a medias, borra lo creado. Luego, «Revisar en Meta»
  (Administrador de anuncios) o «Activar» (pide confirmación: desde ahí gasta).
- **Orden del formulario**: nombre de la campaña (o del conjunto) arriba del todo; luego plantilla, quién
  anuncia, presupuesto, público (sin plantilla, **Ciudad del Este**), imágenes y vídeos, texto, chat y mejoras.
  Con sitio, a la derecha va la **vista previa** del anuncio en el feed de Facebook, el de Instagram y Stories
  y Reels (con la versión que toca en cada uno); sin sitio, debajo.
- **Texto**: texto principal, título y descripción (los dos últimos, opcionales). **Escribir con Claude** los
  escribe todos, y el chat de WhatsApp, con la API de Claude (Claude Opus 5.5): ve las imágenes, la página, el
  público, lo ya escrito y unas indicaciones opcionales; no inventa precios ni fechas, y se puede deshacer. La
  primera vez pide la clave de la API (console.anthropic.com), que se guarda en `datos/claude.json` (solo en este
  Mac, permisos 600; nunca vuelve a la web). Sin ella, usa `ANTHROPIC_API_KEY` si está.
- **Chat de WhatsApp**: vuestro mensaje (lo primero que ve la persona) y, para que empiece, su mensaje ya escrito
  o hasta 4 preguntas frecuentes que toca para enviarlas; con vista previa.
- **Formatos**: Tablero mide cada imagen o vídeo (9:16, 4:5, 1:1…). La versión vertical y la del feed de una
  pieza (mismo nombre sin el formato, como «2_9_16» y «2_4_5», o si solo hay esas dos) se juntan en **un solo
  anuncio**: la del feed en las ubicaciones de feed y la vertical en Stories, Reels, Estados de WhatsApp y el
  resto, como hace el Administrador de anuncios. Se pueden separar o juntar a mano.
- Con Advantage+ activado, Meta solo admite la edad mínima (hasta 25) y decide el resto.
- **Mejoras automáticas de Meta** (Advantage+ creative: retoques, superposiciones, mejoras de texto,
  comentarios relevantes, traducción, stickers…) y **anuncios multianunciante**: sin decir nada, Meta activa
  algunas por su cuenta. Tablero las manda todas, desactivadas salvo las que se marquen en el formulario (se
  guardan en la plantilla); las de catálogo y web, siempre desactivadas. En «En marcha», los anuncios que tienen
  alguna activada lo enseñan («2 automáticas») con la lista.
- **Páginas e Instagram**: las páginas son las que ya usa la cuenta y todas las de su portfolio. La app de
  anuncios no tiene el permiso `instagram_basic`, así que Meta solo le enseña la cuenta de Instagram vinculada a
  la página; Tablero ofrece también las que ya usan los anuncios de esa página (en esa cuenta o, si no, en las
  demás; el nombre sale de su publicación en Instagram), que son las que se eligen en el Administrador de
  anuncios.
- La app de Meta y el token se guardan en `datos/meta.json` (solo en este Mac, permisos 600) y nunca llegan a
  la web; las plantillas y las campañas creadas, en `datos/anuncios.json`. Versión de la API: v26.0
  (`TABLERO_META_VERSION` la cambia).

## Atajos

| Tecla | Acción |
| --- | --- |
| `D` / `T` / `C` / `U` / `P` | Hoy / Tablero / Calendario / Suscripciones / Anuncios |
| `⌃⌘S` | Mostrar u ocultar el menú lateral |
| `N` · `1`–`9` · `⇧N` | Nueva tarea (en Suscripciones, nueva suscripción) · en esa columna · nueva columna |
| `⌘K` o `/` | Buscar (también completadas y archivadas) |
| `↑↓` `←→` (o `J`/`K`) | Moverse entre tareas (o suscripciones) y columnas |
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
  Las cuentas de las suscripciones (cobros, importes, avisos) están en `server/suscripciones.mjs`,
  compartidas por la app, el servidor y el MCP.
- `server/` — servidor sin dependencias: web, API `/api/board`, eventos en vivo `/api/eventos`
  y actualizaciones automáticas (`actualizador.mjs`). Anuncios: la conexión con Meta en `meta.mjs` y lo
  que se manda para crear campañas en `anuncios.mjs` (probado con una Meta de mentira, sin internet).
- `avisos/` — el ayudante de Recordatorios (Swift + EventKit): `Modelo.swift` (fusión, sin
  EventKit) y `Avisos.swift`. Pruebas: `swiftc -parse-as-library avisos/Modelo.swift
  avisos/Pruebas.swift -o /tmp/pruebas && /tmp/pruebas`. Solo se recompila si cambia,
  porque cada compilación nueva hace que macOS vuelva a pedir permiso.
- Probar sin tocar tus datos: `TABLERO_DATA_DIR=/tmp/prueba PORT=4848 npm start`.
- MCP para Claude Code: `npm run mcp` imprime cómo registrarlo. Habla con el servidor de
  `TABLERO_PORT` (4747 por defecto; no usa `PORT`, que suele venir de otros proyectos) y antes
  comprueba que de verdad es Tablero.
