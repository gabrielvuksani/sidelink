import Foundation
import SwiftUI

// MARK: - Apple Account Authentication

extension HelperViewModel {

    func signInAppleAccount(appleId: String, password: String) async {
        guard let identity = currentPairingIdentity() else {
            errorMessage = "Pair with a SideLink server before adding an Apple ID"
            return
        }

        let normalizedAppleId = appleId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedAppleId.isEmpty, !password.isEmpty else {
            errorMessage = "Apple ID and password are required"
            return
        }
        guard await requireCurrentHostAuthority(for: "add Apple IDs", identity: identity) != nil else { return }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            let response = try await api.signInAppleAccount(
                baseURL: identity.baseURL,
                token: identity.token,
                appleId: normalizedAppleId,
                password: password
            )
            guard isCurrentPairingIdentity(identity) else { return }

            if response.requires2FA == true {
                pendingAppleAuth = PendingAppleAuthContext(
                    mode: .signIn,
                    appleId: normalizedAppleId,
                    password: password,
                    accountId: nil,
                    authType: response.authType,
                    trustedPhoneNumbers: response.trustedPhoneNumbers ?? []
                )
                pendingAppleAuthIdentity = identity
                toastMessage = "Enter the 6-digit verification code to finish adding this Apple ID"
                return
            }

            guard let account = response.account else {
                errorMessage = "Apple sign-in returned an unexpected response"
                return
            }

            pendingAppleAuth = nil
            pendingAppleAuthIdentity = nil
            if primarySigningAccountId.isEmpty {
                setPrimarySigningAccount(account.id, showConfirmation: false)
                toastMessage = "Apple ID added and set as your primary signing identity"
            } else {
                toastMessage = "Apple ID added. Your primary signing identity stayed the same"
            }
            await refreshAll(pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            errorMessage = error.localizedDescription
        }
    }

    func reauthenticateAppleAccount(accountId: String) async {
        guard let identity = currentPairingIdentity() else {
            _ = requirePairing(for: "re-authenticate Apple IDs")
            return
        }
        guard await requireCurrentHostAuthority(for: "re-authenticate Apple IDs", identity: identity) != nil else { return }
        guard let account = accounts.first(where: { $0.id == accountId }) else {
            errorMessage = "Apple account not found"
            return
        }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            let response = try await api.reauthenticateAppleAccount(
                baseURL: identity.baseURL,
                token: identity.token,
                accountId: accountId
            )
            guard isCurrentPairingIdentity(identity) else { return }

            if response.requires2FA == true {
                pendingAppleAuth = PendingAppleAuthContext(
                    mode: .reauth,
                    appleId: account.appleId,
                    password: "",
                    accountId: accountId,
                    authType: response.authType,
                    trustedPhoneNumbers: response.trustedPhoneNumbers ?? []
                )
                pendingAppleAuthIdentity = identity
                toastMessage = "Enter the 6-digit verification code to re-authenticate \(account.appleId)"
                return
            }

            pendingAppleAuth = nil
            pendingAppleAuthIdentity = nil
            if primarySigningAccountId.isEmpty {
                setPrimarySigningAccount(accountId, showConfirmation: false)
                toastMessage = "Apple ID re-authenticated and set as your primary signing identity"
            } else {
                toastMessage = "Apple ID re-authenticated"
            }
            await refreshAll(pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            errorMessage = error.localizedDescription
        }
    }

    func submitPendingAppleAccount2FA(code: String) async {
        guard let pendingAppleAuth,
              let identity = pendingAppleAuthIdentity,
              isCurrentPairingIdentity(identity)
        else {
            self.pendingAppleAuth = nil
            pendingAppleAuthIdentity = nil
            errorMessage = "No Apple ID verification is pending"
            return
        }
        guard await requireCurrentHostAuthority(for: "verify Apple IDs", identity: identity) != nil,
              isCurrentPairingIdentity(identity)
        else { return }

        errorMessage = nil

        let trimmedCode = code.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmedCode.count == 6, trimmedCode.allSatisfy(\.isNumber) else {
            errorMessage = "Enter the 6-digit verification code"
            return
        }

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            let account: AccountDTO
            switch pendingAppleAuth.mode {
            case .signIn:
                account = try await api.submitAppleAccount2FA(
                    baseURL: identity.baseURL,
                    token: identity.token,
                    appleId: pendingAppleAuth.appleId,
                    password: pendingAppleAuth.password,
                    code: trimmedCode
                )
            case .reauth:
                guard let accountId = pendingAppleAuth.accountId else {
                    errorMessage = "Missing Apple account ID for verification"
                    return
                }
                account = try await api.submitAppleAccountReauth2FA(
                    baseURL: identity.baseURL,
                    token: identity.token,
                    accountId: accountId,
                    code: trimmedCode
                )
            }
            guard isCurrentPairingIdentity(identity),
                  pendingAppleAuthIdentity == identity
            else { return }

            self.pendingAppleAuth = nil
            pendingAppleAuthIdentity = nil
            if primarySigningAccountId.isEmpty {
                setPrimarySigningAccount(account.id, showConfirmation: false)
                toastMessage = "Apple ID verified and set as your primary signing identity"
            } else {
                toastMessage = "Apple ID verified successfully"
            }
            await refreshAll(pairingIdentity: identity)
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            errorMessage = error.localizedDescription
        }
    }

    func deleteAppleAccount(_ accountId: String) async {
        guard let identity = currentPairingIdentity() else {
            _ = requirePairing(for: "remove Apple IDs")
            return
        }
        guard await requireCurrentHostAuthority(for: "remove Apple IDs", identity: identity) != nil else { return }

        errorMessage = nil

        isLoading = true
        defer {
            if isCurrentPairingIdentity(identity) {
                isLoading = false
            }
        }

        do {
            let removedPrimarySigningIdentity = primarySigningAccountId == accountId
            try await api.deleteAppleAccount(
                baseURL: identity.baseURL,
                token: identity.token,
                accountId: accountId
            )
            guard isCurrentPairingIdentity(identity) else { return }
            if removedPrimarySigningIdentity {
                primarySigningAccountId = ""
            }
            if selectedAccountId == accountId {
                selectedAccountId = ""
            }
            pendingAppleAuth = nil
            pendingAppleAuthIdentity = nil
            await refreshAll(pairingIdentity: identity)
            guard isCurrentPairingIdentity(identity) else { return }
            if removedPrimarySigningIdentity {
                if let fallback = primaryActiveSigningAccount {
                    toastMessage = "Primary signing identity removed. SideLink switched to \(fallback.appleId)"
                } else {
                    toastMessage = "Primary signing identity removed"
                }
            } else {
                toastMessage = "Apple ID removed"
            }
        } catch {
            guard isCurrentPairingIdentity(identity) else { return }
            errorMessage = error.localizedDescription
        }
    }
}
