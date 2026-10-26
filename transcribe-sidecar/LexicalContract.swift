import Foundation

@main
struct LexicalContract {
    static func main() {
        let cases: [(String, Bool)] = [
            ("", false), (" . ，… ", false), ("。", false),
            ("Hello, world.", true), ("你好。", true), ("42%", true),
            ("½", false), ("Ⅷ", false),
        ]
        for (text, expected) in cases {
            precondition(hasLexicalContent(text) == expected,
                         "Lexical contract failed for \(String(reflecting: text))")
        }
        precondition(liveTextAction("hello", hasPartial: false) == .segment)
        precondition(liveTextAction("", hasPartial: true) == .revoke)
        precondition(liveTextAction("…", hasPartial: true) == .revoke)
        precondition(liveTextAction("", hasPartial: false) == .ignore)
        print("Swift lexical contract: \(cases.count + 4) cases passed")
    }
}
