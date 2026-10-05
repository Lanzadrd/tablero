// Lógica del ayudante sin EventKit ni AppKit, para poder probarla aparte (avisos/Pruebas.swift):
// la sincronización Tablero ⇄ Recordatorios y la captura rápida (atajos, ajustes, peticiones).

import Foundation

// MARK: - Comunes

struct Fallo: LocalizedError {
    let errorDescription: String?
    init(_ mensaje: String) { errorDescription = mensaje }
}

func registrar(_ mensaje: String) {
    print("\(ISO8601DateFormatter().string(from: Date()))  \(mensaje)")
}

/// Carpeta de datos de Tablero (la misma que la del servidor).
func carpetaDeDatos(_ entorno: [String: String] = ProcessInfo.processInfo.environment) -> URL {
    entorno["TABLERO_DATA_DIR"].map { URL(fileURLWithPath: $0) }
        ?? FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Application Support/Tablero/datos")
}

/// Dirección del servidor local de Tablero.
func direccionServidor(_ entorno: [String: String] = ProcessInfo.processInfo.environment) -> URL {
    let puerto = entorno["PORT"].flatMap { Int($0) } ?? 4747
    return URL(string: "http://127.0.0.1:\(puerto)/")!
}

// MARK: - Lo que manda el servidor de Tablero

struct Respuesta: Decodable {
    let rev: Int
    let board: Tablero?
}

struct Tablero: Decodable {
    let columns: [Columna]
}

struct Columna: Decodable {
    let id: String
    let name: String
    let color: String
    let tasks: [Tarea]

    private enum Clave: String, CodingKey { case id, name, color, tasks }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Clave.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? "Sin título"
        color = (try? c.decode(String.self, forKey: .color)) ?? "blue"
        // Sin tareas legibles mejor fallar que creer que se han borrado todas.
        tasks = try c.decode([Tarea].self, forKey: .tasks)
    }
}

struct Tarea: Decodable {
    let id: String
    let title: String
    let notes: String
    let done: Bool
    let completedAt: String?
    let due: String?
    let time: String?
    let alerts: [Int]?

    private enum Clave: String, CodingKey { case id, title, notes, done, completedAt, due, time, alerts }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Clave.self)
        id = try c.decode(String.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        notes = (try? c.decode(String.self, forKey: .notes)) ?? ""
        done = (try? c.decode(Bool.self, forKey: .done)) ?? false
        completedAt = try? c.decode(String.self, forKey: .completedAt)
        due = try? c.decode(String.self, forKey: .due)
        time = try? c.decode(String.self, forKey: .time)
        alerts = try? c.decode([Int].self, forKey: .alerts)
    }

    func instantanea(columna: String) -> Instantanea {
        let hora = due == nil ? nil : time
        let avisos = due == nil ? [] : (alerts ?? avisosPorDefecto(conHora: hora != nil))
        return Instantanea(titulo: title, notas: notes, hecha: done, dia: due, hora: hora,
                           avisos: normalizar(avisos), columna: columna)
    }
}

/// Avisos en minutos: respecto a la hora de inicio, o a las 0:00 del día si es de todo el día.
/// Por defecto: a la hora; o, sin hora, ese día a las 9:00 (hora local de este Mac).
func avisosPorDefecto(conHora: Bool) -> [Int] { conHora ? [0] : [9 * 60] }

func normalizar(_ avisos: [Int]) -> [Int] { Array(Set(avisos)).sorted(by: >) }

// MARK: - Instantánea: una tarea tal y como quedó en la última sincronización

struct Instantanea: Codable, Equatable {
    var titulo: String
    var notas: String
    var hecha: Bool
    var dia: String?
    var hora: String?
    var avisos: [Int]
    var columna: String

    /// ¿Es la misma tarea, aunque Recordatorios le haya cambiado el identificador?
    func pareceLaMisma(que otra: Instantanea) -> Bool {
        titulo == otra.titulo && dia == otra.dia && hora == otra.hora && columna == otra.columna
    }
}

