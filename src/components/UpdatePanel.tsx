import { useState, useEffect, useRef, useCallback, type FC } from 'react';
import { RefreshCw, Upload, Globe, CheckCircle, AlertTriangle, XCircle, FileArchive, Loader2, Package, Sparkles, Shield, HardDrive, Power, Rocket } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import styles from './UpdatePanel.module.css';

interface UpdateFileInfo {
    valid: boolean;
    fileName: string;
    fileSize: number;
    fileSizeFormatted: string;
    version: string | null;
    productName: string | null;
    packageType: string | null;
    description: string | null;
    changelog: string[] | null;
    warnings: string[];
    error: string | null;
}

interface UpdateInfo {
    currentVersion: string;
    buildDate: string;
    installMode: 'installed' | 'portable' | 'development';
}

type UpdateApplyPhase = 'validating' | 'extracting' | 'verifying' | 'checking-signature' | 'shutting-down' | 'launching';
type UpdateState = 'idle' | 'validating' | 'file-selected' | 'applying' | 'error';

const APPLY_STEPS: { phase: UpdateApplyPhase; label: string; icon: typeof Shield }[] = [
    { phase: 'validating', label: 'Validating package', icon: Shield },
    { phase: 'extracting', label: 'Extracting installer', icon: HardDrive },
    { phase: 'verifying', label: 'Verifying integrity', icon: Shield },
    { phase: 'checking-signature', label: 'Checking signature', icon: Shield },
    { phase: 'shutting-down', label: 'Preparing update', icon: Power },
    { phase: 'launching', label: 'Launching installer', icon: Rocket },
];

