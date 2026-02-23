use serde::{Deserialize, Serialize};

/// Represents an authenticated user returned from login/register commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub username: String,
    pub created_at: String,
}

/// Payload for the `login` IPC command.
#[derive(Debug, Deserialize)]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

/// Payload for the `register` IPC command.
#[derive(Debug, Deserialize)]
pub struct RegisterRequest {
    pub username: String,
    pub password: String,
}

/// Unified response returned by auth IPC commands.
#[derive(Debug, Serialize)]
pub struct AuthResponse {
    pub success: bool,
    pub user: Option<User>,
    pub error: Option<String>,
}
