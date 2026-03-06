// ─── Apple Code Signature Structures ────────────────────────────────
// Pure TypeScript implementation of Apple's code signing blob formats.
// These are the binary structures embedded in Mach-O binaries for
// code signature validation.
//
// Reference: Apple's `Security/CSCommon.h` and `codesign` source code.
// The structures are big-endian (network byte order).

import crypto from 'node:crypto';
import forge from 'node-forge';

// ─── Magic Numbers ──────────────────────────────────────────────────

export const CSMAGIC_REQUIREMENT = 0xfade0c00;
export const CSMAGIC_REQUIREMENTS = 0xfade0c01;
export const CSMAGIC_CODEDIRECTORY = 0xfade0c02;
export const CSMAGIC_EMBEDDED_SIGNATURE = 0xfade0cc0;
export const CSMAGIC_DETACHED_SIGNATURE = 0xfade0cc1;
export const CSMAGIC_BLOBWRAPPER = 0xfade0b01;
export const CSMAGIC_ENTITLEMENTS = 0xfade7171;
export const CSMAGIC_ENTITLEMENTS_DER = 0xfade7172;

// Slot types within the SuperBlob
export const CSSLOT_CODEDIRECTORY = 0;
export const CSSLOT_INFOSLOT = 1;
export const CSSLOT_REQUIREMENTS = 2;
export const CSSLOT_RESOURCEDIR = 3;  // _CodeSignature/CodeResources
export const CSSLOT_APPLICATION = 4;
export const CSSLOT_ENTITLEMENTS = 5;
export const CSSLOT_ENTITLEMENTS_DER = 7;
export const CSSLOT_ALTERNATE_CODEDIRECTORIES = 0x1000; // + index
export const CSSLOT_SIGNATURESLOT = 0x10000;

// Hash types
export const CS_HASHTYPE_SHA1 = 1;
export const CS_HASHTYPE_SHA256 = 2;
export const CS_HASHTYPE_SHA256_TRUNCATED = 3;
export const CS_HASHTYPE_SHA384 = 4;

// CodeDirectory version
export const CS_SUPPORTSSCATTER = 0x20100;
export const CS_SUPPORTSTEAMID = 0x20200;
export const CS_SUPPORTSCODELIMIT64 = 0x20300;
export const CS_SUPPORTSEXECSEG = 0x20400;
export const CS_SUPPORTSRUNTIME = 0x20500;
export const CS_SUPPORTSLINKAGE = 0x20600;

// Code signing flags
export const CS_ADHOC = 0x0002;
export const CS_GET_TASK_ALLOW = 0x0004;
export const CS_LINKER_SIGNED = 0x20000;

// Page size (arm64 iOS uses 16 KiB pages)
export const CS_PAGE_SIZE = 16384;
export const CS_PAGE_SHIFT = 14;

// ─── Types ──────────────────────────────────────────────────────────

export interface CodeDirectoryParams {
  /** Identifier string (usually the bundle ID) */
  identifier: string;
  /** Team ID */
  teamId: string;
  /** SHA-1 or SHA-256 */
  hashType: number;
  /** Total size of the executable to hash (code limit) */
  codeLimit: number;
  /** Page size (usually 4096) */
  pageSize: number;
  /** Executable segment base offset */
  execSegBase?: number;
  /** Executable segment limit */
  execSegLimit?: number;
  /** Executable segment flags */
  execSegFlags?: number;
  /** Code hashes (one per page) */
  codeHashes: Buffer[];
  /** Special slot hashes (info.plist, requirements, resources, entitlements, etc.) */
  specialHashes: Map<number, Buffer>;
  /** Code signing flags */
  flags?: number;
}

export interface BlobIndex {
  type: number;
  offset: number;
}

// ─── Blob Builders ──────────────────────────────────────────────────

/**
 * Build a CodeDirectory blob.
 * This is the core structure that contains page hashes and metadata.
 */
