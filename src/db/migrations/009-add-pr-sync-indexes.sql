-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Migration 009: Add pull request sync indexes for faster identifier lookups

CREATE INDEX IF NOT EXISTS idx_pull_requests_status_branch ON pull_requests(status, branch_name);
CREATE INDEX IF NOT EXISTS idx_pull_requests_github_pr_number ON pull_requests(github_pr_number);
