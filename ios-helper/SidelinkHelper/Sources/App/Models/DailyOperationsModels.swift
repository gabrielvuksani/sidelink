import Foundation

struct DailyOperationsTargetDTO: Decodable, Equatable {
    let kind: String
    let jobId: String?
    let installedAppId: String?
}

struct DailyOperationsActionDTO: Decodable, Identifiable {
    let id: String
    let title: String
    let detail: String
    let action: String
    let tone: String
    let target: DailyOperationsTargetDTO
}

struct DailyOperationDTO: Decodable, Identifiable {
    let jobId: String
    let title: String
    let detail: String
    let status: String
    let operation: String
    let revision: Int
    let currentStep: String?
    let appName: String
    let deviceName: String
    let updatedAt: String
    let eligibleCommands: [String]
    let target: DailyOperationsTargetDTO

    var id: String { jobId }
    var outcome: String? = nil
    var outcomeReason: String? = nil
}

struct DailyOperationsExpiryDTO: Decodable, Identifiable {
    let installedAppId: String
    let appName: String
    let deviceName: String
    let expiresAt: String
    let daysRemaining: Int
    let expired: Bool
    let recoveryInFlight: Bool
    let target: DailyOperationsTargetDTO

    var id: String { installedAppId }
}

struct DailyOperationsQuotaDTO: Decodable, Identifiable {
    let accountId: String
    let used: Int
    let limit: Int
    let ratio: Double
    let tone: String
    let target: DailyOperationsTargetDTO

    var id: String { accountId }
}

struct DailyOperationsReadinessIssueDTO: Decodable, Identifiable {
    let code: String
    let title: String
    let target: DailyOperationsTargetDTO

    var id: String { code }
}

struct DailyOperationsFleetDTO: Decodable {
    struct Accounts: Decodable {
        let active: Int
        let total: Int
    }

    struct Devices: Decodable {
        let online: Int
        let detected: Int
        let paired: Int
        let managed: Int
    }

    struct Apps: Decodable {
        let active: Int
        let total: Int
    }

    struct Library: Decodable {
        let total: Int
    }

    let accounts: Accounts
    let devices: Devices
    let apps: Apps
    let library: Library
}

struct DailyOperationsReadinessDTO: Decodable {
    let status: String
    let issues: [DailyOperationsReadinessIssueDTO]
    let helperPairing: String
}

struct DailyOperationsSnapshotDTO: Decodable {
    let schemaVersion: Int
    let jobCommandPreconditionVersion: Int?
    let generatedAt: String
    let headline: String
    let summary: String
    let actions: [DailyOperationsActionDTO]
    let operations: [DailyOperationDTO]
    let expiryPressure: [DailyOperationsExpiryDTO]
    let expiryHorizonDays: Int
    let quotaPressure: [DailyOperationsQuotaDTO]
    let quotaAvailability: String
    let recentOutcomes: [DailyOperationDTO]
    let fleet: DailyOperationsFleetDTO
    let readiness: DailyOperationsReadinessDTO
}

enum InstallJobRevisionCollection {
    static func merging(
        current: [String: InstallJobDetailDTO],
        incoming: [InstallJobDetailDTO]
    ) -> [String: InstallJobDetailDTO] {
        var result = current
        for job in incoming {
            let existing = result[job.id]
            if InstallJobSnapshotOrdering.shouldAccept(current: existing, incoming: job) {
                result[job.id] = job
            }
        }
        return result
    }
}
