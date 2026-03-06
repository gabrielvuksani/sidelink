import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

// MARK: - Color Palette
extension Color {
    static let slAccent = Color(red: 0.05, green: 0.42, blue: 0.74)
    static let slAccent2 = Color(red: 0.05, green: 0.70, blue: 0.68)
    static let slSuccess = Color(red: 0.11, green: 0.62, blue: 0.35)
    static let slWarning = Color(red: 0.92, green: 0.47, blue: 0.09)
    static let slDanger = Color(red: 0.82, green: 0.19, blue: 0.24)
    static let slMuted = Color.secondary

    /// Initialize a Color from a hex string like "#6366f1" or "6366f1"
    init?(hex: String?) {
        guard let hex = hex else { return nil }
        let cleaned = hex.trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "#", with: "")
        guard cleaned.count == 6, let rgb = UInt64(cleaned, radix: 16) else { return nil }
        self.init(
            red: Double((rgb >> 16) & 0xFF) / 255,
            green: Double((rgb >> 8) & 0xFF) / 255,
            blue: Double(rgb & 0xFF) / 255
        )
    }
}

struct SidelinkBrandIcon: View {
    var size: CGFloat = 56

    private static let sPath: String = "M38.4 17.6c-2.7 0-5.2.8-7 2.4-2.2 1.9-3.4 4.8-3.4 8.2 0 2.4.6 4.2 1.8 5.6 1.1 1.3 2.7 2.3 4.8 3.2l4.2 1.8c1.4.6 2.4 1.2 3 2 .7.8 1 1.9 1 3.2 0 1.8-.6 3.2-1.7 4.2-1.1 1-2.6 1.4-4.5 1.4-1.6 0-3-.4-4.2-1.2-1.2-.8-2-2-2.4-3.4l-3.6 1.2c.6 2.2 1.9 4 3.8 5.2 1.9 1.2 4.1 1.8 6.6 1.8 3.2 0 5.7-.9 7.6-2.8 1.9-1.9 2.8-4.4 2.8-7.4 0-2.4-.6-4.4-1.9-5.8-1.2-1.4-3-2.6-5.2-3.4l-4-1.6c-1.4-.6-2.4-1.2-3-1.8-.6-.7-.9-1.6-.9-2.8 0-1.6.5-2.9 1.6-3.8 1-.9 2.4-1.4 4-1.4 1.3 0 2.4.3 3.4 1 1 .7 1.7 1.6 2.1 2.8l3.4-1.2c-.6-1.9-1.7-3.4-3.3-4.4-1.6-1.1-3.5-1.6-5.6-1.6h-.3Z"

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.25, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color(red: 0.118, green: 0.118, blue: 0.18), Color(red: 0.059, green: 0.059, blue: 0.09)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            SPathShape()
                .fill(.white.opacity(0.92))
                .frame(width: size * 0.6, height: size * 0.6)
        }
        .frame(width: size, height: size)
        .shadow(color: .black.opacity(0.16), radius: size * 0.08, y: size * 0.03)
    }
}