export function buildCodeDirectory(params: CodeDirectoryParams): Buffer {
  const {
    identifier,
    teamId,
    hashType,
    codeLimit,
    pageSize,
    codeHashes,
    specialHashes,
    flags = 0,
    execSegBase = 0,
    execSegLimit = 0,
    execSegFlags = 0,
  } = params;

  const hashSize = hashType === CS_HASHTYPE_SHA1 ? 20 : 32;
  const pageShift = Math.log2(pageSize);
  const version = CS_SUPPORTSEXECSEG; // 0x20400 — supports exec segment

  // Special slots: negative indices (-1 = info, -2 = requirements, etc.)
  const maxSpecialSlot = specialHashes.size > 0
    ? Math.max(...Array.from(specialHashes.keys()))
    : 0;

  const nSpecialSlots = maxSpecialSlot;
  const nCodeSlots = codeHashes.length;

  // Encode strings
  const identBytes = Buffer.from(identifier, 'utf8');
  const teamIdBytes = Buffer.from(teamId, 'utf8');

  // Calculate offsets — per Apple CodeDirectory spec:
  //   [header][ident\0][special hash N]...[special hash 1][code hash 0]...[code hash N][teamId\0]
  //   hashOffset points to code hash 0 (i.e. AFTER all special slot hashes).
  //   Special slot N is stored at (hashOffset - N * hashSize).
  const headerSize = 88; // CodeDirectory v0x20400 fixed header
  const identOffset = headerSize;
  const specialHashesStart = identOffset + identBytes.length + 1; // +1 for null terminator
  const hashOffset = specialHashesStart + (nSpecialSlots * hashSize); // points to code hash 0
  const codeHashesStart = hashOffset;
  const teamIdOffset = codeHashesStart + (nCodeSlots * hashSize);
  const totalSize = teamIdOffset + teamIdBytes.length + 1;

  const buf = Buffer.alloc(totalSize, 0);

  // Write header
  buf.writeUInt32BE(CSMAGIC_CODEDIRECTORY, 0);
  buf.writeUInt32BE(totalSize, 4);
  buf.writeUInt32BE(version, 8);
  buf.writeUInt32BE(flags, 12);
  buf.writeUInt32BE(hashOffset, 16);       // hashOffset (start of code hashes, after special)
  buf.writeUInt32BE(identOffset, 20);       // identOffset
  buf.writeUInt32BE(nSpecialSlots, 24);
  buf.writeUInt32BE(nCodeSlots, 28);
  buf.writeUInt32BE(codeLimit, 32);
  buf.writeUInt8(hashSize, 36);
  buf.writeUInt8(hashType, 37);
  buf.writeUInt8(0, 38);                    // platform
  buf.writeUInt8(pageShift, 39);
  buf.writeUInt32BE(0, 40);                 // spare2
  // scatter offset (0 = none)
  buf.writeUInt32BE(0, 44);
  // team ID offset
  buf.writeUInt32BE(teamIdOffset, 48);
  // spare3
  buf.writeUInt32BE(0, 52);
  // code limit 64
  buf.writeBigUInt64BE(BigInt(codeLimit), 56);
  // exec seg base
  buf.writeBigUInt64BE(BigInt(execSegBase), 64);
  // exec seg limit
  buf.writeBigUInt64BE(BigInt(execSegLimit), 72);
  // exec seg flags
  buf.writeBigUInt64BE(BigInt(execSegFlags), 80);

  // Write identifier string (null-terminated)
  identBytes.copy(buf, identOffset);
  buf.writeUInt8(0, identOffset + identBytes.length);

  // Write special slot hashes (negative indices mapped to positive positions)
  // Slot -N is stored at (hashOffset - N * hashSize)
  for (const [slot, hash] of specialHashes) {
    if (slot > 0 && slot <= nSpecialSlots) {
      // Special slots are stored before the hash offset
      const slotOffset = hashOffset - (slot * hashSize);
      hash.copy(buf, slotOffset, 0, hashSize);
    }
  }

  // Write code hashes
  for (let i = 0; i < nCodeSlots; i++) {
    codeHashes[i].copy(buf, codeHashesStart + (i * hashSize), 0, hashSize);
  }

  // Write team ID (null-terminated)
  teamIdBytes.copy(buf, teamIdOffset);
  buf.writeUInt8(0, teamIdOffset + teamIdBytes.length);

  return buf;
}

/**
 * Build an entitlements blob (CSMAGIC_ENTITLEMENTS).
 */
export function buildEntitlementsBlob(entitlementsPlist: string): Buffer {
  const plistBytes = Buffer.from(entitlementsPlist, 'utf8');
  const totalSize = 8 + plistBytes.length;
  const buf = Buffer.alloc(totalSize);

  buf.writeUInt32BE(CSMAGIC_ENTITLEMENTS, 0);
  buf.writeUInt32BE(totalSize, 4);
  plistBytes.copy(buf, 8);

  return buf;
}

/**
 * Build a DER-encoded entitlements blob (CSMAGIC_ENTITLEMENTS_DER).
 * iOS 15+ requires both XML plist and DER-encoded entitlements.
 * We wrap the raw XML plist bytes with the DER magic — the kernel
 * validates the slot hash, not the inner encoding.
 */
export function buildDEREntitlementsBlob(entitlementsPlist: string): Buffer {
  const plistBytes = Buffer.from(entitlementsPlist, 'utf8');
  const totalSize = 8 + plistBytes.length;
  const buf = Buffer.alloc(totalSize);

  buf.writeUInt32BE(CSMAGIC_ENTITLEMENTS_DER, 0);
  buf.writeUInt32BE(totalSize, 4);
  plistBytes.copy(buf, 8);

  return buf;
}

/**
 * Build an empty requirements blob.
 * Most sideloaded apps use empty requirements.
 */
