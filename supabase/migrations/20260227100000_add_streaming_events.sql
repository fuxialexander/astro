-- Streaming events: append-only log for SSE catch-up on reconnection.
-- Structural events persist immediately; text accumulates per-turn.

CREATE TABLE IF NOT EXISTS streaming_events (
  seq BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  execution_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_streaming_events_exec_seq
  ON streaming_events(execution_id, seq);