private struct SPathShape: Shape {
    func path(in rect: CGRect) -> Path {
        let s = min(rect.width, rect.height) / 64
        var p = Path()
        p.move(to: CGPoint(x: 38.4 * s, y: 17.6 * s))
        p.addCurve(to: CGPoint(x: 31.4 * s, y: 20 * s), control1: CGPoint(x: 35.7 * s, y: 17.6 * s), control2: CGPoint(x: 33.2 * s, y: 18.4 * s))
        p.addCurve(to: CGPoint(x: 28 * s, y: 28.2 * s), control1: CGPoint(x: 29.2 * s, y: 21.9 * s), control2: CGPoint(x: 28 * s, y: 24.8 * s))
        p.addCurve(to: CGPoint(x: 29.8 * s, y: 33.8 * s), control1: CGPoint(x: 28 * s, y: 30.6 * s), control2: CGPoint(x: 28.6 * s, y: 32.4 * s))
        p.addCurve(to: CGPoint(x: 34.6 * s, y: 37 * s), control1: CGPoint(x: 30.9 * s, y: 35.1 * s), control2: CGPoint(x: 32.5 * s, y: 36.1 * s))
        p.addLine(to: CGPoint(x: 38.8 * s, y: 38.8 * s))
        p.addCurve(to: CGPoint(x: 41.8 * s, y: 40.8 * s), control1: CGPoint(x: 40.2 * s, y: 39.4 * s), control2: CGPoint(x: 41.2 * s, y: 40 * s))
        p.addCurve(to: CGPoint(x: 42.8 * s, y: 44 * s), control1: CGPoint(x: 42.5 * s, y: 41.6 * s), control2: CGPoint(x: 42.8 * s, y: 42.7 * s))
        p.addCurve(to: CGPoint(x: 41.1 * s, y: 48.2 * s), control1: CGPoint(x: 42.8 * s, y: 45.8 * s), control2: CGPoint(x: 42.2 * s, y: 47.2 * s))
        p.addCurve(to: CGPoint(x: 36.6 * s, y: 49.6 * s), control1: CGPoint(x: 40 * s, y: 49.2 * s), control2: CGPoint(x: 38.5 * s, y: 49.6 * s))
        p.addCurve(to: CGPoint(x: 32.4 * s, y: 48.4 * s), control1: CGPoint(x: 35 * s, y: 49.6 * s), control2: CGPoint(x: 33.6 * s, y: 49.2 * s))
        p.addCurve(to: CGPoint(x: 30 * s, y: 45 * s), control1: CGPoint(x: 31.2 * s, y: 47.6 * s), control2: CGPoint(x: 30.4 * s, y: 46.4 * s))
        p.addLine(to: CGPoint(x: 26.4 * s, y: 46.2 * s))
        p.addCurve(to: CGPoint(x: 30.2 * s, y: 51.4 * s), control1: CGPoint(x: 27 * s, y: 48.4 * s), control2: CGPoint(x: 28.3 * s, y: 50.2 * s))
        p.addCurve(to: CGPoint(x: 36.8 * s, y: 53.2 * s), control1: CGPoint(x: 32.1 * s, y: 52.6 * s), control2: CGPoint(x: 34.3 * s, y: 53.2 * s))
        p.addCurve(to: CGPoint(x: 44.4 * s, y: 50.4 * s), control1: CGPoint(x: 40 * s, y: 53.2 * s), control2: CGPoint(x: 42.5 * s, y: 52.3 * s))
        p.addCurve(to: CGPoint(x: 47.2 * s, y: 43 * s), control1: CGPoint(x: 46.3 * s, y: 48.5 * s), control2: CGPoint(x: 47.2 * s, y: 46 * s))
        p.addCurve(to: CGPoint(x: 45.3 * s, y: 37.2 * s), control1: CGPoint(x: 47.2 * s, y: 40.6 * s), control2: CGPoint(x: 46.6 * s, y: 38.6 * s))
        p.addCurve(to: CGPoint(x: 40.1 * s, y: 33.8 * s), control1: CGPoint(x: 44.1 * s, y: 35.8 * s), control2: CGPoint(x: 42.3 * s, y: 34.6 * s))
        p.addLine(to: CGPoint(x: 36.1 * s, y: 32.2 * s))
        p.addCurve(to: CGPoint(x: 33.1 * s, y: 30.4 * s), control1: CGPoint(x: 34.7 * s, y: 31.6 * s), control2: CGPoint(x: 33.7 * s, y: 31 * s))
        p.addCurve(to: CGPoint(x: 32.2 * s, y: 27.6 * s), control1: CGPoint(x: 32.5 * s, y: 29.7 * s), control2: CGPoint(x: 32.2 * s, y: 28.8 * s))
        p.addCurve(to: CGPoint(x: 33.8 * s, y: 23.8 * s), control1: CGPoint(x: 32.2 * s, y: 26 * s), control2: CGPoint(x: 32.7 * s, y: 24.7 * s))
        p.addCurve(to: CGPoint(x: 37.8 * s, y: 22.4 * s), control1: CGPoint(x: 34.8 * s, y: 22.9 * s), control2: CGPoint(x: 36.2 * s, y: 22.4 * s))
        p.addCurve(to: CGPoint(x: 41.2 * s, y: 23.4 * s), control1: CGPoint(x: 39.1 * s, y: 22.4 * s), control2: CGPoint(x: 40.2 * s, y: 22.7 * s))
        p.addCurve(to: CGPoint(x: 43.3 * s, y: 26.2 * s), control1: CGPoint(x: 42.2 * s, y: 24.1 * s), control2: CGPoint(x: 42.9 * s, y: 25 * s))
        p.addLine(to: CGPoint(x: 46.7 * s, y: 25 * s))
        p.addCurve(to: CGPoint(x: 43.4 * s, y: 20.6 * s), control1: CGPoint(x: 46.1 * s, y: 23.1 * s), control2: CGPoint(x: 45 * s, y: 21.6 * s))
        p.addCurve(to: CGPoint(x: 37.8 * s, y: 19 * s), control1: CGPoint(x: 41.8 * s, y: 19.5 * s), control2: CGPoint(x: 39.9 * s, y: 19 * s))
        p.closeSubpath()
        return p
    }
}

