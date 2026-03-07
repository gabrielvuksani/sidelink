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

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.235, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [Color(red: 0.19, green: 0.36, blue: 1.0), Color(red: 0.56, green: 0.25, blue: 1.0)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )

            Ellipse()
                .fill(.white.opacity(0.18))
                .frame(width: size * 0.76, height: size * 0.38)
                .offset(x: 0, y: -size * 0.18)
                .blur(radius: size * 0.04)

            ZStack {
                RoundedRectangle(cornerRadius: size * 0.14, style: .continuous)
                    .stroke(.white.opacity(0.94), lineWidth: size * 0.06)
                    .frame(width: size * 0.33, height: size * 0.33)
                    .offset(x: -size * 0.13, y: -size * 0.01)

                RoundedRectangle(cornerRadius: size * 0.14, style: .continuous)
                    .stroke(.white.opacity(0.94), lineWidth: size * 0.06)
                    .frame(width: size * 0.33, height: size * 0.33)
                    .offset(x: size * 0.13, y: size * 0.03)

                RoundedRectangle(cornerRadius: size * 0.06, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [Color(red: 0.19, green: 0.36, blue: 1.0), Color(red: 0.56, green: 0.25, blue: 1.0)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: size * 0.16, height: size * 0.14)
                    .offset(x: size * 0.01, y: -size * 0.01)
            }

            RoundedRectangle(cornerRadius: size * 0.235, style: .continuous)
                .stroke(.white.opacity(0.18), lineWidth: max(1, size * 0.01))
        }
        .frame(width: size, height: size)
        .shadow(color: .black.opacity(0.12), radius: size * 0.1, y: size * 0.04)
    }
}

struct SidelinkBackdrop: View {
    var accent: Color = .slAccent
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        LinearGradient(
            colors: colorScheme == .dark
                ? [Color(red: 0.01, green: 0.01, blue: 0.015), Color(red: 0.03, green: 0.035, blue: 0.05), Color(red: 0.01, green: 0.01, blue: 0.015)]
                : [Color(red: 0.965, green: 0.978, blue: 0.995), Color.white, Color(red: 0.972, green: 0.982, blue: 0.988)],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
        .overlay(alignment: .topTrailing) {
            Circle()
                .fill(accent.opacity(colorScheme == .dark ? 0.18 : 0.12))
                .frame(width: colorScheme == .dark ? 320 : 260, height: colorScheme == .dark ? 320 : 260)
                .blur(radius: colorScheme == .dark ? 42 : 24)
                .offset(x: 88, y: -56)
        }
        .overlay(alignment: .bottomLeading) {
            RoundedRectangle(cornerRadius: 120, style: .continuous)
                .fill(Color.slAccent2.opacity(colorScheme == .dark ? 0.15 : 0.10))
                .frame(width: 220, height: 220)
                .rotationEffect(.degrees(24))
                .blur(radius: colorScheme == .dark ? 20 : 12)
                .offset(x: -92, y: 84)
        }
        .overlay {
            if colorScheme == .dark {
                Rectangle()
                    .fill(
                        LinearGradient(
                            colors: [Color.black.opacity(0.0), Color.black.opacity(0.12), Color.black.opacity(0.28)],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            }
        }
    }
}

struct LiquidPanelModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .padding(20)
            .background {
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.68))
                    .overlay {
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .stroke(colorScheme == .dark ? Color.white.opacity(0.10) : Color.white.opacity(0.55), lineWidth: 1)
                    }
                    .overlay(alignment: .topLeading) {
                        RoundedRectangle(cornerRadius: 28, style: .continuous)
                            .fill(
                                LinearGradient(
                                    colors: [Color.white.opacity(colorScheme == .dark ? 0.06 : 0.28), .clear],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                    }
                    .shadow(color: .black.opacity(colorScheme == .dark ? 0.42 : 0.08), radius: colorScheme == .dark ? 28 : 18, y: colorScheme == .dark ? 14 : 8)
            }
    }
}

extension View {
    func liquidPanel() -> some View {
        modifier(LiquidPanelModifier())
    }
}

struct SidelinkSectionIntro: View {
    let eyebrow: String?
    let title: String
    let subtitle: String

    init(eyebrow: String? = nil, title: String, subtitle: String) {
        self.eyebrow = eyebrow
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let eyebrow, !eyebrow.isEmpty {
                Text(eyebrow.uppercased())
                    .font(.caption2.weight(.semibold))
                    .tracking(1.1)
                    .foregroundStyle(.secondary)
            }
            Text(title)
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .foregroundStyle(.primary)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct SidelinkMetricTile: View {
    let label: String
    let value: String
    var tint: Color = .slAccent
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .tracking(1.0)
                .foregroundStyle(.secondary)
            Text(value)
                .font(.system(size: 22, weight: .bold, design: .rounded))
                .foregroundStyle(.primary)
            Capsule()
                .fill(tint.opacity(0.22))
                .frame(width: 34, height: 5)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .background((colorScheme == .dark ? Color.white.opacity(0.06) : Color.white.opacity(0.72)), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }
}

struct SidelinkQuickActionButtonStyle: ButtonStyle {
    var tint: Color = .slAccent

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.primary)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color(uiColor: UIColor { trait in
                        if trait.userInterfaceStyle == .dark {
                            return UIColor.white.withAlphaComponent(configuration.isPressed ? 0.10 : 0.14)
                        }
                        return UIColor.white.withAlphaComponent(configuration.isPressed ? 0.62 : 0.82)
                    }))
                    .overlay {
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(tint.opacity(0.16), lineWidth: 1)
                    }
            )
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.easeOut(duration: 0.16), value: configuration.isPressed)
    }
}

extension ButtonStyle where Self == SidelinkQuickActionButtonStyle {
    static var sidelinkQuickAction: SidelinkQuickActionButtonStyle { SidelinkQuickActionButtonStyle() }
    static func sidelinkQuickAction(tint: Color) -> SidelinkQuickActionButtonStyle { SidelinkQuickActionButtonStyle(tint: tint) }
}

struct SidelinkInsetPanelModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(colorScheme == .dark ? Color.white.opacity(0.06) : Color.white.opacity(0.72))
            )
    }
}

struct SidelinkFieldModifier: ViewModifier {
    @Environment(\.colorScheme) private var colorScheme

    func body(content: Content) -> some View {
        content
            .padding(.horizontal, 14)
            .padding(.vertical, 13)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.78))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(colorScheme == .dark ? Color.white.opacity(0.08) : Color.black.opacity(0.06), lineWidth: 1)
            )
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

    func sidelinkInsetPanel() -> some View {
        modifier(SidelinkInsetPanelModifier())
    }

    func sidelinkField() -> some View {
        modifier(SidelinkFieldModifier())
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
                    .fill(colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.72))
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
