import SwiftUI

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

            // Hidden text field to capture keyboard input
            TextField("", text: $code)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .focused($isFocused)
                .frame(width: 0, height: 0)
                .opacity(0)
                .onChange(of: code) { newValue in
                    // Limit to digits only & max 6
                    let filtered = String(newValue.filter(\.isNumber).prefix(digitCount))
                    if filtered != newValue { code = filtered }
                    if filtered.count == digitCount {
                        onSubmit()
                    }
                }

            // Digit boxes
            HStack(spacing: 10) {
                ForEach(0..<digitCount, id: \.self) { index in
                    let char = digitAt(index)
                    ZStack {
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(colorScheme == .dark ? Color.white.opacity(0.07) : Color.white.opacity(0.76))
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(
                                index == code.count && isFocused
                                    ? Color.slAccent
                                    : (colorScheme == .dark ? Color.white.opacity(0.10) : Color.secondary.opacity(0.2)),
                                lineWidth: index == code.count && isFocused ? 2 : 1
                            )
                        Text(char)
                            .font(.system(size: 28, weight: .bold, design: .monospaced))
                            .foregroundStyle(.primary)
                    }
                    .frame(width: 48, height: 58)
                }
            }
            .onTapGesture { isFocused = true }
            .padding(14)
            .background((colorScheme == .dark ? Color.white.opacity(0.04) : Color.black.opacity(0.02)), in: RoundedRectangle(cornerRadius: 22, style: .continuous))

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
            .buttonStyle(.borderedProminent)
            .tint(.slAccent)
            .controlSize(.regular)
            .disabled(code.count != digitCount || isLoading)
        }
        .onAppear {
            guard autoFocus else { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) {
                isFocused = true
            }
        }
        .onChange(of: focusTrigger) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                isFocused = true
            }
        }
    }

    private func digitAt(_ index: Int) -> String {
        guard index < code.count else { return "" }
        let i = code.index(code.startIndex, offsetBy: index)
        return String(code[i])
    }
}