// MARK: - Card Style Modifier
struct SidelinkCardStyle: ViewModifier {
    @Environment(\.colorScheme) var colorScheme

    func body(content: Content) -> some View {
        content
            .padding()
            .background {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color(uiColor: colorScheme == .dark ? UIColor.systemGray6 : UIColor.systemBackground))
                    .shadow(color: .black.opacity(colorScheme == .dark ? 0.3 : 0.08), radius: 8, y: 2)
            }
    }
}

extension View {
    func sidelinkCard() -> some View {
        modifier(SidelinkCardStyle())
    }
}

// MARK: - Hero Card Modifier (20pt corners, gradient overlay)
struct HeroCardModifier: ViewModifier {
    var tintColor: Color

    func body(content: Content) -> some View {
        content
            .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(alignment: .bottom) {
                LinearGradient(
                    colors: [.clear, tintColor.opacity(0.55)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: 100)
                .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                .allowsHitTesting(false)
            }
    }
}

extension View {
    func heroCard(tint: Color = .slAccent) -> some View {
        modifier(HeroCardModifier(tintColor: tint))
    }
}

// MARK: - App Icon Style Modifier
struct AppIconStyle: ViewModifier {
    var size: CGFloat = 60

    func body(content: Content) -> some View {
        content
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                    .stroke(.secondary.opacity(0.15), lineWidth: 0.5)
            }
    }
}

extension View {
    func appIconStyle(size: CGFloat = 60) -> some View {
        modifier(AppIconStyle(size: size))
    }
}

// MARK: - Section Header Style
struct SectionHeaderStyle: ViewModifier {
    func body(content: Content) -> some View {
        content
            .font(.system(size: 22, weight: .bold))
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension View {
    func sectionHeader() -> some View {
        modifier(SectionHeaderStyle())
    }
}

// MARK: - Pill Badge
struct PillBadge: View {
    let text: String
    var color: Color = .slAccent
    var small: Bool = false

    var body: some View {
        Text(text)
            .font(small ? .caption2.bold() : .caption.bold())
            .foregroundStyle(color)
            .padding(.horizontal, small ? 6 : 10)
            .padding(.vertical, small ? 2 : 4)
            .background(color.opacity(0.14), in: Capsule())
    }
}

// MARK: - Glassmorphism Card
struct GlassmorphismCard: ViewModifier {
    @Environment(\.colorScheme) var colorScheme

    func body(content: Content) -> some View {
        content
            .padding()
            .background {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(.ultraThinMaterial)
                    .shadow(color: .black.opacity(colorScheme == .dark ? 0.35 : 0.1), radius: 12, y: 4)
            }
    }
}

extension View {
    func glassmorphismCard() -> some View {
        modifier(GlassmorphismCard())
    }
}

// MARK: - Animated Gradient Shimmer
struct GradientShimmer: ViewModifier {
    @State private var phase: CGFloat = 0
    var baseColor: Color

    func body(content: Content) -> some View {
        content
            .overlay {
                LinearGradient(
                    colors: [.clear, baseColor.opacity(0.25), .clear],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .offset(x: phase)
                .mask(content)
            }
            .onAppear {
                withAnimation(.linear(duration: 1.5).repeatForever(autoreverses: false)) {
                    phase = 300
                }
            }
    }
}

extension View {
    func gradientShimmer(color: Color = .white) -> some View {
        modifier(GradientShimmer(baseColor: color))
    }
}

// MARK: - Skeleton Loading Modifier
struct SkeletonModifier: ViewModifier {
    @State private var opacity: Double = 0.3

    func body(content: Content) -> some View {
        content
            .redacted(reason: .placeholder)
            .opacity(opacity)
            .animation(
                .easeInOut(duration: 0.8).repeatForever(autoreverses: true),
                value: opacity
            )
            .onAppear { opacity = 0.7 }
    }
}

extension View {
    func skeletonLoading() -> some View {
        modifier(SkeletonModifier())
    }
}

// MARK: - Skeleton Row (placeholder shape)
struct SkeletonRow: View {
    var lineCount: Int = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ForEach(0..<lineCount, id: \.self) { i in
                RoundedRectangle(cornerRadius: 4)
                    .fill(.secondary.opacity(0.15))
                    .frame(height: i == 0 ? 16 : 12)
                    .frame(maxWidth: i == 0 ? .infinity : 180)
            }
        }
        .skeletonLoading()
        .padding(.vertical, 4)
    }
}

// MARK: - Slot Gauge Ring (circular progress)
struct SlotGaugeRing: View {
    let used: Int
    let total: Int
    var lineWidth: CGFloat = 8
    var size: CGFloat = 64

