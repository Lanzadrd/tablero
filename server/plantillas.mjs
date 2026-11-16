// Las plantillas en el formulario de un anuncio: qué pone una plantilla (de anuncio o de campaña) en él y qué se
// guarda de él en una plantilla de anuncio. Una plantilla es de un destino (WhatsApp o una web): su chat o su web
// solo valen para los anuncios que van al mismo sitio; los textos y las mejoras, para todos.

const COMMON = ['texto', 'titular', 'descripcion', 'mejoras', 'multianunciante']
const BY_DESTINATION = {
  whatsapp: ['bienvenida', 'tipoMensaje', 'saludo', 'preguntas'],
  web: ['url', 'boton', 'etiquetas'],
}
const destinationOf = (x) => (x?.destino === 'web' ? 'web' : 'whatsapp')
const pick = (object, keys) => Object.fromEntries(keys.filter((key) => object[key] !== undefined).map((key) => [key, object[key]]))

/**
 * Lo que una plantilla pone en el formulario de un anuncio: los textos y las mejoras; el chat o la web, si el anuncio
 * va al mismo sitio que ella; y el Instagram, si es de la misma página (solo lo dicen las plantillas de campaña).
 */
export function contentFromTemplate(template, content) {
  const destino = destinationOf(content)
  return {
    ...pick(template, [...COMMON, ...(destinationOf(template) === destino ? BY_DESTINATION[destino] : [])]),
    ...(template.pagina && template.pagina === content.pagina ? { instagram: template.instagram ?? null } : {}),
  }
}

/** Si en el formulario ya no pone lo que dice la plantilla (el Instagram no cuenta: es de la página). */
export function differsFromTemplate(template, content) {
  const { instagram: _, ...said } = contentFromTemplate(template, content)
  return Object.entries(said).some(([key, value]) => JSON.stringify(content[key] ?? null) !== JSON.stringify(value ?? null))
}

/**
 * Lo del formulario que va a una plantilla de anuncio: una nueva, del destino del anuncio, o la que se actualiza
 * (`base`), que sigue siendo del suyo (si el anuncio va a otro sitio, solo cambian sus textos y sus mejoras).
 */
export function templateFromContent(content, base = null) {
  const destino = destinationOf(base ?? content)
  return {
    ...(base ?? {}),
    destino,
    ...pick(content, [...COMMON, ...(destinationOf(content) === destino ? BY_DESTINATION[destino] : [])]),
  }
}
