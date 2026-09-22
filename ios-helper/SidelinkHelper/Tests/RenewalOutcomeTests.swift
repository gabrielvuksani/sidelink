import XCTest
@testable import SidelinkHelper

final class RenewalOutcomeTests: XCTestCase {
    func testRefreshReceiptPreservesNoOpReason() throws {
        let data = Data(#"{"id":"job","operation":"refresh","status":"completed","outcome":"not_needed","outcomeReason":"deactivated"}"#.utf8)
        let job = try JSONDecoder().decode(InstallJobDTO.self, from: data)
        XCTAssertEqual(job.outcome, "not_needed")
        XCTAssertEqual(job.outcomeReason, "deactivated")
    }

    func testLegacyReceiptStillDecodes() throws {
        let data = Data(#"{"id":"job","status":"completed"}"#.utf8)
        let job = try JSONDecoder().decode(InstallJobDTO.self, from: data)
        XCTAssertNil(job.outcome)
    }

    func testDetailedRepairReceiptKeepsItsOperationAndOutcome() throws {
        let data = Data(#"{"id":"job","title":"App","detail":"Repair","operation":"repair","status":"completed","steps":[],"revision":2,"createdAt":"2026-09-22T12:00:00Z","updatedAt":"2026-09-22T12:01:00Z","eligibleCommands":[],"outcome":"renewed"}"#.utf8)
        let job = try JSONDecoder().decode(InstallJobDetailDTO.self, from: data)
        XCTAssertEqual(job.operationKind, .repair)
        XCTAssertEqual(job.outcome, "renewed")
    }
}
