/**
 * Multi-CLI Agent State Detection Types
 *
 * Defines common state detection interfaces and types that work across
 * different CLI tools (Claude Code, Codex, Gemini, etc.)
 */
/**
 * Universal agent states that apply across different CLI tools
 */
export var AgentState;
(function (AgentState) {
    // Active states - agent is actively working
    AgentState["THINKING"] = "thinking";
    AgentState["TOOL_RUNNING"] = "tool_running";
    AgentState["PROCESSING"] = "processing";
    // Waiting states - idle at prompt, ready for input
    AgentState["IDLE_AT_PROMPT"] = "idle_at_prompt";
    AgentState["WORK_COMPLETE"] = "work_complete";
    // Blocked states - requires human intervention
    AgentState["ASKING_QUESTION"] = "asking_question";
    AgentState["AWAITING_SELECTION"] = "awaiting_selection";
    AgentState["PLAN_APPROVAL"] = "plan_approval";
    AgentState["PERMISSION_REQUIRED"] = "permission_required";
    AgentState["USER_DECLINED"] = "user_declined";
    // Unknown state
    AgentState["UNKNOWN"] = "unknown";
})(AgentState || (AgentState = {}));
//# sourceMappingURL=types.js.map