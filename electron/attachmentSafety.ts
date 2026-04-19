/**
 * Attachment safety: extension denylist + magic-byte sniff for MIME-mismatch.
 *
 * Purpose: prevent the user from saving a file that is either (a) inherently
 * dangerous by extension, or (b) misrepresented (e.g., an executable with a
 * .pdf or .jpg name, or a ZIP container disguised as a .txt). Both surface
 * as a confirmation gate in the renderer.
 *
 * Hand-rolled (no `file-type` dep) to keep the security boundary auditable in
 * a single small file. Covers the magic bytes that matter for malware delivery
 * via email; expand as new threat patterns appear.
 */

/**
 * Extensions that should NEVER be saved without explicit user confirmation,
 * regardless of declared MIME type or content. Lower-cased, with leading dot.
 */
export const DANGEROUS_EXTENSIONS: ReadonlySet<string> = new Set([
    // Windows executables / shortcuts / installers
    '.exe', '.scr', '.bat', '.cmd', '.com', '.pif', '.msi', '.lnk',
    '.dll', '.cpl', '.msc', '.gadget', '.application', '.appx', '.msix',
    // Scripting (executes by double-click on Windows / runtime risk elsewhere)
    '.vbs', '.vbe', '.js', '.jse', '.jar', '.ps1', '.ps2', '.psm1',
    '.wsf', '.wsh', '.hta', '.reg', '.scf', '.url',
    // Office macro-enabled documents
    '.docm', '.dotm', '.xlsm', '.xltm', '.pptm', '.potm', '.ppam', '.sldm',
    // Disk images / archives that can chain-execute
    '.iso', '.img', '.vhd', '.vhdx', '.ace',
    // Unix shell that may run on macOS/Linux without prompting
    '.sh', '.bash', '.zsh', '.command',
]);

/** Detected file type from magic-byte inspection. Narrow set — only what we act on. */
export type MagicType = 'exe' | 'elf' | 'pdf' | 'zip' | 'png' | 'jpeg' | 'gif' | 'html' | 'rtf' | 'ole';

/**
 * Inspect the first few bytes of a buffer and return the detected file type,
 * or null if no known magic-byte pattern matches.
 *
 * Recognized signatures:
 * - EXE  (PE/MZ)        : 4D 5A
 * - ELF                 : 7F 45 4C 46
 * - PDF                 : %PDF
 * - ZIP/Office/JAR      : 50 4B 03 04
 * - PNG                 : 89 50 4E 47 0D 0A 1A 0A
 * - JPEG                : FF D8 FF
 * - GIF                 : GIF87a / GIF89a
 * - RTF                 : {\rtf
 * - OLE (DOC/XLS/PPT)   : D0 CF 11 E0 A1 B1 1A E1
 * - HTML                : leading whitespace + <!DOCTYPE or <html (case-insensitive)
 */
export function detectMagicBytes(buf: Buffer): MagicType | null {
    if (buf.length < 2) return null;

    if (buf[0] === 0x4d && buf[1] === 0x5a) return 'exe';

    if (buf.length >= 4) {
        if (buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) return 'elf';
        if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
        if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg';
        // PDF: %PDF
        if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) return 'pdf';
        // GIF87a / GIF89a
        if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) return 'gif';
    }

    if (buf.length >= 5) {
        // RTF: {\rtf
        if (buf[0] === 0x7b && buf[1] === 0x5c && buf[2] === 0x72 && buf[3] === 0x74 && buf[4] === 0x66) return 'rtf';
    }

    if (buf.length >= 8) {
        if (
            buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
            buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
        ) {
            return 'png';
        }
        // OLE compound document (legacy .doc/.xls/.ppt — major macro-virus vector)
        if (
            buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0 &&
            buf[4] === 0xa1 && buf[5] === 0xb1 && buf[6] === 0x1a && buf[7] === 0xe1
        ) {
            return 'ole';
        }
    }

    // HTML detection: skip leading whitespace, then look for <!DOCTYPE or <html.
    // Limit the snippet to 256 bytes so we never decode a multi-MB binary.
    const head = buf.slice(0, Math.min(buf.length, 256)).toString('utf-8').trimStart().toLowerCase();
    if (head.startsWith('<!doctype html') || head.startsWith('<html')) return 'html';

    return null;
}

export interface AttachmentRisk {
    /** safe = OK to save without confirmation. extension = name is dangerous. mismatch = magic bytes don't match the claimed extension. */
    risk: 'safe' | 'extension' | 'mismatch';
    /** Human-readable reason, suitable for a ConfirmDialog body. Null when risk='safe'. */
    reason: string | null;
    /** When risk='mismatch', the magic-byte-detected type (e.g., 'exe', 'elf'). */
    detectedType?: MagicType;
}

/**
 * Magic types that, when found, indicate the file is likely an executable
 * payload. Triggers mismatch on ANY non-dangerous extension (an exe disguised
 * as an image is the classic email-malware vector).
 */
