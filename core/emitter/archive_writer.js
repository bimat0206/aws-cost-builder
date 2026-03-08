/**
 * Archive writer — produces a gzip-compressed tar archive of HCL profile files.
 * @module core/emitter/archive_writer
 *
 * Uses only Node.js built-ins: zlib, fs, path, stream — no additional npm deps.
 *
 * Tar format: POSIX ustar (GNU-compatible).
 */

import { createGzip, createGunzip } from 'node:zlib';
import { createReadStream, createWriteStream } from 'node:fs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, basename, extname } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Readable, PassThrough } from 'node:stream';

// ─── Tar helpers ──────────────────────────────────────────────────────────────

const TAR_BLOCK_SIZE = 512;

/**
 * Encode a string into a fixed-length ASCII buffer, null-padded.
 * @param {string} str
 * @param {number} len
 * @returns {Buffer}
 */
function tarField(str, len) {
    const buf = Buffer.alloc(len, 0);
    Buffer.from(str, 'ascii').copy(buf, 0, 0, len - 1);
    return buf;
}

/**
 * Write an octal number into a fixed-length field, space-terminated.
 * @param {number} num
 * @param {number} len
 * @returns {Buffer}
 */
function tarOctal(num, len) {
    const str = num.toString(8).padStart(len - 1, '0');
    const buf = Buffer.alloc(len, 0x20);
    Buffer.from(str, 'ascii').copy(buf, 0);
    buf[len - 1] = 0;
    return buf;
}

/**
 * Build a ustar header block for a file entry.
 * @param {string} name - filename (max 100 chars)
 * @param {number} size - file size in bytes
 * @returns {Buffer} 512-byte header block
 */
function buildTarHeader(name, size) {
    const header = Buffer.alloc(TAR_BLOCK_SIZE, 0);
    const now = Math.floor(Date.now() / 1000);

    tarField(name, 100).copy(header, 0);       // name
    tarOctal(0o644, 8).copy(header, 100);       // mode
    tarOctal(0, 8).copy(header, 108);           // uid
    tarOctal(0, 8).copy(header, 116);           // gid
    tarOctal(size, 12).copy(header, 124);       // size
    tarOctal(now, 12).copy(header, 136);        // mtime
    Buffer.from('        ', 'ascii').copy(header, 148); // checksum placeholder
    header[156] = 0x30;                         // typeflag = '0' (regular file)
    tarField('ustar', 6).copy(header, 257);     // magic
    tarField('00', 2).copy(header, 263);        // version

    // Compute checksum
    let checksum = 0;
    for (let i = 0; i < TAR_BLOCK_SIZE; i++) checksum += header[i];
    tarOctal(checksum, 8).copy(header, 148);

    return header;
}

/**
 * Pad a buffer to a multiple of 512 bytes.
 * @param {Buffer} data
 * @returns {Buffer}
 */
function padToBlock(data) {
    const rem = data.length % TAR_BLOCK_SIZE;
    if (rem === 0) return data;
    const padding = Buffer.alloc(TAR_BLOCK_SIZE - rem, 0);
    return Buffer.concat([data, padding]);
}

/**
 * Build a complete in-memory tar archive from a list of file entries.
 * @param {Array<{name: string, data: Buffer}>} entries
 * @returns {Buffer}
 */
function buildTar(entries) {
    const parts = [];
    for (const entry of entries) {
        parts.push(buildTarHeader(entry.name, entry.data.length));
        parts.push(padToBlock(entry.data));
    }
    // Two 512-byte zero blocks mark end of archive
    parts.push(Buffer.alloc(TAR_BLOCK_SIZE * 2, 0));
    return Buffer.concat(parts);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Write a gzip-compressed tar archive of all .hcl files in a directory.
 *
 * @param {string} profilesDir - directory containing .hcl files
 * @param {string} outputPath  - destination path for the .tar.gz file
 * @returns {Promise<{files: string[], outputPath: string}>}
 */
export async function writeProfileArchive(profilesDir, outputPath) {
    const allFiles = await readdir(profilesDir).catch(() => []);
    const hclFiles = allFiles.filter(f => extname(f).toLowerCase() === '.hcl');

    const entries = [];
    for (const filename of hclFiles) {
        const filePath = join(profilesDir, filename);
        const data = await readFile(filePath);
        entries.push({ name: filename, data });
    }

    const tarBuffer = buildTar(entries);

    // Gzip compress
    const compressed = await new Promise((resolve, reject) => {
        const chunks = [];
        const gz = createGzip({ level: 9 });
        gz.on('data', chunk => chunks.push(chunk));
        gz.on('end', () => resolve(Buffer.concat(chunks)));
        gz.on('error', reject);
        gz.end(tarBuffer);
    });

    await mkdir(join(outputPath, '..'), { recursive: true }).catch(() => {});
    await writeFile(outputPath, compressed);

    return { files: hclFiles, outputPath };
}

/**
 * Extract a gzip-compressed tar archive of .hcl files to a directory.
 *
 * @param {string} archivePath - path to .tar.gz file
 * @param {string} outputDir   - directory to extract files into
 * @returns {Promise<{files: string[], outputDir: string}>}
 */
export async function extractProfileArchive(archivePath, outputDir) {
    await mkdir(outputDir, { recursive: true });

    const compressed = await readFile(archivePath);

    // Gunzip
    const tarBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        const gz = createGunzip();
        gz.on('data', chunk => chunks.push(chunk));
        gz.on('end', () => resolve(Buffer.concat(chunks)));
        gz.on('error', reject);
        gz.end(compressed);
    });

    // Parse tar
    const extractedFiles = [];
    let offset = 0;

    while (offset + TAR_BLOCK_SIZE <= tarBuffer.length) {
        const header = tarBuffer.slice(offset, offset + TAR_BLOCK_SIZE);
        offset += TAR_BLOCK_SIZE;

        // End-of-archive: two zero blocks
        if (header.every(b => b === 0)) break;

        const name = header.slice(0, 100).toString('ascii').replace(/\0/g, '').trim();
        const size = parseInt(header.slice(124, 136).toString('ascii').trim(), 8);

        if (!name || isNaN(size)) continue;

        const data = tarBuffer.slice(offset, offset + size);
        offset += Math.ceil(size / TAR_BLOCK_SIZE) * TAR_BLOCK_SIZE;

        if (extname(name).toLowerCase() === '.hcl') {
            const outPath = join(outputDir, basename(name));
            await writeFile(outPath, data);
            extractedFiles.push(basename(name));
        }
    }

    return { files: extractedFiles, outputDir };
}
