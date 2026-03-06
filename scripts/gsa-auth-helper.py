#!/usr/bin/env python3
"""
Apple Grand Slam Authentication (GSA) helper for Sidelink.

Performs Apple GSA SRP-6a authentication using the proven Python `srp`
library. Called from Node.js TypeScript code.

Based on the working implementation from:
  github.com/nythepegasus/grandslam (forked from JJTech0130/grandslam)

Usage:
  echo '{"command":"auth","username":"...","password":"...","anisette":{...}}' | python3 scripts/gsa-auth-helper.py
  echo '{"command":"2fa_validate","adsid":"...","idms_token":"...","code":"123456","anisette":{...}}' | python3 scripts/gsa-auth-helper.py
  echo '{"command":"app_tokens","adsid":"...","idms_token":"...","sk":"(base64)","c":"(base64)","anisette":{...}}' | python3 scripts/gsa-auth-helper.py

Input:  JSON on stdin
Output: JSON on stdout
"""

import json
import sys
import hashlib
import hmac as hmac_mod
import uuid
import plistlib as plist
from base64 import b64encode, b64decode
from datetime import datetime, timezone

import requests
import srp._pysrp as srp
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives import padding

# Use the OS trust store so Apple Root CA is trusted on macOS
try:
    import truststore
    truststore.inject_into_ssl()
except ImportError:
    pass  # Fall back to default certifi/openssl certs

# Apple's GSA endpoints use standard publicly-trusted certificates.
# No need to disable certificate verification.

# ─── Configure SRP library for Apple compatibility ───────────────────
srp.rfc5054_enable()
srp.no_username_in_x()

# ─── Constants ───────────────────────────────────────────────────────
GSA_ENDPOINT = "https://gsa.apple.com/grandslam/GsService2"
GSA_VERIFY_TRUSTED = "https://gsa.apple.com/auth/verify/trusteddevice"
GSA_VALIDATE = "https://gsa.apple.com/grandslam/GsService2/validate"
GSA_VERIFY_PHONE = "https://gsa.apple.com/auth/verify/phone/"
GSA_VERIFY_PHONE_CODE = "https://gsa.apple.com/auth/verify/phone/securitycode"

PLIST_HEADER = b"""\
<?xml version='1.0' encoding='UTF-8'?>
<!DOCTYPE plist PUBLIC '-//Apple//DTD PLIST 1.0//EN' 'http://www.apple.com/DTDs/PropertyList-1.0.dtd'>
"""


# ─── Anisette / CPD Helpers ─────────────────────────────────────────

def build_cpd(anisette: dict) -> dict:
    """Build client provisioning data from anisette headers."""
    cpd = {
        "bootstrap": True,
        "icscrec": True,
        "pbe": False,
        "prkgen": True,
        "svct": "iCloud",
    }
    # Copy anisette headers into CPD
    for key in [
        "X-Apple-I-Client-Time", "X-Apple-I-TimeZone", "X-Apple-Locale",
        "X-Apple-I-Locale", "X-Apple-I-MD", "X-Apple-I-MD-LU",
        "X-Apple-I-MD-M", "X-Apple-I-MD-RINFO", "X-Mme-Device-Id",
        "X-Apple-I-SRL-NO",
    ]:
        if key in anisette:
            val = anisette[key]
            # RINFO should be an integer in CPD
            if key == "X-Apple-I-MD-RINFO":
                try:
                    val = int(val)
                except (ValueError, TypeError):
                    val = 17106176
            cpd[key] = val

    # Ensure locale is set
    if "loc" not in cpd:
        cpd["loc"] = anisette.get("X-Apple-Locale", anisette.get("X-Apple-I-Locale", "en_US"))

    # Ensure serial number
    if "X-Apple-I-SRL-NO" not in cpd:
        cpd["X-Apple-I-SRL-NO"] = "0"

    return cpd


def get_client_info(anisette: dict) -> str:
    """Get X-MMe-Client-Info from anisette data."""
    return anisette.get(
        "X-MMe-Client-Info",
        "<iMac20,2> <Mac OS X;13.0;22A380> <com.apple.AuthKit/1 (com.apple.dt.Xcode/3594.4.19)>"
    )


# ─── GSA Request ─────────────────────────────────────────────────────

