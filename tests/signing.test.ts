// Signing Engine Unit Tests
import { describe, it, expect } from "vitest";
import crypto from "node:crypto";

describe("Signing Strategy Selection", () => {
  it("auto selects native on macOS when codesign exists", async () => {
    const { resolveSigningStrategy } = await import("../src/server/signing");
    const result = await resolveSigningStrategy({
      strategy: "auto",
      platform: "darwin",
      hasCodesign: async () => true,
    });
    expect(result).toBe("native");
  });

  it("auto selects typescript when codesign is unavailable", async () => {
    const { resolveSigningStrategy } = await import("../src/server/signing");
    const result = await resolveSigningStrategy({
      strategy: "auto",
      platform: "darwin",
      hasCodesign: async () => false,
    });
    expect(result).toBe("typescript");
  });

  it("auto selects typescript on non-macOS", async () => {
    const { resolveSigningStrategy } = await import("../src/server/signing");
    const result = await resolveSigningStrategy({
      strategy: "auto",
      platform: "linux",
      hasCodesign: async () => true,
    });
    expect(result).toBe("typescript");
  });

  it("auto selects typescript on Windows", async () => {
    const { resolveSigningStrategy } = await import("../src/server/signing");
    const result = await resolveSigningStrategy({
      strategy: "auto",
      platform: "win32",
      hasCodesign: async () => true,
    });
    expect(result).toBe("typescript");
  });

  it("native strategy throws on non-macOS", async () => {
    const { resolveSigningStrategy } = await import("../src/server/signing");
    await expect(
      resolveSigningStrategy({
        strategy: "native",
        platform: "linux",
        hasCodesign: async () => true,
      }),
    ).rejects.toThrow(/requires macOS/i);
  });
});

describe("Signing Constants and Utils", () => {
  it("STRIP_ENTITLEMENT arrays are non-empty", async () => {
    const { STRIP_ENTITLEMENT_PREFIXES, STRIP_ENTITLEMENT_KEYS } = await import("../src/server/signing/signing-utils");
    expect(STRIP_ENTITLEMENT_PREFIXES.length).toBeGreaterThan(0);
    expect(STRIP_ENTITLEMENT_KEYS.length).toBeGreaterThan(0);
  });

  it("buildSigningEntitlements filters dangerous keys", async () => {
    const { buildSigningEntitlements } = await import("../src/server/signing/signing-utils");
    const profile = {
      "com.apple.private.skip-library-validation": true,
      "com.apple.security.application-groups": ["group.x"],
      "beta-reports-active": true,
      "aps-environment": "development",
    };
    const result = buildSigningEntitlements(profile, "TEAM123", "com.test.app");
    expect(result["application-identifier"]).toBe("TEAM123.com.test.app");
    expect(result["com.apple.developer.team-identifier"]).toBe("TEAM123");
    expect(result["get-task-allow"]).toBe(true);
    expect(result).not.toHaveProperty("com.apple.private.skip-library-validation");
    expect(result).not.toHaveProperty("com.apple.security.application-groups");
    expect(result).not.toHaveProperty("beta-reports-active");
    expect(result["aps-environment"]).toBe("development");
  });

  it("buildSigningEntitlements applies overrides", async () => {
    const { buildSigningEntitlements } = await import("../src/server/signing/signing-utils");
    const result = buildSigningEntitlements({}, "T", "b", { custom: 42, "get-task-allow": false });
    expect(result.custom).toBe(42);
    expect(result["get-task-allow"]).toBe(false);
  });

  it("buildSigningEntitlements defaults keychain groups", async () => {
    const { buildSigningEntitlements } = await import("../src/server/signing/signing-utils");
    const result = buildSigningEntitlements({}, "T1", "com.x.y");
    expect(result["keychain-access-groups"]).toEqual(["T1.com.x.y"]);
  });
});

