import SwiftUI
#if canImport(UIKit)
import UIKit
#endif

struct PairingCodeEntryView: View {
    @Binding var code: String
    var onSubmit: () -> Void
    var isLoading: Bool
    var autoFocus: Bool = false
    var focusTrigger: Int = 0
    var showsHeader: Bool = true
    var buttonTitle: String = "Connect"

    @FocusState private var isFocused: Bool
    @Environment(\.colorScheme) private var colorScheme
    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @ScaledMetric(relativeTo: .body) private var digitHeight: CGFloat = 56

    private let digitCount = 6

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            if showsHeader {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Enter the pairing code")
                        .font(.headline)
                    Text("The desktop app generates a 6-digit code. SideLink connects as soon as all digits are entered.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

            pairingCodeField

            Button {
                onSubmit()
            } label: {
                Group {
                    if isLoading {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Text(buttonTitle)
                            .font(.headline)
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .sidelinkProminentButton()
            .controlSize(.regular)
            .frame(minHeight: 44)
            .disabled(code.count != digitCount || isLoading)
        }
        .onAppear {
            guard autoFocus else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                isFocused = true
            }
        }
        .onChange(of: focusTrigger) { _, _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isFocused = true
            }
        }
    }

    private var pairingCodeField: some View {
        ZStack {
            digitBoxes
            codeTextField
        }
        .frame(maxWidth: .infinity)
        .padding(8)
        .background(
            pairingFieldBackground,
            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
        )
        .frame(maxWidth: 424, alignment: .leading)
    }

    private var pairingFieldBackground: Color {
        if reduceTransparency {
            return Color(uiColor: .secondarySystemBackground)
        }
        return colorScheme == .dark ? Color.white.opacity(0.04) : Color.black.opacity(0.02)
    }

    private var codeTextField: some View {
        TextField("", text: pairingCodeBinding)
            .keyboardType(.numberPad)
            .textContentType(.oneTimeCode)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .focused($isFocused)
            .textFieldStyle(.plain)
            .foregroundStyle(.clear)
            .tint(.clear)
            .frame(maxWidth: .infinity, minHeight: max(56, digitHeight))
            .contentShape(Rectangle())
            .accessibilityLabel("Pairing code")
            .accessibilityValue(accessibilityValue)
            .accessibilityHint("Enter the six-digit code shown in the SideLink desktop app.")
            .accessibilityIdentifier("pairingCodeField")
            .onChange(of: code) { oldValue, newValue in
                if oldValue.count != digitCount, newValue.count == digitCount {
                    onSubmit()
                }
            }
    }

    private var digitBoxes: some View {
        HStack(spacing: 6) {
            ForEach(0..<digitCount, id: \.self) { index in
                digitBox(at: index)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private var pairingCodeBinding: Binding<String> {
        Binding(
            get: { code },
            set: { newValue in
                code = String(newValue.filter(\.isNumber).prefix(digitCount))
            }
        )
    }

    private var accessibilityValue: String {
        guard !code.isEmpty else { return "No digits entered" }
        let spokenDigits = code.map(String.init).joined(separator: " ")
        return "\(spokenDigits). \(code.count) of \(digitCount) digits entered."
    }

    private func digitBox(at index: Int) -> some View {
        let isCurrentDigit = index == code.count && isFocused
        let fillColor = reduceTransparency
            ? Color(uiColor: .systemBackground)
            : (colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.76))
        let borderColor = isCurrentDigit
            ? Color.slAccent
            : (colorScheme == .dark ? Color.white.opacity(0.10) : Color.secondary.opacity(0.2))
        let borderWidth: CGFloat = isCurrentDigit ? 2 : 1

        return ZStack {
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(fillColor)
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(borderColor, lineWidth: borderWidth)
            Text(digitAt(index))
                .font(.title2.monospacedDigit().weight(.bold))
                .minimumScaleFactor(0.7)
                .foregroundStyle(.primary)
        }
        .frame(maxWidth: .infinity, minHeight: max(56, digitHeight))
    }

    private func digitAt(_ index: Int) -> String {
        guard index < code.count else { return "" }
        let i = code.index(code.startIndex, offsetBy: index)
        return String(code[i])
    }
}
