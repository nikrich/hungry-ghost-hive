-- Licensed under the Hungry Ghost Hive License. See LICENSE.

-- Add browser_tab_id to agents for Chrome tab isolation.
-- Each Chrome-enabled agent tracks its own dedicated browser tab.
ALTER TABLE agents ADD COLUMN browser_tab_id INTEGER;
