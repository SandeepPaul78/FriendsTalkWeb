import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AudioCall from "../components/AudioCall";
import ChatWindow from "../components/ChatWindow";
import Sidebar from "../components/Sidebar";
import VideoCall from "../components/VideoCall";
import { apiRequest } from "../services/api";
import { socket } from "../services/socket";

function Chat({ authToken, currentUser, onlineUserIds, onLogout }) {
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selectedContactId, setSelectedContactId] = useState(null);

  const [draftMessage, setDraftMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [typingContactId, setTypingContactId] = useState(null);
  const [callType, setCallType] = useState(null); // audio | video | null

  const [unreadCounts, setUnreadCounts] = useState({});
  const [missedCallCounts, setMissedCallCounts] = useState({});

  const [addContactError, setAddContactError] = useState("");
  const [addingContact, setAddingContact] = useState(false);

  const typingTimeoutRef = useRef(null);
  const selectedContactIdRef = useRef(selectedContactId);
  const contactsRef = useRef(contacts);

  useEffect(() => {
    selectedContactIdRef.current = selectedContactId;
  }, [selectedContactId]);

  useEffect(() => {
    return () => {
      clearTimeout(typingTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    contactsRef.current = contacts;
  }, [contacts]);

  const selectedContact = useMemo(() => {
    return contacts.find((contact) => contact.id === selectedContactId) || null;
  }, [contacts, selectedContactId]);

  const clearCountsForContact = useCallback((contactId) => {
    if (!contactId) return;

    setUnreadCounts((prev) => {
      if (!prev[contactId]) return prev;
      const next = { ...prev };
      delete next[contactId];
      return next;
    });

    setMissedCallCounts((prev) => {
      if (!prev[contactId]) return prev;
      const next = { ...prev };
      delete next[contactId];
      return next;
    });
  }, []);

  const loadContacts = useCallback(async () => {
    try {
      const response = await apiRequest("/contacts", {
        token: authToken,
      });

      const incomingContacts = response.contacts || [];
      setContacts(incomingContacts);

      setSelectedContactId((prevSelected) => {
        if (prevSelected && incomingContacts.some((contact) => contact.id === prevSelected)) {
          return prevSelected;
        }
        return incomingContacts[0]?.id || null;
      });
    } catch (error) {
      setAddContactError(error.message);
    } finally {
      setContactsLoading(false);
    }
  }, [authToken]);

  const loadMessages = useCallback(
    async (contactId) => {
      if (!contactId) {
        setMessages([]);
        return;
      }

      try {
        const response = await apiRequest(`/messages/${contactId}`, {
          token: authToken,
        });

        setMessages(response.messages || []);
      } catch (error) {
        console.error("loadMessages failed", error);
      }
    },
    [authToken]
  );

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    setTypingContactId(null);
    clearCountsForContact(selectedContactId);
    loadMessages(selectedContactId);
  }, [clearCountsForContact, loadMessages, selectedContactId]);

  useEffect(() => {
    const handlePrivateMessage = (data) => {
      if (!data?.from || data.from === currentUser.id) return;

      const incomingMessage = {
        id: data.id,
        from: data.from,
        to: data.to,
        message: data.message,
        timestamp: data.timestamp || Date.now(),
      };

      if (incomingMessage.from === selectedContactIdRef.current) {
        setMessages((prev) => [...prev, incomingMessage]);
        return;
      }

      setUnreadCounts((prev) => ({
        ...prev,
        [incomingMessage.from]: (prev[incomingMessage.from] || 0) + 1,
      }));

      if (!contactsRef.current.some((contact) => contact.id === incomingMessage.from)) {
        setContacts((prev) => {
          if (prev.some((contact) => contact.id === incomingMessage.from)) {
            return prev;
          }

          return [
            {
              id: incomingMessage.from,
              phoneNumber: data.fromPhone || "Unknown",
              displayName: data.fromPhone || "Unknown",
              isSaved: false,
              isOnline: true,
            },
            ...prev,
          ];
        });
        loadContacts();
      }
    };

    const handleTyping = ({ from }) => {
      if (from === selectedContactIdRef.current) {
        setTypingContactId(from);
      }
    };

    const handleStopTyping = ({ from }) => {
      if (from === selectedContactIdRef.current) {
        setTypingContactId(null);
      }
    };

    const handleSessionReplaced = () => {
      onLogout();
    };

    socket.on("private-message", handlePrivateMessage);
    socket.on("typing", handleTyping);
    socket.on("stop-typing", handleStopTyping);
    socket.on("session-replaced", handleSessionReplaced);

    return () => {
      socket.off("private-message", handlePrivateMessage);
      socket.off("typing", handleTyping);
      socket.off("stop-typing", handleStopTyping);
      socket.off("session-replaced", handleSessionReplaced);
    };
  }, [currentUser.id, loadContacts, onLogout]);

  const sendMessage = () => {
    const cleanMessage = draftMessage.trim();
    if (!cleanMessage || !selectedContactId) return;

    const outgoing = {
      id: `local-${Date.now()}`,
      from: currentUser.id,
      to: selectedContactId,
      message: cleanMessage,
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, outgoing]);

    socket.emit("private-message", {
      to: selectedContactId,
      message: cleanMessage,
    });

    socket.emit("stop-typing", { to: selectedContactId });

    setDraftMessage("");
    setTypingContactId(null);
  };

  const handleDraftChange = (value) => {
    setDraftMessage(value);
    if (!selectedContactId) return;

    socket.emit("typing", { to: selectedContactId });

    clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      socket.emit("stop-typing", { to: selectedContactId });
    }, 1000);
  };

  const handleSelectContact = (contactId) => {
    setSelectedContactId(contactId);
    clearCountsForContact(contactId);
    setTypingContactId(null);
  };

  const handleAddContact = useCallback(
    async ({ phoneNumber, name }) => {
      setAddContactError("");
      setAddingContact(true);

      try {
        const response = await apiRequest("/contacts", {
          method: "POST",
          token: authToken,
          body: { phoneNumber, name },
        });

        await loadContacts();
        setSelectedContactId(response.contact.id);
        clearCountsForContact(response.contact.id);
        return true;
      } catch (error) {
        setAddContactError(error.message);
        return false;
      } finally {
        setAddingContact(false);
      }
    },
    [authToken, clearCountsForContact, loadContacts]
  );

  const handleMissedCall = useCallback(({ from }) => {
    if (!from) return;

    setMissedCallCounts((prev) => ({
      ...prev,
      [from]: (prev[from] || 0) + 1,
    }));
  }, []);

  const handleAudioCallStart = useCallback(() => {
    setCallType("audio");
  }, []);

  const handleAudioCallEnd = useCallback(() => {
    setCallType((current) => (current === "audio" ? null : current));
  }, []);

  const handleVideoCallStart = useCallback(() => {
    setCallType("video");
  }, []);

  const handleVideoCallEnd = useCallback(() => {
    setCallType((current) => (current === "video" ? null : current));
  }, []);

  const typingContact = contacts.find((contact) => contact.id === typingContactId);
  const typingContactLabel = typingContact?.displayName || typingContact?.phoneNumber || null;

  const callControls = (
    <div className="flex flex-col gap-2">
      {callType !== "video" && (
        <AudioCall
          selectedUser={selectedContactId}
          selectedUserLabel={selectedContact?.displayName || selectedContact?.phoneNumber}
          onStart={handleAudioCallStart}
          onEnd={handleAudioCallEnd}
          onMissedCall={handleMissedCall}
        />
      )}

      {callType !== "audio" && (
        <VideoCall
          selectedUser={selectedContactId}
          selectedUserLabel={selectedContact?.displayName || selectedContact?.phoneNumber}
          onStart={handleVideoCallStart}
          onEnd={handleVideoCallEnd}
          onMissedCall={handleMissedCall}
        />
      )}
    </div>
  );

  return (
    <div className="bg-grid-soft min-h-screen px-3 py-4 sm:px-6 sm:py-8">
      <div className="mx-auto flex h-[calc(100vh-2rem)] max-w-7xl flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white/70 shadow-[0_24px_65px_-30px_rgba(15,23,42,0.55)] backdrop-blur-xl md:h-[calc(100vh-4rem)] md:flex-row">
        <Sidebar
          currentUser={currentUser}
          contacts={contacts}
          onlineUserIds={onlineUserIds}
          selectedContactId={selectedContactId}
          onSelectContact={handleSelectContact}
          isCallLocked={Boolean(callType)}
          unreadCounts={unreadCounts}
          missedCallCounts={missedCallCounts}
          onAddContact={handleAddContact}
          addingContact={addingContact}
          addContactError={addContactError}
          onLogout={onLogout}
        />

        {contactsLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-slate-500">
            Loading chats...
          </div>
        ) : (
          <ChatWindow
            currentUser={currentUser}
            selectedContact={selectedContact}
            messages={messages}
            typingContactLabel={typingContactLabel}
            draftMessage={draftMessage}
            onDraftChange={handleDraftChange}
            onSendMessage={sendMessage}
            callControls={callControls}
          />
        )}
      </div>
    </div>
  );
}

export default Chat;
