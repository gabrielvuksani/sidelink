import Network
import SwiftUI
import UserNotifications
#if canImport(UIKit)
import UIKit
#endif

enum SidelinkPermissionState: String {
    case unknown
    case requesting
    case granted
    case denied
    case unavailable
    case disabled

    var statusLabel: String {
        switch self {
        case .unknown:
            return "Not requested"
        case .requesting:
            return "Requesting"
        case .granted:
            return "Granted"
        case .denied:
            return "Denied"
        case .unavailable:
            return "Unavailable"
        case .disabled:
            return "Disabled"
        }
    }

    var actionLabel: String {
        switch self {
        case .unknown:
            return "Request Access"
        case .requesting:
            return "Requesting…"
        case .granted:
            return "Granted"
        case .denied:
            return "Open Settings"
        case .unavailable:
            return "Unavailable"
        case .disabled:
            return "Open Settings"
        }
    }

    var tint: Color {
        switch self {
        case .granted:
            return .slSuccess
        case .denied, .disabled:
            return .slDanger
        case .requesting:
            return .slAccent2
        case .unavailable:
            return .slMuted
        case .unknown:
            return .slWarning
        }
    }

    var isResolved: Bool {
        self == .granted || self == .denied || self == .disabled || self == .unavailable
    }

    var isGranted: Bool {
        self == .granted
    }
}

@MainActor
final class PermissionCoordinator: ObservableObject {
    static let shared = PermissionCoordinator()

    @Published private(set) var notifications: SidelinkPermissionState = .unknown
    @Published private(set) var localNetwork: SidelinkPermissionState = .unknown
    @Published private(set) var backgroundRefresh: SidelinkPermissionState = .unknown

    private let localNetworkStateKey = "sidelink.permission.local-network"
    private let localNetworkBonjourType = "_sidelink._tcp"
    private var localNetworkBrowser: NWBrowser?
    private var localNetworkTimeout: DispatchWorkItem?
    private var localNetworkDialogTrigger: NWConnection?
    private var localNetworkReceivedDenial = false

    private init() {
        if let stored = UserDefaults.standard.string(forKey: localNetworkStateKey),
           let state = SidelinkPermissionState(rawValue: stored) {
            localNetwork = state
        }
    }

    func refreshStatuses() async {
        await refreshNotificationStatus()
        refreshBackgroundRefreshStatus()
    }

    func requestAllIfNeeded() async {
        // Fire local network first — it is non-blocking and the system dialog
        // can appear while the user responds to the subsequent await-ed dialogs.
        requestLocalNetworkIfNeeded(force: true)
        await requestNotificationsIfNeeded()
        refreshBackgroundRefreshStatus()
    }

    func requestNotificationsIfNeeded() async {
        let center = UNUserNotificationCenter.current()
        let settings = await center.notificationSettings()
        let current = Self.mapNotificationStatus(settings.authorizationStatus)
        notifications = current
        guard settings.authorizationStatus == .notDetermined else { return }

        notifications = .requesting
        _ = try? await center.requestAuthorization(options: [.alert, .sound, .badge])
        await refreshNotificationStatus()
    }