const EXECUTABLE_MAGIC_TYPES: ReadonlySet<MagicType> = new Set(['exe', 'elf']);

/**
 * Allowlist of magic types per extension. When a file's extension is in this
 * map, the detected magic-bytes MUST be in the corresponding set or the file
 * is flagged as a mismatch. An empty set means the extension is expected to
 * have NO recognized magic (i.e., plain text).
 *
 * This is the load-bearing check for ZIP/HTML/RTF impersonation attacks (e.g.,
 * a `.txt` file that's actually a ZIP malware container, or a `.pdf` that's
 * actually an HTML phishing landing page).
 */
const ALLOWED_MAGIC_BY_EXTENSION: Record<string, ReadonlySet<MagicType>> = {
    '.pdf':  new Set(['pdf']),
    '.png':  new Set(['png']),
    '.jpg':  new Set(['jpeg']),
    '.jpeg': new Set(['jpeg']),
    '.gif':  new Set(['gif']),
    '.html': new Set(['html']),
    '.htm':  new Set(['html']),
    '.zip':  new Set(['zip']),
    '.docx': new Set(['zip']),
    '.xlsx': new Set(['zip']),
    '.pptx': new Set(['zip']),
    '.odt':  new Set(['zip']),
    '.ods':  new Set(['zip']),
    '.odp':  new Set(['zip']),
    '.epub': new Set(['zip']),
    '.jar':  new Set(['zip']),
    '.rtf':  new Set(['rtf']),
    '.doc':  new Set(['ole']),
    '.xls':  new Set(['ole']),
    '.ppt':  new Set(['ole']),
    '.txt':  new Set(),  // plain text: ANY recognized magic is suspicious
    '.csv':  new Set(),
    '.json': new Set(),
    '.xml':  new Set(),
};

/** Lower-cased trailing extension including the dot (e.g., '.pdf'). Empty string if no dot. */
function getExtension(filename: string): string {
    const dot = filename.lastIndexOf('.');
    if (dot < 0) return '';
    return filename.slice(dot).toLowerCase();
}

/**
 * Strip control characters and bidi-override codepoints from a filename
 * before interpolating it into a user-facing message. Defense against the
 * "RTLO trick" where U+202E reverses subsequent characters so that
 * "photo<RTLO>gpj.exe" displays as "photoexe.jpg".
 */
function sanitizeFilenameForDisplay(filename: string): string {
    // C0 controls (0x00-0x1F), DEL (0x7F), bidi formatting characters
    // (LRE/RLE/PDF/LRO/RLO U+202A-U+202E and LRI/RLI/FSI/PDI U+2066-U+2069).
    return filename.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
}

/**
 * Assess the risk of saving an attachment to disk. Returns:
 * - 'extension'  when the file's name ends with a dangerous extension.
 * - 'mismatch'   when the magic bytes indicate executable content, OR when
 *                the extension's allowlist does not contain the detected
 *                magic type.
 * - 'safe'       otherwise.
 *
 * Both 'extension' and 'mismatch' should require the user to explicitly
 * confirm before the file is written.
 */
export function assessAttachmentRisk(
    filename: string,
    _mimeType: string,
    content: Buffer,
): AttachmentRisk {
    const ext = getExtension(filename);
    const safeFilename = sanitizeFilenameForDisplay(filename);

    // 1. Dangerous extension always wins, before magic-byte sniff. The user
    //    is being asked to consent to running code regardless of payload.
    if (ext && DANGEROUS_EXTENSIONS.has(ext)) {
        return {
            risk: 'extension',
            reason: `Files with the ${ext} extension can run code on your computer when opened. Only save "${safeFilename}" if you trust the sender.`,
        };
    }

    const detected = detectMagicBytes(content);
    if (!detected) return { risk: 'safe', reason: null };

    // 2. Executable magic in any non-dangerous-extension file is ALWAYS a
    //    mismatch — there is no benign reason for a non-.exe file to begin
    //    with PE or ELF magic.
    if (EXECUTABLE_MAGIC_TYPES.has(detected)) {
        return {
            risk: 'mismatch',
            reason: `"${safeFilename}" is named like a benign file but its content is a ${detected.toUpperCase()} executable. Saving it could disguise malware. Only save if you trust the sender.`,
            detectedType: detected,
        };
    }

    // 3. Extension-specific allowlist check. Catches ZIP-as-.txt malware
    //    containers, HTML-as-.pdf phishing landers, RTF-as-.pdf CVE vectors.
    const allowed = ALLOWED_MAGIC_BY_EXTENSION[ext];
    if (allowed !== undefined && !allowed.has(detected)) {
        return {
            risk: 'mismatch',
            reason: `"${safeFilename}" claims to be a ${ext} file but its content is ${detected.toUpperCase()}. Saving it could disguise malicious content. Only save if you trust the sender.`,
            detectedType: detected,
        };
    }

    return { risk: 'safe', reason: null };
}
