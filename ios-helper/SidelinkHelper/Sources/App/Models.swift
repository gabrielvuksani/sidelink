import Foundation

struct HelperStatusResponse: Decodable {
    let ok: Bool
    let now: String
    let mode: String
    let scheduler: SchedulerSnapshotDTO
    let installs: [InstallCardDTO]
    let devices: [DeviceDTO]
    let helperArtifact: HelperArtifactDTO
}

struct APIEnvelope<T: Decodable>: Decodable {
    let ok: Bool
    let data: T?
    let error: String?
}

struct PairResponse: Decodable {
    let token: String
    let apiBasePath: String?
    let serverName: String?
    let serverVersion: String?
}

struct HelperConfigDTO: Decodable {
    struct CapabilitiesDTO: Decodable {
        let pairingCode: Bool
        let sourceImport: Bool
        let installEvents: Bool
        let inline2FA: Bool
    }

    struct FreeAccountLimitsDTO: Decodable {
        let maxActiveApps: Int
        let maxNewAppIdsPerWeek: Int
        let certValidityDays: Int
    }

    struct FreeAccountUsageDTO: Decodable {
        let activeSlotsUsed: Int?
        let weeklyAppIdsUsedByAccount: [String: Int]?
    }

    let serverName: String?
    let serverVersion: String?
    let schedulerEnabled: Bool
    let schedulerCheckIntervalMs: Int
    let capabilities: CapabilitiesDTO?
    let freeAccountLimits: FreeAccountLimitsDTO?
    let freeAccountUsage: FreeAccountUsageDTO?
    let sourceFeeds: [SourceFeedDTO]
}

struct SourceFeedDTO: Decodable, Identifiable {
    let id: String
    let name: String
    let url: String
    let enabled: Bool
}

struct AccountDTO: Decodable, Identifiable {
    let id: String
    let appleId: String
    let teamId: String
    let teamName: String
    let accountType: String
    let status: String
}

struct IpaArtifactDTO: Decodable, Identifiable {
    let id: String
    let originalName: String
    let bundleName: String
    let bundleId: String
    let bundleVersion: String?
    let bundleShortVersion: String
    let fileSize: Double?
    let minOsVersion: String?
    let iconData: String?
    let entitlements: [String: AnyCodable]?
    let extensions: [IpaExtensionDTO]?
    let warnings: [String]
    let uploadedAt: String?
}

struct IpaExtensionDTO: Decodable, Identifiable {
    let bundleId: String
    let name: String
    var id: String { bundleId }
}

/// Type-erased Codable wrapper for mixed JSON values (entitlements).
struct AnyCodable: Decodable {
    let value: Any

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            value = NSNull()
        } else if let b = try? container.decode(Bool.self) {
            value = b
        } else if let i = try? container.decode(Int.self) {
            value = i
        } else if let d = try? container.decode(Double.self) {
            value = d
        } else if let s = try? container.decode(String.self) {
            value = s
        } else if let a = try? container.decode([AnyCodable].self) {
            value = a.map(\.value)
        } else if let dict = try? container.decode([String: AnyCodable].self) {
            value = dict.mapValues(\.value)
        } else {
            value = NSNull()
        }
    }
}

struct InstallJobDTO: Decodable, Identifiable {
    let id: String
    let status: String
    let currentStep: String?
    let error: String?
}

struct PipelineStepDTO: Decodable, Identifiable {
    let name: String
    let status: String
    let startedAt: String?
    let completedAt: String?
    let error: String?

    var id: String { name }
}

struct InstallJobDetailDTO: Decodable, Identifiable {
    let id: String
    let ipaId: String
    let deviceUdid: String
    let accountId: String
    let includeExtensions: Bool
    let status: String
    let currentStep: String?
    let steps: [PipelineStepDTO]
    let error: String?
    let createdAt: String
    let updatedAt: String
}

struct InstallJobLogDTO: Decodable, Identifiable {
    let id: String
    let jobId: String
    let step: String?
    let level: String
    let message: String
    let meta: [String: AnyCodable]?
    let at: String
}

struct SchedulerSnapshotDTO: Decodable {
    let running: Bool
    let simulatedNow: String
    let autoRefreshThresholdHours: Double
}

