// Tablero Avisos
//
// Copia las tareas de Tablero que tienen fecha a la lista «Tablero» de Recordatorios
// de Apple, con sus avisos. Recordatorios las sincroniza por iCloud y el iPhone avisa.
// Si una se completa en Recordatorios, se marca como hecha en Tablero.
//
// Corre en segundo plano (LaunchAgent com.tablero.avisos) y habla con el servidor
// local de Tablero: escucha sus cambios (/api/eventos) y le cuenta su estado (/api/avisos).

import AppKit
import EventKit

// MARK: - Datos de Tablero (solo lo que hace falta para los avisos)

struct Respuesta: Decodable {
    let rev: Int
    let board: Tablero?
}

struct Tablero: Decodable {
    let columns: [Columna]
}

struct Columna: Decodable {
    let tasks: [Tarea]
}

struct Tarea: Decodable {
    let id: String
    let title: String
    let notes: String
    let done: Bool
    let due: String?
    let time: String?
    let alerts: [Int]?

    private enum Clave: String, CodingKey { case id, title, notes, done, due, time, alerts }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Clave.self)
        id = try c.decode(String.self, forKey: .id)
        title = (try? c.decode(String.self, forKey: .title)) ?? ""
        notes = (try? c.decode(String.self, forKey: .notes)) ?? ""
        done = (try? c.decode(Bool.self, forKey: .done)) ?? false
        due = try? c.decode(String.self, forKey: .due)
        time = try? c.decode(String.self, forKey: .time)
        alerts = try? c.decode([Int].self, forKey: .alerts)
    }

    /// Cuándo es: el día y, si la tiene, la hora de inicio. Sin fecha no hay recordatorio.
    var cuando: (dia: DateComponents, hora: DateComponents?)? {
        guard let due else { return nil }
        let d = due.split(separator: "-").compactMap { Int($0) }
        guard d.count == 3 else { return nil }
        let dia = DateComponents(calendar: .current, year: d[0], month: d[1], day: d[2])
        let h = (time ?? "").split(separator: ":").compactMap { Int($0) }
        guard h.count == 2 else { return (dia, nil) }
        return (dia, DateComponents(calendar: .current, timeZone: .current,
                                    year: d[0], month: d[1], day: d[2], hour: h[0], minute: h[1]))
    }

    /// Avisos en minutos: respecto a la hora de inicio, o a las 0:00 del día si es de todo el día.
    /// Por defecto, a la hora; o, sin hora, ese día a las 9:00 (hora local de este Mac).
    var avisos: [Int] { alerts ?? (time == nil ? [9 * 60] : [0]) }

    /// Si cambia, hay que actualizar el recordatorio.
    var huella: String {
        [title, notes, due ?? "", time ?? "", avisos.map(String.init).joined(separator: ",")].joined(separator: "\u{1F}")
    }
}

// MARK: - Qué recordatorio corresponde a cada tarea (avisos.json)

struct Enlace: Codable {
    var recordatorio: String
    var huella: String
    /// Se borró en Recordatorios: no se vuelve a crear mientras la tarea no cambie.
    var descartado = false
    /// Ya se le dijo a Tablero que se completó en Recordatorios.
    var avisadoHecho = false
}

struct Memoria: Codable {
    var lista: String?
    var enlaces: [String: Enlace] = [:]
}

struct Fallo: LocalizedError {
    let errorDescription: String?
    init(_ mensaje: String) { errorDescription = mensaje }
}

func registrar(_ mensaje: String) {
    print("\(ISO8601DateFormatter().string(from: Date()))  \(mensaje)")
}

// MARK: - Sincronización

@MainActor
final class Avisos {
    private let servidor: URL
    private let archivoMemoria: URL
    private var store = EKEventStore()
    private var memoria: Memoria
    private var trabajo: Task<Void, Never>?
    private var sincronizando = false
    private var otraVez = false
    private var informe = Data()
    private let fechaISO: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()

