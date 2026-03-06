import SwiftUI
#if canImport(VisionKit)
import VisionKit
#endif

struct SettingsTab: View {
    @ObservedObject var model: HelperViewModel
    @AppStorage("backgroundRefreshEnabled") private var backgroundRefreshEnabled = true
    @AppStorage("backgroundRefreshIntervalMinutes") private var backgroundRefreshIntervalMinutes = 30
    @State private var showPairingSheet = false
    @State private var appleSheetMode: AppleAccountSheetMode?
    @State private var deleteConfirmation: DestructiveConfirmation?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    HStack(spacing: 12) {
                        Image(systemName: model.isPaired ? "checkmark.shield.fill" : "iphone.slash")
                            .font(.title2)
                            .foregroundStyle(model.isPaired ? Color.slSuccess : Color.slWarning)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(model.isPaired ? "Helper Connected" : "Helper Not Paired")
                                .font(.headline)
                            Text(model.serverName.isEmpty ? "Use the desktop pairing code or a discovered server to connect." : model.serverName)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }

                        Spacer()

                        if model.isPaired {
                            VStack(alignment: .trailing, spacing: 4) {
                                HStack(spacing: 4) {
                                    StatusDot(color: model.sseConnected ? .slSuccess : .slWarning)
                                    Text(model.sseConnected ? "Live" : "Polling")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                                if !model.serverVersion.isEmpty {
                                    Text("v\(model.serverVersion)")
                                        .font(.caption2)
                                        .foregroundStyle(.secondary)
                                }
                            }
                        }
                    }
                    .padding(.vertical, 4)

