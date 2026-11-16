/** Lo que estas funciones necesitan de una plantilla y del formulario de un anuncio (src/ads.ts tiene los tipos completos). */
export interface TemplateLike {
  destino?: 'whatsapp' | 'web'
  pagina?: string | null
  instagram?: string | null
  texto?: string
  titular?: string
  descripcion?: string
  bienvenida?: string
  tipoMensaje?: 'escrito' | 'preguntas'
  saludo?: string
  preguntas?: string[]
  url?: string
  boton?: string
  etiquetas?: string
  mejoras?: string[]
  multianunciante?: boolean
}

export function contentFromTemplate<C extends TemplateLike>(template: TemplateLike, content: C): Partial<C>
export function differsFromTemplate(template: TemplateLike, content: TemplateLike): boolean
export function templateFromContent<B extends TemplateLike>(content: TemplateLike, base?: B | null): B & TemplateLike & { destino: 'whatsapp' | 'web' }