    init() {
        let entorno = ProcessInfo.processInfo.environment
        servidor = URL(string: "http://127.0.0.1:\(entorno["PORT"] ?? "4747")/")!
        let datos = entorno["TABLERO_DATA_DIR"].map { URL(fileURLWithPath: $0) }
            ?? FileManager.default.homeDirectoryForCurrentUser.appending(path: "Library/Application Support/Tablero/datos")
        archivoMemoria = datos.appending(path: "avisos.json")
        memoria = (try? JSONDecoder().decode(Memoria.self, from: Data(contentsOf: archivoMemoria))) ?? Memoria()
    }

    private var conPermiso: Bool { EKEventStore.authorizationStatus(for: .reminder) == .fullAccess }

    func arrancar() {
        escuchar()
        Task { await esperarPermiso() }
    }

    private func esperarPermiso() async {
        if EKEventStore.authorizationStatus(for: .reminder) == .notDetermined {
            informar(estado: "iniciando")
            registrar("Pidiendo permiso para Recordatorios…")
            _ = try? await store.requestFullAccessToReminders()
        }
        while !conPermiso {
            informar(estado: "sin-permiso")
            // Si lo activan en Ajustes del Sistema, se sigue sin reiniciar.
            try? await Task.sleep(for: .seconds(5))
        }
        registrar("Permiso concedido")
        store = EKEventStore()
        NotificationCenter.default.addObserver(forName: .EKEventStoreChanged, object: store, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.programar() }
        }
        Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            MainActor.assumeIsolated { self?.programar() }
        }
        programar()
    }

    /// Escucha al servidor: cada cambio en el tablero dispara una sincronización.
    private func escuchar() {
        Task {
            while true {
                do {
                    var peticion = URLRequest(url: servidor.appending(path: "api/eventos")
                        .appending(queryItems: [URLQueryItem(name: "cliente", value: "avisos")]))
                    peticion.timeoutInterval = 90
                    let (bytes, respuesta) = try await URLSession.shared.bytes(for: peticion)
                    guard (respuesta as? HTTPURLResponse)?.statusCode == 200 else { throw Fallo("Sin servidor") }
                    var evento = "message"
                    for try await linea in bytes.lines {
                        if linea.hasPrefix("event:") {
                            evento = linea.dropFirst(6).trimmingCharacters(in: .whitespaces)
                        } else if linea.hasPrefix("data:") {
                            if evento == "hola" { enviarInforme() }
                            if evento == "hola" || evento == "rev" { programar() }
                            evento = "message"
                        }
                    }
                } catch {
                    // El servidor se ha reiniciado o aún no ha arrancado: se reintenta.
                }
                try? await Task.sleep(for: .seconds(3))
            }
        }
    }

    func programar() {
        trabajo?.cancel()
        trabajo = Task {
            try? await Task.sleep(for: .milliseconds(600))
            guard !Task.isCancelled else { return }
            await sincronizar()
        }
    }

    private func sincronizar() async {
        guard conPermiso else { return }
        if sincronizando {
            otraVez = true
            return
        }
        sincronizando = true
        defer {
            sincronizando = false
            if otraVez {
                otraVez = false
                programar()
            }
        }
        do {
            let (datos, _) = try await URLSession.shared.data(from: servidor.appending(path: "api/board"))
            guard let tablero = try JSONDecoder().decode(Respuesta.self, from: datos).board else { return }
            let lista = try asegurarLista()
            var programados = 0
            var vistas = Set<String>()
            for tarea in tablero.columns.flatMap(\.tasks) where tarea.cuando != nil {
                vistas.insert(tarea.id)
                if try await reconciliar(tarea, en: lista) { programados += 1 }
            }
            // Tareas borradas en Tablero, o que ya no tienen fecha.
            for (id, enlace) in memoria.enlaces where !vistas.contains(id) {
                if let r = recordatorio(enlace), !r.isCompleted {
                    try store.remove(r, commit: true)
                    registrar("Quitado: \(r.title ?? id)")
                }
                memoria.enlaces[id] = nil
            }
            guardarMemoria()
            informar(estado: "activo", lista: lista, programados: programados)
        } catch {
            registrar("Error: \(error.localizedDescription)")
            informar(estado: "error", mensaje: error.localizedDescription)
        }
    }

    /// Pone de acuerdo una tarea con su recordatorio. Devuelve true si queda un aviso pendiente.
    private func reconciliar(_ tarea: Tarea, en lista: EKCalendar) async throws -> Bool {
        var enlace = memoria.enlaces[tarea.id]
        let existente = enlace.flatMap(recordatorio)

        if var e = enlace, existente == nil {
            if !e.descartado {
                // Lo han borrado en Recordatorios: se respeta.
                e.descartado = true
                e.huella = tarea.huella
                memoria.enlaces[tarea.id] = e
                return false
            }
            if e.huella == tarea.huella { return false }
            enlace = nil // La tarea ha cambiado desde entonces: vuelve a avisar.
        }

        guard let r = existente, var e = enlace else {
            if tarea.done { return false }
            let nuevo = EKReminder(eventStore: store)
            nuevo.calendar = lista
            rellenar(nuevo, con: tarea)
            try store.save(nuevo, commit: true)
            memoria.enlaces[tarea.id] = Enlace(recordatorio: nuevo.calendarItemIdentifier, huella: tarea.huella)
            registrar("Creado: \(nuevo.title ?? "")")
            return true
        }

        switch (r.isCompleted, tarea.done) {
        case (true, false):
            if e.avisadoHecho {
                // Se completó en Recordatorios y luego se volvió a abrir en Tablero.
                r.isCompleted = false
                e.avisadoHecho = false
            } else {
                try await marcarHecha(tarea.id, cuando: r.completionDate)
                registrar("Completado en Recordatorios: \(tarea.title)")
                e.avisadoHecho = true
                memoria.enlaces[tarea.id] = e
                return false
            }
        case (false, true):
            r.isCompleted = true
        case (false, false):
            e.avisadoHecho = false
        case (true, true):
            break
        }
        if e.huella != tarea.huella {
            rellenar(r, con: tarea)
            e.huella = tarea.huella
        }
        if r.hasChanges {
            try store.save(r, commit: true)
            registrar("Actualizado: \(r.title ?? "")")
        }
        memoria.enlaces[tarea.id] = e
        return !tarea.done
    }

    private func rellenar(_ r: EKReminder, con tarea: Tarea) {
        guard let (dia, hora) = tarea.cuando else { return }
        r.title = tarea.title.isEmpty ? "Sin título" : tarea.title
        r.notes = tarea.notes.isEmpty ? nil : tarea.notes
        // Sin hora es un recordatorio de todo el día.
        r.dueDateComponents = hora ?? dia
        r.alarms?.forEach(r.removeAlarm)
        // Los avisos van a horas concretas de este Mac (las 9:00 de aquí, no las de otro huso).
        var inicio = dia
        inicio.timeZone = .current
        guard let referencia = Calendar.current.date(from: hora ?? inicio) else { return }
        for minutos in tarea.avisos {
            r.addAlarm(EKAlarm(absoluteDate: referencia.addingTimeInterval(TimeInterval(minutos * 60))))
        }
    }

    private func recordatorio(_ enlace: Enlace) -> EKReminder? {
        store.calendarItem(withIdentifier: enlace.recordatorio) as? EKReminder
    }

    /// La lista «Tablero». Si no existe (o la han borrado), se crea y se rehacen todos los avisos.
    private func asegurarLista() throws -> EKCalendar {
        if let id = memoria.lista, let lista = store.calendar(withIdentifier: id) { return lista }
        if let existente = store.calendars(for: .reminder).first(where: { $0.title == "Tablero" }) {
            memoria.lista = existente.calendarIdentifier
            return existente
        }
        guard let cuenta = store.defaultCalendarForNewReminders()?.source
            ?? store.sources.first(where: { $0.sourceType == .local }) else {
            throw Fallo("No hay ninguna cuenta de Recordatorios en este Mac")
        }
        let lista = EKCalendar(for: .reminder, eventStore: store)
        lista.title = "Tablero"
        lista.source = cuenta
        lista.cgColor = NSColor.systemBlue.cgColor
        try store.saveCalendar(lista, commit: true)
        registrar("Lista «Tablero» creada en \(cuenta.title)")
        memoria.lista = lista.calendarIdentifier
        memoria.enlaces = [:]
        return lista
    }

    private func marcarHecha(_ id: String, cuando: Date?) async throws {
        var peticion = URLRequest(url: servidor.appending(path: "api/tareas/\(id)"))
        peticion.httpMethod = "PATCH"
        peticion.setValue("application/json", forHTTPHeaderField: "Content-Type")
        peticion.httpBody = try JSONSerialization.data(withJSONObject: [
            "done": true,
            "completedAt": fechaISO.string(from: cuando ?? Date()),
        ])
        let (_, respuesta) = try await URLSession.shared.data(for: peticion)
        let codigo = (respuesta as? HTTPURLResponse)?.statusCode ?? 0
        // 404: la tarea ya no existe en Tablero; no hay nada que marcar.
        guard codigo == 200 || codigo == 404 else { throw Fallo("Tablero respondió \(codigo)") }
    }

    private func guardarMemoria() {
        do {
            try FileManager.default.createDirectory(at: archivoMemoria.deletingLastPathComponent(), withIntermediateDirectories: true)
            try JSONEncoder().encode(memoria).write(to: archivoMemoria, options: .atomic)
        } catch {
            registrar("No se pudo guardar avisos.json: \(error.localizedDescription)")
        }
    }

    // MARK: Estado para la app (icono de la campana)

    private func informar(estado: String, lista: EKCalendar? = nil, programados: Int? = nil, mensaje: String? = nil) {
        var cuerpo: [String: Any] = ["estado": estado]
        if let lista {
            cuerpo["lista"] = lista.title
            cuerpo["cuenta"] = lista.source.title
            cuerpo["icloud"] = lista.source.sourceType == .calDAV && lista.source.title.localizedCaseInsensitiveContains("icloud")
        }
        if let programados { cuerpo["programados"] = programados }
        if let mensaje { cuerpo["mensaje"] = mensaje }
        guard let datos = try? JSONSerialization.data(withJSONObject: cuerpo, options: .sortedKeys), datos != informe else { return }
        informe = datos
        registrar("Estado: \(String(decoding: datos, as: UTF8.self))")
        enviarInforme()
    }

    private func enviarInforme() {
        guard !informe.isEmpty else { return }
        var peticion = URLRequest(url: servidor.appending(path: "api/avisos"))
        peticion.httpMethod = "PUT"
        peticion.setValue("application/json", forHTTPHeaderField: "Content-Type")
        peticion.httpBody = informe
        Task { _ = try? await URLSession.shared.data(for: peticion) }
    }
}

// MARK: - Arranque (app sin icono en el Dock)

final class Delegado: NSObject, NSApplicationDelegate {
    private var avisos: Avisos?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let avisos = Avisos()
        self.avisos = avisos
        avisos.arrancar()
    }
}

@main
enum Principal {
    @MainActor
    static func main() {
        setvbuf(stdout, nil, _IOLBF, 0)
        registrar("Tablero Avisos arrancado")
        let app = NSApplication.shared
        app.setActivationPolicy(.accessory)
        let delegado = Delegado()
        app.delegate = delegado
        withExtendedLifetime(delegado) { app.run() }
    }
}
