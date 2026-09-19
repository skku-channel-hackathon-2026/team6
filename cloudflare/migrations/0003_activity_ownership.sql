ALTER TABLE activities ADD COLUMN created_by TEXT REFERENCES users(id);
CREATE INDEX activities_creator ON activities(created_by, status);
