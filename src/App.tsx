import { useAuthStore } from "@/stores/authStore";
import { AuthScreen } from "@/components/auth/AuthScreen";
import { DAWLayout } from "@/components/daw/DAWLayout";

function App() {
  const { isAuthenticated } = useAuthStore();

  return isAuthenticated ? <DAWLayout /> : <AuthScreen />;
}

export default App;
