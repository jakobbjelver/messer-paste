package store

import (
	"context"
	"encoding/json"
	"fmt"
	"time"
)

// LoadSettings reads every stored override. The value column is a JSON scalar so one column can hold
// a number, a bool and a duration without a type map.
func (s *Store) LoadSettings(ctx context.Context) (map[string]any, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT key, value FROM settings`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := map[string]any{}
	for rows.Next() {
		var key, raw string
		if err := rows.Scan(&key, &raw); err != nil {
			return nil, err
		}
		var value any
		if err := json.Unmarshal([]byte(raw), &value); err != nil {
			// A row we cannot read is ignored, not fatal: a downgrade must not brick a database.
			continue
		}
		if n, ok := value.(float64); ok {
			value = int64(n)
		}
		out[key] = value
	}
	return out, rows.Err()
}

// SaveSettings writes the given keys in one transaction and returns the rows that changed.
func (s *Store) SaveSettings(ctx context.Context, values map[string]any) error {
	if len(values) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // a rollback after commit is a no-op

	now := time.Now().Unix()
	for key, value := range values {
		raw, err := json.Marshal(value)
		if err != nil {
			return fmt.Errorf("marshal %s: %w", key, err)
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
			key, string(raw), now); err != nil {
			return fmt.Errorf("save %s: %w", key, err)
		}
	}
	return tx.Commit()
}

// DeleteSettings drops the overrides for the given keys: the default (or the environment) takes over.
func (s *Store) DeleteSettings(ctx context.Context, keys []string) error {
	if len(keys) == 0 {
		return nil
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck // a rollback after commit is a no-op

	for _, key := range keys {
		if _, err := tx.ExecContext(ctx, `DELETE FROM settings WHERE key = ?`, key); err != nil {
			return fmt.Errorf("clear %s: %w", key, err)
		}
	}
	return tx.Commit()
}

// PurgeOlderThan deletes pastes whose last touch is older than the given unix time and returns the
// slugs that went, so the caller can drop their directories.
func (s *Store) PurgeOlderThan(ctx context.Context, before int64) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT slug FROM pastes WHERE updated_at < ?`, before)
	if err != nil {
		return nil, err
	}
	var slugs []string
	for rows.Next() {
		var slug string
		if err := rows.Scan(&slug); err != nil {
			rows.Close()
			return nil, err
		}
		slugs = append(slugs, slug)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, err
	}
	for _, slug := range slugs {
		if err := s.Delete(ctx, slug); err != nil {
			return slugs, err
		}
	}
	return slugs, nil
}