def gsa_request(parameters: dict, anisette: dict) -> dict:
    """Send a GSA request in plist format and return the Response dict."""
    body = {
        "Header": {"Version": "1.0.1"},
        "Request": {
            "cpd": build_cpd(anisette),
        },
    }
    body["Request"].update(parameters)

    headers = {
        "Content-Type": "text/x-xml-plist",
        "Accept": "*/*",
        "User-Agent": "akd/1.0 CFNetwork/978.0.7 Darwin/18.7.0",
        "X-MMe-Client-Info": get_client_info(anisette),
    }

    resp = requests.post(
        GSA_ENDPOINT,
        headers=headers,
        data=plist.dumps(body),
        timeout=30,
    )

    parsed = plist.loads(resp.content)
    return parsed["Response"]


# ─── Password Encryption ────────────────────────────────────────────

def encrypt_password(password: str, salt: bytes, iterations: int, protocol: str = "s2k") -> bytes:
    """
    Derive password key using Apple's PBKDF2 variant.
    - s2k:    PBKDF2(SHA256(password_raw), salt, iterations, 32)
    - s2k_fo: PBKDF2(hex(SHA256(password_raw)), salt, iterations, 32)
    """
    p = hashlib.sha256(password.encode("utf-8")).digest()
    if protocol == "s2k_fo":
        # For s2k_fo, use the hex encoding of the hash
        p = hashlib.sha256(password.encode("utf-8")).hexdigest().encode("ascii")
    return hashlib.pbkdf2_hmac("sha256", p, salt, iterations, dklen=32)


# ─── Session Key / Decryption ───────────────────────────────────────

def create_session_key(session_key: bytes, name: str) -> bytes:
    """Derive a named key from the SRP session key using HMAC-SHA256."""
    return hmac_mod.new(session_key, name.encode(), hashlib.sha256).digest()


def decrypt_cbc(session_key: bytes, data: bytes) -> bytes:
    """Decrypt SPD using AES-256-CBC with session-derived key/IV."""
    extra_data_key = create_session_key(session_key, "extra data key:")
    extra_data_iv = create_session_key(session_key, "extra data iv:")[:16]

    cipher = Cipher(algorithms.AES(extra_data_key), modes.CBC(extra_data_iv))
    decryptor = cipher.decryptor()
    data = decryptor.update(data) + decryptor.finalize()

    # Remove PKCS#7 padding
    padder = padding.PKCS7(128).unpadder()
    return padder.update(data) + padder.finalize()


def decrypt_gcm(sk: bytes, data: bytes) -> bytes:
    """
    Decrypt app token data using AES-256-GCM.
    Format: header(3) + IV(16) + ciphertext + tag(16)
    """
    if len(data) < 35:
        raise ValueError("Encrypted token data too short")

    header = data[:3]  # "XYZ"
    iv = data[3:19]
    tag = data[-16:]
    ciphertext = data[19:-16]

    cipher = Cipher(algorithms.AES(sk), modes.GCM(iv, tag))
    decryptor = cipher.decryptor()
    decryptor.authenticate_additional_data(header)
    return decryptor.update(ciphertext) + decryptor.finalize()


# ─── Main Auth Flow ─────────────────────────────────────────────────

def authenticate(username: str, password: str, anisette: dict) -> dict:
    """
    Perform full GSA SRP-6a authentication.
    Returns dict with: adsid, idms_token, sk (base64), c (base64), auth_type
    """
    # Create SRP user - password is set later after we get the salt
    usr = srp.User(username, bytes(), hash_alg=srp.SHA256, ng_type=srp.NG_2048)
    _, A = usr.start_authentication()

    # ── Step 1: SRP Init ──────────────────────────────────────────
    r = gsa_request(
        {
            "A2k": A,
            "ps": ["s2k", "s2k_fo"],
            "u": username,
            "o": "init",
        },
        anisette,
    )

    # Check for error
    if "Status" in r:
        status = r["Status"]
        ec = status.get("ec", 0)
        if ec != 0:
            em = status.get("em", "Unknown error")
            return {"error": True, "error_code": ec, "error_message": str(em)}

    protocol = r.get("sp", "s2k")
    salt = r["s"]
    iterations = r["i"]
    B = r["B"]

    # ── Step 2: Compute password and SRP proof ────────────────────
    # Set the password on the SRP user (Apple-specific PBKDF2 derivation)
    usr.p = encrypt_password(password, salt, iterations, protocol)

    # Process the server's challenge to get our proof M1
    M = usr.process_challenge(salt, B)
    if M is None:
        return {"error": True, "error_code": -1, "error_message": "Failed to process SRP challenge"}

    # ── Step 3: SRP Complete ──────────────────────────────────────
    r = gsa_request(
        {
            "c": r["c"],
            "M1": M,
            "u": username,
            "o": "complete",
        },
        anisette,
    )

    # Check for error
    if "Status" in r:
        status = r["Status"]
        ec = status.get("ec", 0)
        if ec != 0:
            em = status.get("em", "Unknown error")
            return {"error": True, "error_code": ec, "error_message": str(em)}

    # Verify server's proof
    usr.verify_session(r["M2"])
    if not usr.authenticated():
        return {"error": True, "error_code": -2, "error_message": "Server proof verification failed"}

    # ── Step 4: Decrypt SPD ───────────────────────────────────────
    session_key = usr.get_session_key()
    spd_data = decrypt_cbc(session_key, r["spd"])
    spd = plist.loads(PLIST_HEADER + spd_data)

    adsid = spd.get("adsid", "")
    idms_token = spd.get("GsIdmsToken", "")
    sk = spd.get("sk")
    c = spd.get("c")

    # Check auth type
    auth_type = ""
    if "Status" in r and "au" in r["Status"]:
        auth_type = r["Status"]["au"]

    result = {
        "error": False,
        "adsid": adsid,
        "idms_token": idms_token,
        "auth_type": auth_type,
    }

    # Include sk and c as base64 if present
    if sk is not None:
        result["sk"] = b64encode(bytes(sk)).decode("ascii")
    if c is not None:
        result["c"] = b64encode(bytes(c)).decode("ascii")

    return result


