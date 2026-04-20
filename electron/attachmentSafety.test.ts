import { describe, it, expect } from 'vitest';
import {
    DANGEROUS_EXTENSIONS,
    detectMagicBytes,
    assessAttachmentRisk,
} from './attachmentSafety.js';

describe('DANGEROUS_EXTENSIONS', () => {
    it('includes Windows executables', () => {
        expect(DANGEROUS_EXTENSIONS.has('.exe')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.scr')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.com')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.bat')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.cmd')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.pif')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.msi')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.lnk')).toBe(true);
    });

    it('includes scripting languages with execution risk', () => {
        expect(DANGEROUS_EXTENSIONS.has('.vbs')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.js')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.jar')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.ps1')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.wsf')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.hta')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.reg')).toBe(true);
    });

    it('includes Office macro-enabled formats', () => {
        expect(DANGEROUS_EXTENSIONS.has('.docm')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.xlsm')).toBe(true);
        expect(DANGEROUS_EXTENSIONS.has('.pptm')).toBe(true);
    });

    it('does NOT include benign formats', () => {
        expect(DANGEROUS_EXTENSIONS.has('.txt')).toBe(false);
        expect(DANGEROUS_EXTENSIONS.has('.pdf')).toBe(false);
        expect(DANGEROUS_EXTENSIONS.has('.png')).toBe(false);
        expect(DANGEROUS_EXTENSIONS.has('.jpg')).toBe(false);
        expect(DANGEROUS_EXTENSIONS.has('.docx')).toBe(false);
        expect(DANGEROUS_EXTENSIONS.has('.zip')).toBe(false);
    });
});

describe('detectMagicBytes', () => {
    it('detects Windows PE executables (MZ header)', () => {
        const buf = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
        expect(detectMagicBytes(buf)).toBe('exe');
    });

    it('detects Linux ELF executables', () => {
        const buf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01]);
        expect(detectMagicBytes(buf)).toBe('elf');
    });

    it('detects PDF files (%PDF marker)', () => {
        const buf = Buffer.from('%PDF-1.7\n');
        expect(detectMagicBytes(buf)).toBe('pdf');
    });

    it('detects ZIP/Office/JAR (PK\\x03\\x04 marker)', () => {
        const buf = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
        expect(detectMagicBytes(buf)).toBe('zip');
    });

    it('detects PNG files', () => {
        const buf = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        expect(detectMagicBytes(buf)).toBe('png');
    });

    it('detects JPEG files', () => {
        const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
        expect(detectMagicBytes(buf)).toBe('jpeg');
    });

    it('detects HTML by leading whitespace + <!DOCTYPE or <html', () => {
        expect(detectMagicBytes(Buffer.from('<!DOCTYPE html>\n<html>'))).toBe('html');
        expect(detectMagicBytes(Buffer.from('<html lang="en">'))).toBe('html');
        expect(detectMagicBytes(Buffer.from('  \r\n<!doctype HTML>'))).toBe('html');
    });

    it('returns null for unrecognized binary', () => {
        const buf = Buffer.from([0x00, 0x00, 0x00, 0x00]);
        expect(detectMagicBytes(buf)).toBeNull();
    });

    it('returns null for empty buffer', () => {
        expect(detectMagicBytes(Buffer.alloc(0))).toBeNull();
    });
});

