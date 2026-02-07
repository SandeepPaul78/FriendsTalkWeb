import { useCallback, useEffect, useState } from "react";
import Chat from "./pages/Chat";
import Login from "./pages/Login";
import { apiRequest, clearStoredAuth, getStoredAuth, storeAuth } from "./services/api";
import { connectSocket, disconnectSocket, socket } from "./services/socket";

function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [authToken, setAuthToken] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [onlineUserIds, setOnlineUserIds] = useState([]);

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
    />
  );
}

export default App;
