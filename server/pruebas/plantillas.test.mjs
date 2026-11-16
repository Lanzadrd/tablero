// Las plantillas en el formulario de un anuncio.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { contentFromTemplate, differsFromTemplate, templateFromContent } from '../plantillas.mjs'

const chat = { bienvenida: 'Hola', tipoMensaje: 'preguntas', saludo: 'Quiero info', preguntas: ['¿Precio?'] }
const texts = { texto: 'Ven', titular: 'Hoy', descripcion: '2x1', mejoras: ['retoques'], multianunciante: true }
const whatsapp = { id: 't1', nombre: 'Chat', destino: 'whatsapp', pagina: '10', instagram: 'ig1', presupuesto: 20, ...texts, ...chat }
const web = { id: 't2', nombre: 'Web', destino: 'web', ...texts, url: 'https://ejemplo.com/', boton: 'LEARN_MORE', etiquetas: 'utm_source=meta' }

test('una plantilla pone en un anuncio sus textos y mejoras; el chat o la web, solo si va al mismo sitio', () => {
  const toChat = { destino: 'whatsapp', pagina: '10', texto: '' }
  // De la misma página, también su Instagram; nada de lo que no es del anuncio (presupuesto, nombre…).
  assert.deepEqual(contentFromTemplate(whatsapp, toChat), { ...texts, ...chat, instagram: 'ig1' })
  assert.deepEqual(contentFromTemplate(whatsapp, { ...toChat, pagina: '99' }), { ...texts, ...chat })
  // Una sin Instagram no quita el que hay.
  assert.deepEqual(contentFromTemplate({ ...whatsapp, instagram: null }, toChat), { ...texts, ...chat })
  // Una de web en un anuncio a WhatsApp (y al revés): solo los textos y las mejoras.
  assert.deepEqual(contentFromTemplate(web, toChat), texts)
  assert.deepEqual(contentFromTemplate(whatsapp, { destino: 'web', pagina: '99' }), texts)
  assert.deepEqual(contentFromTemplate(web, { destino: 'web' }), { ...texts, url: 'https://ejemplo.com/', boton: 'LEARN_MORE', etiquetas: 'utm_source=meta' })
  // Las plantillas de antes no dicen el destino (WhatsApp) ni la descripción: lo que falta no se toca.
  assert.deepEqual(contentFromTemplate({ texto: 'Ven', titular: 'Hoy', saludo: 'Hola' }, {}), { texto: 'Ven', titular: 'Hoy', saludo: 'Hola' })
})

test('el formulario difiere de la plantilla cuando cambia algo de lo que ella pone', () => {
  const content = { destino: 'whatsapp', pagina: '10', instagram: 'otro', ...texts, ...chat, url: '' }
  assert.equal(differsFromTemplate(whatsapp, content), false, 'el Instagram no cuenta')
  assert.equal(differsFromTemplate(whatsapp, { ...content, texto: 'Otra cosa' }), true)
  assert.equal(differsFromTemplate(whatsapp, { ...content, preguntas: ['¿Precio?', '¿Dónde?'] }), true)
  // Lo que la plantilla no pone en este anuncio (el chat, en uno de web) no cuenta.
  assert.equal(differsFromTemplate(whatsapp, { destino: 'web', ...texts, url: 'https://otra.com/' }), false)
})

test('una plantilla de anuncio nueva es del destino del anuncio; al actualizarla, sigue siendo del suyo', () => {
  const content = { destino: 'web', pagina: '10', instagram: 'ig1', ...texts, ...chat, url: 'https://ejemplo.com/', boton: 'SEE_DETAILS', etiquetas: '', variantes: { textos: [] } }
  assert.deepEqual(templateFromContent(content), { destino: 'web', ...texts, url: 'https://ejemplo.com/', boton: 'SEE_DETAILS', etiquetas: '' })
  assert.deepEqual(templateFromContent({ ...texts, ...chat }), { destino: 'whatsapp', ...texts, ...chat })
  // Desde un anuncio de web, una plantilla de WhatsApp solo cambia de textos: su chat se queda.
  const base = { id: 't1', nombre: 'Chat', cuenta: 'act_1', destino: 'whatsapp', ...texts, ...chat }
  assert.deepEqual(templateFromContent({ ...content, texto: 'Nuevo' }, base), { ...base, texto: 'Nuevo' })
  assert.deepEqual(templateFromContent({ destino: 'whatsapp', ...texts, ...chat, saludo: 'Otro' }, base), { ...base, saludo: 'Otro' })
})
