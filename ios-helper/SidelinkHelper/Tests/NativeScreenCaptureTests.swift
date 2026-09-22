import Foundation
import SwiftUI
import UIKit
import XCTest
@testable import SidelinkHelper

/// Renders real helper screens with synthetic host data and writes PNG evidence.
///
/// This class is excluded from the regular XCTest step and runs only in the
/// dedicated native-verify capture step, which passes the output directory as
/// `TEST_RUNNER_SIDELINK_CAPTURE_DIR` (visible here as `SIDELINK_CAPTURE_DIR`).
/// Every host response is served in-process by `CaptureFixtureHost`; nothing
/// reaches the network and pairing credentials stay in the injected store.
@MainActor
final class NativeScreenCaptureTests: XCTestCase {
    private static let captureDirectoryVariable = "SIDELINK_CAPTURE_DIR"
    private static let maximumCaptureHeight: CGFloat = 6_000
    private static let minimumPNGBytes = 25_000

    func testCapture01OnboardingFirstRunUnpaired() async throws {
        let output = try captureDirectory()
        let session = CaptureSession(routes: [:])
        defer { session.tearDown() }

        for appearance in CaptureAppearance.standard {
            try await capture(
                "onboarding-unpaired",
                appearance: appearance,
                into: output,
                screen: AnyView(
                    OnboardingView(
                        model: session.model,
                        permissions: PermissionCoordinator.shared,
                        completed: .constant(false)
                    )
                )
            )
        }
    }

    func testCapture02TodayRenewalStates() async throws {
        let output = try captureDirectory()

        for scenario in TodayCaptureScenario.allCases {
            let now = Date()
            let todayEnvelope = try CaptureFixture.envelope(scenario.snapshot(now: now))
            let session = CaptureSession(routes: ["/api/helper/today": todayEnvelope])
            defer { session.tearDown() }
            try session.pair()
            try session.applyPairedHostState(now: now)

            let refreshed = await session.model.refreshDailyOperations()
            XCTAssertTrue(refreshed, "The \(scenario.slug) Today fixture must decode through the real API client")
            XCTAssertFalse(session.model.dailyOperationsAreStale, "The \(scenario.slug) Today fixture must be current")

            let screen = AnyView(TodayTab(model: session.model, onNavigate: { _ in }))
            let name = "today-\(scenario.slug)"
            for appearance in CaptureAppearance.standard {
                try await capture(name, appearance: appearance, into: output, screen: screen)
            }
            try await capture(name, appearance: .light, into: output, fullLength: true, screen: screen)
            if scenario == .renewalFailed {
                try await capture(name, appearance: .accessibility3Light, into: output, screen: screen)
            }
        }
    }

    func testCapture03InstalledLegacyRepairAndActiveApp() async throws {
        let output = try captureDirectory()
        let now = Date()
        let session = CaptureSession(routes: [:])
        defer { session.tearDown() }
        try session.pair()
        try session.applyPairedHostState(now: now)
        try session.applyInstalledState(now: now)

        // InstalledTab refreshes from the host on appear. The fixture host
        // answers that refresh with 404s, so the fixture state is re-applied
        // after the view settles to capture the populated surface.
        let reapply: @MainActor () throws -> Void = {
            try session.applyPairedHostState(now: now)
            try session.applyInstalledState(now: now)
        }
        let screen = AnyView(InstalledTab(model: session.model))
        for appearance in CaptureAppearance.standard {
            try await capture(
                "installed-legacy-repair",
                appearance: appearance,
                into: output,
                reapply: reapply,
                screen: screen
            )
        }
        try await capture(
            "installed-legacy-repair",
            appearance: .light,
            into: output,
            fullLength: true,
            reapply: reapply,
            screen: screen
        )
    }

    func testCapture04InstallProgressRunningAndFailed() async throws {
        let output = try captureDirectory()
        let now = Date()
        let running = try CaptureFixture.decode(
            InstallJobDetailDTO.self,
            from: CaptureFixture.runningRefreshJob(now: now)
        )
        let runningLogs = try CaptureFixture.decode(
            [InstallJobLogDTO].self,
            from: CaptureFixture.runningRefreshLogs(now: now)
        )
        let failed = try CaptureFixture.decode(
            InstallJobDetailDTO.self,
            from: CaptureFixture.failedRefreshJob(now: now)
        )
        let failedLogs = try CaptureFixture.decode(
            [InstallJobLogDTO].self,
            from: CaptureFixture.failedRefreshLogs(now: now)
        )

        for appearance in CaptureAppearance.standard {
            try await capture(
                "install-progress-running",
                appearance: appearance,
                into: output,
                screen: AnyView(InstallConsoleCaptureScreen(job: running, logs: runningLogs))
            )
            try await capture(
                "install-progress-failed",
                appearance: appearance,
                into: output,
                screen: AnyView(InstallConsoleCaptureScreen(job: failed, logs: failedLogs))
            )
        }
    }

