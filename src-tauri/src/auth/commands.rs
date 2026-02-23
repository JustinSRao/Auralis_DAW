use super::{db, models::*};
use argon2::{
    password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2,
};
use chrono::Utc;
use tauri::Manager;
use uuid::Uuid;

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
            let valid = Argon2::default()
                .verify_password(password.as_bytes(), &parsed_hash)
                .is_ok();

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
    let hash = Argon2::default()
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
