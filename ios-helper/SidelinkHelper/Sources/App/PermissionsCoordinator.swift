import AVFoundation
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
    @Published private(set) var camera: SidelinkPermissionState = .unknown
    @Published private(set) var localNetwork: SidelinkPermissionState = .unknown
    @Published private(set) var backgroundRefresh: SidelinkPermissionState = .unknown

    private let localNetworkStateKey = "sidelink.permission.local-network"
    private var localNetworkBrowser: NWBrowser?
    private var localNetworkTimeout: DispatchWorkItem?

    private init() {
        if let stored = UserDefaults.standard.string(forKey: localNetworkStateKey),
           let state = SidelinkPermissionState(rawValue: stored) {
            localNetwork = state
        }
    }

    func refreshStatuses() async {
        await refreshNotificationStatus()
        refreshCameraStatus()
        refreshBackgroundRefreshStatus()
    }

    func requestAllIfNeeded() async {
        await requestNotificationsIfNeeded()
        await requestCameraIfNeeded()
        requestLocalNetworkIfNeeded(force: true)
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

    func requestCameraIfNeeded() async {
        let current = AVCaptureDevice.authorizationStatus(for: .video)
        camera = Self.mapCameraStatus(current)
        guard current == .notDetermined else { return }

        camera = .requesting
        _ = await AVCaptureDevice.requestAccess(for: .video)
        refreshCameraStatus()
    }

    func requestLocalNetworkIfNeeded(force: Bool = false) {
        if !force, localNetworkBrowser != nil {
            return
        }

        cancelLocalNetworkProbe()
        localNetwork = .requesting

        let parameters = NWParameters()
        parameters.includePeerToPeer = true

        let browser = NWBrowser(for: .bonjour(type: "_services._dns-sd._udp", domain: nil), using: parameters)
        browser.stateUpdateHandler = { [weak self] state in
            Task { @MainActor in
                guard let self else { return }
                switch state {
                case .ready:
                    self.finishLocalNetworkProbe(with: .granted)
                case .waiting(let error), .failed(let error):
                    let resolved: SidelinkPermissionState = Self.isPolicyDenied(error) ? .denied : .unknown
                    self.finishLocalNetworkProbe(with: resolved)
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

        let timeout = DispatchWorkItem { [weak self] in
            Task { @MainActor in
                guard let self else { return }
                if self.localNetwork == .requesting {
                    self.finishLocalNetworkProbe(with: .unknown)
                }
            }
        }
        localNetworkTimeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 4.0, execute: timeout)
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

    private func refreshCameraStatus() {
        camera = Self.mapCameraStatus(AVCaptureDevice.authorizationStatus(for: .video))
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

    private static func mapCameraStatus(_ status: AVAuthorizationStatus) -> SidelinkPermissionState {
        switch status {
        case .authorized:
            return .granted
        case .denied, .restricted:
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