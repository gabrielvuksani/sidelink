const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function normalizePath(value) {
  return value.split(path.sep).join('/');
}

function collectFiles(absolutePath, entryName, entries, include = () => true) {
  const normalizedEntryName = normalizePath(entryName);
  if (!include(normalizedEntryName)) return;
  const stat = fs.statSync(absolutePath);
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(absolutePath).sort()) {
      collectFiles(path.join(absolutePath, child), `${entryName}/${child}`, entries, include);
    }
    return;
  }
  if (stat.isFile()) {
    entries.push({ name: normalizedEntryName, content: fs.readFileSync(absolutePath) });
  }
}

function hashNamedContents(entries) {
  const hash = crypto.createHash('sha256');
  for (const entry of [...entries].sort((left, right) => left.name.localeCompare(right.name))) {
    const name = Buffer.from(entry.name, 'utf8');
    const nameLength = Buffer.allocUnsafe(8);
    const contentLength = Buffer.allocUnsafe(8);
    nameLength.writeBigUInt64BE(BigInt(name.length));
    contentLength.writeBigUInt64BE(BigInt(entry.content.length));
    hash.update(nameLength);
    hash.update(name);
    hash.update(contentLength);
    hash.update(entry.content);
  }
  return hash.digest('hex');
}

function readUnsigned(buffer, offset, size, littleEndian) {
  if (size === 8) {
    return littleEndian ? buffer.readBigUInt64LE(offset) : buffer.readBigUInt64BE(offset);
  }
  return littleEndian ? buffer.readUInt32LE(offset) : buffer.readUInt32BE(offset);
}

function writeUnsigned(buffer, value, offset, size, littleEndian) {
  if (size === 8) {
    if (littleEndian) buffer.writeBigUInt64LE(BigInt(value), offset);
    else buffer.writeBigUInt64BE(BigInt(value), offset);
    return;
  }
  if (littleEndian) buffer.writeUInt32LE(Number(value), offset);
  else buffer.writeUInt32BE(Number(value), offset);
}

function readSafeUnsigned(buffer, offset, size, littleEndian) {
  if (offset < 0 || offset + size > buffer.length) return null;
  const value = readUnsigned(buffer, offset, size, littleEndian);
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function rangesOverlap(left, right) {
  return left.start < right.end && right.start < left.end;
}

function addFileRange(ranges, offset, size, contentLength) {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 0 || size < 0) {
    return false;
  }
  if (offset > contentLength || size > contentLength - offset) return false;
  if (size > 0) ranges.push({ start: offset, end: offset + size });
  return true;
}

function addCountedFileRange(ranges, offset, count, entrySize, contentLength) {
  if (!Number.isSafeInteger(count) || count < 0 || count > Math.floor(contentLength / entrySize)) {
    return false;
  }
  return addFileRange(ranges, offset, count * entrySize, contentLength);
}

function hasWellFormedEmbeddedSignature(content, signatureOffset, signatureSize) {
  if (signatureSize < 20) return false;
  const magic = content.readUInt32BE(signatureOffset);
  const blobLength = content.readUInt32BE(signatureOffset + 4);
  const blobCount = content.readUInt32BE(signatureOffset + 8);
  if (magic !== 0xfade0cc0 || blobLength < 20 || blobLength > signatureSize) return false;
  if (blobCount === 0 || blobCount > Math.floor((blobLength - 12) / 8)) return false;

  const indexEnd = 12 + blobCount * 8;
  const childRanges = [];
  let hasCodeDirectory = false;
  for (let index = 0; index < blobCount; index += 1) {
    const indexOffset = signatureOffset + 12 + index * 8;
    const childOffset = content.readUInt32BE(indexOffset + 4);
    if (childOffset < indexEnd || childOffset > blobLength - 8) return false;
    const absoluteChildOffset = signatureOffset + childOffset;
    const childMagic = content.readUInt32BE(absoluteChildOffset);
    const childLength = content.readUInt32BE(absoluteChildOffset + 4);
    if ((childMagic >>> 16) !== 0xfade || childLength < 8 || childLength > blobLength - childOffset) {
      return false;
    }
    const childRange = { start: childOffset, end: childOffset + childLength };
    if (childRanges.some((range) => rangesOverlap(range, childRange))) return false;
    childRanges.push(childRange);
    hasCodeDirectory ||= childMagic === 0xfade0c02;
  }

  return hasCodeDirectory;
}

