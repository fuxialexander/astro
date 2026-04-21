ALTER TABLE projects ADD CONSTRAINT projects_terminal_open_in_check
  CHECK (terminal_open_in IS NULL OR terminal_open_in IN ('local', 'remote'));