/// Fusión a tres bandas, campo a campo: gana el lado que cambió; si cambiaron los dos, Tablero.
func fusionar(base: Instantanea, tablero t: Instantanea, recordatorio r: Instantanea) -> Instantanea {
    func elegir<V: Equatable>(_ campo: KeyPath<Instantanea, V>) -> V {
        t[keyPath: campo] != base[keyPath: campo] ? t[keyPath: campo] : r[keyPath: campo]
    }
    // Día, hora y avisos van juntos: los avisos se miden distinto con hora o sin ella.
    let cuandoCambiaEnTablero = t.dia != base.dia || t.hora != base.hora || t.avisos != base.avisos
    let cuando = cuandoCambiaEnTablero ? t : r
    return Instantanea(titulo: elegir(\.titulo), notas: elegir(\.notas), hecha: elegir(\.hecha),
                       dia: cuando.dia, hora: cuando.hora, avisos: cuando.avisos, columna: elegir(\.columna))
}

/// Un opcional para JSON: el valor o null.
func json(_ valor: Any?) -> Any { valor ?? NSNull() }

/// Campos que hay que cambiar en Tablero para pasar de `t` a `m` (sin mover de columna).
func cambiosParaTablero(desde t: Instantanea, hasta m: Instantanea, completadaEn: String?) -> [String: Any] {
    var cambios: [String: Any] = [:]
    if m.titulo != t.titulo { cambios["title"] = m.titulo }
    if m.notas != t.notas { cambios["notes"] = m.notas }
    if m.hecha != t.hecha {
        cambios["done"] = m.hecha
        if m.hecha, let completadaEn { cambios["completedAt"] = completadaEn }
    }
    if m.dia != t.dia || m.hora != t.hora || m.avisos != t.avisos {
        cambios["due"] = json(m.dia)
        cambios["time"] = json(m.hora)
        // null = los avisos por defecto.
        let porDefecto = m.dia == nil || m.avisos == avisosPorDefecto(conHora: m.hora != nil)
        cambios["alerts"] = json(porDefecto ? nil : m.avisos)
    }
    return cambios
}

/// Una tarea nueva en Tablero a partir de lo que se creó en el iPhone.
func tareaNueva(_ s: Instantanea) -> [String: Any] {
    var tarea: [String: Any] = ["title": s.titulo, "notes": s.notas, "done": s.hecha]
    if let dia = s.dia {
        tarea["due"] = dia
        tarea["time"] = json(s.hora)
        if s.avisos != avisosPorDefecto(conHora: s.hora != nil) { tarea["alerts"] = s.avisos }
    }
    return tarea
}

/// Si desaparecen muchos recordatorios a la vez, lo normal es que iCloud se esté
/// resincronizando, no que alguien los haya borrado: mejor no tocar Tablero.
func borradoSospechoso(borrados: Int, enlazados: Int) -> Bool {
    borrados > 5 && Double(borrados) > Double(enlazados) * 0.3
}

// MARK: - Fechas

/// «2026-10-05» + «17:15» → fecha de Recordatorios. Sin hora es de todo el día.
func componentes(dia: String?, hora: String?) -> DateComponents? {
    guard let dia else { return nil }
    let d = dia.split(separator: "-").compactMap { Int($0) }
    guard d.count == 3 else { return nil }
    let h = (hora ?? "").split(separator: ":").compactMap { Int($0) }
    if h.count == 2 {
        return DateComponents(calendar: .current, timeZone: .current,
                              year: d[0], month: d[1], day: d[2], hour: h[0], minute: h[1])
    }
    return DateComponents(calendar: .current, year: d[0], month: d[1], day: d[2])
}

func diaYHora(de c: DateComponents?) -> (dia: String?, hora: String?) {
    guard let c, let y = c.year, let m = c.month, let d = c.day else { return (nil, nil) }
    let dia = String(format: "%04d-%02d-%02d", y, m, d)
    guard let h = c.hour else { return (dia, nil) }
    return (dia, String(format: "%02d:%02d", h, c.minute ?? 0))
}