struct InstallCardDTO: Decodable, Identifiable {
    let id: String
    let deviceId: String
    let kind: String
    let label: String
    let bundleId: String
    let health: String
    let expiresAt: String
    let refreshCount: Int
    let autoRefresh: AutoRefreshDTO
}

struct InstalledAppDTO: Decodable, Identifiable {
    let id: String
    let bundleId: String
    let originalBundleId: String
    let appName: String?
    let appVersion: String?
    let deviceUdid: String
    let accountId: String
    let installedAt: String
    let expiresAt: String
    let refreshCount: Int
    let lastRefreshAt: String?
}

struct AutoRefreshDTO: Decodable {
    let nextAttemptAt: String
    let retryCount: Int
    let lastFailureReason: String?
    let lastSuccessAt: String?
}

struct DeviceDTO: Decodable, Identifiable {
    let id: String
    let name: String
    let connection: String
    let transport: String
    let networkName: String?
}

struct HelperArtifactDTO: Decodable {
    let available: Bool
    let message: String?
}

struct HelperRefreshResponse: Decodable {
    let ok: Bool
    let install: InstallCardDTO
}

struct DiscoveryBroadcastDTO: Decodable {
    let service: String?
    let type: String
    let version: Int
    let name: String
    let port: Int
    let addresses: [String]
    let timestamp: String
}

struct AutoRefreshStateDTO: Decodable, Identifiable {
    let installedAppId: String
    let bundleId: String
    let appName: String
    let deviceUdid: String
    let expiresAt: String
    let isExpired: Bool
    let needsRefresh: Bool
    let msUntilExpiry: Double
    let refreshInProgress: Bool
    let lastRefreshAt: String?
    let lastError: String?

    var id: String { installedAppId }
}

struct SourceManifestDTO: Decodable {
    let name: String
    let identifier: String?
    let subtitle: String?
    let description: String?
    let iconURL: String?
    let headerURL: String?
    let website: String?
    let tintColor: String?
    let sourceURL: String?
    let patreonURL: String?
    let featuredApps: [String]?
    let news: [SourceNewsDTO]?
    let apps: [SourceAppDTO]
}

struct SourceNewsDTO: Decodable, Identifiable {
    let identifier: String?
    let title: String
    let caption: String?
    let date: String?
    let tintColor: String?
    let imageURL: String?
    let notify: Bool?
    let url: String?
    let appID: String?

    var id: String { identifier ?? title }
}

struct SourceAppDTO: Decodable, Identifiable {
    let name: String
    let bundleIdentifier: String
    let developerName: String?
    let subtitle: String?
    let version: String?
    let versionDate: String?
    let versionDescription: String?
    let downloadURL: String?
    let localizedDescription: String?
    let iconURL: String?
    let tintColor: String?
    let category: String?
    let screenshots: SourceScreenshotsDTO?
    let versions: [SourceAppVersionDTO]?
    let appPermissions: SourceAppPermissionsDTO?
    let patreon: SourceAppPatreonDTO?
    let size: Double?

    var primaryDownloadURL: String {
        if let latest = versions?.first?.downloadURL, !latest.isEmpty {
            return latest
        }
        return downloadURL ?? ""
    }

    var displayVersion: String {
        versions?.first?.version ?? version ?? "Unknown"
    }

    var id: String { "\(bundleIdentifier)-\(primaryDownloadURL)" }
}

struct SourceScreenshotsDTO: Decodable {
    let iphone: [SourceScreenshotDTO]?
    let ipad: [SourceScreenshotDTO]?
}

struct SourceScreenshotDTO: Decodable, Identifiable {
    let imageURL: String
    let width: Int?
    let height: Int?

    var id: String { imageURL }
}

struct SourceAppVersionDTO: Decodable, Identifiable {
    let version: String
    let buildVersion: String?
    let marketingVersion: String?
    let date: String?
    let localizedDescription: String?
    let downloadURL: String
    let size: Double?
    let minOSVersion: String?
    let maxOSVersion: String?

    var id: String { "\(version)-\(downloadURL)" }
}

struct SourceAppPermissionsDTO: Decodable {
    let entitlements: [String]?
    let privacy: [String: String]?
}

struct SourceAppPatreonDTO: Decodable {
    let pledge: Int?
    let currency: String?
    let benefit: String?
    let tiers: [String]?
}
