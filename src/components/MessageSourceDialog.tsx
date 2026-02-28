import { useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Copy, X, Code } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import styles from './MessageSourceDialog.module.css';

interface MessageSourceDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    source: string;
    subject: string;
}

export const MessageSourceDialog: React.FC<MessageSourceDialogProps> = ({
    open,
    onOpenChange,
    source,
    subject,
}) => {
    const { t } = useTranslation();
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        await navigator.clipboard.writeText(source);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="msg-source-overlay" />
                <Dialog.Content
                    className="msg-source-content"
                    aria-describedby={undefined}
                >
                    <div className="msg-source-header">
                        <Dialog.Title className="msg-source-title">
                            <Code size={16} aria-hidden="true" />
                            {t('messageSource.title')}
                            {subject && (
                                <span className={styles['msg-source-subject']}>
                                    &mdash; {subject}
                                </span>
                            )}
                        </Dialog.Title>
                        <div className="msg-source-actions">
                            <button
                                type="button"
                                onClick={handleCopy}
                                className="msg-source-copy-btn"
                                aria-label={copied ? t('messageSource.copied') : t('messageSource.copy')}
                            >
                                <Copy size={14} aria-hidden="true" />
                                {copied ? t('messageSource.copied') : t('messageSource.copy')}
                            </button>
                            <Dialog.Close className="msg-source-close-btn" aria-label="Close">
                                <X size={16} aria-hidden="true" />
                            </Dialog.Close>
                        </div>
                    </div>
                    <pre className="msg-source-pre">{source || t('messageSource.loading')}</pre>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