describe('assessAttachmentRisk', () => {
    const benignBuffer = Buffer.from('plain text content');
    const exeMagic = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]);
    const pdfMagic = Buffer.from('%PDF-1.7\n');
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

    it('marks plain .txt with benign content as safe', () => {
        const result = assessAttachmentRisk('notes.txt', 'text/plain', benignBuffer);
        expect(result.risk).toBe('safe');
    });

    it('flags .exe extension as dangerous regardless of content', () => {
        const result = assessAttachmentRisk('installer.exe', 'application/octet-stream', exeMagic);
        expect(result.risk).toBe('extension');
        expect(result.reason).toContain('.exe');
    });

    it('flags .scr extension as dangerous', () => {
        const result = assessAttachmentRisk('screensaver.scr', 'application/octet-stream', exeMagic);
        expect(result.risk).toBe('extension');
    });

    it('flags .docm (macro-enabled Word) as dangerous', () => {
        const result = assessAttachmentRisk('report.docm', 'application/vnd.ms-word.document.macroEnabled.12', Buffer.from([0x50, 0x4b, 0x03, 0x04]));
        expect(result.risk).toBe('extension');
    });

    it('detects executable disguised as image (.jpg with MZ header)', () => {
        const result = assessAttachmentRisk('vacation.jpg', 'image/jpeg', exeMagic);
        expect(result.risk).toBe('mismatch');
        expect(result.detectedType).toBe('exe');
        expect(result.reason).toMatch(/executable/i);
    });

    it('detects executable disguised as PDF', () => {
        const result = assessAttachmentRisk('invoice.pdf', 'application/pdf', exeMagic);
        expect(result.risk).toBe('mismatch');
        expect(result.detectedType).toBe('exe');
    });

    it('detects ELF executable disguised as PDF', () => {
        const elfMagic = Buffer.from([0x7f, 0x45, 0x4c, 0x46]);
        const result = assessAttachmentRisk('document.pdf', 'application/pdf', elfMagic);
        expect(result.risk).toBe('mismatch');
        expect(result.detectedType).toBe('elf');
    });

    it('does not false-positive a real PDF named .pdf', () => {
        const result = assessAttachmentRisk('real.pdf', 'application/pdf', pdfMagic);
        expect(result.risk).toBe('safe');
    });

    it('does not false-positive a real PNG named .png', () => {
        const result = assessAttachmentRisk('image.png', 'image/png', pngMagic);
        expect(result.risk).toBe('safe');
    });

    it('does not flag a benign extension with unknown magic bytes', () => {
        const result = assessAttachmentRisk('notes.txt', 'text/plain', Buffer.from([0x00, 0x01, 0x02]));
        expect(result.risk).toBe('safe');
    });

    it('handles uppercase extensions correctly', () => {
        const result = assessAttachmentRisk('VIRUS.EXE', 'application/octet-stream', exeMagic);
        expect(result.risk).toBe('extension');
    });

    it('uses the LAST dot for extension detection (multiple dots in name)', () => {
        const result = assessAttachmentRisk('archive.tar.exe', 'application/octet-stream', exeMagic);
        expect(result.risk).toBe('extension');
    });

    it('flags zero-byte files as safe (no magic bytes to read)', () => {
        const result = assessAttachmentRisk('empty.txt', 'text/plain', Buffer.alloc(0));
        expect(result.risk).toBe('safe');
    });

    it('flags unknown extension with executable magic as mismatch', () => {
        const result = assessAttachmentRisk('mystery.dat', 'application/octet-stream', exeMagic);
        expect(result.risk).toBe('mismatch');
        expect(result.detectedType).toBe('exe');
    });

    it('flags ZIP magic disguised as .txt as mismatch (malware container)', () => {
        const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
        const result = assessAttachmentRisk('readme.txt', 'text/plain', zipMagic);
        expect(result.risk).toBe('mismatch');
        expect(result.detectedType).toBe('zip');
    });

    it('flags ZIP magic disguised as .png as mismatch', () => {
        const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
        const result = assessAttachmentRisk('icon.png', 'image/png', zipMagic);
        expect(result.risk).toBe('mismatch');
        expect(result.detectedType).toBe('zip');
    });

    it('does NOT flag a real .docx (ZIP-based Office Open XML) as mismatch', () => {
        const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
        const result = assessAttachmentRisk('report.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', zipMagic);
        expect(result.risk).toBe('safe');
    });

    it('does NOT flag a real .jar (ZIP-based) as mismatch — but still flags .jar as dangerous extension', () => {
        const zipMagic = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
        const result = assessAttachmentRisk('plugin.jar', 'application/java-archive', zipMagic);
        expect(result.risk).toBe('extension');
    });

    it('flags HTML disguised as .pdf as mismatch (phishing landing page vector)', () => {
        const htmlMagic = Buffer.from('<!DOCTYPE html>\n<html>');
        const result = assessAttachmentRisk('invoice.pdf', 'application/pdf', htmlMagic);
        expect(result.risk).toBe('mismatch');
        expect(result.detectedType).toBe('html');
    });

    it('detects RTF files via magic bytes', () => {
        const rtfMagic = Buffer.from('{\\rtf1\\ansi');
        // RTF in a non-doc extension is suspicious; in a .rtf is benign.
        const benign = assessAttachmentRisk('letter.rtf', 'application/rtf', rtfMagic);
        expect(benign.risk).toBe('safe');
    });

    it('flags RTF magic in a .pdf or .png as mismatch (CVE-2017-0199 vector)', () => {
        const rtfMagic = Buffer.from('{\\rtf1\\ansi\\ansicpg1252');
        const result = assessAttachmentRisk('invoice.pdf', 'application/pdf', rtfMagic);
        expect(result.risk).toBe('mismatch');
    });

    it('sanitizes filename in reason — strips control characters and RTLO bidi overrides', () => {
        // Right-to-left override (U+202E) is used to disguise extensions:
        // "photo<RTLO>gpj.exe" displays as "photoexe.jpg" in some renderers.
        const filename = 'photo\u202egpj.exe';
        const result = assessAttachmentRisk(filename, 'image/jpeg', exeMagic);
        expect(result.risk).toBe('extension');
        expect(result.reason).not.toContain('\u202e');
        // Control characters stripped too
        const filename2 = 'evil\u0000.exe';
        const result2 = assessAttachmentRisk(filename2, 'application/octet-stream', exeMagic);
        expect(result2.reason).not.toContain('\u0000');
    });
});
