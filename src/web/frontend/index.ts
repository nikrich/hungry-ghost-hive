// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { WebConfig } from '../../config/schema.js';
import { getDashboardScript } from './app.js';
import { getDashboardStyles } from './styles.js';

export function renderDashboardHtml(config: WebConfig): string {
  const wsAuthParam = config.auth_token ? `?token=${encodeURIComponent(config.auth_token)}` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Hive Orchestrator</title>
  <style>${getDashboardStyles()}</style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="header-title">Hive Orchestrator</span>
      <span class="header-version">web dashboard</span>
    </div>
    <div class="header-right">
      <button class="btn" onclick="showAddRepoModal()">+ REPO</button>
      <button class="btn btn-primary" onclick="showRequirementModal()">+ REQUIREMENT</button>
      <button id="manager-btn" class="btn" onclick="toggleManager()">MANAGER: ...</button>
      <div class="connection-status">
        <span id="ws-dot" class="status-dot"></span>
        <span id="ws-text">CONNECTING</span>
      </div>
    </div>
  </div>

  <div class="dashboard">
    <!-- Pipeline (full width) -->
    <div class="panel panel-pipeline">
      <div class="panel-header">
        <span class="panel-title">Pipeline</span>
      </div>
      <div id="pipeline-body" class="panel-body"></div>
    </div>

    <!-- Agents -->
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Agents</span>
        <span class="panel-count" id="agents-count">0</span>
      </div>
      <div id="agents-body" class="panel-body"></div>
    </div>

    <!-- Stories -->
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Stories</span>
        <span class="panel-count" id="stories-count">0</span>
      </div>
      <div id="stories-body" class="panel-body"></div>
    </div>

    <!-- Activity Log -->
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Activity</span>
        <span class="panel-count" id="logs-count">0</span>
      </div>
      <div id="logs-body" class="panel-body"></div>
    </div>

    <!-- Merge Queue -->
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Merge Queue</span>
        <span class="panel-count" id="merge-queue-count">0</span>
      </div>
      <div id="merge-queue-body" class="panel-body"></div>
    </div>

    <!-- Escalations -->
    <div class="panel">
      <div class="panel-header">
        <span class="panel-title">Escalations</span>
        <span class="panel-count" id="escalations-count">0</span>
      </div>
      <div id="escalations-body" class="panel-body"></div>
    </div>
  </div>

  <!-- Modal -->
  <div id="modal-overlay" class="modal-overlay" onclick="if(event.target===this)closeModal()">
    <div class="modal">
      <div class="modal-header">
        <span id="modal-title" class="modal-title"></span>
        <button class="modal-close" onclick="closeModal()">&times;</button>
      </div>
      <div id="modal-body" class="modal-body"></div>
      <div id="modal-footer" class="modal-footer" style="display:none;"></div>
    </div>
  </div>

  <script>${getDashboardScript(wsAuthParam)}</script>
</body>
</html>`;
}
