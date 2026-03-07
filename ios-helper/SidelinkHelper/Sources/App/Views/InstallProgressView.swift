import SwiftUI

struct InstallProgressView: View {
    let job: InstallJobDetailDTO
    let logs: [InstallJobLogDTO]
    @Binding var twoFACode: String
    var onSubmitTwoFA: () -> Void
    var onRetry: () -> Void
    var isSubmitting: Bool
    var showsVerboseLogs: Bool = true
    @State private var showVerboseLogs = true

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Install Progress")
                        .font(.headline)
                    Text("Live status for the current install job")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Text(statusLabel(job.status))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(statusColor(job.status))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(statusColor(job.status).opacity(0.12), in: Capsule())
            }

            if job.status == "completed" {
                VStack(spacing: 8) {
                    Image(systemName: "checkmark.seal.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(.green)
                    Text("App Installed")
                        .font(.headline)
                        .foregroundStyle(.green)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .onAppear { triggerSuccessHaptic() }
            } else if job.status == "failed" {
                VStack(spacing: 8) {
                    Image(systemName: "xmark.octagon.fill")
                        .font(.system(size: 36))
                        .foregroundStyle(.red)
                    Text("Install Failed")
                        .font(.headline)
                        .foregroundStyle(.red)
                    if let error = job.error, !error.isEmpty {
                        Text(SidelinkLogRedaction.sanitize(error))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    Button {
                        onRetry()
                    } label: {
                        Label("Retry", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                    .disabled(isSubmitting)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 8)
                .onAppear { triggerErrorHaptic() }
            } else {
                HStack {
                    Text("Status")
                        .foregroundStyle(.secondary)
                    Spacer()
                    Text(statusLabel(job.status))
                        .font(.subheadline.bold())
                        .foregroundStyle(statusColor(job.status))
                }
            }

            if job.status == "waiting_2fa" {
                VStack(alignment: .leading, spacing: 12) {
                    Label("Verification Required", systemImage: "lock.shield.fill")
                        .font(.headline)
                        .foregroundStyle(.orange)
                    Text(twoFAMessage)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    TextField("6-digit 2FA code", text: $twoFACode)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                        .font(.system(.title3, design: .monospaced).weight(.semibold))
                        .sidelinkField()
                    Button {
                        onSubmitTwoFA()
                    } label: {
                        Label("Submit Code", systemImage: "checkmark.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(twoFACode.count != 6 || isSubmitting)
                }
                .padding(16)
                .background(Color.orange.opacity(0.10), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            }

            ForEach(job.steps) { step in
                HStack(spacing: 10) {
                    stepIcon(for: step.status)
                        .frame(width: 22)
                    Text(stepDisplayName(step.name))
                        .font(.subheadline)
                    Spacer()
                    Text(step.status.capitalized)
                        .font(.caption)
                        .foregroundStyle(stepStatusColor(step.status))
                }
                .opacity(step.status == "pending" ? 0.5 : 1.0)
                .padding(.vertical, 2)
            }

            if showsVerboseLogs && !logs.isEmpty {
                DisclosureGroup(isExpanded: $showVerboseLogs) {
                    InstallVerboseLogConsole(logs: logs, maxHeight: 210)
                } label: {
                    Label("Verbose Install Log", systemImage: "terminal")
                }
                .padding(.top, 6)
            }
        }
        .liquidPanel()
    }

    @ViewBuilder
    private func stepIcon(for status: String) -> some View {
        switch status {
        case "completed":
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(.green)
        case "running":
            ProgressView()
                .controlSize(.small)
        case "failed":
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(.red)
        case "skipped":
            Image(systemName: "forward.fill")
                .foregroundStyle(.secondary)
        default:
            Image(systemName: "circle")
                .foregroundStyle(.secondary.opacity(0.4))
        }
    }

    private func stepDisplayName(_ name: String) -> String {
        let map: [String: String] = [
            "validate": "Validate IPA",
            "authenticate": "Authenticate",
            "provision": "Provision Profile",
            "sign": "Sign App",
            "install": "Install to Device",
            "register": "Register App",
        ]
        return map[name.lowercased()] ?? name.capitalized
    }

    private func stepStatusColor(_ status: String) -> Color {
        switch status {
        case "completed": return .green
        case "running": return .blue
        case "failed": return .red
        case "skipped": return .secondary
        default: return .secondary
        }
    }

    private func statusLabel(_ status: String) -> String {
        switch status {
        case "queued": return "Queued"
        case "running": return "Running"
        case "waiting_2fa": return "Waiting for 2FA"
        case "completed": return "Completed"
        case "failed": return "Failed"
        default: return status.capitalized
        }
    }

    private func statusColor(_ status: String) -> Color {
        switch status {
        case "completed": return .green
        case "failed": return .red
        case "waiting_2fa": return .orange
        case "running": return .blue
        default: return .secondary
        }
    }

    private var twoFAMessage: String {
        switch job.currentStep {
        case "provision":
            return "Apple needs a fresh verification code before provisioning can continue. Approve the trusted-device prompt if it appears, then enter the 6-digit code here."
        default:
            return "Sidelink is waiting on Apple account verification. Enter the 6-digit code from your trusted device or SMS to resume the install."
        }
    }

    private func triggerSuccessHaptic() {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
    }

    private func triggerErrorHaptic() {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.error)
    }

}

struct InstallVerboseLogConsole: View {
    let logs: [InstallJobLogDTO]
    let maxHeight: CGFloat

    private var visibleLogs: ArraySlice<InstallJobLogDTO> {
        logs.suffix(220)
    }

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                if logs.isEmpty {
                    Text("Waiting for live install output…")
                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                        .foregroundStyle(Color(red: 0.62, green: 0.67, blue: 0.74))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(8)
                } else {
                    LazyVStack(alignment: .leading, spacing: 6) {
                        if logs.count > visibleLogs.count {
                            Text("Showing latest \(visibleLogs.count) of \(logs.count) log lines.")
                                .font(.system(size: 11, weight: .regular, design: .monospaced))
                                .foregroundStyle(Color(red: 0.62, green: 0.67, blue: 0.74))
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }

                        ForEach(visibleLogs) { line in
                            Text(logLine(line))
                                .font(.system(size: 11, weight: .regular, design: .monospaced))
                                .foregroundStyle(logColor(line.level))
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .id(line.id)
                        }
                    }
                    .padding(8)
                }
            }
            .frame(maxHeight: maxHeight)
            .frame(height: maxHeight)
            .background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
            .onChange(of: logs.count) { _ in
                guard let last = logs.last else { return }
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo(last.id, anchor: .bottom)
                }
            }
            .onAppear {
                guard let last = logs.last else { return }
                proxy.scrollTo(last.id, anchor: .bottom)
            }
        }
    }

    private func logLine(_ line: InstallJobLogDTO) -> String {
        let time = String(line.at.suffix(8))
        let sanitizedMessage = SidelinkLogRedaction.sanitize(line.message)
        if let step = line.step {
            return "[\(time)] [\(step)] \(sanitizedMessage)"
        }
        return "[\(time)] \(sanitizedMessage)"
    }

    private func logColor(_ level: String) -> Color {
        switch level.lowercased() {
        case "error": return Color(red: 1, green: 0.45, blue: 0.45)
        case "warn": return Color(red: 1, green: 0.78, blue: 0.35)
        case "debug": return Color(red: 0.62, green: 0.67, blue: 0.74)
        default: return Color(red: 0.86, green: 0.93, blue: 1)
        }
    }
}
