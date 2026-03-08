-- Migration 015: Add markdown_path column to stories table
-- Stories are now stored as markdown files in .hive/stories/ directory.
-- The DB stores the file path for reference.

ALTER TABLE stories ADD COLUMN markdown_path TEXT;
