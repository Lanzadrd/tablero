// Pruebas de la lógica de sincronización (sin EventKit). No forma parte de la app:
//   swiftc -parse-as-library avisos/Modelo.swift avisos/Pruebas.swift -o /tmp/pruebas && /tmp/pruebas

import Foundation

@main
enum Pruebas {
    static var fallos = 0
    static var total = 0

    static func comprobar(_ condicion: Bool, _ nombre: String) {
        total += 1
        if !condicion {
            fallos += 1
            print("✗ \(nombre)")
        }
    }

    static func main() throws {
        let base = Instantanea(titulo: "Pan", notas: "", hecha: false, dia: "2026-10-06", hora: "10:30", avisos: [0], columna: "A")

        // Fusión
        var t = base, r = base
        t.titulo = "Pan integral"
        r.hecha = true
        var m = fusionar(base: base, tablero: t, recordatorio: r)
        comprobar(m.titulo == "Pan integral" && m.hecha, "cada lado aporta lo que cambió")

        t = base; r = base
        t.titulo = "Desde el Mac"; r.titulo = "Desde el iPhone"
        comprobar(fusionar(base: base, tablero: t, recordatorio: r).titulo == "Desde el Mac", "si cambian los dos, gana Tablero")

        t = base; r = base
        r.hora = nil; r.avisos = [540]
        t.avisos = [0, -15]
        m = fusionar(base: base, tablero: t, recordatorio: r)
        comprobar(m.hora == "10:30" && m.avisos == [0, -15], "fecha, hora y avisos van juntos (de Tablero)")

        t = base; r = base
        r.dia = "2026-10-07"; r.columna = "B"
        m = fusionar(base: base, tablero: t, recordatorio: r)
        comprobar(m.dia == "2026-10-07" && m.columna == "B" && m.hora == "10:30", "cambio de día y de lista en el iPhone")

        // Cambios para Tablero
        var c = cambiosParaTablero(desde: base, hasta: base, completadaEn: nil)
        comprobar(c.isEmpty, "sin cambios")
        m = base; m.hecha = true
        c = cambiosParaTablero(desde: base, hasta: m, completadaEn: "2026-10-06T08:00:00.000Z")
        comprobar(c["done"] as? Bool == true && c["completedAt"] as? String == "2026-10-06T08:00:00.000Z" && c["due"] == nil,
                  "completada en el iPhone")
        m = base; m.hora = nil; m.avisos = [540]
        c = cambiosParaTablero(desde: base, hasta: m, completadaEn: nil)
        comprobar(c["time"] is NSNull && c["alerts"] is NSNull, "a todo el día con avisos por defecto → null")
        m = base; m.avisos = [-15, 0]
        c = cambiosParaTablero(desde: base, hasta: m, completadaEn: nil)
        comprobar((c["alerts"] as? [Int]) == [-15, 0], "avisos propios se mandan tal cual")
        m = base; m.dia = nil; m.hora = nil; m.avisos = []
        c = cambiosParaTablero(desde: base, hasta: m, completadaEn: nil)
        comprobar(c["due"] is NSNull && c["alerts"] is NSNull, "sin fecha")

        // Tarea → instantánea
        let json = #"{"id":"x","title":"Gimnasio","notes":"","done":false,"due":"2026-10-06","time":null}"#
        let tarea = try JSONDecoder().decode(Tarea.self, from: Data(json.utf8))
        comprobar(tarea.instantanea(columna: "A").avisos == [540], "todo el día: aviso a las 9:00 por defecto")
        let conHora = try JSONDecoder().decode(Tarea.self, from: Data(#"{"id":"y","due":"2026-10-06","time":"18:00","alerts":[0,-60,0]}"#.utf8))
        comprobar(conHora.instantanea(columna: "A").avisos == [0, -60], "avisos sin repetir y ordenados")
        let sinFecha = try JSONDecoder().decode(Tarea.self, from: Data(#"{"id":"z","time":"18:00","alerts":[0]}"#.utf8))
        comprobar(sinFecha.instantanea(columna: "A").hora == nil && sinFecha.instantanea(columna: "A").avisos.isEmpty, "sin fecha no hay hora ni avisos")
        let roto = Data(#"{"columns":[{"id":"A","name":"Casa","tasks":"nada"}]}"#.utf8)
        comprobar((try? JSONDecoder().decode(Tablero.self, from: roto)) == nil, "un tablero ilegible falla en vez de parecer vacío")

        // Fechas
        let (dia, hora) = diaYHora(de: componentes(dia: "2026-10-06", hora: "09:05"))
        comprobar(dia == "2026-10-06" && hora == "09:05", "fecha con hora, ida y vuelta")
        let todoElDia = diaYHora(de: componentes(dia: "2026-10-06", hora: nil))
        comprobar(todoElDia.dia == "2026-10-06" && todoElDia.hora == nil, "todo el día, ida y vuelta")
        if let inicio = referencia(dia: "2026-10-06", hora: nil), let nueve = referencia(dia: "2026-10-06", hora: "09:00") {
            comprobar(minutos(desde: inicio, hasta: nueve) == 540, "9:00 son 540 minutos desde las 0:00")
        } else {
            comprobar(false, "referencias de fecha")
        }
        comprobar(fechaISO(iso(Date(timeIntervalSince1970: 1_791_000_000))) == Date(timeIntervalSince1970: 1_791_000_000), "ISO ida y vuelta")

        // Listas y seguridad
        comprobar(nombreColumna(deLista: tituloLista("Trabajo")) == "Trabajo", "nombre de lista ↔ columna")
        comprobar(nombreColumna(deLista: "Oficina") == "Oficina", "lista renombrada sin prefijo")
        comprobar(!borradoSospechoso(borrados: 1, enlazados: 40), "borrar una tarea es normal")
        comprobar(borradoSospechoso(borrados: 30, enlazados: 40), "que falten 30 de 40 es sospechoso")
        let otra = Instantanea(titulo: "Pan", notas: "x", hecha: true, dia: "2026-10-06", hora: "10:30", avisos: [], columna: "A")
        comprobar(base.pareceLaMisma(que: otra), "reconoce una tarea aunque cambie el identificador")

        print(fallos == 0 ? "sincronización: \(total)/\(total) casos correctos" : "sincronización: \(fallos) de \(total) fallan")
        if fallos > 0 { exit(1) }
    }
}