/// Instante desde el que se miden los avisos: la hora de inicio, o las 0:00 del día (hora local).
func referencia(dia: String, hora: String?) -> Date? {
    guard var c = componentes(dia: dia, hora: hora) else { return nil }
    c.timeZone = .current
    if c.hour == nil {
        c.hour = 0
        c.minute = 0
    }
    return Calendar.current.date(from: c)
}

func minutos(desde inicio: Date, hasta fecha: Date) -> Int {
    Int((fecha.timeIntervalSince(inicio) / 60).rounded())
}

private let formatoISO: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()

func iso(_ fecha: Date) -> String { formatoISO.string(from: fecha) }

func fechaISO(_ texto: String) -> Date? {
    formatoISO.date(from: texto) ?? ISO8601DateFormatter().date(from: texto)
}

// MARK: - Listas de Recordatorios

let prefijoLista = "Tablero · "

func tituloLista(_ columna: String) -> String { prefijoLista + columna }

func nombreColumna(deLista titulo: String) -> String {
    (titulo.hasPrefix(prefijoLista) ? String(titulo.dropFirst(prefijoLista.count)) : titulo)
        .trimmingCharacters(in: .whitespaces)
}

// MARK: - Estado guardado (sincronizacion.json)

struct ListaEnlazada: Codable {
    var lista: String
    var nombre: String
    var color: String
}

struct Enlace: Codable {
    var recordatorio: String
    var externo: String?
    var ultima: Instantanea
}

struct EstadoSync: Codable {
    var columnas: [String: ListaEnlazada] = [:]
    var tareas: [String: Enlace] = [:]
    /// Tareas cuyo recordatorio ha desaparecido, y desde cuándo (se confirma antes de borrar).
    var ausentes: [String: Date] = [:]
    /// Cambios para Tablero que aún no se han podido enviar.
    var pendientes: Data?
}

// Versión 1 (solo tareas con fecha, en una única lista «Tablero»).
struct MemoriaV1: Decodable {
    struct EnlaceV1: Decodable {
        let recordatorio: String
        let descartado: Bool?
    }

    let lista: String?
    let enlaces: [String: EnlaceV1]
}

// MARK: - Captura rápida: atajos de teclado globales

/// Un atajo global: tecla física (código virtual de Carbon, posición ANSI) y modificadores.
struct Atajo: Equatable {
    var tecla: UInt32
    var comando = false
    var opcion = false
    var control = false
    var mayusculas = false

    /// Máscara de Carbon para RegisterEventHotKey (cmdKey, shiftKey, optionKey, controlKey).
    var modificadoresCarbon: UInt32 {
        (comando ? 1 << 8 : 0) | (mayusculas ? 1 << 9 : 0) | (opcion ? 1 << 11 : 0) | (control ? 1 << 12 : 0)
    }

    private var datos: TeclaConocida? { teclasConocidas.first { $0.codigo == tecla } }

    /// Para NSMenuItem.keyEquivalent (los modificadores van aparte).
    var equivalenteMenu: String { datos?.equivalente ?? "" }

    /// Como en los menús de macOS: «⌥⇧Espacio».
    var descripcion: String {
        (control ? "⌃" : "") + (opcion ? "⌥" : "") + (mayusculas ? "⇧" : "") + (comando ? "⌘" : "")
            + (datos?.etiqueta ?? "#\(tecla)")
    }
}

private struct TeclaConocida {
    let nombres: [String]
    let codigo: UInt32
    let equivalente: String
    let etiqueta: String
}

