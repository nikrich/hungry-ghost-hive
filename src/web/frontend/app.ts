// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { getComponentHelpers } from './components.js';

export function getDashboardScript(wsAuthParam: string): string {
  return `
    ${getComponentHelpers()}

    var state = {
      agents: [],
      stories: [],
      pipeline: {},
      escalations: [],
      logs: [],
      mergeQueue: [],
      requirements: []
    };

    var ws = null;
    var wsReconnectTimer = null;
    var wsReconnectDelay = 1000;

    function updatePanel(id, html) {
      var el = document.getElementById(id);
      if (el) el.innerHTML = html;
    }

    function updateCount(id, count) {
      var el = document.getElementById(id);
      if (el) el.textContent = count;
    }

    function render() {
      updatePanel('agents-body', renderAgentsTable(state.agents));
      updateCount('agents-count', state.agents.length);

      updatePanel('stories-body', renderStoriesTable(state.stories));
      updateCount('stories-count', state.stories.length);

      updatePanel('pipeline-body', renderPipeline(state.pipeline));

      updatePanel('escalations-body', renderEscalationsTable(state.escalations));
      updateCount('escalations-count', state.escalations.length);

      updatePanel('logs-body', renderLogsPanel(state.logs));
      updateCount('logs-count', state.logs.length);

      updatePanel('merge-queue-body', renderMergeQueueTable(state.mergeQueue));
      updateCount('merge-queue-count', state.mergeQueue.length);
    }

    function setConnectionStatus(connected) {
      var dot = document.getElementById('ws-dot');
      var text = document.getElementById('ws-text');
      if (dot) {
        dot.className = connected ? 'status-dot connected' : 'status-dot';
      }
      if (text) {
        text.innerHTML = connected ? 'CONNECTED<span class="cursor-blink">_</span>' : 'DISCONNECTED';
      }
    }

    function connectWebSocket() {
      var proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      var url = proto + '//' + location.host + '/ws' + '${wsAuthParam}';
      ws = new WebSocket(url);

      ws.onopen = function() {
        setConnectionStatus(true);
        wsReconnectDelay = 1000;
      };

      ws.onmessage = function(evt) {
        try {
          var msg = JSON.parse(evt.data);
          switch (msg.type) {
            case 'agents:update': state.agents = msg.data; break;
            case 'stories:update': state.stories = msg.data; break;
            case 'pipeline:update': state.pipeline = msg.data; break;
            case 'escalations:update': state.escalations = msg.data; break;
            case 'logs:new': state.logs = msg.data; break;
            case 'merge-queue:update': state.mergeQueue = msg.data; break;
            case 'requirements:update': state.requirements = msg.data; break;
            case 'state:full':
              if (msg.data) {
                Object.keys(msg.data).forEach(function(k) {
                  if (state.hasOwnProperty(k)) state[k] = msg.data[k];
                });
              }
              break;
          }
          render();
        } catch (e) { /* ignore parse errors */ }
      };

      ws.onclose = function() {
        setConnectionStatus(false);
        ws = null;
        wsReconnectTimer = setTimeout(function() {
          wsReconnectDelay = Math.min(wsReconnectDelay * 1.5, 10000);
          connectWebSocket();
        }, wsReconnectDelay);
      };

      ws.onerror = function() {
        if (ws) ws.close();
      };
    }

    // Initial data fetch via REST (before WS connects)
    function fetchInitialData() {
      var endpoints = [
        { url: '/api/v1/agents', key: 'agents' },
        { url: '/api/v1/stories', key: 'stories' },
        { url: '/api/v1/pipeline', key: 'pipeline' },
        { url: '/api/v1/escalations', key: 'escalations' },
        { url: '/api/v1/logs?limit=50', key: 'logs' },
        { url: '/api/v1/merge-queue', key: 'mergeQueue' },
        { url: '/api/v1/requirements', key: 'requirements' }
      ];
      endpoints.forEach(function(ep) {
        fetch(ep.url).then(function(r) { return r.json(); }).then(function(data) {
          state[ep.key] = data;
          render();
        }).catch(function() {});
      });
    }

    // Detail modals
    function showAgentDetail(id) {
      fetch('/api/v1/agents/' + encodeURIComponent(id))
        .then(function(r) { return r.json(); })
        .then(function(agent) {
          var html = '';
          html += '<div class="detail-row"><span class="detail-label">ID</span><span class="detail-value">' + escapeHtml(agent.id) + '</span></div>';
          html += '<div class="detail-row"><span class="detail-label">Type</span><span class="detail-value">' + agentTypeLabel(agent.type) + ' (' + escapeHtml(agent.type) + ')</span></div>';
          html += '<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="' + statusClass(agent.status) + '">' + statusText(agent.status) + '</span></span></div>';
          html += '<div class="detail-row"><span class="detail-label">Current Story</span><span class="detail-value">' + escapeHtml(agent.current_story_id || '—') + '</span></div>';
          html += '<div class="detail-row"><span class="detail-label">Model</span><span class="detail-value">' + escapeHtml(agent.model || '—') + '</span></div>';
          html += '<div class="detail-row"><span class="detail-label">Tmux Session</span><span class="detail-value">' + escapeHtml(agent.tmux_session || '—') + '</span></div>';
          html += '<div class="detail-row"><span class="detail-label">Last Seen</span><span class="detail-value">' + timeAgo(agent.last_seen || agent.updated_at) + '</span></div>';
          if (agent.logs && agent.logs.length > 0) {
            html += '<div style="margin-top:12px;"><label>RECENT LOGS</label>';
            html += '<div style="max-height:200px;overflow-y:auto;">';
            agent.logs.forEach(function(l) {
              html += '<div class="log-entry">';
              html += '<span class="log-time">' + shortTime(l.timestamp) + '</span>';
              html += '<span class="log-event">' + escapeHtml(l.event_type) + '</span>';
              html += '<span class="log-message">' + escapeHtml(l.message || '') + '</span>';
              html += '</div>';
            });
            html += '</div></div>';
          }
          showModal('Agent: ' + agent.id, html);
        }).catch(function() {});
    }

    function showStoryDetail(id) {
      fetch('/api/v1/stories/' + encodeURIComponent(id))
        .then(function(r) { return r.json(); })
        .then(function(story) {
          var html = '';
          html += '<div class="detail-row"><span class="detail-label">ID</span><span class="detail-value">' + escapeHtml(story.id) + '</span></div>';
          html += '<div class="detail-row"><span class="detail-label">Title</span><span class="detail-value">' + escapeHtml(story.title) + '</span></div>';
          html += '<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value"><span class="' + statusClass(story.status) + '">' + statusText(story.status) + '</span></span></div>';
          html += '<div class="detail-row"><span class="detail-label">Points</span><span class="detail-value">' + (story.story_points || '—') + '</span></div>';
          html += '<div class="detail-row"><span class="detail-label">Agent</span><span class="detail-value">' + escapeHtml(story.assigned_agent_id || '—') + '</span></div>';
          html += '<div class="detail-row"><span class="detail-label">Branch</span><span class="detail-value">' + escapeHtml(story.branch_name || '—') + '</span></div>';
          if (story.pr_url) {
            html += '<div class="detail-row"><span class="detail-label">PR</span><span class="detail-value"><a href="' + escapeHtml(story.pr_url) + '" target="_blank" rel="noopener" style="color:var(--accent-cyan);">' + escapeHtml(story.pr_url) + '</a></span></div>';
          }
          html += '<div class="detail-row"><span class="detail-label">Description</span><span class="detail-value" style="white-space:pre-wrap;max-width:none;">' + escapeHtml(story.description) + '</span></div>';
          if (story.acceptance_criteria) {
            try {
              var ac = JSON.parse(story.acceptance_criteria);
              if (Array.isArray(ac)) {
                html += '<div style="margin-top:8px;"><label>ACCEPTANCE CRITERIA</label><ul style="padding-left:16px;">';
                ac.forEach(function(c) { html += '<li>' + escapeHtml(c) + '</li>'; });
                html += '</ul></div>';
              }
            } catch (e) {}
          }
          if (story.dependencies && story.dependencies.length > 0) {
            html += '<div style="margin-top:8px;"><label>DEPENDS ON</label>';
            story.dependencies.forEach(function(d) {
              html += '<div style="padding:2px 0;">' + escapeHtml(d.id) + ' — <span class="' + statusClass(d.status) + '">' + statusText(d.status) + '</span></div>';
            });
            html += '</div>';
          }
          if (story.dependents && story.dependents.length > 0) {
            html += '<div style="margin-top:8px;"><label>BLOCKED BY THIS</label>';
            story.dependents.forEach(function(d) {
              html += '<div style="padding:2px 0;">' + escapeHtml(d.id) + ' — <span class="' + statusClass(d.status) + '">' + statusText(d.status) + '</span></div>';
            });
            html += '</div>';
          }
          showModal('Story: ' + story.id, html);
        }).catch(function() {});
    }

    // Escalation resolve modal
    function showResolveModal(id, reason) {
      var html = '';
      html += '<div class="detail-row"><span class="detail-label">Escalation</span><span class="detail-value">' + escapeHtml(id) + '</span></div>';
      html += '<div class="detail-row"><span class="detail-label">Reason</span><span class="detail-value" style="white-space:pre-wrap;max-width:none;">' + escapeHtml(reason) + '</span></div>';
      html += '<label>Resolution</label>';
      html += '<textarea id="resolve-text" placeholder="Enter resolution instructions..."></textarea>';

      var footer = '<button class="btn" onclick="closeModal()">CANCEL</button>';
      footer += '<button class="btn btn-success" onclick="submitResolve(\\'' + escapeHtml(id) + '\\')">RESOLVE</button>';
      showModal('Resolve Escalation', html, footer);
      setTimeout(function() {
        var ta = document.getElementById('resolve-text');
        if (ta) ta.focus();
      }, 100);
    }

    function submitResolve(id) {
      var text = document.getElementById('resolve-text');
      if (!text || !text.value.trim()) return;
      fetch('/api/v1/escalations/' + encodeURIComponent(id) + '/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolution: text.value.trim() })
      }).then(function(r) {
        if (r.ok) { closeModal(); fetchInitialData(); }
        else r.json().then(function(d) { alert(d.error || 'Failed'); });
      }).catch(function() { alert('Request failed'); });
    }

    // Requirement submit modal
    function showRequirementModal() {
      var html = '';
      html += '<label>Title</label>';
      html += '<input type="text" id="req-title" placeholder="Feature title...">';
      html += '<label>Description</label>';
      html += '<textarea id="req-desc" placeholder="Detailed description of the requirement..."></textarea>';
      html += '<label>Target Branch</label>';
      html += '<input type="text" id="req-branch" placeholder="main" value="main">';
      html += '<div class="checkbox-row"><input type="checkbox" id="req-godmode"><label style="margin:0;cursor:pointer;" for="req-godmode">God Mode (bypass planning)</label></div>';

      var footer = '<button class="btn" onclick="closeModal()">CANCEL</button>';
      footer += '<button class="btn btn-primary" onclick="submitRequirement()">SUBMIT</button>';
      showModal('Submit Requirement', html, footer);
      setTimeout(function() {
        var el = document.getElementById('req-title');
        if (el) el.focus();
      }, 100);
    }

    function submitRequirement() {
      var title = document.getElementById('req-title');
      var desc = document.getElementById('req-desc');
      var branch = document.getElementById('req-branch');
      var godmode = document.getElementById('req-godmode');
      if (!title || !title.value.trim() || !desc || !desc.value.trim()) {
        alert('Title and description are required');
        return;
      }
      fetch('/api/v1/requirements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.value.trim(),
          description: desc.value.trim(),
          target_branch: branch ? branch.value.trim() || 'main' : 'main',
          godmode: godmode ? godmode.checked : false
        })
      }).then(function(r) {
        if (r.ok) { closeModal(); fetchInitialData(); }
        else r.json().then(function(d) { alert(d.error || 'Failed'); });
      }).catch(function() { alert('Request failed'); });
    }

    // Generic modal
    function showModal(title, bodyHtml, footerHtml) {
      document.getElementById('modal-title').textContent = title;
      document.getElementById('modal-body').innerHTML = bodyHtml;
      var footer = document.getElementById('modal-footer');
      if (footerHtml) {
        footer.innerHTML = footerHtml;
        footer.style.display = '';
      } else {
        footer.innerHTML = '';
        footer.style.display = 'none';
      }
      document.getElementById('modal-overlay').classList.add('active');
    }

    function closeModal() {
      document.getElementById('modal-overlay').classList.remove('active');
    }

    // Manager controls
    var managerRunning = false;

    function pollManagerStatus() {
      fetch('/api/v1/manager/status')
        .then(function(r) { return r.json(); })
        .then(function(data) {
          managerRunning = data.running;
          var btn = document.getElementById('manager-btn');
          if (btn) {
            if (data.running) {
              btn.textContent = 'MANAGER: ON';
              btn.className = 'btn btn-success';
            } else {
              btn.textContent = 'MANAGER: OFF';
              btn.className = 'btn';
              btn.style.borderColor = 'var(--accent-red)';
              btn.style.color = 'var(--accent-red)';
            }
          }
        }).catch(function() {});
    }

    function toggleManager() {
      var endpoint = managerRunning ? '/api/v1/manager/stop' : '/api/v1/manager/start';
      var btn = document.getElementById('manager-btn');
      if (btn) btn.textContent = 'MANAGER: ...';
      fetch(endpoint, { method: 'POST' })
        .then(function(r) { return r.json(); })
        .then(function() { pollManagerStatus(); })
        .catch(function() { pollManagerStatus(); });
    }

    // Add repo modal
    function showAddRepoModal() {
      var html = '';
      html += '<label>Repository URL</label>';
      html += '<input type="text" id="repo-url" placeholder="https://github.com/org/repo.git">';
      html += '<label>Team Name</label>';
      html += '<input type="text" id="repo-team" placeholder="my-team">';
      html += '<label>Branch</label>';
      html += '<input type="text" id="repo-branch" placeholder="main" value="main">';

      var footer = '<button class="btn" onclick="closeModal()">CANCEL</button>';
      footer += '<button class="btn btn-primary" onclick="submitAddRepo()">ADD REPO</button>';
      showModal('Add Repository', html, footer);
      setTimeout(function() {
        var el = document.getElementById('repo-url');
        if (el) el.focus();
      }, 100);
    }

    function submitAddRepo() {
      var url = document.getElementById('repo-url');
      var team = document.getElementById('repo-team');
      var branch = document.getElementById('repo-branch');
      if (!url || !url.value.trim() || !team || !team.value.trim()) {
        alert('Repository URL and team name are required');
        return;
      }
      fetch('/api/v1/teams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: url.value.trim(),
          team: team.value.trim(),
          branch: branch ? branch.value.trim() || 'main' : 'main'
        })
      }).then(function(r) {
        if (r.ok) { closeModal(); fetchInitialData(); }
        else r.json().then(function(d) { alert(d.error || 'Failed to add repo'); });
      }).catch(function() { alert('Request failed'); });
    }

    // Keyboard shortcuts
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') closeModal();
      if (e.key === 'r' && !e.ctrlKey && !e.metaKey && document.activeElement === document.body) {
        fetchInitialData();
      }
    });

    // Init
    fetchInitialData();
    connectWebSocket();
    pollManagerStatus();
    setInterval(pollManagerStatus, 10000);
  `;
}
