import SwiftUI

struct InstallProgressView: View {
    let job: InstallJobDetailDTO
    let logs: [InstallJobLogDTO]
    @Binding var twoFACode: String
    var onSubmitTwoFA: () -> Void
    var onRetry: () -> Void
    var isSubmitting: Bool
    @State private var showVerboseLogs = true

    var body: some View {
        Section("Install Progress") {
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
                        Text(error)
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
                VStack(alignment: .leading, spacing: 8) {
                    Label("Verification Required", systemImage: "lock.shield")
                        .font(.subheadline.bold())
                        .foregroundStyle(.orange)
                    TextField("6-digit 2FA code", text: $twoFACode)
                        .keyboardType(.numberPad)
                        .textContentType(.oneTimeCode)
                    Button {
                        onSubmitTwoFA()
                    } label: {
                        Label("Submit Code", systemImage: "checkmark.circle")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(twoFACode.count != 6 || isSubmitting)
                }
                .padding(.vertical, 4)
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
            }

            if !logs.isEmpty {
                DisclosureGroup(isExpanded: $showVerboseLogs) {
                    ScrollViewReader { proxy in
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 6) {
                                ForEach(logs.suffix(220)) { line in
                                    Text(logLine(line))
                                        .font(.system(size: 11, weight: .regular, design: .monospaced))
                                        .foregroundStyle(logColor(line.level))
                                        .frame(maxWidth: .infinity, alignment: .leading)
                                        .id(line.id)
                                }
                            }
                            .padding(8)
                        }
                        .frame(maxHeight: 210)
                        .background(Color.black.opacity(0.85), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .onChange(of: logs.count) { _ in
                            guard showVerboseLogs, let last = logs.last else { return }
                            withAnimation(.easeOut(duration: 0.18)) {
                                proxy.scrollTo(last.id, anchor: .bottom)
                            }
                        }
                        .onAppear {
                            guard let last = logs.last else { return }
                            proxy.scrollTo(last.id, anchor: .bottom)
                        }
                    }
                } label: {
                    Label("Verbose Install Log", systemImage: "terminal")
                }
                .padding(.top, 6)
            }
        }
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

    private func triggerSuccessHaptic() {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.success)
    }

    private func triggerErrorHaptic() {
        let generator = UINotificationFeedbackGenerator()
        generator.notificationOccurred(.error)
    }

    private func logLine(_ line: InstallJobLogDTO) -> String {
        let time = String(line.at.suffix(8))
        if let step = line.step {
            return "[\(time)] [\(step)] \(line.message)"
        }
        return "[\(time)] \(line.message)"
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