private let teclasConocidas: [TeclaConocida] = {
    // Códigos kVK_ANSI_* de Carbon (HIToolbox/Events.h).
    let letras: [(String, UInt32)] = [
        ("a", 0x00), ("s", 0x01), ("d", 0x02), ("f", 0x03), ("h", 0x04), ("g", 0x05), ("z", 0x06), ("x", 0x07),
        ("c", 0x08), ("v", 0x09), ("b", 0x0B), ("q", 0x0C), ("w", 0x0D), ("e", 0x0E), ("r", 0x0F), ("y", 0x10),
        ("t", 0x11), ("o", 0x1F), ("u", 0x20), ("i", 0x22), ("p", 0x23), ("l", 0x25), ("j", 0x26), ("k", 0x28),
        ("n", 0x2D), ("m", 0x2E),
        ("1", 0x12), ("2", 0x13), ("3", 0x14), ("4", 0x15), ("6", 0x16), ("5", 0x17), ("9", 0x19), ("7", 0x1A),
        ("8", 0x1C), ("0", 0x1D),
        ("=", 0x18), ("-", 0x1B), ("]", 0x1E), ("[", 0x21), ("'", 0x27), (";", 0x29), ("\\", 0x2A), (",", 0x2B),
        ("/", 0x2C), (".", 0x2F), ("`", 0x32),
    ]
    var teclas = letras.map { TeclaConocida(nombres: [$0.0], codigo: $0.1, equivalente: $0.0, etiqueta: $0.0.uppercased()) }
    teclas += [
        TeclaConocida(nombres: ["space", "espacio"], codigo: 0x31, equivalente: " ", etiqueta: "Espacio"),
        TeclaConocida(nombres: ["return", "enter", "intro"], codigo: 0x24, equivalente: "\r", etiqueta: "↩"),
        TeclaConocida(nombres: ["tab", "tabulador"], codigo: 0x30, equivalente: "\t", etiqueta: "⇥"),
        TeclaConocida(nombres: ["escape", "esc"], codigo: 0x35, equivalente: "\u{1b}", etiqueta: "⎋"),
        TeclaConocida(nombres: ["delete", "backspace", "borrar"], codigo: 0x33, equivalente: "\u{8}", etiqueta: "⌫"),
    ]
    // F1–F12: códigos de Carbon y NSF1FunctionKey… (0xF704…) para los menús.
    let funciones: [UInt32] = [0x7A, 0x78, 0x63, 0x76, 0x60, 0x61, 0x62, 0x64, 0x65, 0x6D, 0x67, 0x6F]
    for (i, codigo) in funciones.enumerated() {
        let equivalente = Unicode.Scalar(0xF704 + i).map { String(Character($0)) } ?? ""
        teclas.append(TeclaConocida(nombres: ["f\(i + 1)"], codigo: codigo, equivalente: equivalente, etiqueta: "F\(i + 1)"))
    }
    return teclas
}()

/// Lee un atajo como «option+space», «cmd+shift+k» u «opción+espacio» (partes separadas por «+»).
/// Hace falta ⌘, ⌥ o ⌃ (salvo con F1–F12) para no quitarle una tecla normal a las demás apps.
func leerAtajo(_ texto: String) -> Atajo? {
    let partes = texto.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: nil).lowercased()
        .split(separator: "+", omittingEmptySubsequences: false)
        .map { $0.trimmingCharacters(in: .whitespaces) }
    guard let nombre = partes.last, !nombre.isEmpty,
          let tecla = teclasConocidas.first(where: { $0.nombres.contains(nombre) }) else { return nil }
    var atajo = Atajo(tecla: tecla.codigo)
    for parte in partes.dropLast() {
        switch parte {
        case "cmd", "command", "comando", "⌘": atajo.comando = true
        case "option", "opt", "alt", "opcion", "⌥": atajo.opcion = true
        case "ctrl", "control", "⌃": atajo.control = true
        case "shift", "mayus", "mayusculas", "⇧": atajo.mayusculas = true
        default: return nil
        }
    }
    let esFuncion = nombre.count > 1 && nombre.hasPrefix("f")
    guard atajo.comando || atajo.opcion || atajo.control || esFuncion else { return nil }
    return atajo
}

let atajoCapturaPorDefecto = "option+space"
let atajoCapturaConPaginaPorDefecto = "option+shift+space"

/// Atajos de la captura rápida (nil: sin atajo).
struct AjustesCaptura: Equatable {
    var captura: Atajo?
    var capturaConPagina: Atajo?
}

