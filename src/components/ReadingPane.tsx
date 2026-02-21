import React from 'react';
import { Reply, Forward, Trash2, MoreHorizontal } from 'lucide-react';

export const ReadingPane: React.FC = () => {
    return (
        <div className="reading-pane scrollable">
            <div className="pane-header glass">
                <div className="actions">
                    <button className="icon-btn" title="Reply"><Reply size={18} /></button>
                    <button className="icon-btn" title="Forward"><Forward size={18} /></button>
                    <button className="icon-btn" title="Delete"><Trash2 size={18} /></button>
                    <button className="icon-btn" title="More"><MoreHorizontal size={18} /></button>
                </div>
            </div>

            <div className="email-content animate-fade-in">
                <h1 className="subject-title">[expressdelivery] Action Required</h1>

                <div className="email-meta">
                    <div className="avatar">G</div>
                    <div className="meta-info">
                        <div className="sender-row">
                            <span className="sender-name">GitHub</span>
                            <span className="sender-email">&lt;notifications@github.com&gt;</span>
                        </div>
                        <div className="to-row">
                            <span className="to-label">to me</span>
                        </div>
                    </div>
                    <div className="date-time">
                        Oct 24, 2023, 10:42 AM
                    </div>
                </div>

                <div className="email-body">
                    <p>Hi Alex,</p>
                    <br />
                    <p>You have a new mention in the PR <strong>#42: Implement 3-pane layout</strong>.</p>
                    <p>Please review the changes and approve.</p>
                    <br />
                    <div className="btn-container">
                        <button className="action-button">View Pull Request</button>
                    </div>
                    <br />
                    <p>Thanks,<br />The GitHub Team</p>
                </div>
            </div>

            <style>{`
        .reading-pane {
          flex: 1;
          display: flex;
          flex-direction: column;
          background: var(--bg-primary);
        }

        .pane-header {
          padding: 12px 24px;
          display: flex;
          justify-content: flex-end;
          border-bottom: 1px solid var(--glass-border);
          position: sticky;
          top: 0;
          z-index: 10;
        }

        .actions {
          display: flex;
          gap: 8px;
        }

        .icon-btn {
          width: 36px;
          height: 36px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 6px;
          color: var(--text-secondary);
        }

        .icon-btn:hover {
          background: rgba(255, 255, 255, 0.05);
          color: var(--text-primary);
        }

        .email-content {
          padding: 32px 48px;
          max-width: 800px;
        }

        .subject-title {
          font-size: 24px;
          font-weight: 600;
          margin-bottom: 24px;
          color: var(--text-primary);
        }

        .email-meta {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 32px;
        }

        .avatar {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #333;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          font-weight: 500;
        }

        .meta-info {
          flex: 1;
        }

        .sender-row {
          display: flex;
          align-items: baseline;
          gap: 8px;
        }

        .sender-name {
          font-weight: 600;
          font-size: 15px;
        }

        .sender-email {
          color: var(--text-secondary);
          font-size: 13px;
        }

        .to-row {
          font-size: 12px;
          color: var(--text-secondary);
        }

        .date-time {
          font-size: 13px;
          color: var(--text-secondary);
        }

        .email-body {
          font-size: 15px;
          line-height: 1.6;
          color: var(--text-primary);
        }

        .action-button {
          background: var(--accent-color);
          color: white;
          padding: 8px 16px;
          border-radius: 6px;
          font-weight: 500;
          font-size: 14px;
        }

        .action-button:hover {
          background: var(--accent-hover);
        }
      `}</style>
        </div>
    );
};
