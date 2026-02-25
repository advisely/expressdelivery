import { useState, useEffect, type FC } from 'react';
import { Download, RefreshCw, X } from 'lucide-react';
import { ipcInvoke, ipcOn } from '../lib/ipc';

export const UpdateBanner: FC = () => {
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
        <>
            <div className="update-banner" role="status">
                <span className="update-text">
                    {downloaded
                        ? `Version ${updateInfo.version} is ready to install.`
                        : `Version ${updateInfo.version} is available.`
                    }
                </span>
                <div className="update-actions">
                    {downloaded ? (
                        <button className="update-btn update-install" onClick={handleInstall}>
                            <RefreshCw size={14} /> Restart & Update
                        </button>
                    ) : (
                        <button className="update-btn update-download" onClick={handleDownload} disabled={downloading}>
                            <Download size={14} /> {downloading ? 'Downloading...' : 'Download'}
                        </button>
                    )}
                    <button className="update-dismiss" onClick={() => setDismissed(true)} aria-label="Dismiss update banner">
                        <X size={14} />
                    </button>
                </div>
            </div>
            <style>{`
                .update-banner {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 8px 16px;
                    background: rgba(var(--color-accent), 0.12);
                    border-bottom: 1px solid rgba(var(--color-accent), 0.25);
                    font-size: 13px;
                    color: var(--text-primary);
                    gap: 12px;
                }

                .update-text {
                    flex: 1;
                }

                .update-actions {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }

                .update-btn {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 4px 12px;
                    border-radius: 6px;
                    font-size: 12px;
                    font-weight: 600;
                }

                .update-download {
                    background: var(--accent-color);
                    color: white;
                }

                .update-download:hover {
                    background: var(--accent-hover);
                }

                .update-download:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }

                .update-install {
                    background: rgb(var(--color-success));
                    color: white;
                }

                .update-install:hover {
                    filter: brightness(1.1);
                }

                .update-dismiss {
                    color: var(--text-secondary);
                    padding: 4px;
                    border-radius: 4px;
                }

                .update-dismiss:hover {
                    background: var(--hover-bg);
                    color: var(--text-primary);
                }
            `}</style>
        </>
    );
};