                    Button {
                        showPairingSheet = true
                    } label: {
                        Label(model.isPaired ? "Re-pair Helper" : "Pair Helper", systemImage: "key.horizontal")
                    }
                } header: {
                    Text("Helper")
                } footer: {
                    Text(model.isPaired
                         ? "Your iPhone is connected. Use Sources, Browse, and Installed for the day-to-day stuff."
                         : "Pair once, then browse sources, install apps, refresh signing, and monitor the helper directly from iPhone.")
                }

                Section("Discovered Servers") {
                    if model.discoveredBackends.isEmpty {
                        HStack(spacing: 10) {
                            ProgressView()
                                .controlSize(.small)
                            Text("Scanning your local network…")
                                .foregroundStyle(.secondary)
                        }
                    } else {
                        ForEach(model.discoveredBackends) { backend in
                            Button {
                                SidelinkHaptics.selection()
                                model.applyDiscoveredBackend(backend)
                                showPairingSheet = true
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "desktopcomputer")
                                        .foregroundStyle(Color.slAccent)
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(backend.name)
                                            .foregroundStyle(.primary)
                                        Text(backend.url)
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    Image(systemName: "chevron.right")
                                        .font(.caption)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                        }
                    }
                }

                Section("Apple IDs") {
                    if model.pendingAppleAuth != nil || !model.accountsNeedingAttention.isEmpty {
                        VStack(alignment: .leading, spacing: 10) {
                            Label(
                                model.pendingAppleAuth != nil
                                    ? "Verification code needed for \(model.pendingAppleAuth?.appleId ?? "your Apple ID")"
                                    : "One or more Apple IDs need attention before they can sign apps reliably.",
                                systemImage: "exclamationmark.shield"
                            )
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color.slWarning)

                            Button {
                                if let pending = model.pendingAppleAuth, let accountId = pending.accountId {
                                    appleSheetMode = .reauth(accountId: accountId)
                                }
                            } label: {
                                Text("Finish Verification")
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(.slWarning)
                            .disabled(model.pendingAppleAuth?.accountId == nil)
                        }
                        .padding(.vertical, 6)
                    }

                    if model.accounts.isEmpty {
                        Text(model.isPaired
                             ? "Add an Apple ID to sign and refresh apps directly from the helper."
                             : "Pair the helper first, then add an Apple ID here.")
                            .foregroundStyle(.secondary)
                    } else {
                        Picker("Default Signing Account", selection: $model.selectedAccountId) {
                            ForEach(model.activeAccounts) { account in
                                Text(account.appleId).tag(account.id)
                            }
                        }

                        ForEach(model.accounts) { account in
                            VStack(alignment: .leading, spacing: 10) {
                                HStack(alignment: .top, spacing: 10) {
                                    Image(systemName: account.id == model.selectedAccountId ? "checkmark.circle.fill" : "person.crop.circle")
                                        .foregroundStyle(account.id == model.selectedAccountId ? Color.slAccent : .secondary)

                                    VStack(alignment: .leading, spacing: 3) {
                                        Text(account.appleId)
                                            .font(.subheadline.weight(.semibold))
                                        Text("\(account.teamName) · \(account.accountType.capitalized)")
                                            .font(.caption)
                                            .foregroundStyle(.secondary)
                                    }

                                    Spacer()

                                    PillBadge(
                                        text: appleStatusLabel(for: account),
                                        color: appleStatusColor(for: account),
                                        small: true
                                    )
                                }

                                if let lastAuthAt = account.lastAuthAt, !lastAuthAt.isEmpty {
                                    Label("Last verified \(relativeDate(lastAuthAt))", systemImage: "clock.badge.checkmark")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                } else {
                                    Label("This Apple ID has not completed verification in Sidelink yet.", systemImage: "clock.badge.exclamationmark")
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                }

                                if model.pendingAppleAuth?.accountId == account.id {
                                    HStack(spacing: 8) {
                                        Image(systemName: "number.square")
                                            .foregroundStyle(Color.slWarning)
                                        Text("Waiting for a 6-digit verification code.")
                                            .font(.caption.weight(.semibold))
                                            .foregroundStyle(Color.slWarning)
                                    }
                                }

                                HStack(spacing: 10) {
                                    Button {
                                        appleSheetMode = .reauth(accountId: account.id)
                                    } label: {
                                        Label(account.status == "active" ? "Re-auth" : "Verify", systemImage: "arrow.clockwise")
                                            .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(.bordered)

                                    Button(role: .destructive) {
                                        deleteConfirmation = DestructiveConfirmation(
                                            title: "Remove Apple ID",
                                            message: "Remove \(account.appleId)?",
                                            buttonLabel: "Remove"
                                        ) {
                                            Task { await model.deleteAppleAccount(account.id) }
                                        }
                                    } label: {
                                        Label("Remove", systemImage: "trash")
                                            .frame(maxWidth: .infinity)
                                    }
                                    .buttonStyle(.bordered)
                                }
                            }
                            .padding(.vertical, 6)
                        }
                    }

                    Button {
                        appleSheetMode = .add
                    } label: {
                        Label(model.accounts.isEmpty ? "Add Apple ID" : "Add Another Apple ID", systemImage: "person.badge.plus")
                    }
                    .disabled(!model.isPaired)
                }

                Section("Management") {
                    NavigationLink {
                        LogsView(model: model)
                    } label: {
                        settingsLinkRow("Logs", systemImage: "text.alignleft")
                    }

                    NavigationLink {
                        AppIDsView(model: model)
                    } label: {
                        settingsLinkRow("App IDs", systemImage: "app.badge")
                    }

                    NavigationLink {
                        CertificatesView(model: model)
                    } label: {
                        settingsLinkRow("Certificates", systemImage: "checkmark.seal")
                    }

                    if let interval = model.config?.schedulerCheckIntervalMs {
                        HStack {
                            Label("Scheduler", systemImage: model.config?.schedulerEnabled == true ? "play.fill" : "pause.fill")
                            Spacer()
                            Text("\(interval / 60_000) min")
                                .foregroundStyle(.secondary)
                        }
                    }
                }

                Section("Background Refresh") {
                    Toggle(isOn: $backgroundRefreshEnabled) {
                        Label("Enable Background Refresh", systemImage: "arrow.triangle.2.circlepath")
                    }
                    .onChange(of: backgroundRefreshEnabled) { enabled in
                        if enabled {
                            Task {
                                await BackgroundRefreshCoordinator.shared.requestNotificationAuthorizationIfNeeded()
                                BackgroundRefreshCoordinator.shared.setBackgroundRefreshEnabled(true)
                            }
                        } else {
                            BackgroundRefreshCoordinator.shared.setBackgroundRefreshEnabled(false)
                        }
                    }

                    VStack(alignment: .leading, spacing: 8) {
                        Text("Interval: \(backgroundRefreshIntervalMinutes) min")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Slider(
                            value: Binding(
                                get: { Double(backgroundRefreshIntervalMinutes) },
                                set: { backgroundRefreshIntervalMinutes = Int($0) }
                            ),
                            in: 15...180,
                            step: 15
                        )
                        .tint(.slAccent)
                    }
                    .onChange(of: backgroundRefreshIntervalMinutes) { _ in
                        guard backgroundRefreshEnabled else { return }
                        BackgroundRefreshCoordinator.shared.scheduleAppRefresh()
                    }
                }

                Section("Current Signing Setup") {
                    if let selected = model.selectedAccount {
                        HStack {
                            Label("Using Apple ID", systemImage: "person.crop.circle")
                            Spacer()
                            Text(selected.appleId)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }

                    if let selected = model.selectedDevice {
                        HStack {
                            Label("Using Device", systemImage: "iphone")
                            Spacer()
                            Text(selected.name)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }

                Section("About") {
                    aboutRow("App", "Sidelink")
                    aboutRow("Version", Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0.0")
                    aboutRow("Build", Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1")
                    aboutRow("Platform", UIDevice.current.systemName + " " + UIDevice.current.systemVersion)
                }

                if let error = model.errorMessage {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Color.slDanger)
                            .font(.footnote)
                    }
                }

                Section("Connection") {
                    Button {
                        Task { await model.refreshAll() }
                    } label: {
                        Label("Reload Data", systemImage: "arrow.clockwise")
                    }
                    .disabled(model.isLoading || !model.isPaired)

                    Button(role: .destructive) {
                        SidelinkHaptics.impact(.light)
                        deleteConfirmation = DestructiveConfirmation(
                            title: "Disconnect Helper",
                            message: "Disconnect from the Sidelink server? You will need to pair again.",
                            buttonLabel: "Disconnect"
                        ) {
                            model.clearPairing()
                        }
                    } label: {
                        Label("Disconnect Helper", systemImage: "link.badge.plus")
                    }
                }
            }
            .refreshable {
                await model.refreshAll()
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Settings")
            .sheet(isPresented: $showPairingSheet) {
                PairingSheet(model: model)
            }
            .sheet(item: $appleSheetMode) { mode in
                AppleAccountSheet(model: model, mode: mode)
            }
            .alert(
                deleteConfirmation?.title ?? "Confirm",
                isPresented: Binding(
                    get: { deleteConfirmation != nil },
                    set: { if !$0 { deleteConfirmation = nil } }
                )
            ) {
                Button(deleteConfirmation?.buttonLabel ?? "Delete", role: .destructive) {
                    deleteConfirmation?.action()
                    deleteConfirmation = nil
                }
                Button("Cancel", role: .cancel) { deleteConfirmation = nil }
            } message: {
                Text(deleteConfirmation?.message ?? "")
            }
        }
    }

    private func aboutRow(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Spacer()
            Text(value)
                .font(.caption)
        }
    }

    private func settingsLinkRow(_ title: String, systemImage: String) -> some View {
        HStack {
            Label(title, systemImage: systemImage)
            Spacer()
            Image(systemName: "chevron.right")
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .contentShape(Rectangle())
    }

    private func appleStatusLabel(for account: AccountDTO) -> String {
        switch account.status {
        case "active": return "Active"
        case "requires_2fa": return "Needs Code"
        case "session_expired": return "Expired"
        default:
            return account.status.replacingOccurrences(of: "_", with: " ").capitalized
        }
    }

    private func appleStatusColor(for account: AccountDTO) -> Color {
        switch account.status {
        case "active": return .slSuccess
        case "requires_2fa": return .slWarning
        case "session_expired": return .slDanger
        default: return .slWarning
        }
    }

    private func relativeDate(_ iso: String) -> String {
        guard let date = SidelinkDateFormatting.parse(iso) else { return iso }
        return date.formatted(.relative(presentation: .named))
    }
}

private enum AppleAccountSheetMode: Identifiable {
    case add
    case reauth(accountId: String)

    var id: String {
        switch self {
        case .add:
            return "add"
        case .reauth(let accountId):
            return "reauth-\(accountId)"
        }
    }
}

struct PairingPayloadActions: View {
    let onScanned: (String) -> Void
    let onPasted: (String) -> Void
    @State private var showScanner = false

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                Button {
                    showScanner = true
                } label: {
                    Label("Scan QR", systemImage: "qrcode.viewfinder")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.slAccent)
                .disabled(!PairingQRScannerSheet.isSupported)

                Button {
                    onPasted(UIPasteboard.general.string ?? "")
                } label: {
                    Label("Paste Payload", systemImage: "doc.on.clipboard")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }

            if !PairingQRScannerSheet.isSupported {
                Text("QR scanning is unavailable on this device. Paste the pairing payload from the desktop app instead.")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .sheet(isPresented: $showScanner) {
            PairingQRScannerSheet { payload in
                showScanner = false
                onScanned(payload)
            }
        }
    }
}

struct PairingQRScannerSheet: View {
    static var isSupported: Bool {
#if canImport(VisionKit)
        if #available(iOS 16.0, *) {
            return DataScannerViewController.isSupported && DataScannerViewController.isAvailable
        }
#endif
        return false
    }

    let onPayload: (String) -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Group {
                if Self.isSupported {
                    PairingQRScannerRepresentable { payload in
                        onPayload(payload)
                    }
                } else {
                    VStack(spacing: 12) {
                        Image(systemName: "qrcode.viewfinder")
                            .font(.system(size: 36))
                            .foregroundStyle(.secondary)
                        Text("Scanner Unavailable")
                            .font(.headline)
                        Text("Use Paste Payload instead on this device.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .multilineTextAlignment(.center)
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .padding(24)
                }
            }
            .navigationTitle("Scan Pairing QR")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
    }
}

#if canImport(VisionKit)
@available(iOS 16.0, *)
private struct PairingQRScannerRepresentable: UIViewControllerRepresentable {
    typealias UIViewControllerType = DataScannerViewController

    let onPayload: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onPayload: onPayload)
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
        let controller = DataScannerViewController(
            recognizedDataTypes: [.barcode(symbologies: [.qr])],
            qualityLevel: .balanced,
            recognizesMultipleItems: false,
            isHighFrameRateTrackingEnabled: false,
            isHighlightingEnabled: true
        )
        controller.delegate = context.coordinator
        try? controller.startScanning()
        return controller
    }

    func updateUIViewController(_ uiViewController: DataScannerViewController, context: Context) {}

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
        private let onPayload: (String) -> Void
        private var hasScannedPayload = false

        init(onPayload: @escaping (String) -> Void) {
            self.onPayload = onPayload
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didTapOn item: RecognizedItem) {
            handle(item)
        }

        func dataScanner(_ dataScanner: DataScannerViewController, didAdd addedItems: [RecognizedItem], allItems: [RecognizedItem]) {
            guard let firstItem = addedItems.first else {
                return
            }
            handle(firstItem)
        }

        private func handle(_ item: RecognizedItem) {
            guard !hasScannedPayload else {
                return
            }
            guard case .barcode(let barcode) = item,
                  let payload = barcode.payloadStringValue,
                  !payload.isEmpty
            else {
                return
            }

            hasScannedPayload = true
            onPayload(payload)
        }
    }
}
#endif

