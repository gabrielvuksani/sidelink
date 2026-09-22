import Foundation

/// Synthetic host data for `NativeScreenCaptureTests`, expressed in the host's
/// JSON wire format and decoded through the app's real `Decodable` models.
/// All names, identifiers, and hosts are fictional.
enum TodayCaptureScenario: CaseIterable {
    case renewed
    case notNeeded
    case renewalFailed
    case legacyRepair

    var slug: String {
        switch self {
        case .renewed: return "renewed"
        case .notNeeded: return "not-needed"
        case .renewalFailed: return "renewal-failed"
        case .legacyRepair: return "legacy-repair"
        }
    }

    func snapshot(now: Date) -> [String: Any] {
        switch self {
        case .renewed:
            return CaptureFixture.todaySnapshot(
                now: now,
                headline: "Ready for the day",
                summary: "No confirmed blocker, active operation, or near-term signing pressure is visible.",
                recentOutcomes: [
                    CaptureFixture.dailyOperation(
                        jobId: CaptureFixture.renewedJobID,
                        appName: "Field Notes",
                        operation: "refresh",
                        status: "completed",
                        detail: "Completed on the paired host",
                        currentStep: "register",
                        revision: 9,
                        updatedAt: CaptureFixture.iso(now, offset: -3 * 60),
                        outcome: "renewed"
                    ),
                    CaptureFixture.dailyOperation(
                        jobId: CaptureFixture.installJobID,
                        appName: "Trail Log",
                        operation: "install",
                        status: "completed",
                        detail: "Completed on the paired host",
                        currentStep: "register",
                        revision: 12,
                        updatedAt: CaptureFixture.iso(now, offset: -6 * CaptureFixture.day),
                        outcome: "installed"
                    ),
                ]
            )
        case .notNeeded:
            return CaptureFixture.todaySnapshot(
                now: now,
                headline: "Ready for the day",
                summary: "No confirmed blocker, active operation, or near-term signing pressure is visible.",
                recentOutcomes: [
                    CaptureFixture.dailyOperation(
                        jobId: CaptureFixture.notNeededJobID,
                        appName: "Field Notes",
                        operation: "refresh",
                        status: "completed",
                        detail: "Renewal is not needed yet",
                        currentStep: nil,
                        revision: 3,
                        updatedAt: CaptureFixture.iso(now, offset: -2 * 60),
                        outcome: "not_needed",
                        outcomeReason: "not_due"
                    ),
                    CaptureFixture.dailyOperation(
                        jobId: CaptureFixture.renewedJobID,
                        appName: "Field Notes",
                        operation: "refresh",
                        status: "completed",
                        detail: "Completed on the paired host",
                        currentStep: "register",
                        revision: 9,
                        updatedAt: CaptureFixture.iso(now, offset: -26 * CaptureFixture.hour),
                        outcome: "renewed"
                    ),
                ]
            )
        case .renewalFailed:
            return CaptureFixture.todaySnapshot(
                now: now,
                headline: "1 item to review",
                summary: "These confirmed gaps affect daily operation on the paired host.",
                actions: [
                    CaptureFixture.action(
                        id: "recent-failures",
                        title: "Refresh Field Notes failed",
                        detail: "Failed during authentication. Open it to see what to do next.",
                        action: "Review operation",
                        tone: "warning",
                        target: CaptureFixture.target("job", jobId: CaptureFixture.failedJobID)
                    ),
                ],
                expiryPressure: [
                    CaptureFixture.expiry(
                        installedAppId: CaptureFixture.fieldNotesInstallID,
                        appName: "Field Notes",
                        expiresAt: CaptureFixture.iso(now, offset: 1 * CaptureFixture.day + 4 * CaptureFixture.hour),
                        daysRemaining: 2,
                        expired: false
                    ),
                ],
                recentOutcomes: [
                    CaptureFixture.dailyOperation(
                        jobId: CaptureFixture.failedJobID,
                        appName: "Field Notes",
                        operation: "refresh",
                        status: "failed",
                        detail: "Failed during authentication",
                        currentStep: "authenticate",
                        revision: 4,
                        updatedAt: CaptureFixture.iso(now, offset: -25 * 60)
                    ),
                    CaptureFixture.dailyOperation(
                        jobId: CaptureFixture.installJobID,
                        appName: "Trail Log",
                        operation: "install",
                        status: "completed",
                        detail: "Completed on the paired host",
                        currentStep: "register",
                        revision: 12,
                        updatedAt: CaptureFixture.iso(now, offset: -6 * CaptureFixture.day),
                        outcome: "installed"
                    ),
                ]
            )
        case .legacyRepair:
            // Legacy apps without an install recipe are rejected at admission
            // (INSTALL_REPAIR_REQUIRED), so Today shows expiry pressure and the
            // renewal-review action rather than a failed job receipt.
            return CaptureFixture.todaySnapshot(
                now: now,
                headline: "1 critical action needs you",
                summary: "SideLink has paused where a decision or credential is required.",
                actions: [
                    CaptureFixture.action(
                        id: "renewal-repair",
                        title: "Trail Log needs its renewal settings reviewed",
                        detail: "Automatic renewal is paused until you confirm the original IPA and extensions on the paired computer.",
                        action: "Open Apps",
                        tone: "critical",
                        target: CaptureFixture.target("installed_app", installedAppId: CaptureFixture.trailLogInstallID)
                    ),
                ],
                expiryPressure: [
                    CaptureFixture.expiry(
                        installedAppId: CaptureFixture.trailLogInstallID,
                        appName: "Trail Log",
                        expiresAt: CaptureFixture.iso(now, offset: -3 * CaptureFixture.hour),
                        daysRemaining: 0,
                        expired: true
                    ),
                ],
                recentOutcomes: [
                    CaptureFixture.dailyOperation(
                        jobId: CaptureFixture.renewedJobID,
                        appName: "Field Notes",
                        operation: "refresh",
                        status: "completed",
                        detail: "Completed on the paired host",
                        currentStep: "register",
                        revision: 9,
                        updatedAt: CaptureFixture.iso(now, offset: -5 * CaptureFixture.hour),
                        outcome: "renewed"
                    ),
                ]
            )
        }
    }
}