    private var fraction: Double {
        guard total > 0 else { return 0 }
        return min(Double(used) / Double(total), 1.0)
    }

    private var ringColor: Color {
        if fraction >= 1.0 { return .slDanger }
        if fraction >= 0.7 { return .slWarning }
        return .slAccent
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(.secondary.opacity(0.15), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(ringColor, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
            VStack(spacing: 0) {
                Text("\(used)")
                    .font(.system(size: size * 0.25, weight: .bold, design: .rounded))
                Text("/ \(total)")
                    .font(.system(size: size * 0.14, design: .rounded))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Progress Bar (linear gauge)
struct LinearGaugeBar: View {
    let fraction: Double
    var height: CGFloat = 8

    private var barColor: Color {
        if fraction >= 1.0 { return .slDanger }
        if fraction >= 0.7 { return .slWarning }
        return .slSuccess
    }

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: height / 2)
                    .fill(.secondary.opacity(0.15))
                RoundedRectangle(cornerRadius: height / 2)
                    .fill(barColor)
                    .frame(width: geo.size.width * min(max(fraction, 0), 1))
            }
        }
        .frame(height: height)
    }
}

// MARK: - Haptic Helpers
enum SidelinkHaptics {
    static func impact(_ style: UIImpactFeedbackGenerator.FeedbackStyle = .medium) {
        UIImpactFeedbackGenerator(style: style).impactOccurred()
    }

    static func success() {
        UINotificationFeedbackGenerator().notificationOccurred(.success)
    }

    static func error() {
        UINotificationFeedbackGenerator().notificationOccurred(.error)
    }

    static func selection() {
        UISelectionFeedbackGenerator().selectionChanged()
    }
}

// MARK: - Status Dot
struct StatusDot: View {
    let color: Color

    var body: some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
    }
}

// MARK: - Accent Button Style
struct SidelinkButtonStyle: ButtonStyle {
    var tint: Color = .slAccent

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.bold())
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.easeOut(duration: 0.15), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == SidelinkButtonStyle {
    static var sidelink: SidelinkButtonStyle { SidelinkButtonStyle() }
    static func sidelink(tint: Color) -> SidelinkButtonStyle { SidelinkButtonStyle(tint: tint) }
}

// MARK: - Async Image with Placeholder
struct SidelinkAsyncImage: View {
    let url: String?
    var size: CGFloat = 60

    var body: some View {
        if let urlStr = url, let url = URL(string: urlStr) {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image.resizable().aspectRatio(contentMode: .fill)
                case .failure:
                    placeholderIcon
                default:
                    RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
                        .fill(.secondary.opacity(0.12))
                        .gradientShimmer()
                }
            }
            .appIconStyle(size: size)
        } else {
            placeholderIcon
        }
    }

    private var placeholderIcon: some View {
        RoundedRectangle(cornerRadius: size * 0.22, style: .continuous)
            .fill(.secondary.opacity(0.12))
            .frame(width: size, height: size)
            .overlay {
                Image(systemName: "app.fill")
                    .foregroundStyle(.secondary)
            }
    }
}
