-- jobs table tracks each CSV upload pipeline run
CREATE TABLE IF NOT EXISTS jobs (
    id          SERIAL PRIMARY KEY,
    file_name   VARCHAR(255) NOT NULL,
    status      VARCHAR(50)  NOT NULL DEFAULT 'pending',
    row_count_before INT,
    row_count_after  INT,
    enriched_api     VARCHAR(100),
    error_message    TEXT,
    created_at  TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMP NOT NULL DEFAULT NOW()
);

-- index for quick status lookups
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

ALTER TABLE jobs ADD COLUMN IF NOT EXISTS enriched_columns TEXT;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS skipped_rows INT DEFAULT 0;
ALTER TABLE jobs ADD COLUMN IF NOT EXISTS output_path TEXT;