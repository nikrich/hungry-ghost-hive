// Licensed under the Hungry Ghost Hive License. See LICENSE.

export function getComponentHelpers(): string {
  return `
    function statusClass(status) {
      return 'status status-' + (status || 'unknown').toLowerCase().replace(/ /g, '_');
    }

    function statusText(status) {
      return (status || 'UNKNOWN').toUpperCase().replace(/_/g, ' ');
    }

    function timeAgo(isoStr) {
      if (!isoStr) return '—';
      var diff = Date.now() - new Date(isoStr).getTime();
      var sec = Math.floor(diff / 1000);
      if (sec < 60) return sec + 's ago';
      var min = Math.floor(sec / 60);
      if (min < 60) return min + 'm ago';
      var hr = Math.floor(min / 60);
      if (hr < 24) return hr + 'h ago';
      return Math.floor(hr / 24) + 'd ago';
    }

    function shortTime(isoStr) {
      if (!isoStr) return '—';
      var d = new Date(isoStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    }

    function agentTypeLabel(type) {
      var labels = {
        tech_lead: 'TL',
        senior: 'SR',
        intermediate: 'MID',
        junior: 'JR',
        qa: 'QA',
        feature_test: 'FT',
        auditor: 'AUD'
      };
      return labels[type] || type;
    }

    function escapeHtml(str) {
      if (!str) return '';
      return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function renderAgentsTable(agents) {
      if (!agents || agents.length === 0) {
        return '<div style="padding:12px;color:var(--text-secondary);">No active agents</div>';
      }
      var html = '<table><thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Story</th><th>Team</th><th>Last Seen</th></tr></thead><tbody>';
      agents.forEach(function(a) {
        html += '<tr onclick="showAgentDetail(\\'' + escapeHtml(a.id) + '\\')">';
        html += '<td>' + escapeHtml(a.id) + '</td>';
        html += '<td>' + agentTypeLabel(a.type) + '</td>';
        html += '<td><span class="' + statusClass(a.status) + '">' + statusText(a.status) + '</span></td>';
        html += '<td>' + escapeHtml(a.current_story_id || '—') + '</td>';
        html += '<td>' + escapeHtml(a.team ? a.team.name : (a.team_id || '—')) + '</td>';
        html += '<td>' + timeAgo(a.last_seen || a.updated_at) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      return html;
    }

    function renderStoriesTable(stories) {
      if (!stories || stories.length === 0) {
        return '<div style="padding:12px;color:var(--text-secondary);">No stories</div>';
      }
      var html = '<table><thead><tr><th>ID</th><th>Title</th><th>Status</th><th>Points</th><th>Agent</th><th>Updated</th></tr></thead><tbody>';
      stories.forEach(function(s) {
        html += '<tr onclick="showStoryDetail(\\'' + escapeHtml(s.id) + '\\')">';
        html += '<td>' + escapeHtml(s.id) + '</td>';
        html += '<td>' + escapeHtml(s.title) + '</td>';
        html += '<td><span class="' + statusClass(s.status) + '">' + statusText(s.status) + '</span></td>';
        html += '<td>' + (s.story_points || '—') + '</td>';
        html += '<td>' + escapeHtml(s.assigned_agent_id || '—') + '</td>';
        html += '<td>' + timeAgo(s.updated_at) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      return html;
    }

    function renderPipeline(counts) {
      if (!counts) return '';
      var stages = [
        { key: 'draft', label: 'Draft', color: 'var(--text-secondary)' },
        { key: 'estimated', label: 'Est', color: 'var(--accent-magenta)' },
        { key: 'planned', label: 'Plan', color: 'var(--text-secondary)' },
        { key: 'in_progress', label: 'WIP', color: 'var(--accent-yellow)' },
        { key: 'review', label: 'Review', color: 'var(--accent-cyan)' },
        { key: 'qa', label: 'QA', color: 'var(--accent-magenta)' },
        { key: 'qa_failed', label: 'QA Fail', color: 'var(--accent-red)' },
        { key: 'pr_submitted', label: 'PR', color: 'var(--accent-cyan)' },
        { key: 'merged', label: 'Merged', color: 'var(--accent-green)' }
      ];
      var total = stages.reduce(function(sum, s) { return sum + (counts[s.key] || 0); }, 0);
      if (total === 0) return '<div style="padding:12px;color:var(--text-secondary);">No stories in pipeline</div>';

      var barHtml = '<div class="pipeline-bar">';
      var labelHtml = '<div class="pipeline-labels">';
      stages.forEach(function(s) {
        var count = counts[s.key] || 0;
        var grow = count > 0 ? count : 0;
        barHtml += '<div class="pipeline-segment" style="flex-grow:' + grow + ';background:' + s.color + ';color:var(--bg-primary);">' + (count > 0 ? count : '') + '</div>';
        labelHtml += '<div class="pipeline-label" style="flex-grow:' + grow + ';">' + s.label + '</div>';
      });
      barHtml += '</div>';
      labelHtml += '</div>';
      return barHtml + labelHtml;
    }

    function renderEscalationsTable(escalations) {
      if (!escalations || escalations.length === 0) {
        return '<div style="padding:12px;color:var(--text-secondary);">No pending escalations</div>';
      }
      var html = '<table><thead><tr><th>ID</th><th>Story</th><th>Status</th><th>Reason</th><th>Created</th><th></th></tr></thead><tbody>';
      escalations.forEach(function(e) {
        var rowClass = e.status === 'pending' ? 'escalation-pending' : (e.status === 'acknowledged' ? 'escalation-acknowledged' : '');
        html += '<tr class="' + rowClass + '">';
        html += '<td>' + escapeHtml(e.id) + '</td>';
        html += '<td>' + escapeHtml(e.story_id || '—') + '</td>';
        html += '<td><span class="' + statusClass(e.status) + '">' + statusText(e.status) + '</span></td>';
        html += '<td>' + escapeHtml(e.reason) + '</td>';
        html += '<td>' + timeAgo(e.created_at) + '</td>';
        html += '<td>';
        if (e.status === 'pending') {
          html += '<button class="btn btn-success" onclick="event.stopPropagation();showResolveModal(\\'' + escapeHtml(e.id) + '\\', \\'' + escapeHtml(e.reason).replace(/'/g, "\\\\'") + '\\')">RESOLVE</button>';
        }
        html += '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      return html;
    }

    function renderMergeQueueTable(queue) {
      if (!queue || queue.length === 0) {
        return '<div style="padding:12px;color:var(--text-secondary);">Merge queue empty</div>';
      }
      var html = '<table><thead><tr><th>#</th><th>PR</th><th>Branch</th><th>Status</th><th>Story</th><th>Created</th></tr></thead><tbody>';
      queue.forEach(function(pr, i) {
        html += '<tr>';
        html += '<td>' + (i + 1) + '</td>';
        html += '<td>' + (pr.github_pr_url ? '<a href="' + escapeHtml(pr.github_pr_url) + '" target="_blank" rel="noopener" style="color:var(--accent-cyan);">#' + (pr.github_pr_number || pr.id) + '</a>' : escapeHtml(pr.id)) + '</td>';
        html += '<td>' + escapeHtml(pr.branch_name) + '</td>';
        html += '<td><span class="' + statusClass(pr.status) + '">' + statusText(pr.status) + '</span></td>';
        html += '<td>' + escapeHtml(pr.story_id || '—') + '</td>';
        html += '<td>' + timeAgo(pr.created_at) + '</td>';
        html += '</tr>';
      });
      html += '</tbody></table>';
      return html;
    }

    function renderLogsPanel(logs) {
      if (!logs || logs.length === 0) {
        return '<div style="padding:12px;color:var(--text-secondary);">No recent activity</div>';
      }
      var html = '';
      logs.forEach(function(l) {
        html += '<div class="log-entry">';
        html += '<span class="log-time">' + shortTime(l.timestamp) + '</span>';
        html += '<span class="log-event">' + escapeHtml(l.event_type) + '</span>';
        html += '<span class="log-message">' + escapeHtml(l.message || l.agent_id || '') + '</span>';
        html += '</div>';
      });
      return html;
    }
  `;
}