export function buildEmptyRequirements(): Buffer {
  const buf = Buffer.alloc(12);
  buf.writeUInt32BE(CSMAGIC_REQUIREMENTS, 0);
  buf.writeUInt32BE(12, 4);  // total size
  buf.writeUInt32BE(0, 8);   // count = 0
  return buf;
}

/**
 * Build a BlobWrapper for CMS signature data.
 */
export function buildBlobWrapper(signatureData: Buffer): Buffer {
  const totalSize = 8 + signatureData.length;
  const buf = Buffer.alloc(totalSize);

  buf.writeUInt32BE(CSMAGIC_BLOBWRAPPER, 0);
  buf.writeUInt32BE(totalSize, 4);
  signatureData.copy(buf, 8);

  return buf;
}

/**
 * Build a SuperBlob (EmbeddedSignature) containing all the sub-blobs.
 * This is the top-level structure that contains CodeDirectory,
 * Requirements, Entitlements, and the CMS signature.
 */
export function buildSuperBlob(blobs: Map<number, Buffer>): Buffer {
  // Sort blobs by slot type
  const sortedSlots = Array.from(blobs.entries()).sort(([a], [b]) => a - b);
  const count = sortedSlots.length;

  // Header: magic(4) + length(4) + count(4)
  // Index: count * (type(4) + offset(4))
  const headerSize = 12 + (count * 8);

  // Calculate total size
  let totalSize = headerSize;
  for (const [, blob] of sortedSlots) {
    totalSize += blob.length;
  }

  const buf = Buffer.alloc(totalSize);

  // Write header
  buf.writeUInt32BE(CSMAGIC_EMBEDDED_SIGNATURE, 0);
  buf.writeUInt32BE(totalSize, 4);
  buf.writeUInt32BE(count, 8);

  // Write index and blobs
  let blobOffset = headerSize;
  let indexOffset = 12;

  for (const [slotType, blob] of sortedSlots) {
    // Write index entry
    buf.writeUInt32BE(slotType, indexOffset);
    buf.writeUInt32BE(blobOffset, indexOffset + 4);
    indexOffset += 8;

    // Write blob data
    blob.copy(buf, blobOffset);
    blobOffset += blob.length;
  }

  return buf;
}

// ─── CMS Signature ──────────────────────────────────────────────────

/**
 * Create a CMS (PKCS#7) signature over the CodeDirectory using node-forge.
 * This creates a detached signature that Apple's code signing verification expects.
 */
export function createCMSSignature(
  codeDirectoryData: Buffer,
  certPem: string,
  privateKeyPem: string,
): Buffer {
  const cert = forge.pki.certificateFromPem(certPem);
  const key = forge.pki.privateKeyFromPem(privateKeyPem);

  // Create PKCS#7 signed data
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(codeDirectoryData.toString('binary'));

  p7.addCertificate(cert);

  p7.addSigner({
    key,
    certificate: cert,
    digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      {
        type: forge.pki.oids.contentType,
        value: forge.pki.oids.data,
      },
      {
        type: forge.pki.oids.messageDigest,
        // messageDigest will be auto-computed
      },
      {
        type: forge.pki.oids.signingTime,
        value: new Date() as unknown as string, // forge accepts Date for signingTime
      },
    ],
  });

  p7.sign({ detached: true });

  // Serialize to DER and wrap in BlobWrapper (magic 0xfade0b01)
  // as required by Apple's SuperBlob format
  const asn1 = p7.toAsn1();
  const der = forge.asn1.toDer(asn1);
  return buildBlobWrapper(Buffer.from(der.getBytes(), 'binary'));
}

/**
 * Create an ad-hoc signature (no CMS, just CodeDirectory hash).
 * Used when no signing identity is available.
 */
export function createAdHocSignature(): Buffer {
  // Ad-hoc: empty CMS wrapper
  return buildBlobWrapper(Buffer.alloc(0));
}

// ─── Hash Utilities ─────────────────────────────────────────────────

/**
 * Compute a hash for a special slot (Info.plist, CodeResources, etc.).
 */
export function computeSpecialSlotHash(data: Buffer, hashType: number): Buffer {
  const algorithm = hashType === CS_HASHTYPE_SHA1 ? 'sha1' : 'sha256';
  return crypto.createHash(algorithm).update(data).digest();
}

/**
 * Compute code page hashes for the executable data.
 */
export function computeCodeHashes(data: Buffer, pageSize: number, hashType: number): Buffer[] {
  const algorithm = hashType === CS_HASHTYPE_SHA1 ? 'sha1' : 'sha256';
  const hashes: Buffer[] = [];

  for (let offset = 0; offset < data.length; offset += pageSize) {
    const page = data.subarray(offset, Math.min(offset + pageSize, data.length));
    const hash = crypto.createHash(algorithm).update(page).digest();
    hashes.push(hash);
  }

  return hashes;
}

/**
 * Format a hash as a hex string (for display/debugging).
 */
export function hashToHex(hash: Buffer): string {
  return hash.toString('hex');
}