    func testCapture05ActivityMixedReceipts() async throws {
        let output = try captureDirectory()
        let now = Date()
        // ActivityView loads receipts on appear; the fixture host serves them
        // so the real list decode and authority publication paths run.
        let jobsEnvelope = try CaptureFixture.envelope(CaptureFixture.activityJobs(now: now))
        let session = CaptureSession(routes: ["/api/helper/jobs": jobsEnvelope])
        defer { session.tearDown() }
        try session.pair()
        try session.applyPairedHostState(now: now)

        let screen = AnyView(NavigationStack { ActivityView(model: session.model) })
        for appearance in CaptureAppearance.standard {
            try await capture("activity-mixed", appearance: appearance, into: output, screen: screen)
        }
        try await capture("activity-mixed", appearance: .light, into: output, fullLength: true, screen: screen)

        XCTAssertEqual(session.model.operationJobsById.count, 5, "Activity must load every fixture receipt")
        XCTAssertTrue(session.model.hasCurrentActivitySnapshot, "Activity receipts must be host-current")
    }

    func testCapture06SettingsPairedAndUnpaired() async throws {
        let output = try captureDirectory()
        let now = Date()

        let paired = CaptureSession(routes: [:])
        defer { paired.tearDown() }
        try paired.pair()
        try paired.applyPairedHostState(now: now)
        paired.model.sseConnected = true
        let pairedScreen = AnyView(SettingsTab(model: paired.model, permissions: PermissionCoordinator.shared))
        for appearance in CaptureAppearance.standard {
            try await capture("settings-paired", appearance: appearance, into: output, screen: pairedScreen)
        }
        try await capture("settings-paired", appearance: .light, into: output, fullLength: true, screen: pairedScreen)

        let unpaired = CaptureSession(routes: [:])
        defer { unpaired.tearDown() }
        let unpairedScreen = AnyView(SettingsTab(model: unpaired.model, permissions: PermissionCoordinator.shared))
        for appearance in CaptureAppearance.standard {
            try await capture("settings-unpaired", appearance: appearance, into: output, screen: unpairedScreen)
        }
    }

    // MARK: - Rendering

    private func captureDirectory() throws -> URL {
        let raw = ProcessInfo.processInfo.environment[Self.captureDirectoryVariable]?
            .trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty else {
            throw CaptureFailure(
                "\(Self.captureDirectoryVariable) is not set. NativeScreenCaptureTests runs only in the "
                    + "native-verify capture step, which passes TEST_RUNNER_\(Self.captureDirectoryVariable) to xcodebuild."
            )
        }
        let directory = URL(fileURLWithPath: raw, isDirectory: true)
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        return directory
    }

    private func capture(
        _ name: String,
        appearance: CaptureAppearance,
        into directory: URL,
        fullLength: Bool = false,
        reapply: (@MainActor () throws -> Void)? = nil,
        screen: AnyView
    ) async throws {
        let scene = try foregroundScene()
        let animationsWereEnabled = UIView.areAnimationsEnabled
        UIView.setAnimationsEnabled(false)
        defer { UIView.setAnimationsEnabled(animationsWereEnabled) }

        let root: AnyView
        if let dynamicTypeSize = appearance.dynamicTypeSize {
            root = AnyView(screen.dynamicTypeSize(dynamicTypeSize))
        } else {
            root = screen
        }
        let controller = UIHostingController(rootView: root)
        if let category = appearance.contentSizeCategory {
            controller.traitOverrides.preferredContentSizeCategory = category
        }

        let screenSize = scene.screen.bounds.size
        let window = UIWindow(windowScene: scene)
        window.frame = CGRect(origin: .zero, size: screenSize)
        window.overrideUserInterfaceStyle = appearance.style
        window.windowLevel = UIWindow.Level(rawValue: UIWindow.Level.alert.rawValue + 1)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        defer {
            window.isHidden = true
            window.rootViewController = nil
        }

        try await settle(window)
        if let reapply {
            try reapply()
            try await settle(window)
        }
        if fullLength {
            try await expandToContent(window)
        }

        let fileName = fullLength
            ? "\(name)-full-\(appearance.suffix).png"
            : "\(name)-\(appearance.suffix).png"
        let data = try snapshot(window)
        try data.write(to: directory.appendingPathComponent(fileName), options: .atomic)
        XCTAssertGreaterThan(
            data.count,
            Self.minimumPNGBytes,
            "\(fileName) is suspiciously small and may be a blank capture"
        )
    }