private struct PairingSheet: View {
    @ObservedObject var model: HelperViewModel
    @Environment(\.dismiss) private var dismiss
    @State private var pairingFocusTrigger = 0
    @State private var localError: String?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("Enter the 6-digit pairing code from the desktop app.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)

                    PairingPayloadActions(
                        onScanned: { payload in
                            Task {
                                localError = nil
                                let didPair = await model.pairUsingPayload(payload)
                                if didPair {
                                    dismiss()
                                } else {
                                    localError = model.errorMessage
                                }
                            }
                        },
                        onPasted: { payload in
                            Task {
                                localError = nil
                                let didPair = await model.pairUsingPayload(payload)
                                if didPair {
                                    dismiss()
                                } else {
                                    localError = model.errorMessage
                                }
                            }
                        }
                    )

                    Divider()

                    Text("Or enter the backend URL and 6-digit code manually.")
                        .font(.caption)
                        .foregroundStyle(.secondary)

                    TextField("Backend URL", text: $model.backendURL)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .textFieldStyle(.roundedBorder)

                    if !model.discoveredBackends.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Discovered Servers")
                                .font(.caption.bold())
                                .foregroundStyle(.secondary)

                            ForEach(model.discoveredBackends) { backend in
                                Button {
                                    model.applyDiscoveredBackend(backend)
                                    pairingFocusTrigger += 1
                                } label: {
                                    HStack {
                                        VStack(alignment: .leading, spacing: 2) {
                                            Text(backend.name)
                                                .font(.subheadline)
                                            Text(backend.url)
                                                .font(.caption)
                                                .foregroundStyle(.secondary)
                                        }
                                        Spacer()
                                        Image(systemName: "checkmark.circle")
                                            .foregroundStyle(Color.slAccent)
                                    }
                                }
                            }
                        }
                    }

                    PairingCodeEntryView(code: $model.pairingCode, onSubmit: {
                        Task {
                            localError = nil
                            await model.pair()
                            if model.isPaired {
                                dismiss()
                            } else {
                                localError = model.errorMessage
                            }
                        }
                    }, isLoading: model.isLoading, autoFocus: false, focusTrigger: pairingFocusTrigger)

                    if let error = localError {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Color.slDanger)
                            .font(.footnote)
                    }
                }
                .padding(20)
            }
            .navigationTitle("Pair Helper")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
    }
}