enum CaptureFixture {
    static let hostURL = "http://studio-mac.local:4010"
    static let hostName = "Studio Mac"
    static let hostVersion = "1.1.1"
    static let accountID = "account-example"
    static let appleID = "signing@example.com"
    static let teamID = "EXAMPLE001"
    static let teamName = "Example Team"
    static let deviceID = "TEST-IPHONE-SIMULATED-0001"
    static let deviceName = "Test iPhone"
    static let fieldNotesInstallID = "installed-field-notes"
    static let trailLogInstallID = "installed-trail-log"
    static let renewedJobID = "4f1c9e2a-7b3d-4c8e-9a61-2d5b8f0c3e17"
    static let notNeededJobID = "c93a6d10-2f4e-4b7a-8d15-6e0b3c9f7a42"
    static let failedJobID = "7e2b4c91-5d3a-4f68-b0c7-1a9e6f2d8b35"
    static let installJobID = "b72e05d4-1a9f-4e3b-8c26-5f7d9a1e4b80"
    static let runningJobID = "2d8f6a13-9c4b-4e7d-a5f2-0b3e7c1d9a64"
    static let verificationJobID = "e5a1c7f2-3b9d-4a60-8e24-7c0f5b2d6e19"
    static let hour: TimeInterval = 60 * 60
    static let day: TimeInterval = 24 * 60 * 60

    // MARK: Encoding