    func requestLocalNetworkIfNeeded(force: Bool = false) {
        if !force, localNetworkBrowser != nil {
            return
        }

        cancelLocalNetworkProbe()
        localNetwork = .requesting
        localNetworkReceivedDenial = false

        let parameters = NWParameters()
        parameters.includePeerToPeer = true

        let browser = NWBrowser(for: .bonjour(type: localNetworkBonjourType, domain: nil), using: parameters)
        browser.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .ready:
                    // Browser started — does NOT mean permission was granted yet.
                    // On first launch, iOS shows the dialog asynchronously after
                    // .ready, so we must wait for browseResults or a denial error
                    // before deciding.
                    break
                case .waiting(let error):
                    if Self.isPolicyDenied(error) {
                        self.localNetworkReceivedDenial = true
                        self.finishLocalNetworkProbe(with: .denied)
                    }
                    // For non-policy waits (network down, etc.), keep waiting
                case .failed(let error):
                    if Self.isPolicyDenied(error) {
                        self.localNetworkReceivedDenial = true
                        self.finishLocalNetworkProbe(with: .denied)
                    } else {
                        self.finishLocalNetworkProbe(with: .unknown)
                    }
                default:
                    break
                }
            }
        }
        browser.browseResultsChangedHandler = { [weak self] _, _ in
            Task { @MainActor in
                self?.finishLocalNetworkProbe(with: .granted)
            }
        }

        localNetworkBrowser = browser
        browser.start(queue: DispatchQueue(label: "com.sidelink.permissions.local-network", qos: .userInitiated))

        // Secondary trigger: a brief multicast connection forces iOS to present
        // the Local Network permission dialog more reliably than NWBrowser alone,
        // particularly on first app launch.
        triggerLocalNetworkDialogViaMulticast()

        let timeout = DispatchWorkItem { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                if self.localNetwork == .requesting {
                    // If no denial arrived and the browser stayed alive, the user
                    // very likely granted access (no browse results just means no
                    // _sidelink._tcp services are advertising right now).
                    self.finishLocalNetworkProbe(with: self.localNetworkReceivedDenial ? .denied : .granted)
                }
            }
        }
        localNetworkTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 12.0, execute: timeout)
    }

    func openSystemSettings() {
#if canImport(UIKit)
        guard let settingsURL = URL(string: UIApplication.openSettingsURLString) else { return }
        UIApplication.shared.open(settingsURL)
#endif
    }

    private func refreshNotificationStatus() async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        notifications = Self.mapNotificationStatus(settings.authorizationStatus)
    }

    private func refreshBackgroundRefreshStatus() {
#if canImport(UIKit)
        let enabled = UserDefaults.standard.object(forKey: "backgroundRefreshEnabled") as? Bool ?? true
        switch UIApplication.shared.backgroundRefreshStatus {
        case .available:
            backgroundRefresh = enabled ? .granted : .disabled
        case .denied, .restricted:
            backgroundRefresh = .denied
        @unknown default:
            backgroundRefresh = .unknown
        }
#else
        backgroundRefresh = .unavailable
#endif
    }

    private func finishLocalNetworkProbe(with result: SidelinkPermissionState) {
        localNetwork = result
        if result == .granted || result == .denied {
            UserDefaults.standard.set(result.rawValue, forKey: localNetworkStateKey)
        }
        cancelLocalNetworkProbe()
    }

    private func cancelLocalNetworkProbe() {
        localNetworkTimeout?.cancel()
        localNetworkTimeout = nil
        localNetworkBrowser?.cancel()
        localNetworkBrowser = nil
        localNetworkDialogTrigger?.cancel()
        localNetworkDialogTrigger = nil
    }

    /// Creates a brief UDP connection to the mDNS multicast address.  On iOS
    /// this reliably triggers the Local Network permission dialog even when
    /// NWBrowser alone does not (common on first app launch).
    private func triggerLocalNetworkDialogViaMulticast() {
        localNetworkDialogTrigger?.cancel()
        let connection = NWConnection(host: "224.0.0.251", port: 5353, using: .udp)
        connection.stateUpdateHandler = { [weak self] state in
            switch state {
            case .ready:
                // Send a tiny packet so the network stack actually transmits on
                // the local interface, which is what iOS gates behind the dialog.
                let emptyPacket = Data([0])
                connection.send(content: emptyPacket, completion: .contentProcessed { _ in
                    connection.cancel()
                    Task { @MainActor in self?.localNetworkDialogTrigger = nil }
                })
            case .failed, .cancelled:
                Task { @MainActor in self?.localNetworkDialogTrigger = nil }
            default:
                break
            }
        }
        localNetworkDialogTrigger = connection
        connection.start(queue: .global(qos: .userInitiated))
    }

    private static func mapNotificationStatus(_ status: UNAuthorizationStatus) -> SidelinkPermissionState {
        switch status {
        case .authorized, .provisional, .ephemeral:
            return .granted
        case .denied:
            return .denied
        case .notDetermined:
            return .unknown
        @unknown default:
            return .unknown
        }
    }

    private static func isPolicyDenied(_ error: NWError) -> Bool {
        let description = String(describing: error).lowercased()
        return description.contains("policydenied") || description.contains("denied")
    }
}