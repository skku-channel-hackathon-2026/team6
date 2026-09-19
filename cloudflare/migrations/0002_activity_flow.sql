CREATE TABLE users (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  department TEXT NOT NULL,
  student_number TEXT NOT NULL UNIQUE
);

CREATE TABLE classes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  term TEXT NOT NULL,
  section TEXT NOT NULL,
  weekday INTEGER NOT NULL CHECK (weekday BETWEEN 0 AND 6), -- Sunday = 0
  start_time TEXT NOT NULL CHECK (start_time GLOB '[0-2][0-9]:[0-5][0-9]' AND start_time < '24:00'),
  end_time TEXT NOT NULL CHECK (end_time GLOB '[0-2][0-9]:[0-5][0-9]' AND end_time < '24:00' AND end_time > start_time),
  room TEXT NOT NULL
);

CREATE TABLE enrollments (
  user_id TEXT NOT NULL REFERENCES users(id),
  class_id TEXT NOT NULL REFERENCES classes(id),
  PRIMARY KEY (user_id, class_id)
);
CREATE INDEX enrollments_class ON enrollments(class_id, user_id);

CREATE TABLE activities (
  id TEXT PRIMARY KEY NOT NULL,
  class_id TEXT NOT NULL REFERENCES classes(id),
  class_starts_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', class_starts_at) IS NOT NULL AND class_starts_at = strftime('%Y-%m-%dT%H:%M:%SZ', class_starts_at)),
  starts_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', starts_at) IS NOT NULL AND starts_at = strftime('%Y-%m-%dT%H:%M:%SZ', starts_at)),
  ends_at TEXT NOT NULL CHECK (strftime('%Y-%m-%dT%H:%M:%SZ', ends_at) IS NOT NULL AND ends_at = strftime('%Y-%m-%dT%H:%M:%SZ', ends_at) AND ends_at > starts_at),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  place TEXT NOT NULL,
  max_people INTEGER NOT NULL CHECK (max_people BETWEEN 2 AND 4),
  status TEXT NOT NULL DEFAULT 'recruiting' CHECK (status IN ('recruiting', 'confirmed', 'completed')),
  completed_at TEXT,
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR (status <> 'completed' AND completed_at IS NULL))
);
CREATE INDEX activities_class_date ON activities(class_id, class_starts_at);

CREATE TABLE activity_participants (
  activity_id TEXT NOT NULL REFERENCES activities(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  joined_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (activity_id, user_id)
);
CREATE INDEX participants_user ON activity_participants(user_id, activity_id);

CREATE TABLE rematch_preferences (
  activity_id TEXT NOT NULL,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  PRIMARY KEY (activity_id, from_user_id, to_user_id),
  FOREIGN KEY (activity_id, from_user_id) REFERENCES activity_participants(activity_id, user_id),
  FOREIGN KEY (activity_id, to_user_id) REFERENCES activity_participants(activity_id, user_id),
  CHECK (from_user_id <> to_user_id)
);
CREATE INDEX preferences_target ON rematch_preferences(activity_id, to_user_id);