    static func iso(_ now: Date, offset: TimeInterval) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: now.addingTimeInterval(offset))
    }

    static func nullable(_ value: String?) -> Any {
        if let value {
            return value
        }
        return NSNull()
    }

    static func envelope(_ payload: Any) throws -> Data {
        let envelope: [String: Any] = ["ok": true, "data": payload]
        return try JSONSerialization.data(withJSONObject: envelope, options: [.sortedKeys])
    }

    static func decode<T: Decodable>(_ type: T.Type, from object: Any) throws -> T {
        let data = try JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
        return try JSONDecoder().decode(type, from: data)
    }

    // MARK: Host inventory

    static func accounts(now: Date) -> [[String: Any]] {
        [[
            "id": accountID,
            "appleId": appleID,
            "teamId": teamID,
            "teamName": teamName,
            "accountType": "free",
            "status": "active",
            "lastAuthAt": iso(now, offset: -2 * day),
            "createdAt": iso(now, offset: -30 * day),
        ]]
    }

    static func devices() -> [[String: Any]] {
        [[
            "udid": deviceID,
            "name": deviceName,
            "connection": "online",
            "transport": "usb",
            "iosVersion": "26.0",
        ]]
    }

    static func config() -> [String: Any] {
        [
            "serverName": hostName,
            "serverVersion": hostVersion,
            "schedulerEnabled": true,
            "schedulerCheckIntervalMs": 900_000,
            "capabilities": [
                "pairingCode": true,
                "sourceImport": true,
                "installEvents": true,
                "inline2FA": true,
            ],
            "freeAccountLimits": [
                "maxActiveApps": 3,
                "maxNewAppIdsPerWeek": 10,
                "certValidityDays": 7,
            ],
            "freeAccountUsage": [
                "activeSlotsUsed": 2,
                "weeklyAppIdsUsedByAccount": [accountID: 3],
            ] as [String: Any],
            "sourceFeeds": [[String: Any]](),
        ]
    }

    static func installedApps(now: Date) -> [[String: Any]] {
        [
            [
                "id": trailLogInstallID,
                "status": "active",
                "bundleId": "com.example.traillog",
                "originalBundleId": "com.example.traillog",
                "appName": "Trail Log",
                "appVersion": "1.8",
                "deviceUdid": deviceID,
                "accountId": accountID,
                "installedAt": iso(now, offset: -(6 * day + 4 * hour)),
                "expiresAt": iso(now, offset: 20 * hour),
                "refreshCount": 0,
                "lastRefreshAt": NSNull(),
                "renewalRepairRequired": true,
            ],
            [
                "id": fieldNotesInstallID,
                "status": "active",
                "bundleId": "com.example.fieldnotes",
                "originalBundleId": "com.example.fieldnotes",
                "appName": "Field Notes",
                "appVersion": "2.4.1",
                "deviceUdid": deviceID,
                "accountId": accountID,
                "installedAt": iso(now, offset: -15 * day),
                "expiresAt": iso(now, offset: 5 * day + 6 * hour),
                "refreshCount": 3,
                "lastRefreshAt": iso(now, offset: -(1 * day + 18 * hour)),
                "renewalRepairRequired": false,
            ],
        ]
    }

    static func autoRefreshStates(now: Date) -> [[String: Any]] {
        [
            [
                "installedAppId": trailLogInstallID,
                "bundleId": "com.example.traillog",
                "appName": "Trail Log",
                "deviceUdid": deviceID,
                "expiresAt": iso(now, offset: 20 * hour),
                "isExpired": false,
                "needsRefresh": true,
                "msUntilExpiry": 20 * hour * 1_000,
                "refreshInProgress": false,
                "lastRefreshAt": NSNull(),
                "lastError": NSNull(),
            ],
            [
                "installedAppId": fieldNotesInstallID,
                "bundleId": "com.example.fieldnotes",
                "appName": "Field Notes",
                "deviceUdid": deviceID,
                "expiresAt": iso(now, offset: 5 * day + 6 * hour),
                "isExpired": false,
                "needsRefresh": false,
                "msUntilExpiry": (5 * day + 6 * hour) * 1_000,
                "refreshInProgress": false,
                "lastRefreshAt": iso(now, offset: -(1 * day + 18 * hour)),
                "lastError": NSNull(),
            ],
        ]
    }

    static func appIds(now: Date) -> [[String: Any]] {
        [
            appID(id: "appid-field-notes", bundleId: "com.example.fieldnotes", name: "Field Notes", createdAt: iso(now, offset: -15 * day)),
            appID(
                id: "appid-field-notes-widgets",
                bundleId: "com.example.fieldnotes.widgets",
                name: "Field Notes Widgets",
                createdAt: iso(now, offset: -15 * day)
            ),
            appID(id: "appid-trail-log", bundleId: "com.example.traillog", name: "Trail Log", createdAt: iso(now, offset: -6 * day)),
        ]
    }

    static func appID(id: String, bundleId: String, name: String, createdAt: String) -> [String: Any] {
        [
            "id": id,
            "accountId": accountID,
            "teamId": teamID,
            "bundleId": bundleId,
            "name": name,
            "originalBundleId": bundleId,
            "createdAt": createdAt,
            "accountAppleId": appleID,
            "teamName": teamName,
        ]
    }

    static func appIdUsage() -> [[String: Any]] {
        [[
            "accountId": accountID,
            "appleId": appleID,
            "teamId": teamID,
            "active": 3,
            "weeklyCreated": 3,
            "maxActive": 10,
            "maxWeekly": 10,
        ]]
    }

    static func ipas(now: Date) -> [[String: Any]] {
        [
            [
                "id": "ipa-field-notes",
                "originalName": "FieldNotes.ipa",
                "bundleName": "Field Notes",
                "bundleId": "com.example.fieldnotes",
                "bundleVersion": "241",
                "bundleShortVersion": "2.4.1",
                "fileSize": 18_450_000,
                "minOsVersion": "17.0",
                "extensions": [["bundleId": "com.example.fieldnotes.widgets", "name": "Field Notes Widgets"]],
                "warnings": [String](),
                "uploadedAt": iso(now, offset: -15 * day),
            ],
            [
                "id": "ipa-trail-log",
                "originalName": "TrailLog.ipa",
                "bundleName": "Trail Log",
                "bundleId": "com.example.traillog",
                "bundleVersion": "18",
                "bundleShortVersion": "1.8",
                "fileSize": 9_320_000,
                "minOsVersion": "17.0",
                "warnings": [String](),
                "uploadedAt": iso(now, offset: -6 * day),
            ],
        ]
    }

    // MARK: Today

    static func target(_ kind: String, jobId: String? = nil, installedAppId: String? = nil) -> [String: Any] {
        ["kind": kind, "jobId": nullable(jobId), "installedAppId": nullable(installedAppId)]
    }

    static func action(
        id: String,
        title: String,
        detail: String,
        action: String,
        tone: String,
        target: [String: Any]
    ) -> [String: Any] {
        ["id": id, "title": title, "detail": detail, "action": action, "tone": tone, "target": target]
    }

    static func expiry(
        installedAppId: String,
        appName: String,
        expiresAt: String,
        daysRemaining: Int,
        expired: Bool
    ) -> [String: Any] {
        [
            "installedAppId": installedAppId,
            "appName": appName,
            "deviceName": deviceName,
            "expiresAt": expiresAt,
            "daysRemaining": daysRemaining,
            "expired": expired,
            "recoveryInFlight": false,
            "target": target("installed_app", installedAppId: installedAppId),
        ]
    }

    static func dailyOperation(
        jobId: String,
        appName: String,
        operation: String,
        status: String,
        detail: String,
        currentStep: String?,
        revision: Int,
        updatedAt: String,
        outcome: String? = nil,
        outcomeReason: String? = nil,
        eligibleCommands: [String] = []
    ) -> [String: Any] {
        [
            "jobId": jobId,
            "title": "\(operationNoun(operation)) \(appName)",
            "detail": detail,
            "status": status,
            "operation": operation,
            "outcome": nullable(outcome),
            "outcomeReason": nullable(outcomeReason),
            "revision": revision,
            "currentStep": nullable(currentStep),
            "appName": appName,
            "deviceName": deviceName,
            "updatedAt": updatedAt,
            "eligibleCommands": eligibleCommands,
            "target": target("job", jobId: jobId),
        ]
    }

    static func operationNoun(_ operation: String) -> String {
        switch operation {
        case "refresh": return "Refresh"
        case "reactivation": return "Reactivate"
        case "repair": return "Repair"
        default: return "Install"
        }
    }

    static func todaySnapshot(
        now: Date,
        headline: String,
        summary: String,
        actions: [[String: Any]] = [],
        operations: [[String: Any]] = [],
        expiryPressure: [[String: Any]] = [],
        recentOutcomes: [[String: Any]]
    ) -> [String: Any] {
        [
            "schemaVersion": 1,
            "jobCommandPreconditionVersion": 1,
            "generatedAt": iso(now, offset: 0),
            "headline": headline,
            "summary": summary,
            "actions": actions,
            "operations": operations,
            "expiryPressure": expiryPressure,
            "expiryHorizonDays": 3,
            "quotaPressure": [[
                "accountId": accountID,
                "used": 3,
                "limit": 10,
                "ratio": 0.3,
                "tone": "healthy",
                "target": target("accounts"),
            ] as [String: Any]],
            "quotaAvailability": "available",
            "recentOutcomes": recentOutcomes,
            "fleet": [
                "accounts": ["active": 1, "total": 1],
                "devices": ["online": 1, "detected": 1, "paired": 1, "managed": 1],
                "apps": ["active": 2, "total": 2],
                "library": ["total": 2],
            ],
            "readiness": [
                "status": "ready",
                "issues": [[String: Any]](),
                "helperPairing": "paired",
            ] as [String: Any],
        ]
    }

    // MARK: Jobs

    static func step(_ name: String, _ status: String, startedAt: String?, completedAt: String?) -> [String: Any] {
        ["name": name, "status": status, "startedAt": nullable(startedAt), "completedAt": nullable(completedAt)]
    }

    static func job(
        id: String,
        appName: String,
        operation: String,
        status: String,
        detail: String,
        currentStep: String?,
        steps: [[String: Any]] = [],
        revision: Int,
        createdAt: String,
        updatedAt: String,
        eligibleCommands: [String] = [],
        outcome: String? = nil,
        outcomeReason: String? = nil
    ) -> [String: Any] {
        [
            "id": id,
            "title": "\(operationNoun(operation)) \(appName)",
            "detail": detail,
            "operation": operation,
            "status": status,
            "currentStep": nullable(currentStep),
            "steps": steps,
            "revision": revision,
            "createdAt": createdAt,
            "updatedAt": updatedAt,
            "eligibleCommands": eligibleCommands,
            "outcome": nullable(outcome),
            "outcomeReason": nullable(outcomeReason),
        ]
    }

    static func runningRefreshJob(now: Date) -> [String: Any] {
        job(
            id: runningJobID,
            appName: "Field Notes",
            operation: "refresh",
            status: "running",
            detail: "signing in progress",
            currentStep: "sign",
            steps: [
                step("validate", "completed", startedAt: iso(now, offset: -95), completedAt: iso(now, offset: -93)),
                step("authenticate", "completed", startedAt: iso(now, offset: -93), completedAt: iso(now, offset: -80)),
                step("provision", "completed", startedAt: iso(now, offset: -80), completedAt: iso(now, offset: -41)),
                step("sign", "running", startedAt: iso(now, offset: -41), completedAt: nil),
                step("install", "pending", startedAt: nil, completedAt: nil),
                step("register", "pending", startedAt: nil, completedAt: nil),
            ],
            revision: 6,
            createdAt: iso(now, offset: -96),
            updatedAt: iso(now, offset: -41),
            eligibleCommands: ["cancel"]
        )
    }

    static func runningRefreshLogs(now: Date) -> [[String: Any]] {
        [
            logLine(runningJobID, 1, "validate", "info", "Validated Field Notes 2.4.1 and its widget extension.", iso(now, offset: -94)),
            logLine(runningJobID, 2, "authenticate", "info", "Using the primary signing identity for Example Team.", iso(now, offset: -85)),
            logLine(runningJobID, 3, "provision", "info", "Provisioning profiles are ready for 2 App IDs.", iso(now, offset: -42)),
            logLine(runningJobID, 4, "sign", "info", "Signing the app and 1 extension for Test iPhone.", iso(now, offset: -40)),
        ]
    }

    static func failedRefreshJob(now: Date) -> [String: Any] {
        job(
            id: failedJobID,
            appName: "Field Notes",
            operation: "refresh",
            status: "failed",
            detail: "Failed during authentication",
            currentStep: "authenticate",
            steps: [
                step("validate", "completed", startedAt: iso(now, offset: -30 * 60), completedAt: iso(now, offset: -30 * 60 + 2)),
                step("authenticate", "failed", startedAt: iso(now, offset: -30 * 60 + 2), completedAt: iso(now, offset: -25 * 60)),
                step("provision", "pending", startedAt: nil, completedAt: nil),
                step("sign", "pending", startedAt: nil, completedAt: nil),
                step("install", "pending", startedAt: nil, completedAt: nil),
                step("register", "pending", startedAt: nil, completedAt: nil),
            ],
            revision: 4,
            createdAt: iso(now, offset: -30 * 60),
            updatedAt: iso(now, offset: -25 * 60)
        )
    }

    static func failedRefreshLogs(now: Date) -> [[String: Any]] {
        [
            logLine(failedJobID, 1, "validate", "info", "Validated Field Notes 2.4.1 and its widget extension.", iso(now, offset: -30 * 60 + 1)),
            logLine(failedJobID, 2, "authenticate", "info", "Using the primary signing identity for Example Team.", iso(now, offset: -30 * 60 + 3)),
            logLine(failedJobID, 3, "authenticate", "error", "Apple authentication expired. Start sign-in again.", iso(now, offset: -25 * 60 - 1)),
            logLine(
                failedJobID,
                4,
                "authenticate",
                "warn",
                "Re-authenticate the Apple ID in Settings, then retry this refresh. The installed app keeps running until it expires.",
                iso(now, offset: -25 * 60)
            ),
        ]
    }

    static func logLine(
        _ jobId: String,
        _ sequence: Int,
        _ step: String,
        _ level: String,
        _ message: String,
        _ at: String
    ) -> [String: Any] {
        [
            "id": "\(jobId)-log-\(sequence)",
            "jobId": jobId,
            "sequence": sequence,
            "step": step,
            "level": level,
            "message": message,
            "at": at,
        ]
    }

    static func activityJobs(now: Date) -> [[String: Any]] {
        [
            job(
                id: verificationJobID,
                appName: "Pocket Ledger",
                operation: "install",
                status: "waiting_2fa",
                detail: "Waiting for two-factor authentication",
                currentStep: "authenticate",
                revision: 3,
                createdAt: iso(now, offset: -4 * 60),
                updatedAt: iso(now, offset: -3 * 60),
                eligibleCommands: ["cancel", "submit_2fa"]
            ),
            job(
                id: failedJobID,
                appName: "Field Notes",
                operation: "refresh",
                status: "failed",
                detail: "Failed during authentication",
                currentStep: "authenticate",
                revision: 4,
                createdAt: iso(now, offset: -30 * 60),
                updatedAt: iso(now, offset: -25 * 60)
            ),
            job(
                id: runningJobID,
                appName: "Field Notes",
                operation: "refresh",
                status: "running",
                detail: "signing in progress",
                currentStep: "sign",
                revision: 6,
                createdAt: iso(now, offset: -96),
                updatedAt: iso(now, offset: -41),
                eligibleCommands: ["cancel"]
            ),
            job(
                id: notNeededJobID,
                appName: "Field Notes",
                operation: "refresh",
                status: "completed",
                detail: "Renewal is not needed yet",
                currentStep: nil,
                revision: 3,
                createdAt: iso(now, offset: -2 * hour),
                updatedAt: iso(now, offset: -2 * hour + 5),
                outcome: "not_needed",
                outcomeReason: "not_due"
            ),
            job(
                id: renewedJobID,
                appName: "Field Notes",
                operation: "refresh",
                status: "completed",
                detail: "Completed on the paired host",
                currentStep: "register",
                revision: 9,
                createdAt: iso(now, offset: -26 * hour),
                updatedAt: iso(now, offset: -26 * hour + 150),
                outcome: "renewed"
            ),
        ]
    }
}
