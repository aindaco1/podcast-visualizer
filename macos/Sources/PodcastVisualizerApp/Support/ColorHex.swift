import SwiftUI

extension Color {
    init?(hex: String) {
        guard hex.count == 7, hex.first == "#", let value = UInt64(hex.dropFirst(), radix: 16) else { return nil }
        self.init(
            .sRGB,
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255,
            opacity: 1
        )
    }
}
