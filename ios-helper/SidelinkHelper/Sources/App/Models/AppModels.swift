import Foundation

struct DiscoveredBackend: Identifiable, Equatable {
	let id: String
	var name: String
	var url: String
	var lastSeenAt: Date
}

enum PendingAppleAuthMode {
	case signIn
	case reauth
}

struct PendingAppleAuthContext {
	let mode: PendingAppleAuthMode
	let appleId: String
	let password: String
	let accountId: String?
	let authType: String?
	let trustedPhoneNumbers: [AppleTrustedPhoneNumberDTO]
}

struct HelperPairingPayload: Decodable {
	let code: String
	let backendUrl: String
	let apiBasePath: String?
	let serverName: String?
	let serverVersion: String?
}

struct SourceCatalog: Identifiable {
	let sourceId: String?
	let sourceURL: String
	let manifest: SourceManifestDTO
	let isBuiltIn: Bool

	var id: String { sourceId ?? sourceURL }
}
