// Modelo de la sincronización Tablero ⇄ Recordatorios.
// No usa EventKit, así que se puede probar aparte (avisos/Pruebas.swift).

import Foundation

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
