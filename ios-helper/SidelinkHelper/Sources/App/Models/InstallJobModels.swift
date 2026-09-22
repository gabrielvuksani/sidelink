import Foundation

struct InstallJobDTO: Decodable, Identifiable {
    let id: String
    let title: String?
    let detail: String?
    let operation: String?
    let status: String
    let currentStep: String?
    let revision: Int?
    var outcome: String? = nil
    var outcomeReason: String? = nil
}

struct RefreshJobReceiptDTO: Decodable {
    let disposition: String
    let job: InstallJobDTO?
}

struct LegacyRefreshAcceptanceDTO: Decodable {
    let ok: Bool
}

struct PipelineStepDTO: Decodable, Identifiable {
    let name: String
    let status: String
    let startedAt: String?
    let completedAt: String?

    var id: String { name }
}

struct InstallJobDetailDTO: Decodable, Identifiable {
    let id: String
    let title: String
    let detail: String
    let operation: String?
    let status: String
    let currentStep: String?
    let steps: [PipelineStepDTO]
    let revision: Int?
    let createdAt: String
    let updatedAt: String
    let eligibleCommands: [String]
    let error: String?
    let outcome: String?
    let outcomeReason: String?

    private enum CodingKeys: String, CodingKey {
        case id, title, detail, operation, status, currentStep, steps
        case revision, createdAt, updatedAt, eligibleCommands
        case outcome, outcomeReason
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        id = try container.decode(String.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        detail = try container.decode(String.self, forKey: .detail)
        operation = try container.decodeIfPresent(String.self, forKey: .operation)
        status = try container.decode(String.self, forKey: .status)
        currentStep = try container.decodeIfPresent(String.self, forKey: .currentStep)
        steps = try container.decode([PipelineStepDTO].self, forKey: .steps)
        revision = try container.decodeIfPresent(Int.self, forKey: .revision)
        createdAt = try container.decode(String.self, forKey: .createdAt)
        updatedAt = try container.decode(String.self, forKey: .updatedAt)
        eligibleCommands = try container.decode([String].self, forKey: .eligibleCommands)
        error = nil
        outcome = try container.decodeIfPresent(String.self, forKey: .outcome)
        outcomeReason = try container.decodeIfPresent(String.self, forKey: .outcomeReason)
    }

    init(
        id: String,
        title: String,
        detail: String,
        operation: String?,
        status: String,
        currentStep: String?,
        steps: [PipelineStepDTO],
        revision: Int?,
        createdAt: String,
        updatedAt: String,
        eligibleCommands: [String],
        error: String? = nil,
        outcome: String? = nil,
        outcomeReason: String? = nil
    ) {
        self.id = id
        self.title = title
        self.detail = detail
        self.operation = operation
        self.status = status
        self.currentStep = currentStep
        self.steps = steps
        self.revision = revision
        self.createdAt = createdAt
        self.updatedAt = updatedAt
        self.eligibleCommands = eligibleCommands
        self.error = error
        self.outcome = outcome
        self.outcomeReason = outcomeReason
    }
}

enum InstallOperationKind: String {
    case install
    case refresh
    case reactivation
    case repair

    var noun: String {
        switch self {
        case .install: return "Install"
        case .refresh: return "Refresh"
        case .reactivation: return "Reactivation"
        case .repair: return "Renewal repair"
        }
    }

    var activeLabel: String {
        switch self {
        case .install: return "Installing"
        case .refresh: return "Refreshing"
        case .reactivation: return "Reactivating"
        case .repair: return "Repairing renewal"
        }
    }

    var retryLabel: String {
        self == .repair ? "Review on computer" : "Retry \(noun.lowercased())"
    }

    var completedVerb: String {
        switch self {
        case .install: return "installed"
        case .refresh: return "refreshed"
        case .reactivation: return "reactivated"
        case .repair: return "renewed"
        }
    }
}

extension InstallJobDetailDTO {
    var operationKind: InstallOperationKind {
        InstallOperationKind(rawValue: operation ?? "") ?? .install
    }
}

struct InstallJobVersionFingerprint: Equatable, Hashable {
    let jobId: String
    let value: String

    init?(jobId: String, revision: Int, updatedAt: String) {
        guard revision >= 0,
              revision <= 9_007_199_254_740_991,
              !updatedAt.isEmpty
        else {
            return nil
        }
        self.jobId = jobId
        value = "revision:\(revision)|updated:\(updatedAt)"
    }

