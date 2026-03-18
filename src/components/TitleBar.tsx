import { useState, useEffect, type FC } from 'react';
import { Minus, Square, Copy, X } from 'lucide-react';
import { ipcInvoke, ipcOn } from '../lib/ipc';
import styles from './TitleBar.module.css';

export const TitleBar: FC = () => {
    const [isMaximized, setIsMaximized] = useState(false);

    useEffect(() => {
        ipcInvoke<boolean>('window:is-maximized').then(v => setIsMaximized(!!v)).catch(() => {});
        const cleanup = ipcOn('window:maximized-change', (...args: unknown[]) => {
            setIsMaximized(args[0] as boolean);
        });
        return () => { cleanup?.(); };
    }, []);

    return (
        <div className={styles['title-bar']}>
            <div className={styles['title-bar__brand']}>
                <img src="./icon.png" alt="" width={18} height={18} className={styles['title-bar__icon']} />
                <span className={styles['title-bar__label']}>ExpressDelivery</span>
            </div>
            <div className={styles['title-bar__controls']}>
                <button
                    className={styles['title-bar__btn']}
                    onClick={() => ipcInvoke('window:minimize')}
                    aria-label="Minimize"
                >
                    <Minus size={16} />
                </button>
                <button
                    className={styles['title-bar__btn']}
                    onClick={() => ipcInvoke('window:maximize')}
                    aria-label={isMaximized ? 'Restore' : 'Maximize'}
                >
                    {isMaximized ? <Copy size={14} /> : <Square size={14} />}
                </button>
                <button
                    className={`${styles['title-bar__btn']} ${styles['title-bar__btn--close']}`}
                    onClick={() => ipcInvoke('window:close')}
                    aria-label="Close"
                >
                    <X size={16} />
                </button>
            </div>
        </div>
    );
};
