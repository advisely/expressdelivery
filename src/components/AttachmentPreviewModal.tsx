import { useEffect, useState, type FC } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X, Download, FileText } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ipcInvoke } from '../lib/ipc';
import { formatFileSize } from '../lib/formatFileSize';
import styles from './AttachmentPreviewModal.module.css';

export interface PreviewAttachment {
    id: string;
    email_id: string;
    filename: string;
    mime_type: string;
    size: number;
}

interface AttachmentPreviewModalProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    attachment: PreviewAttachment | null;
    onDownloadError?: (message: string) => void;
}

/**
 * Floating preview for email attachments. Click the filename in the reading
 * pane to open this dialog; click the download icon (separate button) to
 * save without previewing.
 *
 * Supports:
 *  - PDF via <iframe src={blob URL}> — Chromium's built-in PDF viewer
 *  - Images (png/jpeg/gif/webp/bmp) via <img src={data URL}>
 *  - Plain text and markdown via <pre>
 *  - Everything else: fallback card with filename + size + explicit download
 *
 * The preview content is fetched via `attachments:download` which runs the
 * on-demand IMAP body part fetch if the attachment isn't already cached in
 * SQLite BLOB storage. Same code path used by the actual download — if the
 * preview fetches successfully, download will too.
 */
export const AttachmentPreviewModal: FC<AttachmentPreviewModalProps> = ({
    open,
    onOpenChange,
    attachment,
    onDownloadError,
}) => {
    const { t } = useTranslation();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [blobUrl, setBlobUrl] = useState<string | null>(null);
    const [dataUrl, setDataUrl] = useState<string | null>(null);
    const [textContent, setTextContent] = useState<string | null>(null);
    const [rawBase64, setRawBase64] = useState<string | null>(null);

    // Reset state when the dialog closes or the attachment changes
    useEffect(() => {
        if (!open || !attachment) {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
            setBlobUrl(null);
            setDataUrl(null);
            setTextContent(null);
            setRawBase64(null);
            setError(null);
            setLoading(false);
            return;
        }

        let cancelled = false;
        setLoading(true);
        setError(null);

        (async () => {
            try {
                const result = await ipcInvoke<{
                    filename: string;
                    mimeType: string;
                    content: string;
                }>('attachments:download', {
                    attachmentId: attachment.id,
                    emailId: attachment.email_id,
                });

                if (cancelled) return;
                if (!result || !result.content) {
                    setError(t('readingPane.previewFailed'));
                    return;
                }

                setRawBase64(result.content);

                if (attachment.mime_type === 'application/pdf') {
                    // Chromium renders PDFs from blob: URLs in iframes.
                    const binary = atob(result.content);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    const blob = new Blob([bytes], { type: 'application/pdf' });
                    setBlobUrl(URL.createObjectURL(blob));
                } else if (attachment.mime_type.startsWith('image/')) {
                    setDataUrl(`data:${attachment.mime_type};base64,${result.content}`);
                } else if (
                    attachment.mime_type.startsWith('text/') ||
                    attachment.mime_type === 'application/json' ||
                    attachment.mime_type === 'application/xml'
                ) {
                    try {
                        setTextContent(atob(result.content));
                    } catch {
                        setError(t('readingPane.previewFailed'));
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    const msg = err instanceof Error ? err.message : String(err);
                    setError(msg);
                }
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [open, attachment, t]); // eslint-disable-line react-hooks/exhaustive-deps

    // Clean up blob URL on unmount
    useEffect(() => {
        return () => {
            if (blobUrl) URL.revokeObjectURL(blobUrl);
        };
    }, [blobUrl]);

    const handleDownload = async () => {
        if (!attachment || !rawBase64) return;
        try {
            await ipcInvoke('attachments:save', {
                filename: attachment.filename,
                content: rawBase64,
            });
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            onDownloadError?.(msg);
        }
    };

    const isPreviewable =
        attachment !== null &&
        (attachment.mime_type === 'application/pdf' ||
            attachment.mime_type.startsWith('image/') ||
            attachment.mime_type.startsWith('text/') ||
            attachment.mime_type === 'application/json' ||
            attachment.mime_type === 'application/xml');

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className={styles['overlay']} />
                <Dialog.Content className={styles['content']}>
                    <header className={styles['header']}>
                        <div className={styles['title-group']}>
                            <FileText size={18} />
                            <Dialog.Title className={styles['title']}>
                                {attachment?.filename ?? ''}
                            </Dialog.Title>
                            {attachment && (
                                <span className={styles['size']}>
                                    {formatFileSize(attachment.size)}
                                </span>
                            )}
                        </div>
                        <div className={styles['actions']}>
                            <button
                                type="button"
                                className={styles['download-btn']}
                                onClick={handleDownload}
                                disabled={loading || !rawBase64}
                                aria-label={t('readingPane.downloadAttachment')}
                                title={t('readingPane.downloadAttachment')}
                            >
                                <Download size={16} />
                                <span>{t('readingPane.download')}</span>
                            </button>
                            <Dialog.Close asChild>
                                <button
                                    type="button"
                                    className={styles['close-btn']}
                                    aria-label={t('common.close')}
                                >
                                    <X size={18} />
                                </button>
                            </Dialog.Close>
                        </div>
                    </header>

                    <div className={styles['body']}>
                        {loading && (
                            <div className={styles['state']}>
                                <div className={styles['spinner']} />
                                <span>{t('readingPane.previewLoading')}</span>
                            </div>
                        )}

                        {!loading && error && (
                            <div className={styles['state']} role="alert">
                                <span>{t('readingPane.previewFailed')}</span>
                                <span className={styles['state-detail']}>{error}</span>
                            </div>
                        )}

                        {!loading && !error && blobUrl && attachment?.mime_type === 'application/pdf' && (
                            <iframe
                                src={blobUrl}
                                className={styles['pdf-frame']}
                                title={attachment.filename}
                            />
                        )}

                        {!loading && !error && dataUrl && attachment?.mime_type.startsWith('image/') && (
                            <img
                                src={dataUrl}
                                alt={attachment.filename}
                                className={styles['image']}
                            />
                        )}

                        {!loading && !error && textContent !== null && (
                            <pre className={styles['text']}>{textContent}</pre>
                        )}

                        {!loading && !error && !isPreviewable && rawBase64 && (
                            <div className={styles['state']}>
                                <FileText size={48} className={styles['fallback-icon']} />
                                <span>{t('readingPane.previewUnsupported')}</span>
                                <span className={styles['state-detail']}>
                                    {attachment?.mime_type}
                                </span>
                            </div>
                        )}
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