private struct AppleAccountSheet: View {
    @ObservedObject var model: HelperViewModel
    let mode: AppleAccountSheetMode
    @Environment(\.dismiss) private var dismiss
    @State private var appleId = ""
    @State private var password = ""
    @State private var twoFACode = ""
    @State private var startedReauth = false

    var body: some View {
        NavigationStack {
            Form {
                if let pending = pendingContext {
                    Section("Two-Factor Authentication") {
                        Text("Finish verifying \(pending.appleId) to use it for signing in Sidelink.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)

                        TextField("123456", text: $twoFACode)
                            .keyboardType(.numberPad)
                            .textInputAutocapitalization(.never)

                        if let authType = pending.authType, !authType.isEmpty {
                            Text("Verification method: \(authType)")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                        }

                        Button {
                            Task {
                                await model.submitPendingAppleAccount2FA(code: twoFACode)
                                if model.pendingAppleAuth == nil {
                                    dismiss()
                                }
                            }
                        } label: {
                            Label("Verify Apple ID", systemImage: "checkmark.shield")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(twoFACode.trimmingCharacters(in: .whitespacesAndNewlines).count != 6 || model.isLoading)
                    }
                } else if case .reauth(let accountId) = mode {
                    Section("Re-authenticate Apple ID") {
                        if let account = model.accounts.first(where: { $0.id == accountId }) {
                            Text(account.appleId)
                                .font(.headline)
                            if let lastAuthAt = account.lastAuthAt, !lastAuthAt.isEmpty {
                                Text("Last verified \(relativeDate(lastAuthAt)). Re-authentication refreshes the Apple session before new installs or refreshes.")
                                    .font(.footnote)
                                    .foregroundStyle(.secondary)
                            }
                        }

                        if model.isLoading {
                            HStack(spacing: 12) {
                                ProgressView()
                                Text("Checking whether Apple needs a verification code…")
                                    .foregroundStyle(.secondary)
                            }
                        } else {
                            Button {
                                Task { await beginReauth(accountId: accountId, forceRestart: true) }
                            } label: {
                                Label("Request Verification Code", systemImage: "arrow.clockwise")
                                    .frame(maxWidth: .infinity)
                            }
                            .buttonStyle(.borderedProminent)
                        }
                    }
                } else {
                    Section("Apple ID Sign In") {
                        TextField("name@example.com", text: $appleId)
                            .textInputAutocapitalization(.never)
                            .keyboardType(.emailAddress)
                            .autocorrectionDisabled()

                        SecureField("Password", text: $password)

                        Text("Your Apple ID is used by the paired Sidelink server to sign apps for this device.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)

                        Button {
                            Task {
                                await model.signInAppleAccount(appleId: appleId, password: password)
                                if model.pendingAppleAuth == nil, model.errorMessage == nil {
                                    dismiss()
                                }
                            }
                        } label: {
                            Label("Sign In", systemImage: "person.badge.key")
                                .frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.borderedProminent)
                        .disabled(appleId.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || password.isEmpty || model.isLoading)
                    }
                }

                if let error = model.errorMessage {
                    Section {
                        Label(error, systemImage: "exclamationmark.triangle")
                            .foregroundStyle(Color.slDanger)
                            .font(.footnote)
                    }
                }
            }
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        .presentationDetents([.medium, .large])
        .task {
            if case .reauth(let accountId) = mode {
                await beginReauth(accountId: accountId, forceRestart: false)
            }
        }
    }

    private var pendingContext: PendingAppleAuthContext? {
        guard let pending = model.pendingAppleAuth else { return nil }
        switch mode {
        case .add:
            return pending.mode == .signIn ? pending : nil
        case .reauth(let accountId):
            return pending.mode == .reauth && pending.accountId == accountId ? pending : nil
        }
    }

    private var navigationTitle: String {
        switch mode {
        case .add:
            return pendingContext == nil ? "Add Apple ID" : "Verify Apple ID"
        case .reauth:
            return pendingContext == nil ? "Re-authenticate" : "Enter Verification Code"
        }
    }

    private func beginReauth(accountId: String, forceRestart: Bool) async {
        guard forceRestart || !startedReauth else { return }
        startedReauth = true
        await model.reauthenticateAppleAccount(accountId: accountId)
        if model.pendingAppleAuth == nil, model.errorMessage == nil {
            dismiss()
        }
    }

    private func relativeDate(_ iso: String) -> String {
        guard let date = SidelinkDateFormatting.parse(iso) else { return iso }
        return date.formatted(.relative(presentation: .named))
    }
}
