// Licensed under the Hungry Ghost Hive License. See LICENSE.

export function getDashboardStyles(): string {
  return `
    :root {
      --bg-primary: #0a0e14;
      --bg-panel: #0d1117;
      --bg-panel-header: #161b22;
      --bg-row-alt: #0f151c;
      --border: #21262d;
      --text-primary: #c9d1d9;
      --text-secondary: #6e7681;
      --accent-green: #00ff41;
      --accent-cyan: #00d4ff;
      --accent-yellow: #ffd700;
      --accent-red: #ff4444;
      --accent-magenta: #bc8cff;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: 'JetBrains Mono', 'Fira Code', 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
      background: var(--bg-primary);
      color: var(--text-primary);
      font-size: 13px;
      line-height: 1.5;
      overflow: hidden;
      height: 100vh;
    }

    /* Header */
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: var(--bg-panel-header);
      border-bottom: 1px solid var(--border);
      height: 42px;
    }
    .header-left { display: flex; align-items: center; gap: 12px; }
    .header-title {
      font-size: 14px;
      font-weight: 700;
      letter-spacing: 3px;
      text-transform: uppercase;
      color: var(--accent-cyan);
    }
    .header-version {
      font-size: 11px;
      color: var(--text-secondary);
    }
    .header-right { display: flex; align-items: center; gap: 16px; }
    .connection-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11px;
      color: var(--text-secondary);
    }
    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--accent-red);
    }
    .status-dot.connected {
      background: var(--accent-green);
      box-shadow: 0 0 6px var(--accent-green);
      animation: pulse 2s ease-in-out infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    @keyframes blink {
      0%, 100% { opacity: 1; }
      50% { opacity: 0; }
    }
    .cursor-blink { animation: blink 1s step-end infinite; }

    .btn {
      padding: 4px 12px;
      font-family: inherit;
      font-size: 11px;
      border: 1px solid var(--border);
      background: var(--bg-panel-header);
      color: var(--text-primary);
      cursor: pointer;
      letter-spacing: 1px;
      text-transform: uppercase;
    }
    .btn:hover { border-color: var(--accent-cyan); color: var(--accent-cyan); }
    .btn-primary {
      border-color: var(--accent-cyan);
      color: var(--accent-cyan);
    }
    .btn-success {
      border-color: var(--accent-green);
      color: var(--accent-green);
    }

    /* Dashboard grid */
    .dashboard {
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: auto 1fr 1fr;
      gap: 1px;
      height: calc(100vh - 42px);
      background: var(--border);
    }
    .panel-pipeline { grid-column: 1 / -1; }

    /* Panel */
    .panel {
      background: var(--bg-panel);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      min-height: 0;
    }
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 12px;
      background: var(--bg-panel-header);
      border-top: 2px solid var(--accent-cyan);
      flex-shrink: 0;
    }
    .panel-title {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--accent-cyan);
    }
    .panel-title::before { content: '> '; color: var(--text-secondary); }
    .panel-count {
      font-size: 11px;
      color: var(--text-secondary);
    }
    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 4px 0;
    }

    /* Scrollbar */
    .panel-body::-webkit-scrollbar { width: 4px; }
    .panel-body::-webkit-scrollbar-track { background: var(--bg-panel); }
    .panel-body::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
    .panel-body::-webkit-scrollbar-thumb:hover { background: var(--text-secondary); }

    /* Table */
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th {
      text-align: left;
      padding: 4px 12px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--text-secondary);
      border-bottom: 1px solid var(--border);
      position: sticky;
      top: 0;
      background: var(--bg-panel);
      z-index: 1;
    }
    td {
      padding: 4px 12px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 300px;
      font-variant-numeric: tabular-nums;
    }
    tr { cursor: pointer; }
    tr:nth-child(even) { background: var(--bg-row-alt); }
    tr:hover { background: #1a2233; }

    /* Status badges */
    .status { font-weight: 600; font-size: 11px; }
    .status-working, .status-in_progress { color: var(--accent-yellow); }
    .status-working::before, .status-in_progress::before { content: '['; }
    .status-working::after, .status-in_progress::after { content: ']'; }
    .status-idle { color: var(--text-secondary); }
    .status-idle::before { content: '['; }
    .status-idle::after { content: ']'; }
    .status-blocked, .status-failed, .status-qa_failed, .status-rejected { color: var(--accent-red); }
    .status-blocked::before, .status-failed::before, .status-qa_failed::before, .status-rejected::before { content: '['; }
    .status-blocked::after, .status-failed::after, .status-qa_failed::after, .status-rejected::after { content: ']'; }
    .status-review, .status-reviewing, .status-pr_submitted { color: var(--accent-cyan); }
    .status-review::before, .status-reviewing::before, .status-pr_submitted::before { content: '['; }
    .status-review::after, .status-reviewing::after, .status-pr_submitted::after { content: ']'; }
    .status-qa, .status-estimated { color: var(--accent-magenta); }
    .status-qa::before, .status-estimated::before { content: '['; }
    .status-qa::after, .status-estimated::after { content: ']'; }
    .status-merged, .status-active, .status-approved, .status-completed, .status-resolved { color: var(--accent-green); }
    .status-merged::before, .status-active::before, .status-approved::before, .status-completed::before, .status-resolved::before { content: '['; }
    .status-merged::after, .status-active::after, .status-approved::after, .status-completed::after, .status-resolved::after { content: ']'; }
    .status-draft, .status-planned, .status-pending, .status-queued { color: var(--text-secondary); }
    .status-draft::before, .status-planned::before, .status-pending::before, .status-queued::before { content: '['; }
    .status-draft::after, .status-planned::after, .status-pending::after, .status-queued::after { content: ']'; }

    /* Pipeline bar chart */
    .pipeline-bar {
      display: flex;
      height: 32px;
      gap: 2px;
      padding: 6px 12px;
    }
    .pipeline-segment {
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      min-width: 20px;
      transition: flex-grow 0.3s ease;
    }
    .pipeline-labels {
      display: flex;
      gap: 2px;
      padding: 0 12px 6px;
    }
    .pipeline-label {
      font-size: 9px;
      color: var(--text-secondary);
      text-align: center;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      min-width: 20px;
      transition: flex-grow 0.3s ease;
    }

    /* Modal */
    .modal-overlay {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,0.7);
      z-index: 100;
      align-items: center;
      justify-content: center;
    }
    .modal-overlay.active { display: flex; }
    .modal {
      background: var(--bg-panel);
      border: 1px solid var(--accent-cyan);
      max-width: 700px;
      width: 90%;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
    }
    .modal-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 16px;
      background: var(--bg-panel-header);
      border-bottom: 1px solid var(--border);
    }
    .modal-title {
      font-size: 12px;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      color: var(--accent-cyan);
    }
    .modal-close {
      background: none;
      border: none;
      color: var(--text-secondary);
      cursor: pointer;
      font-size: 18px;
      font-family: inherit;
    }
    .modal-close:hover { color: var(--text-primary); }
    .modal-body {
      padding: 16px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.6;
    }
    .modal-body label {
      display: block;
      font-size: 10px;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: var(--text-secondary);
      margin-bottom: 4px;
      margin-top: 12px;
    }
    .modal-body label:first-child { margin-top: 0; }
    .modal-body input[type="text"],
    .modal-body textarea,
    .modal-body select {
      width: 100%;
      padding: 6px 10px;
      font-family: inherit;
      font-size: 12px;
      background: var(--bg-primary);
      border: 1px solid var(--border);
      color: var(--text-primary);
      outline: none;
    }
    .modal-body input:focus,
    .modal-body textarea:focus,
    .modal-body select:focus {
      border-color: var(--accent-cyan);
    }
    .modal-body textarea { min-height: 100px; resize: vertical; }
    .modal-body .checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 12px;
    }
    .modal-body .detail-row {
      display: flex;
      gap: 8px;
      padding: 4px 0;
      border-bottom: 1px solid var(--border);
    }
    .modal-body .detail-label {
      color: var(--text-secondary);
      min-width: 120px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .modal-body .detail-value { color: var(--text-primary); }
    .modal-footer {
      padding: 8px 16px;
      border-top: 1px solid var(--border);
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    /* Logs */
    .log-entry {
      padding: 2px 12px;
      font-size: 11px;
      display: flex;
      gap: 8px;
    }
    .log-entry:nth-child(even) { background: var(--bg-row-alt); }
    .log-time { color: var(--text-secondary); white-space: nowrap; font-variant-numeric: tabular-nums; }
    .log-event { color: var(--accent-cyan); white-space: nowrap; }
    .log-message { color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

    /* Escalation urgency */
    .escalation-pending { border-left: 3px solid var(--accent-red); }
    .escalation-acknowledged { border-left: 3px solid var(--accent-yellow); }

    /* Responsive: 3-col on wide screens */
    @media (min-width: 1400px) {
      .dashboard {
        grid-template-columns: 1fr 1fr 1fr;
        grid-template-rows: auto 1fr 1fr;
      }
      .panel-pipeline { grid-column: 1 / -1; }
    }

    /* Responsive: 1-col on narrow */
    @media (max-width: 900px) {
      .dashboard {
        grid-template-columns: 1fr;
        grid-template-rows: auto repeat(7, minmax(200px, 1fr));
        overflow-y: auto;
      }
      body { overflow: auto; }
    }
  `;
}