export const UpdatePanel: FC = () => {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<'web' | 'file'>('file');
    const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
    const [fileInfo, setFileInfo] = useState<UpdateFileInfo | null>(null);
    const [filePath, setFilePath] = useState<string | null>(null);
    const [state, setState] = useState<UpdateState>('idle');
    const [errorMsg, setErrorMsg] = useState<string | null>(null);
    const [completedPhases, setCompletedPhases] = useState<Set<UpdateApplyPhase>>(new Set());
    const [activePhase, setActivePhase] = useState<UpdateApplyPhase | null>(null);
    const cleanupRef = useRef<(() => void) | null>(null);

    useEffect(() => {
        ipcInvoke<UpdateInfo>('update:getInfo').then(info => {
            if (info) setUpdateInfo(info);
        });
    }, []);

    // Listen for apply progress events
    useEffect(() => {
        const cleanup = ipcOn('update:applyProgress', (...args: unknown[]) => {
            const step = args[0] as { phase: UpdateApplyPhase; done: boolean } | undefined;
            if (!step) return;
            if (step.done) {
                setCompletedPhases(prev => new Set([...prev, step.phase]));
                setActivePhase(null);
            } else {
                setActivePhase(step.phase);
            }
        });
        cleanupRef.current = cleanup;
        return () => { cleanup?.(); };
    }, []);

    const validateAndSetFile = useCallback(async (path: string) => {
        setFilePath(path);
        setState('validating');
        setErrorMsg(null);

        const info = await ipcInvoke<UpdateFileInfo>('update:validateFile', path);
        if (!info) {
            setState('error');
            setErrorMsg('Validation failed');
            return;
        }
        setFileInfo(info);

        if (!info.valid) {
            setState('error');
            setErrorMsg(info.error || 'Validation failed');
        } else {
            setState('file-selected');
        }
    }, []);

    // Listen for .expressdelivery files opened via double-click / file association
    useEffect(() => {
        const cleanup = ipcOn('update:fileOpened', (...args: unknown[]) => {
            const path = args[0] as string | undefined;
            if (path) validateAndSetFile(path);
        });
        return () => { cleanup?.(); };
    }, [validateAndSetFile]);

    const handlePickFile = async () => {
        setErrorMsg(null);
        const result = await ipcInvoke<{ filePath: string } | null>('update:pickFile');
        if (!result) return;
        validateAndSetFile(result.filePath);
    };

    const handleApply = async () => {
        if (!filePath || !fileInfo) return;

        setCompletedPhases(new Set());
        setActivePhase(null);
        setState('applying');
        const result = await ipcInvoke<{ success: boolean; error?: string }>('update:apply', filePath);
        if (result && !result.success) {
            setState('error');
            setErrorMsg(result.error || 'Update failed');
        }
    };

    const handleCancel = () => {
        setFileInfo(null);
        setFilePath(null);
        setState('idle');
        setErrorMsg(null);
        setCompletedPhases(new Set());
        setActivePhase(null);
    };

    const isUnavailable = updateInfo?.installMode === 'portable' || updateInfo?.installMode === 'development';
    const unavailableMessage = updateInfo?.installMode === 'portable'
        ? t('updatePanel.portableMessage')
        : t('updatePanel.devMessage');

    return (
        <div className={styles['update-panel']}>
            {/* Current Version */}
            <div className={styles['version-card']}>
                <h3 className={styles['section-title']}>{t('updatePanel.currentVersion')}</h3>
                <div className={styles['version-row']}>
                    <div className={styles['version-icon']}>
                        <RefreshCw size={18} />
                    </div>
                    <div>
                        <span className={styles['version-number']}>
                            v{updateInfo?.currentVersion || '...'}
                        </span>
                        <span className={styles['version-mode']}>
                            {updateInfo?.installMode === 'installed' && t('updatePanel.installed')}
                            {updateInfo?.installMode === 'portable' && t('updatePanel.portable')}
                            {updateInfo?.installMode === 'development' && t('updatePanel.development')}
                        </span>
                    </div>
                </div>
            </div>

            {/* Tabbed update section */}
            <div className={styles['update-card']}>
                {/* Tab bar */}
                <div className={styles['tab-bar']}>
                    <button
                        type="button"
                        onClick={() => setActiveTab('web')}
                        className={`${styles['tab-btn']} ${activeTab === 'web' ? styles['tab-active'] : ''}`}
                    >
                        <Globe size={14} />
                        {t('updatePanel.webUpdate')}
                    </button>
                    <button
                        type="button"
                        onClick={() => setActiveTab('file')}
                        className={`${styles['tab-btn']} ${activeTab === 'file' ? styles['tab-active'] : ''}`}
                    >
                        <Upload size={14} />
                        {t('updatePanel.fileUpdate')}
                    </button>
                </div>

                {/* Web Update tab content */}
                {activeTab === 'web' && (
                    <div className={styles['tab-content']}>
                        <p className={styles['tab-desc']}>
                            {t('updatePanel.webDesc')}
                        </p>
                        <button type="button" disabled className={styles['disabled-btn']}>
                            <Globe size={14} />
                            {t('updatePanel.checkForUpdates')}
                        </button>
                        <span className={styles['coming-soon']}>{t('updatePanel.comingSoon')}</span>
                    </div>
                )}

                {/* File Update tab content */}
                {activeTab === 'file' && (
                    <div className={styles['tab-content']}>
                        <p className={styles['tab-desc']}>
                            {t('updatePanel.fileDesc')}
                        </p>

                        {isUnavailable ? (
                            <div className={styles['warning-box']}>
                                <AlertTriangle size={16} />
                                <span>{unavailableMessage}</span>
                            </div>
                        ) : (
                            <>
                                {/* Choose file button */}
                                {!['validating', 'file-selected', 'applying'].includes(state) && (
                                    <button type="button" onClick={handlePickFile} className={styles['choose-btn']}>
                                        <Upload size={14} />
                                        {t('updatePanel.choosePackage')}
                                    </button>
                                )}

                                {/* Validating spinner */}
                                {state === 'validating' && (
                                    <div className={styles['validating-row']}>
                                        <Loader2 size={18} className={styles['spinner']} />
                                        <span>{t('updatePanel.validating')}</span>
                                    </div>
                                )}

                                {/* Error display */}
                                {state === 'error' && errorMsg && (
                                    <div className={styles['error-box']}>
                                        <XCircle size={16} />
                                        <div className={styles['error-content']}>
                                            <span>{errorMsg}</span>
                                            <button type="button" onClick={handleCancel} className={styles['try-again']}>
                                                {t('updatePanel.tryAgain')}
                                            </button>
                                        </div>
                                    </div>
                                )}

                                {/* File info card */}
                                {(state === 'file-selected' || state === 'applying') && fileInfo && (
                                    <div className={styles['file-info-section']}>
                                        <div className={styles['file-info-card']}>
                                            <div className={styles['file-info-header']}>
                                                <Package size={20} />
                                                <div className={styles['file-info-details']}>
                                                    <span className={styles['file-name']}>{fileInfo.fileName}</span>
                                                    <div className={styles['file-meta']}>
                                                        <span>{t('updatePanel.size')}: {fileInfo.fileSizeFormatted}</span>
                                                        {fileInfo.version && <span>{t('updatePanel.version')}: v{fileInfo.version}</span>}
                                                    </div>
                                                    {fileInfo.packageType && (
                                                        <div className={styles['package-type']}>
                                                            <FileArchive size={12} />
                                                            <span>{t('updatePanel.fullUpdate')}</span>
                                                        </div>
                                                    )}
                                                    {fileInfo.description && (
                                                        <span className={styles['file-desc']}>{fileInfo.description}</span>
                                                    )}
                                                    <div className={styles['valid-badge']}>
                                                        <CheckCircle size={12} />
                                                        <span>{t('updatePanel.validPackage')}</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Changelog */}
                                            {fileInfo.changelog && fileInfo.changelog.length > 0 && (
                                                <div className={styles['changelog']}>
                                                    <div className={styles['changelog-header']}>
                                                        <Sparkles size={12} />
                                                        <span>{t('updatePanel.whatsNew')}</span>
                                                    </div>
                                                    <ul className={styles['changelog-list']}>
                                                        {fileInfo.changelog.map((item, i) => (
                                                            <li key={i}>{item}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            )}

                                            {fileInfo.warnings.length > 0 && (
                                                <div className={styles['warnings']}>
                                                    {fileInfo.warnings.map((w, i) => (
                                                        <div key={i} className={styles['warning-item']}>
                                                            <AlertTriangle size={12} />
                                                            <span>{w}</span>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>

                                        {state === 'file-selected' && (
                                            <div className={styles['action-row']}>
                                                <button type="button" onClick={handleApply} className={styles['update-btn']}>
                                                    <RefreshCw size={14} />
                                                    {t('updatePanel.updateNow')}
                                                </button>
                                                <button type="button" onClick={handleCancel} className={styles['cancel-btn']}>
                                                    {t('updatePanel.cancel')}
                                                </button>
                                            </div>
                                        )}

                                        {/* Multi-step apply progress */}
                                        {state === 'applying' && (
                                            <div className={styles['progress-card']}>
                                                <span className={styles['progress-title']}>{t('updatePanel.installing')}</span>
                                                <div className={styles['steps-row']}>
                                                    {APPLY_STEPS.map((step, i) => {
                                                        const isDone = completedPhases.has(step.phase);
                                                        const isActive = activePhase === step.phase;
                                                        const Icon = step.icon;
                                                        return (
                                                            <div key={step.phase} className={styles['step']}>
                                                                <div className={styles['step-line-wrap']}>
                                                                    {i > 0 && (
                                                                        <div className={`${styles['connector']} ${isDone ? styles['connector-done'] : ''}`} />
                                                                    )}
                                                                    {i === 0 && <div className={styles['connector-spacer']} />}
                                                                    <div className={`${styles['step-dot']} ${isDone ? styles['step-done'] : isActive ? styles['step-active'] : ''}`}>
                                                                        {isDone ? (
                                                                            <CheckCircle size={14} />
                                                                        ) : isActive ? (
                                                                            <Loader2 size={14} className={styles['spinner']} />
                                                                        ) : (
                                                                            <Icon size={12} />
                                                                        )}
                                                                    </div>
                                                                    {i < APPLY_STEPS.length - 1 && (
                                                                        <div className={`${styles['connector']} ${isDone ? styles['connector-done'] : ''}`} />
                                                                    )}
                                                                    {i === APPLY_STEPS.length - 1 && <div className={styles['connector-spacer']} />}
                                                                </div>
                                                                <span className={`${styles['step-label']} ${isDone ? styles['label-done'] : isActive ? styles['label-active'] : ''}`}>
                                                                    {step.label}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};