    private func foregroundScene() throws -> UIWindowScene {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        guard let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first else {
            throw CaptureFailure("No UIWindowScene is connected to the test host application.")
        }
        return scene
    }

    private func settle(_ window: UIWindow, iterations: Int = 6) async throws {
        for _ in 0 ..< iterations {
            window.setNeedsLayout()
            window.layoutIfNeeded()
            CATransaction.flush()
            try await Task.sleep(nanoseconds: 150_000_000)
        }
    }

    /// Grows the window until the primary scroll view shows all of its content.
    private func expandToContent(_ window: UIWindow) async throws {
        for _ in 0 ..< 5 {
            guard let scrollView = primaryScrollView(in: window) else { return }
            let inset = scrollView.adjustedContentInset
            let visibleHeight = scrollView.bounds.height - inset.top - inset.bottom
            let overflow = scrollView.contentSize.height - visibleHeight
            guard overflow > 1 else { break }
            let targetHeight = min(window.bounds.height + overflow.rounded(.up), Self.maximumCaptureHeight)
            guard targetHeight > window.bounds.height + 1 else { break }
            window.frame = CGRect(
                origin: .zero,
                size: CGSize(width: window.bounds.width, height: targetHeight)
            )
            try await settle(window)
        }
        if let scrollView = primaryScrollView(in: window) {
            scrollView.setContentOffset(
                CGPoint(x: 0, y: -scrollView.adjustedContentInset.top),
                animated: false
            )
            try await settle(window, iterations: 2)
        }
    }

    private func primaryScrollView(in root: UIView) -> UIScrollView? {
        var best: UIScrollView?
        var pending: [UIView] = [root]
        while let view = pending.popLast() {
            if let scrollView = view as? UIScrollView,
               scrollView.bounds.width >= root.bounds.width * 0.9,
               scrollView.contentSize.height > (best?.contentSize.height ?? 0) {
                best = scrollView
            }
            pending.append(contentsOf: view.subviews)
        }
        return best
    }

    private func snapshot(_ window: UIWindow) throws -> Data {
        let format = UIGraphicsImageRendererFormat(for: window.traitCollection)
        format.opaque = true
        if window.bounds.height > 3_000 {
            format.scale = 2
        }
        let renderer = UIGraphicsImageRenderer(bounds: window.bounds, format: format)
        var didDraw = false
        let image = renderer.image { _ in
            didDraw = window.drawHierarchy(in: window.bounds, afterScreenUpdates: true)
        }
        guard didDraw else {
            throw CaptureFailure("drawHierarchy(in:afterScreenUpdates:) could not render the capture window.")
        }
        guard let data = image.pngData() else {
            throw CaptureFailure("The rendered capture could not be encoded as PNG.")
        }
        return data
    }
}

// MARK: - Capture support

private struct CaptureFailure: LocalizedError {
    let message: String

    init(_ message: String) {
        self.message = message
    }

    var errorDescription: String? { message }
}

private struct CaptureAppearance {
    let suffix: String
    let style: UIUserInterfaceStyle
    let dynamicTypeSize: DynamicTypeSize?
    let contentSizeCategory: UIContentSizeCategory?

    static let light = CaptureAppearance(
        suffix: "light",
        style: .light,
        dynamicTypeSize: nil,
        contentSizeCategory: nil
    )
    static let dark = CaptureAppearance(
        suffix: "dark",
        style: .dark,
        dynamicTypeSize: nil,
        contentSizeCategory: nil
    )
    static let accessibility3Light = CaptureAppearance(
        suffix: "accessibility3-light",
        style: .light,
        dynamicTypeSize: .accessibility3,
        contentSizeCategory: .accessibilityExtraLarge
    )
    static let standard: [CaptureAppearance] = [.light, .dark]
}

/// Serves fixture envelopes for exact request paths and answers every other
/// request with a 404 so no capture ever depends on a real host.
private struct CaptureFixtureHost {
    let routes: [String: Data]

