# Política de privacidad de Tablero Anuncios

Vigente desde el 27 de octubre de 2026.

Tablero es una aplicación personal de tareas que funciona en el Mac de quien la instala, sin servidores propios.
«Tablero Anuncios» es la app de Meta con la que Tablero se conecta a Meta para gestionar las campañas
publicitarias de su propietario. Solo la usa su propietario; no se ofrece a otras personas.

## Qué datos usa

Con los permisos que se conceden al conectar (`ads_management`, `ads_read`, `business_management`,
`pages_show_list`, `pages_read_engagement` y `pages_manage_ads`), Tablero lee y gestiona:

- el nombre y el identificador de Facebook de quien conecta, para saber a nombre de quién está la conexión;
- los portfolios, las cuentas publicitarias, las campañas, los conjuntos de anuncios, los anuncios y sus
  métricas (gasto, alcance, conversaciones, costes);
- las páginas de Facebook, sus cuentas de Instagram y el número de WhatsApp conectado a ellas, para elegir
  quién anuncia;
- las imágenes, los vídeos y los textos que se suben para crear anuncios.

Tablero no lee mensajes de WhatsApp, Messenger ni Instagram, ni datos personales de quienes ven los anuncios o
escriben: de ellos solo ve las cifras agregadas que da Meta, como el número de conversaciones.

## Dónde se guardan

En el Mac, en la carpeta de datos de Tablero (`~/Library/Application Support/Tablero/datos`):

- el token de acceso de Meta, en un archivo que solo puede leer el usuario del Mac;
- las plantillas y el registro de las campañas creadas desde Tablero.

Las imágenes y los vídeos van directamente a la cuenta publicitaria de Meta. No hay servidores de Tablero,
ni analítica, ni cookies de seguimiento.

## Con quién se comparten

- **Meta**, a través de su API: lo necesario para crear y gestionar los anuncios.
- **Anthropic**, solo al usar «Escribir con Claude» y con la clave de API propia del usuario: las imágenes del
  anuncio (reducidas), los textos, el nombre de la página, el público y las indicaciones, para que Claude
  proponga los textos. Anthropic los trata según
  [su política de privacidad](https://www.anthropic.com/legal/privacy).

Los datos no se venden ni se ceden a nadie más, ni se usan para publicidad.

## Cuánto tiempo se guardan

El token de Meta caduca a los 60 días aproximadamente y se borra al pulsar «Desconectar». Lo demás se guarda en
el Mac hasta que se borra.

## Borrar tus datos

1. En Tablero, **Anuncios › Desconectar** borra el token de Meta.
2. Borrar la carpeta `~/Library/Application Support/Tablero/datos` elimina todo lo demás (o solo `meta.json`,
   `anuncios.json` y `claude.json`, para dejar las tareas).
3. En Facebook, **Configuración y privacidad › Configuración › Integraciones comerciales** (o **Apps y sitios
   web**), quitar «Tablero Anuncios» retira sus permisos.

Como Tablero no tiene servidores, no queda ninguna otra copia que borrar.

## Contacto

Para cualquier pregunta sobre esta política: <https://github.com/Lanzadrd/tablero/issues>.