# ─── 2FA Functions ───────────────────────────────────────────────────

def build_2fa_headers(identity_token: str, anisette: dict) -> dict:
    """Build headers for 2FA requests."""
    return {
        "Content-Type": "text/x-xml-plist",
        "User-Agent": "Xcode",
        "Accept": "text/x-xml-plist",
        "Accept-Language": "en-us",
        "X-Apple-App-Info": "com.apple.gs.xcode.auth",
        "X-Xcode-Version": "15.2 (15C500b)",
        "X-Apple-Identity-Token": identity_token,
        "X-Apple-I-MD-M": anisette.get("X-Apple-I-MD-M", ""),
        "X-Apple-I-MD": anisette.get("X-Apple-I-MD", ""),
        "X-Apple-I-MD-LU": anisette.get("X-Apple-I-MD-LU", ""),
        "X-Apple-I-MD-RINFO": anisette.get("X-Apple-I-MD-RINFO", "17106176"),
        "X-Mme-Device-Id": anisette.get("X-Mme-Device-Id", ""),
        "X-MMe-Client-Info": get_client_info(anisette),
        "X-Apple-I-Client-Time": anisette.get("X-Apple-I-Client-Time", ""),
        "X-Apple-Locale": anisette.get("X-Apple-Locale", "en_US"),
        "X-Apple-I-TimeZone": anisette.get("X-Apple-I-TimeZone", "UTC"),
    }


def trigger_2fa_push(adsid: str, idms_token: str, anisette: dict) -> dict:
    """Trigger 2FA push notification to trusted devices."""
    identity_token = b64encode(f"{adsid}:{idms_token}".encode()).decode()
    headers = build_2fa_headers(identity_token, anisette)

    try:
        requests.get(GSA_VERIFY_TRUSTED, headers=headers, timeout=10)
        return {"error": False, "triggered": True}
    except Exception as e:
        return {"error": False, "triggered": False, "warning": str(e)}


def validate_2fa_code(adsid: str, idms_token: str, code: str, anisette: dict) -> dict:
    """Validate a 2FA code with Apple."""
    identity_token = b64encode(f"{adsid}:{idms_token}".encode()).decode()
    headers = build_2fa_headers(identity_token, anisette)
    headers["security-code"] = code

    resp = requests.get(GSA_VALIDATE, headers=headers, timeout=10)

    try:
        r = plist.loads(resp.content)
        ec = r.get("ec", 0)
        if ec != 0:
            em = r.get("em", "Unknown error")
            return {"error": True, "error_code": ec, "error_message": str(em)}
    except Exception:
        if not resp.ok:
            return {"error": True, "error_code": resp.status_code, "error_message": f"HTTP {resp.status_code}"}

    return {"error": False, "validated": True}


