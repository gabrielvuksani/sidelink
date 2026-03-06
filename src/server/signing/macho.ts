// ─── Mach-O Binary Parser ───────────────────────────────────────────
// Cross-platform pure TypeScript implementation for parsing and
// modifying Mach-O binaries (the executable format used in iOS apps).
//
// Supports:
//   - FAT (universal) binaries with multiple architectures
//   - Single-arch Mach-O binaries
//   - Reading load commands
//   - Finding/replacing the LC_CODE_SIGNATURE load command
//   - Identifying the code signature offset and size

// ─── Constants ──────────────────────────────────────────────────────

/** Mach-O magic numbers */
export const MH_MAGIC = 0xfeedface;       // 32-bit
export const MH_CIGAM = 0xcefaedfe;       // 32-bit swapped
export const MH_MAGIC_64 = 0xfeedfacf;    // 64-bit
export const MH_CIGAM_64 = 0xcffaedfe;    // 64-bit swapped

/** FAT binary magic numbers */
export const FAT_MAGIC = 0xcafebabe;
export const FAT_CIGAM = 0xbebafeca;
export const FAT_MAGIC_64 = 0xcafebabf;
export const FAT_CIGAM_64 = 0xbfbafeca;

/** Load command types */
export const LC_SEGMENT = 0x01;
export const LC_SEGMENT_64 = 0x19;
export const LC_CODE_SIGNATURE = 0x1d;
export const LC_ENCRYPTION_INFO = 0x21;
export const LC_ENCRYPTION_INFO_64 = 0x2c;
export const LC_DYLIB_CODE_SIGN_DRS = 0x2b;

/** CPU types */
export const CPU_TYPE_ARM = 12;
export const CPU_TYPE_ARM64 = 0x0100000c;
export const CPU_TYPE_X86 = 7;
export const CPU_TYPE_X86_64 = 0x01000007;

// ─── Types ──────────────────────────────────────────────────────────

export interface MachOHeader {
  magic: number;
  cputype: number;
  cpusubtype: number;
  filetype: number;
  ncmds: number;
  sizeofcmds: number;
  flags: number;
  reserved?: number; // 64-bit only
  is64: boolean;
  isSwapped: boolean;
  headerSize: number;
}

export interface LoadCommand {
  cmd: number;
  cmdsize: number;
  offset: number;  // Offset within the Mach-O file (not the FAT container)
  data: Buffer;
}

export interface CodeSignatureLocation {
  dataoff: number;   // Offset of code signature data from start of Mach-O
  datasize: number;  // Size of code signature data
  loadCommandOffset: number;  // Offset of the LC_CODE_SIGNATURE load command
}

export interface FatArch {
  cputype: number;
  cpusubtype: number;
  offset: number;
  size: number;
  align: number;
}

export interface MachOSlice {
  header: MachOHeader;
  loadCommands: LoadCommand[];
  codeSignature?: CodeSignatureLocation;
  offset: number;  // Offset within the file (for FAT binaries)
  size: number;
}

export interface MachOBinary {
  isFat: boolean;
  slices: MachOSlice[];
  fatArchs?: FatArch[];
  buffer: Buffer;
}

// ─── Reader Helpers ─────────────────────────────────────────────────

function readUint32(buf: Buffer, offset: number, swap: boolean): number {
  return swap ? buf.readUInt32BE(offset) : buf.readUInt32LE(offset);
}

function writeUint32(buf: Buffer, offset: number, value: number, swap: boolean): void {
  if (swap) {
    buf.writeUInt32BE(value, offset);
  } else {
    buf.writeUInt32LE(value, offset);
  }
}

// ─── Parsing ────────────────────────────────────────────────────────

/**
 * Parse a Mach-O header from a buffer at the given offset.
 */
export function parseMachOHeader(buf: Buffer, offset: number): MachOHeader {
  if (offset + 28 > buf.length) {
    throw new Error(`Buffer too small for Mach-O header at offset ${offset} (need 28 bytes, have ${buf.length - offset})`);
  }

  const magic = buf.readUInt32LE(offset);

  let is64 = false;
  let isSwapped = false;

  switch (magic) {
    case MH_MAGIC:
      break;
    case MH_CIGAM:
      isSwapped = true;
      break;
    case MH_MAGIC_64:
      is64 = true;
      break;
    case MH_CIGAM_64:
      is64 = true;
      isSwapped = true;
      break;
    default:
      throw new Error(`Not a Mach-O binary (magic: 0x${magic.toString(16)} at offset ${offset})`);
  }

  const headerSize = is64 ? 32 : 28;

  return {
    magic,
    cputype: readUint32(buf, offset + 4, isSwapped),
    cpusubtype: readUint32(buf, offset + 8, isSwapped),
    filetype: readUint32(buf, offset + 12, isSwapped),
    ncmds: readUint32(buf, offset + 16, isSwapped),
    sizeofcmds: readUint32(buf, offset + 20, isSwapped),
    flags: readUint32(buf, offset + 24, isSwapped),
    reserved: is64 ? readUint32(buf, offset + 28, isSwapped) : undefined,
    is64,
    isSwapped,
    headerSize,
  };
}

/**
 * Parse all load commands from a Mach-O slice.
 */
