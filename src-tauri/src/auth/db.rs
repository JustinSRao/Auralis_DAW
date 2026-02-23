use anyhow::Result;
use rusqlite::{Connection, params};
use std::path::Path;

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