const MACHO_LINKEDIT_DATA_COMMANDS = new Set([
  0x1e, // LC_SEGMENT_SPLIT_INFO
  0x26, // LC_FUNCTION_STARTS
  0x29, // LC_DATA_IN_CODE
  0x2b, // LC_DYLIB_CODE_SIGN_DRS
  0x2e, // LC_LINKER_OPTIMIZATION_HINT
  0x33, // LC_DYLD_EXPORTS_TRIE
  0x34, // LC_DYLD_CHAINED_FIXUPS
  0x36, // LC_ATOM_INFO
  0x37, // LC_FUNCTION_VARIANTS
  0x38, // LC_FUNCTION_VARIANT_FIXUPS
]);

const MACHO_COMMANDS_WITHOUT_FILE_RANGES = new Set([
  0x4, 0x5, 0x6, 0x7, 0x8, 0x9, 0x0a,
  0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15,
  0x17, 0x18, 0x1a, 0x1b, 0x1c, 0x1f, 0x20, 0x23, 0x24, 0x25,
  0x27, 0x2a, 0x2d, 0x2f, 0x30, 0x32, 0x39,
]);

function canonicalizeThinMachO(content) {
  if (content.length < 28) return null;
  const magicLittle = content.readUInt32LE(0);
  const magicBig = content.readUInt32BE(0);
  let littleEndian;
  let is64Bit;
  if (magicLittle === 0xfeedface || magicLittle === 0xfeedfacf) {
    littleEndian = true;
    is64Bit = magicLittle === 0xfeedfacf;
  } else if (magicBig === 0xfeedface || magicBig === 0xfeedfacf) {
    littleEndian = false;
    is64Bit = magicBig === 0xfeedfacf;
  } else {
    return null;
  }

  const headerSize = is64Bit ? 32 : 28;
  if (content.length < headerSize) return null;
  const commandCount = readSafeUnsigned(content, 16, 4, littleEndian);
  const commandsSize = readSafeUnsigned(content, 20, 4, littleEndian);
  if (commandCount === null || commandsSize === null || commandCount > Math.floor(commandsSize / 8)) {
    return null;
  }
  const commandsEnd = headerSize + commandsSize;
  if (commandsEnd > content.length) return null;
  let commandOffset = headerSize;
  let codeSignature = null;
  let linkeditSegment = null;
  const segments = [];
  const referencedRanges = [];
  for (let index = 0; index < commandCount; index += 1) {
    if (commandOffset + 8 > commandsEnd) return null;
    const rawCommand = readSafeUnsigned(content, commandOffset, 4, littleEndian);
    const commandSize = readSafeUnsigned(content, commandOffset + 4, 4, littleEndian);
    if (rawCommand === null || commandSize === null) return null;
    const command = rawCommand & 0x7fffffff;
    if (commandSize < 8 || commandOffset + commandSize > commandsEnd) return null;
    if (command === 0x1 || command === 0x19) {
      const segmentHeaderSize = command === 0x19 ? 72 : 56;
      const sectionSize = command === 0x19 ? 80 : 68;
      const sectionCountField = commandOffset + (command === 0x19 ? 64 : 48);
      const sectionCount = readSafeUnsigned(content, sectionCountField, 4, littleEndian);
      if (sectionCount === null || sectionCount > Math.floor((commandSize - segmentHeaderSize) / sectionSize)) {
        return null;
      }
      if (commandSize !== segmentHeaderSize + sectionCount * sectionSize) return null;
      const segmentName = content.toString('ascii', commandOffset + 8, commandOffset + 24)
        .replace(/\0.*$/, '');
      const fieldSize = command === 0x19 ? 8 : 4;
      const fileOffsetField = commandOffset + (command === 0x19 ? 40 : 32);
      const fileSizeField = commandOffset + (command === 0x19 ? 48 : 36);
      const fileOffset = readSafeUnsigned(content, fileOffsetField, fieldSize, littleEndian);
      const fileSize = readSafeUnsigned(content, fileSizeField, fieldSize, littleEndian);
      if (fileOffset === null || fileSize === null || !addFileRange([], fileOffset, fileSize, content.length)) {
        return null;
      }
      const segment = { name: segmentName, start: fileOffset, end: fileOffset + fileSize };
      if (fileSize > 0) segments.push(segment);
      if (segmentName === '__LINKEDIT') {
        if (linkeditSegment !== null) return null;
        linkeditSegment = {
          commandOffset,
          fileOffset,
          fileSize,
          vmSizeField: commandOffset + (command === 0x19 ? 32 : 28),
          fileSizeField,
          fieldSize,
        };
      }

      const zeroFillSectionTypes = new Set([0x1, 0x0c, 0x12]);
      for (let sectionIndex = 0; sectionIndex < sectionCount; sectionIndex += 1) {
        const sectionOffset = commandOffset + segmentHeaderSize + sectionIndex * sectionSize;
        const sectionFileOffset = readSafeUnsigned(
          content,
          sectionOffset + (command === 0x19 ? 48 : 40),
          4,
          littleEndian,
        );
        const sectionFileSize = readSafeUnsigned(
          content,
          sectionOffset + (command === 0x19 ? 40 : 36),
          fieldSize,
          littleEndian,
        );
        const sectionFlags = readSafeUnsigned(
          content,
          sectionOffset + (command === 0x19 ? 64 : 56),
          4,
          littleEndian,
        );
        const relocationOffset = readSafeUnsigned(
          content,
          sectionOffset + (command === 0x19 ? 56 : 48),
          4,
          littleEndian,
        );
        const relocationCount = readSafeUnsigned(
          content,
          sectionOffset + (command === 0x19 ? 60 : 52),
          4,
          littleEndian,
        );
        if ([sectionFileOffset, sectionFileSize, sectionFlags, relocationOffset, relocationCount]
          .some((value) => value === null)) return null;
        if (!zeroFillSectionTypes.has(sectionFlags & 0xff) && sectionFileSize > 0) {
          const sectionRange = { start: sectionFileOffset, end: sectionFileOffset + sectionFileSize };
          if (sectionRange.start < segment.start || sectionRange.end > segment.end) return null;
          if (!addFileRange(referencedRanges, sectionFileOffset, sectionFileSize, content.length)) return null;
        }
        if (!addCountedFileRange(
          referencedRanges,
          relocationOffset,
          relocationCount,
          8,
          content.length,
        )) return null;
      }
    } else if (command === 0x1d) {
      if (codeSignature !== null) return null;
      if (commandSize !== 16) return null;
      const signatureOffset = readSafeUnsigned(content, commandOffset + 8, 4, littleEndian);
      const signatureSize = readSafeUnsigned(content, commandOffset + 12, 4, littleEndian);
      if (signatureOffset === null || signatureSize === null) return null;
      if (signatureOffset > content.length || signatureSize > content.length - signatureOffset) return null;
      codeSignature = { commandOffset, commandSize, signatureOffset, signatureSize };
    } else if (MACHO_LINKEDIT_DATA_COMMANDS.has(command) || command === 0x3) {
      if (commandSize !== 16) return null;
      const dataOffset = readSafeUnsigned(content, commandOffset + 8, 4, littleEndian);
      const dataSize = readSafeUnsigned(content, commandOffset + 12, 4, littleEndian);
      if (dataOffset === null || dataSize === null
        || !addFileRange(referencedRanges, dataOffset, dataSize, content.length)) return null;
    } else if (command === 0x2) {
      if (commandSize !== 24) return null;
      const symbolOffset = readSafeUnsigned(content, commandOffset + 8, 4, littleEndian);
      const symbolCount = readSafeUnsigned(content, commandOffset + 12, 4, littleEndian);
      const stringOffset = readSafeUnsigned(content, commandOffset + 16, 4, littleEndian);
      const stringSize = readSafeUnsigned(content, commandOffset + 20, 4, littleEndian);
      if ([symbolOffset, symbolCount, stringOffset, stringSize].some((value) => value === null)) return null;
      if (!addCountedFileRange(
        referencedRanges,
        symbolOffset,
        symbolCount,
        is64Bit ? 16 : 12,
        content.length,
      ) || !addFileRange(referencedRanges, stringOffset, stringSize, content.length)) return null;
    } else if (command === 0x0b) {
      if (commandSize !== 80) return null;
      const countedRanges = [
        [32, 36, 8],
        [40, 44, is64Bit ? 56 : 52],
        [48, 52, 4],
        [56, 60, 4],
        [64, 68, 8],
        [72, 76, 8],
      ];
      for (const [offsetField, countField, entrySize] of countedRanges) {
        const dataOffset = readSafeUnsigned(content, commandOffset + offsetField, 4, littleEndian);
        const count = readSafeUnsigned(content, commandOffset + countField, 4, littleEndian);
        if (dataOffset === null || count === null
          || !addCountedFileRange(referencedRanges, dataOffset, count, entrySize, content.length)) return null;
      }
    } else if (command === 0x16) {
      if (commandSize !== 16) return null;
      const hintsOffset = readSafeUnsigned(content, commandOffset + 8, 4, littleEndian);
      const hintsCount = readSafeUnsigned(content, commandOffset + 12, 4, littleEndian);
      if (hintsOffset === null || hintsCount === null
        || !addCountedFileRange(referencedRanges, hintsOffset, hintsCount, 4, content.length)) return null;
    } else if (command === 0x21 || command === 0x2c) {
      if (commandSize !== (command === 0x2c ? 24 : 20)) return null;
      const cryptOffset = readSafeUnsigned(content, commandOffset + 8, 4, littleEndian);
      const cryptSize = readSafeUnsigned(content, commandOffset + 12, 4, littleEndian);
      if (cryptOffset === null || cryptSize === null
        || !addFileRange(referencedRanges, cryptOffset, cryptSize, content.length)) return null;
    } else if (command === 0x22) {
      if (commandSize !== 48) return null;
      for (let fieldOffset = 8; fieldOffset < 48; fieldOffset += 8) {
        const dataOffset = readSafeUnsigned(content, commandOffset + fieldOffset, 4, littleEndian);
        const dataSize = readSafeUnsigned(content, commandOffset + fieldOffset + 4, 4, littleEndian);
        if (dataOffset === null || dataSize === null
          || !addFileRange(referencedRanges, dataOffset, dataSize, content.length)) return null;
      }
    } else if (command === 0x28 || command === 0x35) {
      const fileOffsetField = command === 0x28 ? 8 : 16;
      const minimumCommandSize = command === 0x28 ? 24 : 32;
      if (commandSize < minimumCommandSize) return null;
      const fileOffset = readSafeUnsigned(content, commandOffset + fileOffsetField, 8, littleEndian);
      if (fileOffset === null || !addFileRange(referencedRanges, fileOffset, 1, content.length)) return null;
    } else if (command === 0x31) {
      if (commandSize !== 40) return null;
      const dataOffset = readSafeUnsigned(content, commandOffset + 24, 8, littleEndian);
      const dataSize = readSafeUnsigned(content, commandOffset + 32, 8, littleEndian);
      if (dataOffset === null || dataSize === null
        || !addFileRange(referencedRanges, dataOffset, dataSize, content.length)) return null;
    } else if (!MACHO_COMMANDS_WITHOUT_FILE_RANGES.has(command)) {
      return null;
    }
    commandOffset += commandSize;
  }
  if (commandOffset !== commandsEnd) return null;
  if (codeSignature === null) return content;

  const { commandOffset: signatureCommandOffset, commandSize, signatureOffset, signatureSize } = codeSignature;
  const signatureRange = { start: signatureOffset, end: signatureOffset + signatureSize };
  if (signatureSize === 0 || signatureOffset % 16 !== 0 || signatureRange.start < commandsEnd
    || signatureRange.end !== content.length || linkeditSegment === null) return null;
  if (linkeditSegment.fileOffset > signatureOffset
    || linkeditSegment.fileOffset + linkeditSegment.fileSize !== content.length) return null;
  if (segments.some((segment) => segment.name !== '__LINKEDIT' && rangesOverlap(segment, signatureRange))) {
    return null;
  }
  if (referencedRanges.some((range) => rangesOverlap(range, signatureRange))) return null;
  if (!hasWellFormedEmbeddedSignature(content, signatureOffset, signatureSize)) return null;
  const canonical = Buffer.from(content.subarray(0, signatureOffset));

  content.copy(
    canonical,
    signatureCommandOffset,
    signatureCommandOffset + commandSize,
    commandsEnd,
  );
  canonical.fill(0, commandsEnd - commandSize, commandsEnd);
  writeUnsigned(canonical, commandCount - 1, 16, 4, littleEndian);
  writeUnsigned(canonical, commandsSize - commandSize, 20, 4, littleEndian);

  const commandShift = linkeditSegment.commandOffset > signatureCommandOffset ? commandSize : 0;
  const adjustedVmSizeField = linkeditSegment.vmSizeField - commandShift;
  const adjustedFileSizeField = linkeditSegment.fileSizeField - commandShift;
  const canonicalLinkeditSize = signatureOffset - linkeditSegment.fileOffset;
  writeUnsigned(
    canonical,
    canonicalLinkeditSize,
    adjustedVmSizeField,
    linkeditSegment.fieldSize,
    littleEndian,
  );
  writeUnsigned(
    canonical,
    canonicalLinkeditSize,
    adjustedFileSizeField,
    linkeditSegment.fieldSize,
    littleEndian,
  );
  return canonical;
}