/// Lee <datos>/ajustes.json ({"atajoCaptura": "option+space", "atajoCapturaPagina": …}).
/// Sin la clave (o null), el atajo por defecto; "" o false, sin atajo; si no se entiende, el de
/// por defecto y un aviso para el registro. Las demás claves del archivo no se tocan.
func leerAjustesCaptura(_ datos: Data?) -> (ajustes: AjustesCaptura, avisos: [String]) {
    var avisos: [String] = []
    var json: [String: Any] = [:]
    if let datos {
        if let leido = (try? JSONSerialization.jsonObject(with: datos)) as? [String: Any] {
            json = leido
        } else {
            avisos.append("ajustes.json no es un objeto JSON válido: se usan los atajos por defecto")
        }
    }
    func atajo(_ clave: String, porDefecto: String) -> Atajo? {
        let defecto = leerAtajo(porDefecto)
        guard let valor = json[clave], !(valor is NSNull) else { return defecto }
        if let texto = valor as? String {
            if texto.trimmingCharacters(in: .whitespaces).isEmpty { return nil }
            if let atajo = leerAtajo(texto) { return atajo }
            avisos.append("No se entiende \(clave) «\(texto)»: se usa \(porDefecto)")
            return defecto
        }
        if let activo = valor as? Bool { return activo ? defecto : nil }
        avisos.append("\(clave) debe ser un texto como «\(porDefecto)»: se usa el de por defecto")
        return defecto
    }
    var ajustes = AjustesCaptura(captura: atajo("atajoCaptura", porDefecto: atajoCapturaPorDefecto),
                                 capturaConPagina: atajo("atajoCapturaPagina", porDefecto: atajoCapturaConPaginaPorDefecto))
    if let repetido = ajustes.capturaConPagina, repetido == ajustes.captura {
        avisos.append("atajoCapturaPagina es igual que atajoCaptura (\(repetido.descripcion)): se queda sin atajo")
        ajustes.capturaConPagina = nil
    }
    return (ajustes, avisos)
}

// MARK: - Captura rápida: página de Chrome y petición al servidor

struct Pagina: Equatable {
    var url: String
    var titulo: String

    /// «es.wikipedia.org» (sin «www.»), para la píldora del panel.
    var dominio: String {
        let host = URL(string: url)?.host() ?? url
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}

/// Lo que devuelve el AppleScript de Chrome: una línea por ventana (de delante hacia atrás) con
/// el modo de la ventana, la dirección y el título de su pestaña activa, separados por
/// tabuladores. Se queda con la primera página web: ni chrome://, ni la propia ventana de
/// Tablero, ni ventanas de incógnito (lo que se navega ahí no se guarda en una tarea).
func paginaDeChrome(_ salida: String, servidor: URL = direccionServidor()) -> Pagina? {
    for linea in salida.split(whereSeparator: \.isNewline) {
        let partes = linea.split(separator: "\t", maxSplits: 2, omittingEmptySubsequences: false)
        guard partes.count >= 2, partes[0].trimmingCharacters(in: .whitespaces) != "incognito" else { continue }
        let direccion = partes[1].trimmingCharacters(in: .whitespaces)
        guard let url = URL(string: direccion), let esquema = url.scheme?.lowercased(), esquema == "http" || esquema == "https",
              let host = url.host(), !host.isEmpty else { continue }
        let puerto = url.port ?? (esquema == "https" ? 443 : 80)
        if ["127.0.0.1", "localhost", "::1"].contains(host.lowercased()), puerto == servidor.port { continue }
        let titulo = partes.count > 2 ? partes[2].trimmingCharacters(in: .whitespaces) : ""
        return Pagina(url: direccion, titulo: titulo.isEmpty ? host : titulo)
    }
    return nil
}

/// Cuerpo de POST /api/capturar. Con el texto vacío y una página, el servidor usa el título de
/// la página como título de la tarea.
func cuerpoCaptura(texto: String, pagina: Pagina?, vistaPrevia: Bool) -> [String: Any] {
    var cuerpo: [String: Any] = ["texto": texto.trimmingCharacters(in: .whitespacesAndNewlines)]
    if let pagina {
        cuerpo["url"] = pagina.url
        cuerpo["tituloPagina"] = pagina.titulo
    }
    if vistaPrevia { cuerpo["vistaPrevia"] = true }
    return cuerpo
}

/// Respuesta de POST /api/capturar: {rev, id, columna, resumen} o, en vista previa,
/// {titulo, resumen, columna}. La columna puede venir como nombre o como objeto.
struct RespuestaCaptura: Decodable, Equatable {
    var rev: Int?
    var id: String?
    var titulo: String?
    var resumen: String?
    var columna: String?