def fetch_app_tokens(adsid: str, idms_token: str, sk_b64: str, c_b64: str, anisette: dict) -> dict:
    """Fetch and decrypt app tokens."""
    sk = b64decode(sk_b64)
    c = b64decode(c_b64)

    apps = ["com.apple.gs.xcode.auth"]

    # Compute checksum: HMAC-SHA256(sk, "apptokens" + adsid + app1 + ...)
    h = hmac_mod.new(sk, digestmod=hashlib.sha256)
    h.update(b"apptokens")
    h.update(adsid.encode("utf-8"))
    for app in apps:
        h.update(app.encode("utf-8"))
    checksum = h.digest()

    r = gsa_request(
        {
            "u": adsid,
            "app": apps,
            "c": c,
            "t": idms_token,
            "checksum": checksum,
            "o": "apptokens",
        },
        anisette,
    )

    if "Status" in r:
        status = r["Status"]
        ec = status.get("ec", 0)
        if ec != 0:
            em = status.get("em", "Unknown error")
            return {"error": True, "error_code": ec, "error_message": str(em)}

    encrypted_token = r.get("et")
    if not encrypted_token:
        return {"error": True, "error_code": -3, "error_message": "No encrypted token in response"}

    try:
        decrypted = decrypt_gcm(sk, bytes(encrypted_token))
        # plistlib needs XML header if the decrypted data doesn't have one
        if not decrypted.startswith(b"<?xml"):
            decrypted = PLIST_HEADER + decrypted
        token_plist = plist.loads(decrypted)
        tokens = token_plist.get("t", {})
        xcode_auth = tokens.get("com.apple.gs.xcode.auth", {})
        token = xcode_auth.get("token", "")
        if not token:
            # Log full structure for debugging
            import sys
            print(f"DEBUG: token_plist keys={list(token_plist.keys())}", file=sys.stderr)
            print(f"DEBUG: tokens keys={list(tokens.keys())}", file=sys.stderr)
            for k, v in tokens.items():
                print(f"DEBUG: tokens[{k}] keys={list(v.keys()) if isinstance(v, dict) else type(v)}", file=sys.stderr)
            return {"error": True, "error_code": -4, "error_message": f"No Xcode auth token in decrypted data. Available apps: {list(tokens.keys())}"}
        return {"error": False, "token": token}
    except Exception as e:
        # Include raw decrypted hex for debugging
        import traceback, sys
        traceback.print_exc(file=sys.stderr)
        return {"error": True, "error_code": -5, "error_message": f"Token decryption failed: {str(e)}"}


# ─── Request SMS 2FA ─────────────────────────────────────────────────

def request_sms_2fa(adsid: str, idms_token: str, phone_id: int, anisette: dict) -> dict:
    """Request SMS 2FA code to be sent."""
    identity_token = b64encode(f"{adsid}:{idms_token}".encode()).decode()
    headers = build_2fa_headers(identity_token, anisette)
    # SMS requests use JSON content type
    headers["Content-Type"] = "application/json"

    body = {"phoneNumber": {"id": phone_id}, "mode": "sms"}

    try:
        resp = requests.put(GSA_VERIFY_PHONE, json=body, headers=headers, timeout=10)
        if resp.ok:
            return {"error": False, "sent": True}
        else:
            return {"error": True, "error_code": resp.status_code, "error_message": f"HTTP {resp.status_code}"}
    except Exception as e:
        return {"error": True, "error_code": -6, "error_message": str(e)}


# ─── Main Entry Point ───────────────────────────────────────────────

def main():
    try:
        raw = sys.stdin.read()
        req = json.loads(raw)
    except (json.JSONDecodeError, Exception) as e:
        print(json.dumps({"error": True, "error_code": -100, "error_message": f"Invalid JSON input: {str(e)}"}))
        sys.exit(1)

    command = req.get("command", "")
    anisette = req.get("anisette", {})

    try:
        if command == "auth":
            result = authenticate(req["username"], req["password"], anisette)
        elif command == "2fa_trigger":
            result = trigger_2fa_push(req["adsid"], req["idms_token"], anisette)
        elif command == "2fa_validate":
            result = validate_2fa_code(req["adsid"], req["idms_token"], req["code"], anisette)
        elif command == "app_tokens":
            result = fetch_app_tokens(req["adsid"], req["idms_token"], req["sk"], req["c"], anisette)
        elif command == "sms_2fa":
            result = request_sms_2fa(req["adsid"], req["idms_token"], req.get("phone_id", 1), anisette)
        else:
            result = {"error": True, "error_code": -101, "error_message": f"Unknown command: {command}"}
    except Exception as e:
        result = {"error": True, "error_code": -999, "error_message": str(e)}

    print(json.dumps(result))


if __name__ == "__main__":
    main()
