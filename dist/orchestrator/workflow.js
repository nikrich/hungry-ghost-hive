// Valid story status transitions
const STORY_TRANSITIONS = {
    draft: ['estimated'],
    estimated: ['planned'],
    planned: ['in_progress'],
    in_progress: ['review', 'qa_failed'],
    review: ['in_progress', 'qa'],
    qa: ['qa_failed', 'pr_submitted'],
    qa_failed: ['in_progress'],
    pr_submitted: ['merged'],
    merged: [],
};
export function canTransitionStory(from, to) {
    return STORY_TRANSITIONS[from]?.includes(to) ?? false;
}
export function getNextStatuses(status) {
    return STORY_TRANSITIONS[status] || [];
}
const REQUIREMENT_TRANSITIONS = {
    pending: ['planning'],
    planning: ['planned'],
    planned: ['in_progress'],
    in_progress: ['completed'],
    completed: [],
};
export function canTransitionRequirement(from, to) {
    return REQUIREMENT_TRANSITIONS[from]?.includes(to) ?? false;
}
export function getWorkflowState(db, requirementId) {
    let whereClause = '';
    const params = [];
    if (requirementId) {
        whereClause = 'WHERE requirement_id = ?';
        params.push(requirementId);
    }
    const stories = db.prepare(`
    SELECT status, COUNT(*) as count
    FROM stories
    ${whereClause}
    GROUP BY status
  `).all(...params);
    const counts = {};
    for (const row of stories) {
        counts[row.status] = row.count;
    }
    const activeStories = (counts.in_progress || 0) +
        (counts.review || 0) +
        (counts.qa || 0);
    const completedStories = (counts.pr_submitted || 0) +
        (counts.merged || 0);
    const blockedStories = counts.qa_failed || 0;
    // Determine current phase
    let phase = 'idle';
    if (counts.merged && completedStories === Object.values(counts).reduce((a, b) => a + b, 0)) {
        phase = 'completed';
    }
    else if (counts.pr_submitted) {
        phase = 'pr_submission';
    }
    else if (counts.qa) {
        phase = 'qa';
    }
    else if (counts.review) {
        phase = 'review';
    }
    else if (counts.in_progress) {
        phase = 'development';
    }
    else if (counts.planned) {
        phase = 'development'; // Ready to start development
    }
    else if (counts.estimated) {
        phase = 'estimation';
    }
    else if (counts.draft) {
        phase = 'planning';
    }
    else if (requirementId) {
        // Check requirement status
        const req = db.prepare('SELECT status FROM requirements WHERE id = ?').get(requirementId);
        if (req) {
            if (req.status === 'planning')
                phase = 'planning';
            else if (req.status === 'pending')
                phase = 'requirement_intake';
        }
    }
    return {
        phase,
        requirementId,
        activeStories,
        completedStories,
        blockedStories,
    };
}
export function isWorkflowBlocked(state) {
    return state.blockedStories > 0;
}
export function getWorkflowProgress(state) {
    const total = state.activeStories + state.completedStories + state.blockedStories;
    if (total === 0)
        return 0;
    return Math.round((state.completedStories / total) * 100);
}
//# sourceMappingURL=workflow.js.map