describe("Mach-O Parser", () => {
  it("exports expected constants", async () => {
    const m = await import("../src/server/signing/macho");
    expect(m.MH_MAGIC).toBe(0xfeedface);
    expect(m.MH_MAGIC_64).toBe(0xfeedfacf);
    expect(m.FAT_MAGIC).toBe(0xcafebabe);
    expect(m.LC_CODE_SIGNATURE).toBe(0x1d);
    expect(m.CPU_TYPE_ARM64).toBe(0x0100000c);
  });

  it("parseMachO rejects invalid data", async () => {
    const { parseMachO } = await import("../src/server/signing/macho");
    expect(() => parseMachO(Buffer.alloc(2))).toThrow();
    expect(() => parseMachO(crypto.randomBytes(256))).toThrow();
  });

  it("parseMachO parses minimal 64-bit header", async () => {
    const { parseMachO, MH_MAGIC_64 } = await import("../src/server/signing/macho");
    const buf = Buffer.alloc(32);
    buf.writeUInt32LE(MH_MAGIC_64, 0);
    buf.writeUInt32LE(0x0100000c, 4);
    buf.writeUInt32LE(0, 8);
    buf.writeUInt32LE(2, 12);
    buf.writeUInt32LE(0, 16);
    buf.writeUInt32LE(0, 20);
    buf.writeUInt32LE(0, 24);
    buf.writeUInt32LE(0, 28);
    const parsed = parseMachO(buf);
    expect(parsed.isFat).toBe(false);
    expect(parsed.slices).toHaveLength(1);
    expect(parsed.slices[0].header.is64).toBe(true);
    expect(parsed.slices[0].header.ncmds).toBe(0);
  });

  it("getExecutableSize returns slice size", async () => {
    const { parseMachO, getExecutableSize, MH_MAGIC_64 } = await import("../src/server/signing/macho");
    const buf = Buffer.alloc(512);
    buf.writeUInt32LE(MH_MAGIC_64, 0);
    buf.writeUInt32LE(0x0100000c, 4);
    buf.writeUInt32LE(0, 8);
    buf.writeUInt32LE(2, 12);
    buf.writeUInt32LE(0, 16);
    buf.writeUInt32LE(0, 20);
    buf.writeUInt32LE(0, 24);
    buf.writeUInt32LE(0, 28);
    const parsed = parseMachO(buf);
    expect(getExecutableSize(parsed.slices[0])).toBe(512);
  });
});

