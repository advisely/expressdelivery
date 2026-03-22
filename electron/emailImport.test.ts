import { describe, it, expect, vi } from 'vitest';

vi.mock('electron', () => ({
    dialog: { showOpenDialog: vi.fn() },
    BrowserWindow: { getFocusedWindow: vi.fn() },
}));

vi.mock('./db.js', () => ({
    getDatabase: vi.fn(),
}));

import { stripDangerousHtml, parseEmlContent } from './emailImport.js';

// ─────────────────────────────────────────────────────────────────────────────
// stripDangerousHtml — XSS prevention for imported emails
// ─────────────────────────────────────────────────────────────────────────────
describe('stripDangerousHtml', () => {
    it('removes script tags and their content', () => {
        const html = '<p>Hello</p><script>alert(1)</script><p>World</p>';
        expect(stripDangerousHtml(html)).toBe('<p>Hello</p><p>World</p>');
    });

    it('removes script tags case-insensitively', () => {
        const html = '<SCRIPT type="text/javascript">evil()</SCRIPT>';
        expect(stripDangerousHtml(html)).toBe('');
    });

    it('removes multiline script blocks', () => {
        const html = '<script>\n  var x = 1;\n  alert(x);\n</script>';
        expect(stripDangerousHtml(html)).toBe('');
    });

    it('removes inline event handlers (onclick, onerror, etc.)', () => {
        const html = '<img src="x" onerror="alert(1)" />';
        const result = stripDangerousHtml(html);
        expect(result).not.toContain('onerror');
        expect(result).not.toContain('alert');
    });

    it('removes onload event handlers', () => {
        const html = '<body onload="steal()">';
        const result = stripDangerousHtml(html);
        expect(result).not.toContain('onload');
        expect(result).not.toContain('steal');
    });

    it('removes onmouseover handlers with double quotes', () => {
        const html = '<div onmouseover="malicious()">text</div>';
        const result = stripDangerousHtml(html);
        expect(result).not.toContain('onmouseover');
    });

    it('preserves safe HTML content', () => {
        const html = '<h1>Hello</h1><p>Normal <strong>email</strong> content</p>';
        expect(stripDangerousHtml(html)).toBe(html);
    });

    it('preserves safe attributes like href and src', () => {
        const html = '<a href="https://example.com">link</a><img src="photo.jpg" />';
        expect(stripDangerousHtml(html)).toBe(html);
    });

    it('handles empty string', () => {
        expect(stripDangerousHtml('')).toBe('');
    });

    it('handles multiple script tags', () => {
        const html = '<script>a()</script><p>safe</p><script>b()</script>';
        expect(stripDangerousHtml(html)).toBe('<p>safe</p>');
    });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseEmlContent — RFC 2822 email parser
// ─────────────────────────────────────────────────────────────────────────────
describe('parseEmlContent', () => {
    const makeEml = (headers: string, body: string) =>
        `${headers}\r\n\r\n${body}`;

    it('parses plain-text email headers correctly', () => {
        const eml = makeEml(
            'From: Alice <alice@example.com>\r\nTo: bob@example.com\r\nSubject: Hello\r\nDate: Mon, 01 Jan 2024 12:00:00 +0000\r\nMessage-ID: <msg1@example.com>',
            'Hello Bob!'
        );
        const result = parseEmlContent(eml);
        expect(result).not.toBeNull();
        expect(result!.from_name).toBe('Alice');
        expect(result!.from_email).toBe('alice@example.com');
        expect(result!.to_email).toBe('bob@example.com');
        expect(result!.subject).toBe('Hello');
        expect(result!.body_text).toBe('Hello Bob!');
        expect(result!.message_id).toBe('msg1@example.com');
    });

    it('returns null for email with no header/body separator', () => {
        const result = parseEmlContent('From: alice@example.comSubject: NoSepBody');
        expect(result).toBeNull();
    });

    it('handles Unix-style line endings (LF only)', () => {
        const eml = 'From: alice@example.com\nSubject: Test\n\nBody here';
        const result = parseEmlContent(eml);
        expect(result).not.toBeNull();
        expect(result!.subject).toBe('Test');
        expect(result!.body_text).toBe('Body here');
    });

    it('extracts from_name and from_email from "Name <email>" format', () => {
        const eml = makeEml('From: "John Doe" <john@test.com>\r\nSubject: Hi', 'body');
        const result = parseEmlContent(eml);
        expect(result!.from_name).toBe('John Doe');
        expect(result!.from_email).toBe('john@test.com');
    });

    it('handles from without angle brackets (email only)', () => {
        const eml = makeEml('From: plain@example.com\r\nSubject: Hi', 'body');
        const result = parseEmlContent(eml);
        expect(result!.from_email).toBe('plain@example.com');
        expect(result!.from_name).toBe('');
    });

    it('handles text/html content type', () => {
        const eml = makeEml(
            'From: a@b.com\r\nSubject: HTML\r\nContent-Type: text/html; charset=utf-8',
            '<p>HTML body</p>'
        );
        const result = parseEmlContent(eml);
        expect(result!.body_html).toBe('<p>HTML body</p>');
        expect(result!.body_text).toBe('');
    });

    it('parses multipart/alternative with text and HTML parts', () => {
        const boundary = 'boundary123';
        // Parser splits on \n\n within each part to separate part headers from body
        const body = `--${boundary}\nContent-Type: text/plain\n\nPlain text\n--${boundary}\nContent-Type: text/html\n\n<p>HTML</p>\n--${boundary}--`;
        const eml = makeEml(
            `From: a@b.com\r\nSubject: Multi\r\nContent-Type: multipart/alternative; boundary="${boundary}"`,
            body
        );
        const result = parseEmlContent(eml);
        expect(result!.body_text).toBe('Plain text');
        expect(result!.body_html).toBe('<p>HTML</p>');
    });

    it('handles boundary with regex special characters', () => {
        const boundary = '----=_Part_123.456+789';
        const body = `--${boundary}\nContent-Type: text/plain\n\nSafe text\n--${boundary}--`;
        const eml = makeEml(
            `From: a@b.com\r\nSubject: Special\r\nContent-Type: multipart/mixed; boundary="${boundary}"`,
            body
        );
        const result = parseEmlContent(eml);
        expect(result).not.toBeNull();
        expect(result!.body_text).toBe('Safe text');
    });

    it('handles null/empty subject gracefully', () => {
        const eml = makeEml('From: a@b.com', 'body');
        const result = parseEmlContent(eml);
        expect(result!.subject).toBe('');
    });

    it('generates valid ISO date from Date header', () => {
        const eml = makeEml(
            'From: a@b.com\r\nDate: Thu, 20 Mar 2026 10:30:00 +0000',
            'body'
        );
        const result = parseEmlContent(eml);
        expect(result!.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('falls back to current date when Date header is missing', () => {
        const eml = makeEml('From: a@b.com\r\nSubject: No date', 'body');
        const result = parseEmlContent(eml);
        // Should be a valid ISO date (current time)
        expect(result!.date).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
});