    func respond(to request: URLRequest) throws -> (Data, URLResponse) {
        guard let url = request.url else {
            throw URLError(.badURL)
        }
        let body = routes[url.path]
        guard let response = HTTPURLResponse(
            url: url,
            statusCode: body == nil ? 404 : 200,
            httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        ) else {
            throw URLError(.badServerResponse)
        }
        return (body ?? Data(#"{"ok":false,"error":"Not part of the screen-capture fixture."}"#.utf8), response)
    }
}

@MainActor
private final class CaptureSession {
    let model: HelperViewModel
    private let credentials: LifecyclePairingCredentialStore

    init(routes: [String: Data]) {
        CaptureSession.resetPersistedHelperState()
        let store = LifecyclePairingCredentialStore()
        let host = CaptureFixtureHost(routes: routes)
        credentials = store
        model = HelperViewModel(
            api: APIClient(transport: { request in try host.respond(to: request) }),
            sseClient: LifecycleSSEStream(),
            sseReconnectSleep: { _ in },
            loadStoredPairingIdentity: store.load,
            storePairingIdentity: store.store,
            revokeStoredPairingIdentity: store.revoke,
            startLongLivedServices: false
        )
    }

    func pair() throws {
        model.backendURL = CaptureFixture.hostURL
        guard model.replacePairingIdentity(baseURL: CaptureFixture.hostURL, token: "capture-fixture-token"),
              credentials.load() != nil
        else {
            throw CaptureFailure("The fixture pairing identity could not be committed.")
        }
    }

    func applyPairedHostState(now: Date) throws {
        model.serverName = CaptureFixture.hostName
        model.serverVersion = CaptureFixture.hostVersion
        model.accounts = try CaptureFixture.decode([AccountDTO].self, from: CaptureFixture.accounts(now: now))
        model.devices = try CaptureFixture.decode([DeviceDTO].self, from: CaptureFixture.devices())
        model.config = try CaptureFixture.decode(HelperConfigDTO.self, from: CaptureFixture.config())
        model.primarySigningAccountId = CaptureFixture.accountID
        model.selectedAccountId = CaptureFixture.accountID
        model.selectedDeviceUdid = CaptureFixture.deviceID
        model.hostReachable = true
        model.hostLastReachedAt = now
        model.errorMessage = nil
    }

    func applyInstalledState(now: Date) throws {
        model.installedApps = try CaptureFixture.decode(
            [InstalledAppDTO].self,
            from: CaptureFixture.installedApps(now: now)
        )
        model.autoRefreshStates = try CaptureFixture.decode(
            [AutoRefreshStateDTO].self,
            from: CaptureFixture.autoRefreshStates(now: now)
        )
        model.appIds = try CaptureFixture.decode([HelperAppIdDTO].self, from: CaptureFixture.appIds(now: now))
        model.appIdUsage = try CaptureFixture.decode([HelperAppIdUsageDTO].self, from: CaptureFixture.appIdUsage())
        model.ipas = try CaptureFixture.decode([IpaArtifactDTO].self, from: CaptureFixture.ipas(now: now))
    }

    func tearDown() {
        model.invalidate()
        model.clearPairing()
        CaptureSession.resetPersistedHelperState()
    }

    /// Clears the UserDefaults keys the view model persists. Keychain storage
    /// is never touched because pairing uses the injected credential store.
    static func resetPersistedHelperState() {
        let keys = [
            "backendURL",
            PairingCredentialStorage.baseURLKey,
            "helperToken",
            PairingCredentialStorage.revocationTombstonesKey,
            "serverName",
            "serverVersion",
            "deviceId",
            "selectedAccountId",
            "primarySigningAccountId",
            "selectedDeviceUdid",
        ]
        for key in keys {
            UserDefaults.standard.removeObject(forKey: key)
        }
    }
}

/// Mirrors the install console chrome around the real `InstallProgressView`.
/// The console sheet itself is private to SidelinkApp.swift.
private struct InstallConsoleCaptureScreen: View {
    let job: InstallJobDetailDTO
    let logs: [InstallJobLogDTO]

    var body: some View {
        NavigationStack {
            ZStack {
                SidelinkBackdrop(accent: .slAccent)
                    .ignoresSafeArea()

                ScrollView {
                    InstallProgressView(
                        job: job,
                        logs: logs,
                        twoFACode: .constant(""),
                        onSubmitTwoFA: {},
                        onRetry: {},
                        isSubmitting: false,
                        commandDisabledReason: nil,
                        showsVerboseLogs: true
                    )
                    .padding(.horizontal, 20)
                    .padding(.vertical, 20)
                }
            }
            .navigationTitle("\(job.operationKind.noun) Console")
            .navigationBarTitleDisplayMode(.inline)
        }
    }
}