function canonicalizeFatMachO(content) {
  if (content.length < 8) return null;
  const magic = content.readUInt32BE(0);
  const littleEndian = magic === 0xbebafeca || magic === 0xbfbafeca;
  const is64Bit = magic === 0xcafebabf || magic === 0xbfbafeca;
  if (![0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca].includes(magic)) return null;
  const archCount = readSafeUnsigned(content, 4, 4, littleEndian);
  const archSize = is64Bit ? 32 : 20;
  if (archCount === null || archCount === 0 || archCount > 64
    || 8 + archCount * archSize > content.length) return null;

  const slices = [];
  const sliceRanges = [];
  const architectures = new Set();
  const tableEnd = 8 + archCount * archSize;
  for (let index = 0; index < archCount; index += 1) {
    const archOffset = 8 + index * archSize;
    const cpuType = readSafeUnsigned(content, archOffset, 4, littleEndian);
    const cpuSubtype = readSafeUnsigned(content, archOffset + 4, 4, littleEndian);
    const sliceOffset = readSafeUnsigned(content, archOffset + 8, is64Bit ? 8 : 4, littleEndian);
    const sliceSize = readSafeUnsigned(
      content,
      archOffset + (is64Bit ? 16 : 12),
      is64Bit ? 8 : 4,
      littleEndian,
    );
    const alignment = readSafeUnsigned(content, archOffset + (is64Bit ? 24 : 16), 4, littleEndian);
    const reserved = is64Bit
      ? readSafeUnsigned(content, archOffset + 28, 4, littleEndian)
      : 0;
    if ([cpuType, cpuSubtype, sliceOffset, sliceSize, alignment, reserved]
      .some((value) => value === null)) return null;
    if (sliceSize === 0 || sliceOffset < tableEnd || sliceOffset > content.length
      || sliceSize > content.length - sliceOffset || alignment > 63
      || BigInt(sliceOffset) % (1n << BigInt(alignment)) !== 0n) return null;
    const architecture = `${cpuType}:${cpuSubtype}`;
    if (architectures.has(architecture)) return null;
    architectures.add(architecture);
    const sliceRange = { start: sliceOffset, end: sliceOffset + sliceSize };
    if (sliceRanges.some((range) => rangesOverlap(range, sliceRange))) return null;
    sliceRanges.push(sliceRange);
    const slice = content.subarray(sliceOffset, sliceOffset + sliceSize);
    const stableRecordBytes = Buffer.concat([
      content.subarray(archOffset, archOffset + 8),
      content.subarray(
        archOffset + (is64Bit ? 24 : 16),
        archOffset + archSize,
      ),
    ]);
    slices.push({
      index,
      start: sliceOffset,
      end: sliceOffset + sliceSize,
      architecture,
      stableRecordBytes,
      content: canonicalizeThinMachO(slice) ?? slice,
    });
  }

  const canonicalEntries = [{
    name: 'fat-header',
    content: content.subarray(0, 8),
  }];
  for (const slice of slices) {
    canonicalEntries.push({
      name: `fat-architecture:${slice.index}`,
      content: slice.stableRecordBytes,
    });
    canonicalEntries.push({
      name: `fat-slice:${slice.index}:${slice.architecture}`,
      content: slice.content,
    });
  }

  let cursor = tableEnd;
  for (const [physicalIndex, slice] of [...slices]
    .sort((left, right) => left.start - right.start)
    .entries()) {
    canonicalEntries.push({
      name: `fat-gap:${physicalIndex}:before-slice-${slice.index}`,
      content: content.subarray(cursor, slice.start),
    });
    cursor = slice.end;
  }
  canonicalEntries.push({
    name: 'fat-trailer',
    content: content.subarray(cursor),
  });
  return Buffer.from(hashNamedContents(canonicalEntries), 'hex');
}

