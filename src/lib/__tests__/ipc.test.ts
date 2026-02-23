import { invoke } from "@tauri-apps/api/core";
import { getVersion, login, register } from "../ipc";

const mockInvoke = vi.mocked(invoke);

describe("ipc.ts typed wrappers", () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it("getVersion calls invoke with get_version", async () => {
    mockInvoke.mockResolvedValue("0.1.0");
    const result = await getVersion();
    expect(mockInvoke).toHaveBeenCalledWith("get_version");
    expect(result).toBe("0.1.0");
  });

  it("login passes username and password to invoke", async () => {
    const response = {
      success: true,
      user: { id: "1", username: "alice", created_at: "" },
      error: null,
    };
    mockInvoke.mockResolvedValue(response);
    const result = await login("alice", "secret");
    expect(mockInvoke).toHaveBeenCalledWith("login", {
      username: "alice",
      password: "secret",
    });
    expect(result.success).toBe(true);
  });

  it("register returns error response correctly", async () => {
    const response = {
      success: false,
      user: null,
      error: "Username already taken",
    };
    mockInvoke.mockResolvedValue(response);
    const result = await register("alice", "secret");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Username already taken");
  });
});
