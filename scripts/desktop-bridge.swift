import Cocoa
import ApplicationServices
import Darwin

// Experimental UI relay. No shell, private IPC, credentials or model tool execution.
func fail(_ message: String) -> Never { fputs(message + "\n", stderr); exit(1) }
func attr(_ e: AXUIElement, _ key: String) -> AnyObject? { var v: CFTypeRef?; AXUIElementCopyAttributeValue(e, key as CFString, &v); return v }
func text(_ e: AXUIElement) -> String { (attr(e, "AXDescription") as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (attr(e, "AXTitle") as? String).flatMap { $0.isEmpty ? nil : $0 } ?? (attr(e, "AXValue") as? String ?? "") }
func nodes(_ e: AXUIElement, _ depth: Int = 0) -> [AXUIElement] { if depth > 35 || (attr(e,"AXRole") as? String) == "AXMenuBar" { return [] }; return [e] + (attr(e,"AXChildren") as? [AXUIElement] ?? []).flatMap { nodes($0,depth+1) } }
func press(_ e: AXUIElement) { if AXUIElementPerformAction(e,kAXPressAction as CFString) != .success { fail("UI-Aktion fehlgeschlagen; nicht erneut senden.") } }
func pasteVerified(_ value: String, into composer: AXUIElement, app: NSRunningApplication) -> Bool {
  let pb = NSPasteboard.general
  let saved = (pb.pasteboardItems ?? []).map { item -> NSPasteboardItem in
    let clone = NSPasteboardItem()
    for type in item.types { if let data = item.data(forType: type) { clone.setData(data, forType: type) } }
    return clone
  }
  var signals = sigset_t(); sigemptyset(&signals); sigaddset(&signals, SIGTERM); sigaddset(&signals, SIGINT)
  var previous = sigset_t(); sigprocmask(SIG_BLOCK, &signals, &previous)
  pb.clearContents(); pb.setString(value, forType: .string)
  let ownedChange = pb.changeCount
  defer {
    // Never overwrite a concurrent clipboard update made by the user.
    if pb.changeCount == ownedChange { pb.clearContents(); pb.writeObjects(saved) }
    sigprocmask(SIG_SETMASK, &previous, nil)
  }
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { return false }
  guard let down = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: true),
        let up = CGEvent(keyboardEventSource: nil, virtualKey: 9, keyDown: false) else { return false }
  down.flags = .maskCommand; up.flags = .maskCommand
  down.postToPid(app.processIdentifier); up.postToPid(app.processIdentifier)
  for _ in 0..<10 {
    Thread.sleep(forTimeInterval: 0.1)
    if (attr(composer, "AXValue") as? String) == value { return true }
  }
  return false
}
// Recovery only scrolls the current transcript. It never selects a chat or types.
func recoverAnchor(observe: () -> Bool, scroll: () -> Bool, wait: () -> Void) -> Bool {
  if observe() { return true }
  for _ in 0..<12 {
    if !scroll() { return false }
    wait()
    if observe() { return true }
  }
  return false
}
func elementRect(_ element: AXUIElement) -> CGRect? {
  guard let p = attr(element,"AXPosition"), let s = attr(element,"AXSize"),
        CFGetTypeID(p) == AXValueGetTypeID(), CFGetTypeID(s) == AXValueGetTypeID() else { return nil }
  var point = CGPoint.zero; var size = CGSize.zero
  guard AXValueGetValue(p as! AXValue,.cgPoint,&point), AXValueGetValue(s as! AXValue,.cgSize,&size) else { return nil }
  return CGRect(origin:point,size:size)
}
func safeWheelTarget(_ rect: CGRect, window: CGRect, header: CGRect, input: CGRect) -> Bool {
  return rect.width > 0 && rect.height > 15 && window.contains(rect)
    && rect.minY > header.maxY + 20 && rect.maxY < input.minY - 20
}
func recoverWithWheel(observe: () -> Bool, signature: () -> String, guardedScroll: () -> Bool, wait: () -> Void, now: () -> Double) -> Bool {
  let deadline = now() + 18
  var previous = ""; var stationary = 0
  for action in 0...12 {
    if observe() { return true }
    if action == 12 || now() >= deadline { return false }
    let current = signature()
    stationary = current == previous ? stationary + 1 : 0
    previous = current
    if stationary >= 2 || !guardedScroll() { return false }
    wait()
  }
  return false
}
// Forward-only traversal after anchor recovery; budget is shared across polls.
func followTranscriptReply(read: () -> String?, scroll: () -> Bool, wait: () -> Void, remaining: inout Int) -> String? {
  if let reply = read() { return reply }
  while remaining > 0 {
    remaining -= 1
    if !scroll() { return nil }
    wait()
    if let reply = read() { return reply }
  }
  return nil
}
guard AXIsProcessTrusted() else { fail("Bedienungshilfen für den aufrufenden Prozess fehlen. Systemeinstellungen > Datenschutz & Sicherheit > Bedienungshilfen; manuell freigeben.") }
guard let line = readLine(), let data = line.data(using:.utf8), let r = try? JSONSerialization.jsonObject(with:data) as? [String:String], let provider = r["provider"], let prompt = r["prompt"], let nonce = r["nonce"], let anchor = r["anchor"], !anchor.isEmpty, nonce.range(of:"^[a-zA-Z0-9-]{8,64}$",options:.regularExpression) != nil else { fail("Ungültige Relay-Anfrage") }
let conversationCaps = ["grok-bot": 2_000_000, "perplexity-chat": 800_000]
guard !prompt.isEmpty, let conversationCap = conversationCaps[provider], prompt.utf16.count <= conversationCap, anchor.utf16.count <= 8000 else { fail("Prompt zu lang (über dem Kontextfenster) oder Anker ungültig") }
let bundles = ["grok-bot":"com.anysphere.sand", "perplexity-chat":"ai.perplexity.macv3"]
guard let bundle = bundles[provider], let app = NSRunningApplication.runningApplications(withBundleIdentifier:bundle).first else { fail("Ziel-App nicht gestartet") }
let lockDirectory = NSHomeDirectory() + "/Library/Caches/ayontclaudian"
try FileManager.default.createDirectory(atPath:lockDirectory,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
let lockPath = lockDirectory + "/desktop-global.lock"
let fd = open(lockPath,O_CREAT|O_RDWR|O_NOFOLLOW,0o600)
guard fd >= 0, flock(fd,LOCK_EX|LOCK_NB) == 0 else { fail("Diese App bearbeitet bereits einen Relay-Auftrag") }
defer { flock(fd,LOCK_UN); close(fd) }
let root = AXUIElementCreateApplication(app.processIdentifier)
AXUIElementSetMessagingTimeout(root,2)
func snapshot() -> [AXUIElement] { nodes(root) }
var all = snapshot()
// Sidebar titles and editable input are never conversation ownership evidence.
func transcriptNodes() -> [AXUIElement] {
  if provider == "grok-bot" {
    guard let start = all.firstIndex(where: { (attr($0,"AXRole") as? String) == "AXButton" && text($0) == "Computer von Grok Bot" }),
          let end = all.indices.first(where: { $0 > start && (attr(all[$0],"AXRole") as? String) == "AXTextArea" }) else { return [] }
    return Array(all[(start+1)..<end])
  }
  let areas = all.filter { element in
    guard (attr(element,"AXRole") as? String) == "AXScrollArea" else { return false }
    let children = attr(element,"AXChildren") as? [AXUIElement] ?? []
    return children.contains { (attr($0,"AXRole") as? String) == "AXStaticText" }
      && !nodes(element).contains { ["AXOutline", "AXTextArea"].contains(attr($0,"AXRole") as? String ?? "") }
  }
  guard areas.count == 1 else { return [] }
  return nodes(areas[0])
}
func transcriptSignature() -> String {
  transcriptNodes().filter { (attr($0,"AXRole") as? String) == "AXStaticText" }
    .map { text($0) + String(describing:elementRect($0)) }.joined(separator:"|")
}
func frontWindow() -> (Int, CGRect)? {
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier,
        let windows = CGWindowListCopyWindowInfo([.optionOnScreenOnly,.excludeDesktopElements],kCGNullWindowID) as? [[String:Any]],
        let front = windows.first(where: { ($0[kCGWindowLayer as String] as? Int) == 0 }),
        front[kCGWindowOwnerPID as String] as? Int == Int(app.processIdentifier),
        let id = front[kCGWindowNumber as String] as? Int,
        let bounds = front[kCGWindowBounds as String] as? [String:Any],
        let rect = CGRect(dictionaryRepresentation:bounds as CFDictionary) else { return nil }
  return (id,rect)
}
func wheelRecoverCurrentChat() -> Bool {
  guard provider == "grok-bot", let expected = frontWindow(),
        let window = attr(root,"AXFocusedWindow") as! AXUIElement?,
        elementRect(window) == expected.1 else { return false }
  return recoverWithWheel(observe: {
    all = nodes(window)
    return transcriptNodes().contains { (attr($0,"AXRole") as? String) == "AXStaticText" && text($0) == anchor }
  }, signature: { transcriptSignature() }, guardedScroll: {
    // Re-read the window and target for every event; never use sidebar/input geometry.
    guard let focused = attr(root,"AXFocusedWindow") as! AXUIElement?, CFEqual(focused,window),
          elementRect(window) == expected.1 else { return false }
    all = nodes(window)
    guard let header = all.first(where: { (attr($0,"AXRole") as? String) == "AXButton" && text($0) == "Computer von Grok Bot" }).flatMap({ elementRect($0) }),
          let input = all.first(where: { (attr($0,"AXRole") as? String) == "AXTextArea" }).flatMap({ elementRect($0) }),
          let target = transcriptNodes().first(where: { element in
            guard (attr(element,"AXRole") as? String) == "AXStaticText", let rect = elementRect(element) else { return false }
            return safeWheelTarget(rect,window:expected.1,header:header,input:input)
          }), let rect = elementRect(target),
          let event = CGEvent(scrollWheelEvent2Source:nil,units:.pixel,wheelCount:1,wheel1:700,wheel2:0,wheel3:0) else { return false }
    event.location = CGPoint(x:rect.midX,y:rect.midY)
    // Global wheel delivery only: front PID/window/bounds checked immediately before posting.
    guard let current = frontWindow(), current.0 == expected.0, current.1 == expected.1 else { return false }
    event.post(tap:.cghidEventTap)
    return true
  }, wait: { Thread.sleep(forTimeInterval:0.6) }, now: { ProcessInfo.processInfo.systemUptime })
}
func verifyCurrentChat() -> Bool {
  var previous = ""
  var stationary = false
  let recovered = recoverAnchor(observe: {
    all = snapshot()
    return transcriptNodes().contains { (attr($0,"AXRole") as? String) == "AXStaticText" && text($0) == anchor }
  }, scroll: {
    let transcript = transcriptNodes()
    if provider == "grok-bot" {
      let signature = transcriptSignature()
      if signature == previous { stationary = true; return false }
      previous = signature
      guard let first = transcript.first(where: { (attr($0,"AXRole") as? String) == "AXStaticText" && text($0).count > 30 }) else { return false }
      return AXUIElementPerformAction(first,"AXScrollToVisible" as CFString) == .success
    }
    guard let area = transcript.first, (attr(area,"AXRole") as? String) == "AXScrollArea" else { return false }
    return AXUIElementPerformAction(area,"AXScrollUpByPage" as CFString) == .success
  }, wait: { Thread.sleep(forTimeInterval:0.3) })
  return recovered || (provider == "grok-bot" && stationary && wheelRecoverCurrentChat())
}
if !all.contains(where: { (attr($0,"AXRole") as? String) == "AXTextArea" }) {
  app.activate(options:[]); Thread.sleep(forTimeInterval:0.3); all = snapshot()
}
guard all.contains(where: { (attr($0,"AXRole") as? String) == "AXTextArea" }) else {
  if NSWorkspace.shared.frontmostApplication?.bundleIdentifier == "com.apple.loginwindow" { fail("macOS-Anmeldung aktiv. Mac manuell entsperren, Ziel-App öffnen und Auftrag anschließend bewusst neu starten; nichts gesendet.") }
  fail("App-Oberfläche nicht lesbar. Ziel-App in den Vordergrund holen und den gebundenen Chat öffnen; Bedienungshilfen prüfen. Nichts gesendet.")
}
// Chromium may defer virtualized history updates until activation.
if provider == "grok-bot" { app.activate(options:[]); Thread.sleep(forTimeInterval:0.25) }
guard verifyCurrentChat() else { fail("Gebundener Chat nicht bestätigt: exakter Anker auch nach begrenztem Zurückscrollen nicht gefunden. Gewünschten Chat öffnen und zur ursprünglichen Ankernachricht scrollen. Nichts gesendet; kein automatischer Neuversuch.") }
let composers = all.filter { (attr($0,"AXRole") as? String) == "AXTextArea" && (provider != "grok-bot" || text($0) == "Prompt") }
guard composers.count == 1 else { fail("Eingabefeld nicht eindeutig") }
let composer = composers[0]
let draft = attr(composer,"AXValue") as? String ?? ""
let heading = all.first { (attr($0,"AXRole") as? String) == "AXHeading" }.map { text($0) } ?? ""
let grokEmpty = provider == "grok-bot" && !heading.isEmpty && draft.trimmingCharacters(in:.whitespacesAndNewlines) == "Nachricht an " + heading && !all.contains { text($0) == "Nachricht senden" } && all.contains { text($0) == "Sprachchat starten" }
guard draft.isEmpty || grokEmpty else { fail("Ungesendeter Entwurf vorhanden; unverändert belassen.") }
let framed = prompt + "\nAntworte als reiner Text. Beginne mit einer eigenen Zeile BEGIN_" + nonce + ", danach deine Antwort, abschließend eigene Zeile END_" + nonce + ". Verwende keine nativen App-Tools oder Integrationen. Angeforderte lokale JSON-Vorschläge sind nur Text für Claudian, keine eigene Ausführung."
if provider == "grok-bot" {
  app.activate(options:[])
  Thread.sleep(forTimeInterval:0.25)
  guard NSWorkspace.shared.frontmostApplication?.processIdentifier == app.processIdentifier else { fail("App konnte nicht sicher fokussiert werden") }
  guard AXUIElementSetAttributeValue(composer,kAXFocusedAttribute as CFString,kCFBooleanTrue) == .success else { fail("Eingabe nicht fokussierbar") }
  guard pasteVerified(framed, into: composer, app: app) else { fail("Einfügen nicht bestätigt; Entwurf belassen, nicht gesendet.") }
} else {
  guard all.contains(where:{text($0) == "Suche"}), AXUIElementSetAttributeValue(composer,kAXValueAttribute as CFString,framed as CFString) == .success else { fail("Normale Suche nicht bestätigt oder Eingabe fehlgeschlagen") }
}
Thread.sleep(forTimeInterval:0.3)
guard (attr(composer,"AXValue") as? String) == framed else { fail("Eingabe nicht bestätigt; Entwurf belassen, nicht gesendet.") }
all = snapshot()
guard verifyCurrentChat(), (attr(composer,"AXValue") as? String) == framed else { fail("Chat oder Entwurf geändert; nicht gesendet") }
let send = all.filter { (attr($0,"AXRole") as? String) == "AXButton" && (provider == "grok-bot" ? text($0) == "Nachricht senden" : ["arrow-right", "arrow-up"].contains(text($0))) }
guard send.count == 1 else { fail("Senden nicht eindeutig; Entwurf belassen") }
let oldCopies = all.filter { text($0) == "Kopieren" }.count
press(send[0]) // Exactly one attempt. Unknown outcome is never retried.
let deadline = Date().addingTimeInterval(90)
let begin="BEGIN_"+nonce+"\n", end="\nEND_"+nonce
func extract(_ value:String)->String? { guard value.hasPrefix(begin), let endRange=value.range(of:end), (value[endRange.upperBound...].isEmpty || value[endRange.upperBound...].hasPrefix("\n")) else{return nil}; return String(value[value.index(value.startIndex,offsetBy:begin.count)..<endRange.lowerBound]) }
var forwardBudget = 120
var lastScrolled: AXUIElement?
var lastScrolledText = ""
while Date() < deadline {
  Thread.sleep(forTimeInterval:0.5); all=snapshot()
  if provider == "grok-bot" {
    // Do not recover the old anchor on every poll: that strands virtualized
    // responses above the bottom. No input occurs during this read-only phase.
    let candidate = followTranscriptReply(read: {
      all = snapshot()
      let values=transcriptNodes().filter{(attr($0,"AXRole") as? String)=="AXStaticText"}.map{text($0)}
      for value in values { if let reply=extract(value) { return reply } }
      // Chromium may expose separate text nodes for each line.
      if let b=values.firstIndex(of:"BEGIN_"+nonce), let e=values[(b+1)...].firstIndex(of:"END_"+nonce), e>b { return values[(b+1)..<e].joined(separator:"\n") }
      return nil
    }, scroll: {
      guard Date() < deadline,
            let last = transcriptNodes().last(where: { (attr($0,"AXRole") as? String) == "AXStaticText" && !text($0).isEmpty }) else { return false }
      // A stationary viewport must yield to the normal timed poll, not spin.
      if let previous = lastScrolled, CFEqual(previous, last), lastScrolledText == text(last) { return false }
      lastScrolled = last
      lastScrolledText = text(last)
      return AXUIElementPerformAction(last,"AXScrollToVisible" as CFString) == .success
    }, wait: { Thread.sleep(forTimeInterval:0.3) }, remaining: &forwardBudget)
    if let reply = candidate {
      guard verifyCurrentChat() else { fail("Chat gewechselt; Antwort verworfen, nicht erneut senden.") }
      let out=try! JSONSerialization.data(withJSONObject:["reply":reply,"nonce":nonce]); print(String(data:out,encoding:.utf8)!); exit(0)
    }
  } else {
    guard verifyCurrentChat() else { fail("Chat gewechselt; Auftrag abgebrochen, nicht erneut senden.") }
    if all.contains(where:{text($0)=="player-stop-filled"}) { continue }
    let copies=all.filter{text($0)=="Kopieren"}
    if copies.count == oldCopies+1, let copy=copies.last {
      let pb=NSPasteboard.general
      let saved=(pb.pasteboardItems ?? []).map { item -> NSPasteboardItem in let clone=NSPasteboardItem(); for type in item.types { if let data=item.data(forType:type){clone.setData(data,forType:type)} }; return clone }
      // Defer termination across the only clipboard mutation, restoring all formats.
      var signals = sigset_t(); sigemptyset(&signals); sigaddset(&signals,SIGTERM); sigaddset(&signals,SIGINT)
      var previous = sigset_t(); sigprocmask(SIG_BLOCK,&signals,&previous)
      let count=pb.changeCount
      let copied = AXUIElementPerformAction(copy,kAXPressAction as CFString) == .success
      Thread.sleep(forTimeInterval:0.15)
      let changed = pb.changeCount != count
      let value=pb.string(forType:.string) ?? ""
      if changed { pb.clearContents(); pb.writeObjects(saved) }
      sigprocmask(SIG_SETMASK,&previous,nil)
      guard copied && changed else { fail("Antwort-Kopie nicht bestätigt") }
      guard let reply=extract(value) else { fail("Antwort gehört nicht eindeutig zum Auftrag; nicht erneut senden") }
      let out=try! JSONSerialization.data(withJSONObject:["reply":reply,"nonce":nonce]); print(String(data:out,encoding:.utf8)!); exit(0)
    }
  }
}
fail("Zeitlimit: Auftrag eventuell bereits gesendet. Nicht automatisch wiederholen. Abbruch beendet nur das lokale Warten.")