    init(job: InstallJobDetailDTO) {
        if let revision = job.revision,
           let durable = InstallJobVersionFingerprint(
               jobId: job.id,
               revision: revision,
               updatedAt: job.updatedAt
           ) {
            self = durable
            return
        }

        jobId = job.id
        let stepValues = job.steps.map {
            [$0.name, $0.status, $0.startedAt ?? "", $0.completedAt ?? ""]
                .map(Self.escape)
                .joined(separator: ",")
        }
        value = [
            job.title,
            job.detail,
            job.operation ?? "",
            job.status,
            job.outcome ?? "",
            job.outcomeReason ?? "",
            job.currentStep ?? "",
            job.createdAt,
            job.updatedAt,
            job.eligibleCommands.sorted().joined(separator: ","),
            stepValues.joined(separator: ";"),
        ]
        .map(Self.escape)
        .joined(separator: "|")
    }

    private static func escape(_ value: String) -> String {
        "\(value.utf8.count):\(value)"
    }
}

enum ActivityMutationDisposition: Equatable {
    case submitting
    case accepted
    case outcomeUnknown
}

struct ActivityMutationSuspension: Equatable {
    let fingerprint: InstallJobVersionFingerprint
    let disposition: ActivityMutationDisposition
}

enum ActivityAuthorityReadPurpose: Equatable {
    case background
    case receiptSelection
    case invalidation
}

struct ActivityAuthorityReadToken: Equatable {
    let jobId: String
    let generation: UInt64
    let purpose: ActivityAuthorityReadPurpose
}

enum ActivityReceiptAuthorityState: Equatable {
    case current
    case checking
    case commandSubmitting
    case commandAccepted
    case commandOutcomeUnknown
    case lastKnown

    var label: String {
        switch self {
        case .current: return "Current"
        case .checking: return "Checking"
        case .commandSubmitting: return "Sending command"
        case .commandAccepted: return "Command accepted"
        case .commandOutcomeUnknown: return "Outcome unknown"
        case .lastKnown: return "Last known"
        }
    }
}

enum InstallJobSnapshotOrdering {
    static func shouldAccept(
        current: InstallJobDetailDTO?,
        incoming: InstallJobDetailDTO
    ) -> Bool {
        guard let current else {
            return true
        }
        guard current.id == incoming.id else {
            return incoming.createdAt > current.createdAt
        }
        if isTerminal(current.status), !isTerminal(incoming.status) {
            return false
        }

        let currentRevision = validRevision(current.revision)
        let incomingRevision = validRevision(incoming.revision)
        if incomingRevision != nil, currentRevision == nil {
            return true
        }
        if incomingRevision == nil, currentRevision != nil {
            return false
        }
        if let currentRevision, let incomingRevision {
            if incomingRevision < currentRevision {
                return false
            }
            if incomingRevision > currentRevision {
                return true
            }
        }
        if incoming.updatedAt < current.updatedAt {
            return false
        }
        if incoming.updatedAt == current.updatedAt {
            return !isTerminal(current.status) && isTerminal(incoming.status)
        }
        return true
    }

    static func newest(in jobs: [InstallJobDetailDTO]) -> InstallJobDetailDTO? {
        jobs.reduce(nil) { current, candidate in
            guard let current else {
                return candidate
            }
            if current.id == candidate.id {
                return shouldAccept(current: current, incoming: candidate) ? candidate : current
            }
            if candidate.createdAt != current.createdAt {
                return candidate.createdAt > current.createdAt ? candidate : current
            }
            if candidate.updatedAt != current.updatedAt {
                return candidate.updatedAt > current.updatedAt ? candidate : current
            }
            return candidate.id > current.id ? candidate : current
        }
    }

    static func isTerminal(_ status: String) -> Bool {
        status == "completed" || status == "failed"
    }

    private static func validRevision(_ revision: Int?) -> Int? {
        guard let revision,
              revision >= 0,
              revision <= 9_007_199_254_740_991
        else {
            return nil
        }
        return revision
    }
}

struct OperationActivityProjection {
    let attention: [InstallJobDetailDTO]
    let active: [InstallJobDetailDTO]
    let recent: [InstallJobDetailDTO]
    let needsReview: [InstallJobDetailDTO]

