import Foundation

struct HelperStatusResponse: Decodable {
    let now: String
    let mode: String
    let scheduler: SchedulerSnapshotDTO
    let installs: [InstallCardDTO]
    let devices: [DeviceDTO]
    let helperArtifact: HelperArtifactDTO
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
    let install: InstallCardDTO
}
