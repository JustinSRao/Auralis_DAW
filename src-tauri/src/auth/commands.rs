use super::{db, models::*};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Algorithm, Argon2, Params, Version,
};
use chrono::Utc;
use tauri::Manager;
use uuid::Uuid;

/// Returns an Argon2id instance with the required security parameters:
/// memory=65536 KiB, iterations=2, parallelism=1.
fn argon2_instance() -> Result<Argon2<'static>, String> {
    let params = Params::new(65536, 2, 1, None).map_err(|e| e.to_string())?;
    Ok(Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
}

#[tauri::command]
pub async fn login(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<AuthResponse, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("music_app.db");

    let result = db::find_user_by_username(&db_path, &username).map_err(|e| e.to_string())?;

    match result {
        None => Ok(AuthResponse {
            success: false,
            user: None,
            error: Some("User not found".to_string()),
        }),
        Some((id, hash, created_at)) => {
            let parsed_hash = PasswordHash::new(&hash).map_err(|e| e.to_string())?;
            let argon2 = argon2_instance()?;
            let valid = argon2.verify_password(password.as_bytes(), &parsed_hash).is_ok();

            if valid {
                Ok(AuthResponse {
                    success: true,
                    user: Some(User { id, username, created_at }),
                    error: None,
                })
            } else {
                Ok(AuthResponse {
                    success: false,
                    user: None,
                    error: Some("Invalid password".to_string()),
                })
            }
        }
    }
}

#[tauri::command]
pub async fn register(
    app: tauri::AppHandle,
    username: String,
    password: String,
) -> Result<AuthResponse, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("music_app.db");

    // Check if username already exists
    if db::find_user_by_username(&db_path, &username)
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Ok(AuthResponse {
            success: false,
            user: None,
            error: Some("Username already taken".to_string()),
        });
    }

    let salt = SaltString::generate(&mut OsRng);
    let argon2 = argon2_instance()?;
    let hash = argon2
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| e.to_string())?
        .to_string();

    let id = Uuid::new_v4().to_string();
    let created_at = Utc::now().to_rfc3339();

    db::create_user(&db_path, &id, &username, &hash, &created_at)
        .map_err(|e| e.to_string())?;

    Ok(AuthResponse {
        success: true,
        user: Some(User { id, username, created_at }),
        error: None,
    })
}

#[tauri::command]
pub async fn logout() -> Result<(), String> {
    // Logout is handled on the frontend (clear zustand store)
    Ok(())
}

#[tauri::command]
pub async fn list_users(app: tauri::AppHandle) -> Result<Vec<User>, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("music_app.db");

    let users = db::list_users(&db_path)
        .map_err(|e| e.to_string())?
        .into_iter()
        .map(|(id, username, created_at)| User { id, username, created_at })
        .collect();

    Ok(users)
}

/// Validates a stored user ID against the database.
/// Returns `None` if the user no longer exists (e.g., DB was wiped while localStorage still had a session).
#[tauri::command]
pub async fn get_current_user(
    app: tauri::AppHandle,
    user_id: String,
) -> Result<Option<User>, String> {
    let db_path = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("music_app.db");

    match db::find_user_by_id(&db_path, &user_id).map_err(|e| e.to_string())? {
        None => Ok(None),
        Some((username, created_at)) => Ok(Some(User { id: user_id, username, created_at })),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_argon2_instance_uses_required_params() {
        let argon2 = argon2_instance().unwrap();
        let salt = SaltString::generate(&mut OsRng);
        let hash = argon2.hash_password(b"testpassword", &salt).unwrap().to_string();
        assert!(hash.contains("m=65536"), "expected m=65536 in hash: {hash}");
        assert!(hash.contains("t=2"), "expected t=2 in hash: {hash}");
        assert!(hash.contains("p=1"), "expected p=1 in hash: {hash}");
    }

    #[test]
    fn test_argon2_verify_valid_and_invalid_password() {
        let argon2 = argon2_instance().unwrap();
        let salt = SaltString::generate(&mut OsRng);
        let hash = argon2.hash_password(b"hunter2", &salt).unwrap().to_string();
        let parsed = PasswordHash::new(&hash).unwrap();
        assert!(argon2.verify_password(b"hunter2", &parsed).is_ok());
        assert!(argon2.verify_password(b"wrong", &parsed).is_err());
    }
}
