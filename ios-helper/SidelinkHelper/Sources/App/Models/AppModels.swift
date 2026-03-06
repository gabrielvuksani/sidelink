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
}

struct HelperPairingPayload: Decodable {
	let code: String
	let backendUrl: String
	let serverName: String?
}

struct SourceCatalog: Identifiable {
	let sourceURL: String
	let manifest: SourceManifestDTO

	var id: String { sourceURL }
}