describe("Code Signature Structures", () => {
  it("exports required constants", async () => {
    const cs = await import("../src/server/signing/codesign-structures");
    expect(cs.CSMAGIC_CODEDIRECTORY).toBe(0xfade0c02);
    expect(cs.CSMAGIC_EMBEDDED_SIGNATURE).toBe(0xfade0cc0);
    expect(cs.CSMAGIC_ENTITLEMENTS).toBe(0xfade7171);
    expect(cs.CS_HASHTYPE_SHA256).toBe(2);
    expect(cs.CS_PAGE_SIZE).toBe(16384);
  });

  it("buildEntitlementsBlob produces valid blob", async () => {
    const { buildEntitlementsBlob, CSMAGIC_ENTITLEMENTS } = await import("../src/server/signing/codesign-structures");
    const xml = "<plist><dict><key>get-task-allow</key><true/></dict></plist>";
    const blob = buildEntitlementsBlob(xml);
    expect(blob.readUInt32BE(0)).toBe(CSMAGIC_ENTITLEMENTS);
    expect(blob.readUInt32BE(4)).toBe(8 + Buffer.byteLength(xml, "utf8"));
    expect(blob.subarray(8).toString("utf8")).toBe(xml);
  });

  it("buildEmptyRequirements is valid", async () => {
    const { buildEmptyRequirements, CSMAGIC_REQUIREMENTS } = await import("../src/server/signing/codesign-structures");
    const blob = buildEmptyRequirements();
    expect(blob.readUInt32BE(0)).toBe(CSMAGIC_REQUIREMENTS);
    expect(blob.readUInt32BE(4)).toBe(12);
    expect(blob.readUInt32BE(8)).toBe(0);
  });

  it("buildSuperBlob wraps sub-blobs", async () => {
    const { buildSuperBlob, buildEmptyRequirements, buildEntitlementsBlob, CSMAGIC_EMBEDDED_SIGNATURE, CSSLOT_REQUIREMENTS, CSSLOT_ENTITLEMENTS } = await import("../src/server/signing/codesign-structures");
    const req = buildEmptyRequirements();
    const ent = buildEntitlementsBlob("<plist/>");
    const blobs = new Map();
    blobs.set(CSSLOT_REQUIREMENTS, req);
    blobs.set(CSSLOT_ENTITLEMENTS, ent);
    const superBlob = buildSuperBlob(blobs);
    expect(superBlob.readUInt32BE(0)).toBe(CSMAGIC_EMBEDDED_SIGNATURE);
    expect(superBlob.readUInt32BE(8)).toBe(2);
    expect(superBlob.length).toBe(12 + 16 + req.length + ent.length);
  });

  it("computeSpecialSlotHash produces correct hash", async () => {
    const { computeSpecialSlotHash, CS_HASHTYPE_SHA1, CS_HASHTYPE_SHA256 } = await import("../src/server/signing/codesign-structures");
    const data = Buffer.from("test data");
    const sha1 = computeSpecialSlotHash(data, CS_HASHTYPE_SHA1);
    expect(sha1.length).toBe(20);
    expect(sha1).toEqual(crypto.createHash("sha1").update(data).digest());
    const sha256 = computeSpecialSlotHash(data, CS_HASHTYPE_SHA256);
    expect(sha256.length).toBe(32);
  });

  it("computeCodeHashes splits into pages", async () => {
    const { computeCodeHashes, CS_PAGE_SIZE, CS_HASHTYPE_SHA256 } = await import("../src/server/signing/codesign-structures");
    const data = Buffer.alloc(CS_PAGE_SIZE * 2 + 100, 0xaa);
    const hashes = computeCodeHashes(data, CS_PAGE_SIZE, CS_HASHTYPE_SHA256);
    expect(hashes).toHaveLength(3);
    for (const h of hashes) expect(h.length).toBe(32);
  });

  it("buildCodeDirectory produces valid blob", async () => {
    const { buildCodeDirectory, CSMAGIC_CODEDIRECTORY, CS_HASHTYPE_SHA256 } = await import("../src/server/signing/codesign-structures");
    const codeHashes = [
      crypto.createHash("sha256").update(Buffer.alloc(4096, 0)).digest(),
      crypto.createHash("sha256").update(Buffer.alloc(4096, 1)).digest(),
    ];
    const specialHashes = new Map();
    specialHashes.set(2, crypto.createHash("sha256").update(Buffer.from("req")).digest());
    const cd = buildCodeDirectory({
      identifier: "com.test.app",
      teamId: "TEAM",
      hashType: CS_HASHTYPE_SHA256,
      codeLimit: 8192,
      pageSize: 4096,
      codeHashes,
      specialHashes,
    });
    expect(cd.readUInt32BE(0)).toBe(CSMAGIC_CODEDIRECTORY);
    expect(cd.readUInt32BE(4)).toBe(cd.length);
  });

  it("hashToHex formats correctly", async () => {
    const { hashToHex } = await import("../src/server/signing/codesign-structures");
    expect(hashToHex(Buffer.from([0xde, 0xad, 0xbe, 0xef]))).toBe("deadbeef");
  });

  // C-01: Verify hashOffset points AFTER special slot hashes
  it("buildCodeDirectory hashOffset accounts for special slots (C-01)", async () => {
    const { buildCodeDirectory, CS_HASHTYPE_SHA256 } = await import("../src/server/signing/codesign-structures");
    const codeHashes = [
      crypto.createHash("sha256").update(Buffer.alloc(4096, 0)).digest(),
    ];
    const specialHashes = new Map<number, Buffer>();
    specialHashes.set(1, crypto.createHash("sha256").update(Buffer.from("info")).digest());
    specialHashes.set(2, crypto.createHash("sha256").update(Buffer.from("req")).digest());
    specialHashes.set(5, crypto.createHash("sha256").update(Buffer.from("ent")).digest());

    const cd = buildCodeDirectory({
      identifier: "com.test.app",
      teamId: "TEAM",
      hashType: CS_HASHTYPE_SHA256,
      codeLimit: 4096,
      pageSize: 4096,
      codeHashes,
      specialHashes,
    });

    // hashOffset is at byte offset 16 in the CodeDirectory
    const hashOffset = cd.readUInt32BE(16);
    // nSpecialSlots is at byte offset 24
    const nSpecialSlots = cd.readUInt32BE(24);
    // nCodeSlots is at byte offset 28
    const nCodeSlots = cd.readUInt32BE(28);
    const hashSize = 32; // SHA-256

    expect(nSpecialSlots).toBe(5); // max slot key
    expect(nCodeSlots).toBe(1);

    // hashOffset should point past special hashes to where code hashes start
    // Total hash area = (nSpecialSlots + nCodeSlots) * hashSize
    // Special hashes come BEFORE hashOffset, code hashes come AT hashOffset
    // Verify the hash area fits within the blob
    expect(hashOffset + nCodeSlots * hashSize).toBeLessThanOrEqual(cd.length);
    expect(hashOffset - nSpecialSlots * hashSize).toBeGreaterThan(0);
  });

  // C-03: Verify DER entitlements blob
  it("buildDEREntitlementsBlob produces valid DER blob (C-03)", async () => {
    const { buildDEREntitlementsBlob } = await import("../src/server/signing/codesign-structures");
    const xml = "<plist><dict><key>get-task-allow</key><true/></dict></plist>";
    const blob = buildDEREntitlementsBlob(xml);
    // DER magic is 0xfade7172
    expect(blob.readUInt32BE(0)).toBe(0xfade7172);
    expect(blob.readUInt32BE(4)).toBe(8 + Buffer.byteLength(xml, "utf8"));
    expect(blob.subarray(8).toString("utf8")).toBe(xml);
  });

  // E-03: Bounds checking on malformed Mach-O
  it("parseMachO rejects truncated buffer (E-03)", async () => {
    const { parseMachO } = await import("../src/server/signing/macho");
    // Too small for any valid header
    expect(() => parseMachO(Buffer.alloc(4))).toThrow();
  });

  it("parseMachO rejects absurd FAT arch count (E-03)", async () => {
    const { parseMachO, FAT_MAGIC } = await import("../src/server/signing/macho");
    const buf = Buffer.alloc(64);
    buf.writeUInt32BE(FAT_MAGIC, 0);
    buf.writeUInt32BE(100, 4); // nfat_arch = 100 (unreasonable)
    expect(() => parseMachO(buf)).toThrow(/unreasonable/i);
  });
});
