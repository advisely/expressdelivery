import { useState, useEffect, useRef, type FC } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { AlertTriangle, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import './ConfirmDialog.module.css';

interface ConfirmDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    description?: string;
    confirmLabel?: string;
    cancelLabel?: string;
    variant?: 'default' | 'danger';
    /** Prompt mode: show text input */
    inputLabel?: string;
    inputPlaceholder?: string;
    inputDefaultValue?: string;
    inputValidator?: (value: string) => boolean;
    onConfirm: (inputValue?: string) => void;
}

export const ConfirmDialog: FC<ConfirmDialogProps> = ({
    open,
    onOpenChange,
    title,
    description,
    confirmLabel,
    cancelLabel,
    variant = 'default',
    inputLabel,
    inputPlaceholder,
    inputDefaultValue = '',
    inputValidator,
    onConfirm,
}) => {
    const { t } = useTranslation();
    const isPrompt = !!inputLabel;
    const [inputValue, setInputValue] = useState(inputDefaultValue);
    const inputRef = useRef<HTMLInputElement>(null);

    // Reset input value when dialog opens
    useEffect(() => {
        if (!open) return;
        const timer = setTimeout(() => setInputValue(inputDefaultValue), 0);
        return () => clearTimeout(timer);
    }, [open, inputDefaultValue]);

    // Focus input on open
    useEffect(() => {
        if (open && isPrompt) {
            // Small delay to let the dialog mount
            const timer = setTimeout(() => inputRef.current?.focus(), 50);
            return () => clearTimeout(timer);
        }
    }, [open, isPrompt]);

    const isValid = !isPrompt || !inputValidator || inputValidator(inputValue);

    const handleConfirm = () => {
        if (!isValid) return;
        onConfirm(isPrompt ? inputValue : undefined);
        onOpenChange(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && isValid) {
            e.preventDefault();
            handleConfirm();
        }
    };

    return (
        <Dialog.Root open={open} onOpenChange={onOpenChange}>
            <Dialog.Portal>
                <Dialog.Overlay className="confirm-overlay" />
                <Dialog.Content
                    className="confirm-content"
                    aria-describedby={description ? 'confirm-desc' : undefined}
                    onKeyDown={handleKeyDown}
                >
                    <div className="confirm-header">
                        {variant === 'danger' && (
                            <AlertTriangle size={18} className="confirm-danger-icon" aria-hidden="true" />
                        )}
                        <Dialog.Title className="confirm-title">{title}</Dialog.Title>
                        <Dialog.Close className="confirm-close-btn" aria-label={t('confirm.cancel')}>
                            <X size={16} aria-hidden="true" />
                        </Dialog.Close>
                    </div>

                    {description && (
                        <Dialog.Description id="confirm-desc" className="confirm-description">
                            {description}
                        </Dialog.Description>
                    )}

                    {isPrompt && (
                        <div className="confirm-input-group">
                            <label className="confirm-input-label" htmlFor="confirm-input">
                                {inputLabel}
                            </label>
                            <input
                                id="confirm-input"
                                ref={inputRef}
                                className="confirm-input"
                                type="text"
                                value={inputValue}
                                onChange={e => setInputValue(e.target.value)}
                                placeholder={inputPlaceholder}
                                autoComplete="off"
                                spellCheck={false}
                            />
                        </div>
                    )}

                    <div className="confirm-actions">
                        <Dialog.Close
                            className="confirm-btn confirm-btn-cancel"
                        >
                            {cancelLabel ?? t('confirm.cancel')}
                        </Dialog.Close>
                        <button
                            type="button"
                            className={`confirm-btn ${variant === 'danger' ? 'confirm-btn-danger' : 'confirm-btn-primary'}`}
                            onClick={handleConfirm}
                            disabled={!isValid}
                        >
                            {confirmLabel ?? t('confirm.confirm')}
                        </button>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
