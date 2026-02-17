import { useCallback, useEffect, useState } from "react";
import Chat from "./pages/Chat";
import Login from "./pages/Login";
import { apiRequest, clearStoredAuth, getStoredAuth, storeAuth } from "./services/api";
import { connectSocket, disconnectSocket, socket } from "./services/socket";

const THEME_STORAGE_KEY = "friendstalk_theme_mode";
const THEME_VARIANT_STORAGE_KEY = "friendstalk_theme_variant";

const getInitialTheme = () => {
  if (typeof window === "undefined") return "dark";
  const storedTheme = localStorage.getItem(THEME_STORAGE_KEY);
  if (storedTheme === "dark" || storedTheme === "light") return storedTheme;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
};

const getInitialThemeVariant = () => {
  if (typeof window === "undefined") return "neon";
  const storedVariant = localStorage.getItem(THEME_VARIANT_STORAGE_KEY);
  const valid = new Set(["neon", "gold", "corporate"]);
  return valid.has(storedVariant) ? storedVariant : "neon";
};

function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authToken, setAuthToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [onlineUserIds, setOnlineUserIds] = useState([]);
  const [themeMode, setThemeMode] = useState(getInitialTheme);
  const [themeVariant, setThemeVariant] = useState(getInitialThemeVariant);

  useEffect(() => {
    const restoreSession = async () => {
      const storedAuth = getStoredAuth();
      if (!storedAuth?.token) {
        setAuthLoading(false);
        return;
      }

      try {
        const response = await apiRequest("/auth/me", {
          token: storedAuth.token,
        });

        setAuthToken(storedAuth.token);
        setCurrentUser(response.user);
        storeAuth({ token: storedAuth.token, user: response.user });
      } catch {
        clearStoredAuth();
      } finally {
        setAuthLoading(false);
      }
    };

    restoreSession();
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", themeMode);
    localStorage.setItem(THEME_STORAGE_KEY, themeMode);
  }, [themeMode]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme-accent", themeVariant);
    localStorage.setItem(THEME_VARIANT_STORAGE_KEY, themeVariant);
  }, [themeVariant]);

  useEffect(() => {
    if (!authToken || !currentUser?.id) return;

    connectSocket(authToken);

    const handleOnlineUsers = (userIds) => {
      setOnlineUserIds(userIds || []);
    };

    socket.on("online-users", handleOnlineUsers);

    return () => {
      socket.off("online-users", handleOnlineUsers);
    };
  }, [authToken, currentUser?.id]);

  const handleAuthSuccess = useCallback(({ token, user }) => {
    setAuthToken(token);
    setCurrentUser(user);
    storeAuth({ token, user });
  }, []);

  const handleLogout = useCallback(() => {
    disconnectSocket();
    clearStoredAuth();
    setAuthToken(null);
    setCurrentUser(null);
    setOnlineUserIds([]);
  }, []);

  const handleThemeToggle = useCallback(() => {
    setThemeMode((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const handleThemeVariantChange = useCallback((variant) => {
    if (!variant) return;
    setThemeVariant(variant);
  }, []);

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="rounded-xl border border-slate-200 bg-white/80 px-5 py-3 text-sm text-slate-600">
          Restoring session...
        </div>
      </div>
    );
  }

  if (!authToken || !currentUser) {
    return <Login onAuthSuccess={handleAuthSuccess} />;
  }

  return (
    <Chat
      authToken={authToken}
      currentUser={currentUser}
      onlineUserIds={onlineUserIds}
      onLogout={handleLogout}
      themeMode={themeMode}
      onThemeToggle={handleThemeToggle}
      themeVariant={themeVariant}
      onThemeVariantChange={handleThemeVariantChange}
    />
  );
}

export default App;