function hasWellFormedWinCertificateSequence(content, tableOffset, tableSize) {
  const tableEnd = tableOffset + tableSize;
  let certificateOffset = tableOffset;
  while (certificateOffset < tableEnd) {
    if (certificateOffset % 8 !== 0 || tableEnd - certificateOffset < 8) return false;
    const certificateLength = content.readUInt32LE(certificateOffset);
    const revision = content.readUInt16LE(certificateOffset + 4);
    const certificateType = content.readUInt16LE(certificateOffset + 6);
    if (certificateLength < 8 || revision !== 0x0200 || certificateType !== 0x0002) return false;
    const alignedLength = Math.ceil(certificateLength / 8) * 8;
    if (alignedLength > tableEnd - certificateOffset) return false;
    for (let offset = certificateOffset + certificateLength;
      offset < certificateOffset + alignedLength;
      offset += 1) {
      if (content[offset] !== 0) return false;
    }
    certificateOffset += alignedLength;
  }
  return certificateOffset === tableEnd;
}

function canonicalizePortableExecutable(content) {
  if (content.length < 0x40 || content[0] !== 0x4d || content[1] !== 0x5a) return null;
  const peOffset = content.readUInt32LE(0x3c);
  if (peOffset > content.length - 24 || content.toString('ascii', peOffset, peOffset + 4) !== 'PE\0\0') return null;
  const sectionCount = content.readUInt16LE(peOffset + 6);
  if (sectionCount > 96) return null;
  const optionalOffset = peOffset + 24;
  const optionalSize = content.readUInt16LE(peOffset + 20);
  if (optionalSize < 2 || optionalSize > content.length - optionalOffset) return null;
  const optionalEnd = optionalOffset + optionalSize;
  const optionalMagic = content.readUInt16LE(optionalOffset);
  const optionalLayout = optionalMagic === 0x10b
    ? { minimumSize: 96, numberOfDirectoriesOffset: 92, dataDirectoryOffset: 96 }
    : optionalMagic === 0x20b
      ? { minimumSize: 112, numberOfDirectoriesOffset: 108, dataDirectoryOffset: 112 }
      : null;
  if (optionalLayout === null || optionalSize < optionalLayout.minimumSize) return null;
  const sectionTableOffset = optionalEnd;
  if (sectionCount > Math.floor((content.length - sectionTableOffset) / 40)) return null;
  const sectionTableEnd = sectionTableOffset + sectionCount * 40;
  const sizeOfHeaders = content.readUInt32LE(optionalOffset + 60);
  if (sizeOfHeaders < sectionTableEnd || sizeOfHeaders > content.length) return null;

  const sectionRanges = [];
  for (let index = 0; index < sectionCount; index += 1) {
    const sectionOffset = sectionTableOffset + index * 40;
    const rawSize = content.readUInt32LE(sectionOffset + 16);
    const rawOffset = content.readUInt32LE(sectionOffset + 20);
    if (rawSize === 0) continue;
    if (rawOffset < sizeOfHeaders || rawOffset > content.length || rawSize > content.length - rawOffset) {
      return null;
    }
    const rawEnd = rawOffset + rawSize;
    if (sectionRanges.some((range) => rawOffset < range.end && range.start < rawEnd)) return null;
    sectionRanges.push({ start: rawOffset, end: rawEnd });
  }

  const dataDirectoryOffset = optionalOffset + optionalLayout.dataDirectoryOffset;
  const numberOfDirectories = content.readUInt32LE(
    optionalOffset + optionalLayout.numberOfDirectoriesOffset,
  );
  const availableDirectories = Math.floor((optionalEnd - dataDirectoryOffset) / 8);
  if (numberOfDirectories > availableDirectories) return null;
  const canonicalizeChecksum = () => {
    const canonical = Buffer.from(content);
    canonical.writeUInt32LE(0, optionalOffset + 64);
    return canonical;
  };
  if (numberOfDirectories <= 4) return canonicalizeChecksum();

  const certificateEntryOffset = dataDirectoryOffset + 32;
  const certificateOffset = content.readUInt32LE(certificateEntryOffset);
  const certificateSize = content.readUInt32LE(certificateEntryOffset + 4);
  if (certificateOffset === 0 && certificateSize === 0) return canonicalizeChecksum();
  if (certificateOffset === 0 || certificateSize === 0 || certificateOffset % 8 !== 0) return null;
  if (certificateOffset > content.length || certificateSize > content.length - certificateOffset) return null;
  const certificateEnd = certificateOffset + certificateSize;
  if (certificateEnd !== content.length || certificateOffset < sizeOfHeaders) return null;
  if (sectionRanges.some((range) => certificateOffset < range.end && range.start < certificateEnd)) {
    return null;
  }
  if (!hasWellFormedWinCertificateSequence(content, certificateOffset, certificateSize)) return null;

  const canonical = Buffer.from(content.subarray(0, certificateOffset));
  canonical.writeUInt32LE(0, optionalOffset + 64);
  canonical.writeUInt32LE(0, certificateEntryOffset);
  canonical.writeUInt32LE(0, certificateEntryOffset + 4);
  return canonical;
}

function canonicalizeSignedExecutable(content) {
  return canonicalizeThinMachO(content)
    ?? canonicalizeFatMachO(content)
    ?? canonicalizePortableExecutable(content)
    ?? content;
}

module.exports = {
  canonicalizeSignedExecutable,
  collectFiles,
  hashNamedContents,
  normalizePath,
};