    var isEmpty: Bool {
        attention.isEmpty && active.isEmpty && recent.isEmpty && needsReview.isEmpty
    }

    static func make(from jobs: [InstallJobDetailDTO]) -> OperationActivityProjection {
        let attention = jobs
            .filter { $0.status == "waiting_2fa" || $0.status == "failed" }
            .sorted(by: attentionOrder)
        let active = jobs
            .filter { $0.status == "queued" || $0.status == "running" }
            .sorted(by: receiptOrder)
        let recent = jobs
            .filter { $0.status == "completed" }
            .sorted(by: receiptOrder)
        let recognizedStatuses: Set<String> = [
            "waiting_2fa",
            "failed",
            "queued",
            "running",
            "completed",
        ]
        let needsReview = jobs
            .filter { !recognizedStatuses.contains($0.status) }
            .sorted(by: receiptOrder)

        return OperationActivityProjection(
            attention: attention,
            active: active,
            recent: recent,
            needsReview: needsReview
        )
    }

    private static func attentionOrder(
        _ lhs: InstallJobDetailDTO,
        _ rhs: InstallJobDetailDTO
    ) -> Bool {
        let lhsRank = lhs.status == "waiting_2fa" ? 0 : 1
        let rhsRank = rhs.status == "waiting_2fa" ? 0 : 1
        if lhsRank != rhsRank {
            return lhsRank < rhsRank
        }
        return receiptOrder(lhs, rhs)
    }

    private static func receiptOrder(
        _ lhs: InstallJobDetailDTO,
        _ rhs: InstallJobDetailDTO
    ) -> Bool {
        if lhs.updatedAt != rhs.updatedAt {
            return lhs.updatedAt > rhs.updatedAt
        }
        if lhs.revision != rhs.revision {
            return (lhs.revision ?? -1) > (rhs.revision ?? -1)
        }
        return lhs.id > rhs.id
    }
}

extension InstallJobRevisionCollection {
    static func boundedMerging(
        current: [String: InstallJobDetailDTO],
        incoming: [InstallJobDetailDTO],
        limit: Int
    ) -> [String: InstallJobDetailDTO] {
        guard limit > 0 else { return [:] }
        let merged = merging(current: current, incoming: incoming)
        let retained = merged.values.sorted(by: operationReceiptOrder).prefix(limit)
        return Dictionary(uniqueKeysWithValues: retained.map { ($0.id, $0) })
    }

    private static func operationReceiptOrder(
        _ lhs: InstallJobDetailDTO,
        _ rhs: InstallJobDetailDTO
    ) -> Bool {
        let lhsRank = retentionRank(for: lhs.status)
        let rhsRank = retentionRank(for: rhs.status)
        if lhsRank != rhsRank {
            return lhsRank < rhsRank
        }
        if lhs.updatedAt != rhs.updatedAt {
            return lhs.updatedAt > rhs.updatedAt
        }
        if lhs.revision != rhs.revision {
            return (lhs.revision ?? -1) > (rhs.revision ?? -1)
        }
        if lhs.createdAt != rhs.createdAt {
            return lhs.createdAt > rhs.createdAt
        }
        return lhs.id > rhs.id
    }

    private static func retentionRank(for status: String) -> Int {
        switch status {
        case "waiting_2fa": return 0
        case "running": return 1
        case "queued": return 2
        case "failed": return 3
        case "completed": return 5
        default: return 4
        }
    }
}

struct InstallJobLogDTO: Decodable, Identifiable {
    let id: String
    let jobId: String
    let sequence: Int?
    let step: String?
    let level: String
    let message: String
    let at: String
}

enum InstallJobLogOrdering {
    static func merge(
        persisted: [InstallJobLogDTO],
        live: [InstallJobLogDTO],
        jobId: String,
        limit: Int
    ) -> [InstallJobLogDTO] {
        var byId: [String: InstallJobLogDTO] = [:]
        for entry in persisted where entry.jobId == jobId {
            byId[entry.id] = entry
        }
        for entry in live where entry.jobId == jobId {
            byId[entry.id] = entry
        }

        let ordered = byId.values.sorted {
            if let left = $0.sequence, let right = $1.sequence, left != right {
                return left < right
            }
            return $0.at == $1.at ? $0.id < $1.id : $0.at < $1.at
        }
        return Array(ordered.suffix(max(0, limit)))
    }
}
