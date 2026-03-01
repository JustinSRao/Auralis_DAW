use anyhow::Result;
use rusqlite::{Connection, params};
use std::path::Path;

/// Initializes the SQLite database at the given path, creating the schema if absent.
/// Safe to call multiple times — all DDL uses `CREATE TABLE IF NOT EXISTS`.
pub fn initialize_database(db_path: &Path) -> Result<()> {
    let conn = Connection::open(db_path)?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS users (
            id          TEXT PRIMARY KEY,
            username    TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at  TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS user_settings (
            user_id     TEXT PRIMARY KEY,
            settings    TEXT NOT NULL DEFAULT '{}',
            FOREIGN KEY(user_id) REFERENCES users(id)
        );",
    )?;

    Ok(())
}

/// Looks up a user by username, returning `(id, password_hash, created_at)` if found.
pub fn find_user_by_username(
    db_path: &Path,
    username: &str,
) -> Result<Option<(String, String, String)>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT id, password_hash, created_at FROM users WHERE username = ?1",
    )?;

    let result = stmt
        .query_row(params![username], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .ok();

    Ok(result)
}

/// Inserts a new user row into the database.
pub fn create_user(
    db_path: &Path,
    id: &str,
    username: &str,
    password_hash: &str,
    created_at: &str,
) -> Result<()> {
    let conn = Connection::open(db_path)?;
    conn.execute(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
        params![id, username, password_hash, created_at],
    )?;
    Ok(())
}

/// Looks up a user by their UUID, returning `(username, created_at)` if found.
pub fn find_user_by_id(
    db_path: &Path,
    id: &str,
) -> Result<Option<(String, String)>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare(
        "SELECT username, created_at FROM users WHERE id = ?1",
    )?;
    let result = stmt
        .query_row(params![id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .ok();
    Ok(result)
}

/// Returns all users sorted by username as `(id, username, created_at)` tuples.
pub fn list_users(db_path: &Path) -> Result<Vec<(String, String, String)>> {
    let conn = Connection::open(db_path)?;
    let mut stmt = conn.prepare("SELECT id, username, created_at FROM users ORDER BY username")?;

    let users = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })?
        .filter_map(|r| r.ok())
        .collect();

    Ok(users)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::NamedTempFile;

    fn temp_db() -> (NamedTempFile, std::path::PathBuf) {
        let f = NamedTempFile::new().unwrap();
        let p = f.path().to_path_buf();
        (f, p)
    }

    #[test]
    fn test_initialize_creates_tables() {
        let (_f, path) = temp_db();
        initialize_database(&path).expect("initialize failed");
        // Second call must be idempotent
        initialize_database(&path).expect("second initialize failed");
    }

    #[test]
    fn test_create_and_find_user() {
        let (_f, path) = temp_db();
        initialize_database(&path).unwrap();
        create_user(&path, "u1", "alice", "hash123", "2026-01-01T00:00:00Z").unwrap();
        let result = find_user_by_username(&path, "alice").unwrap();
        assert!(result.is_some());
        let (id, hash, _) = result.unwrap();
        assert_eq!(id, "u1");
        assert_eq!(hash, "hash123");
    }

    #[test]
    fn test_find_nonexistent_user_returns_none() {
        let (_f, path) = temp_db();
        initialize_database(&path).unwrap();
        let result = find_user_by_username(&path, "ghost").unwrap();
        assert!(result.is_none());
    }

    #[test]
    fn test_list_users_empty() {
        let (_f, path) = temp_db();
        initialize_database(&path).unwrap();
        let users = list_users(&path).unwrap();
        assert!(users.is_empty());
    }

    #[test]
    fn test_list_users_sorted_by_username() {
        let (_f, path) = temp_db();
        initialize_database(&path).unwrap();
        create_user(&path, "u2", "zara", "h", "2026-01-01T00:00:00Z").unwrap();
        create_user(&path, "u1", "alice", "h", "2026-01-01T00:00:00Z").unwrap();
        let users = list_users(&path).unwrap();
        assert_eq!(users[0].1, "alice");
        assert_eq!(users[1].1, "zara");
    }

    #[test]
    fn test_find_user_by_id_returns_user() {
        let (_f, path) = temp_db();
        initialize_database(&path).unwrap();
        create_user(&path, "abc123", "alice", "hash", "2026-01-01T00:00:00Z").unwrap();
        let result = find_user_by_id(&path, "abc123").unwrap();
        assert!(result.is_some());
        let (username, _) = result.unwrap();
        assert_eq!(username, "alice");
    }

    #[test]
    fn test_find_user_by_id_nonexistent_returns_none() {
        let (_f, path) = temp_db();
        initialize_database(&path).unwrap();
        let result = find_user_by_id(&path, "nonexistent-id").unwrap();
        assert!(result.is_none());
    }
}