export function parseLoadCommands(buf: Buffer, header: MachOHeader, baseOffset: number): LoadCommand[] {
  const commands: LoadCommand[] = [];
  let offset = baseOffset + header.headerSize;

  for (let i = 0; i < header.ncmds; i++) {
    const cmd = readUint32(buf, offset, header.isSwapped);
    const cmdsize = readUint32(buf, offset + 4, header.isSwapped);

    if (cmdsize < 8 || offset + cmdsize > buf.length) {
      throw new Error(`Invalid load command at offset ${offset}: cmd=${cmd} cmdsize=${cmdsize}`);
    }

    commands.push({
      cmd,
      cmdsize,
      offset,
      data: buf.subarray(offset, offset + cmdsize),
    });

    offset += cmdsize;
  }

  return commands;
}

/**
 * Find the LC_CODE_SIGNATURE load command in a list of load commands.
 */
export function findCodeSignature(commands: LoadCommand[], buf: Buffer, swap: boolean): CodeSignatureLocation | undefined {
  for (const lc of commands) {
    if (lc.cmd === LC_CODE_SIGNATURE) {
      return {
        dataoff: readUint32(buf, lc.offset + 8, swap),
        datasize: readUint32(buf, lc.offset + 12, swap),
        loadCommandOffset: lc.offset,
      };
    }
  }
  return undefined;
}

/**
 * Parse a complete Mach-O binary (single-arch or FAT/universal).
 */
export function parseMachO(buf: Buffer): MachOBinary {
  const magic = buf.readUInt32BE(0);

  // Check for FAT binary
  if (magic === FAT_MAGIC || magic === FAT_CIGAM || magic === FAT_MAGIC_64 || magic === FAT_CIGAM_64) {
    return parseFatBinary(buf);
  }

  // Single-arch Mach-O
  const header = parseMachOHeader(buf, 0);
  const loadCommands = parseLoadCommands(buf, header, 0);
  const codeSignature = findCodeSignature(loadCommands, buf, header.isSwapped);

  return {
    isFat: false,
    slices: [{
      header,
      loadCommands,
      codeSignature,
      offset: 0,
      size: buf.length,
    }],
    buffer: buf,
  };
}

/**
 * Parse a FAT (universal) binary.
 */
function parseFatBinary(buf: Buffer): MachOBinary {
  const magic = buf.readUInt32BE(0);
  const is64 = magic === FAT_MAGIC_64 || magic === FAT_CIGAM_64;
  // FAT header fields are always big-endian
  const nfat_arch = buf.readUInt32BE(4);

  if (nfat_arch > 20) {
    throw new Error(`FAT binary has unreasonable architecture count: ${nfat_arch}`);
  }

  const fatArchs: FatArch[] = [];
  const slices: MachOSlice[] = [];
  const archSize = is64 ? 32 : 20;
  let archOffset = 8;

  for (let i = 0; i < nfat_arch; i++) {
    const arch: FatArch = {
      cputype: buf.readUInt32BE(archOffset),
      cpusubtype: buf.readUInt32BE(archOffset + 4),
      offset: is64
        ? Number(buf.readBigUInt64BE(archOffset + 8))
        : buf.readUInt32BE(archOffset + 8),
      size: is64
        ? Number(buf.readBigUInt64BE(archOffset + 16))
        : buf.readUInt32BE(archOffset + 12),
      align: buf.readUInt32BE(archOffset + (is64 ? 24 : 16)),
    };

    fatArchs.push(arch);
    archOffset += archSize;

    // Parse each slice
    const sliceBuf = buf.subarray(arch.offset, arch.offset + arch.size);
    const header = parseMachOHeader(buf, arch.offset);
    const loadCommands = parseLoadCommands(buf, header, arch.offset);
    const codeSignature = findCodeSignature(loadCommands, buf, header.isSwapped);

    slices.push({
      header,
      loadCommands,
      codeSignature,
      offset: arch.offset,
      size: arch.size,
    });
  }

  return {
    isFat: true,
    slices,
    fatArchs,
    buffer: buf,
  };
}

// ─── Code Signature Computation Helpers ─────────────────────────────

/**
 * Get the size of the executable region (everything before the code signature).
 * This is the region that gets hashed.
 */
export function getExecutableSize(slice: MachOSlice): number {
  if (slice.codeSignature) {
    return slice.codeSignature.dataoff;
  }
  // If no code signature, the full slice is the executable
  return slice.size;
}

/**
 * Find the __LINKEDIT segment in a Mach-O slice.
 * The code signature lives at the end of __LINKEDIT.
 */
export function findLinkeditSegment(slice: MachOSlice, buf: Buffer): {
  fileoff: number;
  filesize: number;
  vmsize: number;
  loadCommandOffset: number;
} | undefined {
  for (const lc of slice.loadCommands) {
    if (lc.cmd !== LC_SEGMENT && lc.cmd !== LC_SEGMENT_64) continue;

    // Read segment name (16 bytes at offset +8)
    const nameBytes = buf.subarray(lc.offset + 8, lc.offset + 24);
    const name = nameBytes.toString('ascii').replace(/\0+$/, '');

    if (name === '__LINKEDIT') {
      const is64 = lc.cmd === LC_SEGMENT_64;
      const swap = slice.header.isSwapped;

      if (is64) {
        return {
          fileoff: Number(buf.readBigUInt64LE(lc.offset + 48)),
          filesize: Number(buf.readBigUInt64LE(lc.offset + 56)),
          vmsize: Number(buf.readBigUInt64LE(lc.offset + 40)),
          loadCommandOffset: lc.offset,
        };
      } else {
        return {
          fileoff: readUint32(buf, lc.offset + 32, swap),
          filesize: readUint32(buf, lc.offset + 36, swap),
          vmsize: readUint32(buf, lc.offset + 28, swap),
          loadCommandOffset: lc.offset,
        };
      }
    }
  }
  return undefined;
}