    private enum Clave: String, CodingKey { case rev, id, titulo, resumen, columna }
    private struct ColumnaObjeto: Decodable {
        let name: String?
        let nombre: String?
    }

    init(rev: Int? = nil, id: String? = nil, titulo: String? = nil, resumen: String? = nil, columna: String? = nil) {
        self.rev = rev
        self.id = id
        self.titulo = titulo
        self.resumen = resumen
        self.columna = columna
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Clave.self)
        rev = try? c.decode(Int.self, forKey: .rev)
        id = try? c.decode(String.self, forKey: .id)
        titulo = try? c.decode(String.self, forKey: .titulo)
        resumen = try? c.decode(String.self, forKey: .resumen)
        columna = (try? c.decode(String.self, forKey: .columna))
            ?? (try? c.decode(ColumnaObjeto.self, forKey: .columna)).flatMap { $0.name ?? $0.nombre }
    }
}

private func sinEspacios(_ texto: String?) -> String? {
    guard let limpio = texto?.trimmingCharacters(in: .whitespacesAndNewlines), !limpio.isEmpty else { return nil }
    return limpio
}

/// Línea de vista previa del panel: el título que quedará, lo que se ha entendido (fecha,
/// repetición…) y la columna de destino, sin repetir lo que ya diga el resumen del servidor.
func mensajeVistaPrevia(_ r: RespuestaCaptura) -> String {
    let resumen = sinEspacios(r.resumen)
    var partes: [String] = []
    if let titulo = sinEspacios(r.titulo), resumen?.contains(titulo) != true { partes.append(titulo) }
    if let resumen { partes.append(resumen) }
    if let columna = sinEspacios(r.columna), resumen?.contains(columna) != true { partes.append(columna) }
    return partes.joined(separator: " · ")
}

func mensajeAnadida(_ r: RespuestaCaptura) -> String {
    sinEspacios(r.columna).map { "✓ Añadida a \($0)" } ?? "✓ Añadida"
}

/// El servidor responde los errores como {"error": "…"} o, si llevan código, {"error": código, "mensaje": "…"}.
func mensajeDeError(_ datos: Data, estado: Int) -> String {
    struct RespuestaError: Decodable {
        let error: String?
        let mensaje: String?
    }
    let respuesta = try? JSONDecoder().decode(RespuestaError.self, from: datos)
    if let texto = sinEspacios(respuesta?.mensaje) ?? sinEspacios(respuesta?.error) { return texto }
    if estado == 404 { return "Este Tablero aún no admite la captura rápida" }
    return "Tablero ha respondido con un error (\(estado))"
}

func recortar(_ texto: String, a maximo: Int) -> String {
    texto.count > maximo ? String(texto.prefix(max(maximo - 1, 0))) + "…" : texto
}

/// Línea de estado del menú, a partir de lo que el sincronizador cuenta a /api/avisos.
func textoEstado(_ estado: String, mensaje: String?) -> String {
    switch estado {
    case "activo": return "Sincronizado con Recordatorios"
    case "sin-permiso": return "Esperando permiso de Recordatorios"
    case "iniciando": return "Conectando con Recordatorios…"
    case "error": return "Error: " + recortar(sinEspacios(mensaje) ?? "desconocido", a: 60)
    default: return estado
    }
}
