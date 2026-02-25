import { useState, useEffect, type FC } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import styles from './UpdateBanner.module.css';

export const UpdateBanner: FC = () => {
    const { t } = useTranslation();
    const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null);
    const [downloaded, setDownloaded] = useState(false);
    const [dismissed, setDismissed] = useState(false);
    const [downloading, setDownloading] = useState(false);

    useEffect(() => {
        const cleanupAvailable = ipcOn('update:available', (...args: unknown[]) => {
            const data = args[0] as { version?: string } | undefined;
            if (data?.version) setUpdateInfo({ version: data.version });
        });
        const cleanupDownloaded = ipcOn('update:downloaded', () => {
            setDownloaded(true);
            setDownloading(false);
        });
        return () => { cleanupAvailable?.(); cleanupDownloaded?.(); };
    }, []);

    if (!updateInfo || dismissed) return null;

    const handleDownload = async () => {
        setDownloading(true);
        await ipcInvoke('update:download');
    };

    const handleInstall = async () => {
        await ipcInvoke('update:install');
    };

    return (
        <div className={styles['banner']} role="status">
            <span className={styles['text']}>
                {downloaded
                    ? t('update.readyToInstall', { version: updateInfo.version })
                    : t('update.available', { version: updateInfo.version })
                }
            </span>
            <div className={styles['actions']}>
                {downloaded ? (
                    <button className={`${styles['btn']} ${styles['install']}`} onClick={handleInstall}>
                        <RefreshCw size={14} /> {t('update.restartUpdate')}
                    </button>
                ) : (
                    <button className={`${styles['btn']} ${styles['download']}`} onClick={handleDownload} disabled={downloading}>
                        <Download size={14} /> {downloading ? t('update.downloading') : t('update.download')}
                    </button>
                )}
                <button className={styles['dismiss']} onClick={() => setDismissed(true)} aria-label={t('update.dismiss')}>
                    <X size={14} />
                </button>
            </div>
        </div>
    );
};
