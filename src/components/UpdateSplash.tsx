import { useState, useEffect } from 'react';
import { CheckCircle, Sparkles } from 'lucide-react';
import styles from './UpdateSplash.module.css';

interface PostUpdateInfo {
    previousVersion: string;
    newVersion: string;
    updatedAt: string;
    changelog?: string[];
}

interface UpdateSplashProps {
    info: PostUpdateInfo;
    onComplete: () => void;
}

export const UpdateSplash: React.FC<UpdateSplashProps> = ({ info, onComplete }) => {
    const [phase, setPhase] = useState<'enter' | 'show' | 'exit'>('enter');

    useEffect(() => {
        // Phase 1: Enter animation (0.6s)
        const enterTimer = setTimeout(() => setPhase('show'), 600);
        // Phase 2: Hold for display (2.5s after enter)
        const holdTimer = setTimeout(() => setPhase('exit'), 3100);
        // Phase 3: Exit animation and proceed (0.5s after exit starts)
        const exitTimer = setTimeout(() => onComplete(), 3600);
        return () => {
            clearTimeout(enterTimer);
            clearTimeout(holdTimer);
            clearTimeout(exitTimer);
        };
    }, [onComplete]);

    // Allow click/key to skip
    const handleSkip = () => {
        setPhase('exit');
        setTimeout(onComplete, 400);
    };

    return (
        <div
            className={`${styles['splash']} ${styles[`splash-${phase}`]}`}
            onClick={handleSkip}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape' || e.key === ' ') handleSkip(); }}
            role="button"
            tabIndex={0}
        >
            <div className={styles['backdrop']} />
            <div className={styles['content']}>
                <div className={styles['icon-ring']}>
                    <CheckCircle size={48} className={styles['check-icon']} />
                    <div className={styles['ring-pulse']} />
                </div>
                <h1 className={styles['title']}>
                    <Sparkles size={20} className={styles['sparkle']} />
                    Updated Successfully
                    <Sparkles size={20} className={styles['sparkle']} />
                </h1>
                <div className={styles['version-badge']}>
                    <span className={styles['version-old']}>v{info.previousVersion}</span>
                    <span className={styles['version-arrow']}>&rarr;</span>
                    <span className={styles['version-new']}>v{info.newVersion}</span>
                </div>
                {info.changelog && info.changelog.length > 0 && (
                    <ul className={styles['changelog']}>
                        {info.changelog.slice(0, 5).map((item, i) => (
                            <li key={i} className={styles['changelog-item']} style={{ animationDelay: `${0.8 + i * 0.15}s` }}>
                                {item}
                            </li>
                        ))}
                    </ul>
                )}
                <p className={styles['hint']}>Click anywhere to continue</p>
            </div>
        </div>
    );
};
