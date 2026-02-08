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
  const [isChatOpen, setIsChatOpen] = useState(false);

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

        const normalizeStatus = (msg) => {
          if (msg.from === currentUser.id) {
            if (msg.readAt) return "read";
            if (msg.deliveredAt) return "delivered";
            return "sent";
          }
          return null;
        };

        const nextMessages = (response.messages || []).map((msg) => ({
          ...msg,
          status: normalizeStatus(msg),
        }));

        setMessages(nextMessages);
      } catch (error) {
        console.error("loadMessages failed", error);
      }
    },
    [authToken, currentUser.id]
  );

  useEffect(() => {
    loadContacts();
  }, [loadContacts]);

  useEffect(() => {
    setTypingContactId(null);
    clearCountsForContact(selectedContactId);
    loadMessages(selectedContactId);
    if (selectedContactId) {
      socket.emit("mark-read", { contactId: selectedContactId });
    }
  }, [clearCountsForContact, loadMessages, selectedContactId]);

  useEffect(() => {
    const handlePrivateMessage = (data) => {
      if (!data?.from || data.from === currentUser.id) return;

      const incomingMessage = {
        id: data.id,
        from: data.from,
        to: data.to,
        message: data.message,
        type: data.type || "text",
        mediaUrl: data.mediaUrl || null,
        mediaMime: data.mediaMime || null,
        mediaName: data.mediaName || null,
        mediaSize: data.mediaSize || null,
        deliveredAt: data.deliveredAt || null,
        readAt: data.readAt || null,
        timestamp: data.timestamp || Date.now(),
      };

      if (incomingMessage.from === selectedContactIdRef.current) {
        setMessages((prev) => [...prev, incomingMessage]);
        socket.emit("mark-read", { contactId: incomingMessage.from });
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

    const handleMessageStatus = ({ clientId, messageId, status, deliveredAt }) => {
      setMessages((prev) =>
        prev.map((msg) => {
          if (clientId && msg.clientId && msg.clientId === clientId) {
            return {
              ...msg,
              id: messageId || msg.id,
              status: status || msg.status,
              deliveredAt: deliveredAt || msg.deliveredAt,
            };
          }
          return msg;
        })
      );
    };

    const handleMessageRead = ({ messageIds, readAt }) => {
      if (!messageIds?.length) return;
      setMessages((prev) =>
        prev.map((msg) => {
          if (msg.from === currentUser.id && messageIds.includes(msg.id)) {
            return {
              ...msg,
              status: "read",
              readAt: readAt || msg.readAt,
            };
          }
          return msg;
        })
      );
    };

    socket.on("private-message", handlePrivateMessage);
    socket.on("typing", handleTyping);
    socket.on("stop-typing", handleStopTyping);
    socket.on("session-replaced", handleSessionReplaced);
    socket.on("message-status", handleMessageStatus);
    socket.on("message-read", handleMessageRead);

    return () => {
      socket.off("private-message", handlePrivateMessage);
      socket.off("typing", handleTyping);
      socket.off("stop-typing", handleStopTyping);
      socket.off("session-replaced", handleSessionReplaced);
      socket.off("message-status", handleMessageStatus);
      socket.off("message-read", handleMessageRead);
    };
  }, [currentUser.id, loadContacts, onLogout]);

  const sendMessage = () => {
    const cleanMessage = draftMessage.trim();
    if (!cleanMessage || !selectedContactId) return;

    const clientId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const outgoing = {
      id: clientId,
      clientId,
      from: currentUser.id,
      to: selectedContactId,
      message: cleanMessage,
      type: "text",
      status: "sent",
      timestamp: Date.now(),
    };

    setMessages((prev) => [...prev, outgoing]);

    socket.emit("private-message", {
      to: selectedContactId,
      message: cleanMessage,
      clientId,
    });

    socket.emit("stop-typing", { to: selectedContactId });

    setDraftMessage("");
    setTypingContactId(null);
  };

  const handleAddMessage = useCallback(
    (message) => {
      if (!message) return;
      const status =
        message.from === currentUser.id
          ? message.readAt
            ? "read"
            : message.deliveredAt
            ? "delivered"
            : "sent"
          : null;
      setMessages((prev) => [...prev, { ...message, status }]);
    },
    [currentUser.id]
  );

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
    setIsChatOpen(true);
    if (contactId) {
      socket.emit("mark-read", { contactId });
    }
  };

  const handleBackToList = () => {
    setIsChatOpen(false);
    setSelectedContactId(null);
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

  const handleDeleteContact = useCallback(
    async (contactId) => {
      if (!contactId) return;
      setAddContactError("");

      try {
        await apiRequest(`/contacts/${contactId}?deleteMessages=true`, {
          method: "DELETE",
          token: authToken,
        });

        if (selectedContactIdRef.current === contactId) {
          setMessages([]);
          setDraftMessage("");
        }

        await loadContacts();
        clearCountsForContact(contactId);
      } catch (error) {
        setAddContactError(error.message);
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
    <div className="flex flex-wrap items-center gap-2">
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
    <div className="min-h-[100dvh] bg-[#0b141a] sm:px-5 sm:py-6">
      <div className="mx-auto flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden bg-[#111b21] sm:h-[calc(100dvh-3rem)] sm:rounded-2xl sm:border sm:border-[#1f2c34] sm:shadow-[0_30px_60px_-35px_rgba(0,0,0,0.7)] md:flex-row">
        <Sidebar
          currentUser={currentUser}
          contacts={contacts}
          onlineUserIds={onlineUserIds}
          selectedContactId={selectedContactId}
          onSelectContact={handleSelectContact}
          isChatOpen={isChatOpen}
          isCallLocked={Boolean(callType)}
          unreadCounts={unreadCounts}
          missedCallCounts={missedCallCounts}
          onAddContact={handleAddContact}
          onDeleteContact={handleDeleteContact}
          addingContact={addingContact}
          addContactError={addContactError}
          onLogout={onLogout}
        />

        <div className={`flex min-h-0 flex-1 ${isChatOpen ? "flex" : "hidden"} md:flex`}>
          {contactsLoading ? (
            <div className="flex flex-1 items-center justify-center text-sm text-white/70">
              Loading chats...
            </div>
          ) : (
            <ChatWindow
              authToken={authToken}
              currentUser={currentUser}
              selectedContact={selectedContact}
              messages={messages}
              typingContactLabel={typingContactLabel}
              draftMessage={draftMessage}
              onDraftChange={handleDraftChange}
              onSendMessage={sendMessage}
              onAddMessage={handleAddMessage}
              callControls={callControls}
              onBack={handleBackToList}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default Chat;
