-- Reading position is deliberately separate from academic progress.
CREATE TABLE IF NOT EXISTS lms_course_positions (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_id integer NOT NULL REFERENCES lms_courses(id) ON DELETE CASCADE,
  lesson_id integer REFERENCES lms_lessons(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lms_course_positions_user_course_unique UNIQUE (user_id, course_id)
);
