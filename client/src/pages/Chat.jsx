import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AudioCall from "../components/AudioCall";
import ChatWindow from "../components/ChatWindow";
import Sidebar from "../components/Sidebar";
import VideoCall from "../components/VideoCall";
import { apiRequest, uploadRequest } from "../services/api";
import { socket } from "../services/socket";

function Chat({ authToken, currentUser, onlineUserIds, onLogout }) {
  const [contacts, setContacts] = useState([]);
  const [contactsLoading, setContactsLoading] = useState(true);
  const [selectedContactId, setSelectedContactId] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("chats"); // chats | status | calls

  const [draftMessage, setDraftMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [typingContactId, setTypingContactId] = useState(null);
  const [callType, setCallType] = useState(null); // audio | video | null

  const [unreadCounts, setUnreadCounts] = useState({});
  const [missedCallCounts, setMissedCallCounts] = useState({});
  const [statuses, setStatuses] = useState([]);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusUploading, setStatusUploading] = useState(false);
  const [callHistory, setCallHistory] = useState([]);
  const [callHistoryLoading, setCallHistoryLoading] = useState(false);
  const [autoStartCall, setAutoStartCall] = useState(null); // { type, contactId, token }

  const [addContactError, setAddContactError] = useState("");
  const [addingContact, setAddingContact] = useState(false);

  const typingTimeoutRef = useRef(null);
  const selectedContactIdRef = useRef(selectedContactId);
  const contactsRef = useRef(contacts);
  const statusFileRef = useRef(null);

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

  const handleTabChange = (tab) => {
    setActiveTab(tab);
    if (tab !== "chats") {
      setIsChatOpen(false);
    }
  };

  const loadStatuses = useCallback(async () => {
    setStatusLoading(true);
    try {
      const response = await apiRequest("/status", { token: authToken });
      setStatuses(response.statuses || []);
    } catch (error) {
      console.error("loadStatuses failed", error);
    } finally {
      setStatusLoading(false);
    }
  }, [authToken]);

  const loadCallHistory = useCallback(async () => {
    setCallHistoryLoading(true);
    try {
      const response = await apiRequest("/calls", { token: authToken });
      setCallHistory(response.calls || []);
    } catch (error) {
      console.error("loadCallHistory failed", error);
    } finally {
      setCallHistoryLoading(false);
    }
  }, [authToken]);

  const handleStatusUpload = async (file) => {
    if (!file) return;
    setStatusUploading(true);
    try {
      const text = window.prompt("Status text (optional)") || "";
      await uploadRequest("/status/upload", {
        token: authToken,
        file,
        fields: { text },
      });
      await loadStatuses();
    } catch (error) {
      console.error("status upload failed", error);
    } finally {
      setStatusUploading(false);
    }
  };

  useEffect(() => {
    if (activeTab === "status") {
      loadStatuses();
    }
  }, [activeTab, loadStatuses]);

  useEffect(() => {
    if (activeTab === "calls") {
      loadCallHistory();
    }
  }, [activeTab, loadCallHistory]);

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

  const triggerAutoCall = (contactId, type) => {
    if (!contactId) return;
    setActiveTab("chats");
    setSelectedContactId(contactId);
    setIsChatOpen(true);
    setAutoStartCall({ type, contactId, token: Date.now() });
  };

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
          autoStartToken={
            autoStartCall?.type === "audio" && autoStartCall?.contactId === selectedContactId
              ? autoStartCall.token
              : null
          }
        />
      )}

      {callType !== "audio" && (
        <VideoCall
          selectedUser={selectedContactId}
          selectedUserLabel={selectedContact?.displayName || selectedContact?.phoneNumber}
          onStart={handleVideoCallStart}
          onEnd={handleVideoCallEnd}
          onMissedCall={handleMissedCall}
          autoStartToken={
            autoStartCall?.type === "video" && autoStartCall?.contactId === selectedContactId
              ? autoStartCall.token
              : null
          }
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
          activeTab={activeTab}
          onTabChange={handleTabChange}
          isCallLocked={Boolean(callType)}
          unreadCounts={unreadCounts}
          missedCallCounts={missedCallCounts}
          onAddContact={handleAddContact}
          onDeleteContact={handleDeleteContact}
          addingContact={addingContact}
          addContactError={addContactError}
          onLogout={onLogout}
        />

        <div className="flex min-h-0 flex-1">
          {activeTab === "chats" && (
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
                  onSaveContact={handleAddContact}
                  callControls={callControls}
                  onBack={handleBackToList}
                />
              )}
            </div>
          )}

          {activeTab === "status" && (
            <div className="flex min-h-0 flex-1 flex-col bg-[#0b141a] pb-16 text-white md:pb-0">
              <div className="border-b border-[#1f2c34] bg-[#005c4b] px-4 py-3 sm:px-6">
                <h3 className="font-display text-lg font-semibold">Status</h3>
                <p className="text-xs text-white/70">Share a photo or video update</p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-6">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-semibold">My Status</p>
                      <p className="text-xs text-white/60">
                        Add a photo or video update
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => statusFileRef.current?.click()}
                      disabled={statusUploading}
                      className="rounded-full bg-[#25d366] px-3 py-1 text-xs font-semibold text-[#073e2a] hover:bg-[#1fc15c] disabled:opacity-60"
                    >
                      {statusUploading ? "Uploading..." : "Add"}
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={loadStatuses}
                  className="self-start rounded-full border border-white/20 px-3 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10"
                >
                  Refresh
                </button>

                {statusLoading && (
                  <div className="text-sm text-white/60">Loading status...</div>
                )}

                {!statusLoading && statuses.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                    No status yet.
                  </div>
                )}

                <div className="grid gap-3">
                  {statuses.map((status) => (
                    <div
                      key={status.id}
                      className="rounded-2xl border border-white/10 bg-white/5 p-3 text-white"
                    >
                      <div className="flex items-center justify-between text-xs text-white/60">
                        <span>{status.ownerPhone}</span>
                        <span>{new Date(status.createdAt).toLocaleTimeString()}</span>
                      </div>
                      {status.mediaType === "image" && (
                        <img
                          src={status.mediaUrl}
                          alt="Status"
                          className="mt-2 max-h-80 w-full rounded-xl object-cover"
                        />
                      )}
                      {status.mediaType === "video" && (
                        <video
                          src={status.mediaUrl}
                          controls
                          className="mt-2 max-h-80 w-full rounded-xl bg-black object-cover"
                        />
                      )}
                      {status.text && (
                        <p className="mt-2 text-sm text-white/90">{status.text}</p>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <input
                ref={statusFileRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) handleStatusUpload(file);
                  event.target.value = "";
                }}
              />
            </div>
          )}

          {activeTab === "calls" && (
            <div className="flex min-h-0 flex-1 flex-col bg-[#0b141a] pb-16 text-white md:pb-0">
              <div className="border-b border-[#1f2c34] bg-[#005c4b] px-4 py-3 sm:px-6">
                <h3 className="font-display text-lg font-semibold">Calls</h3>
                <p className="text-xs text-white/70">Audio & video call history</p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={loadCallHistory}
                  className="self-start rounded-full border border-white/20 px-3 py-1 text-[11px] font-semibold text-white/80 hover:bg-white/10"
                >
                  Refresh
                </button>

                {callHistoryLoading && (
                  <div className="text-sm text-white/60">Loading calls...</div>
                )}

                {!callHistoryLoading && callHistory.length === 0 && (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-6 text-center text-sm text-white/60">
                    No calls yet.
                  </div>
                )}

                <div className="grid gap-3">
                  {callHistory.map((call) => (
                    <div
                      key={call.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">{call.peerPhone}</p>
                        <p className="text-xs text-white/60">
                          {call.callType} · {call.direction} · {call.status}
                        </p>
                        <p className="text-[11px] text-white/50">
                          {new Date(call.startedAt).toLocaleString()}
                        </p>
                      </div>

                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => triggerAutoCall(call.peerId, "audio")}
                          className="rounded-full border border-white/30 px-3 py-1 text-[11px] font-semibold text-white/90 hover:bg-white/10"
                        >
                          Audio
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerAutoCall(call.peerId, "video")}
                          className="rounded-full border border-white/30 px-3 py-1 text-[11px] font-semibold text-white/90 hover:bg-white/10"
                        >
                          Video
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[#1f2c34] bg-[#111b21] md:hidden">
        <div className="mx-auto flex max-w-6xl items-center justify-around px-4 py-2 text-xs text-white/70">
          {[
            { key: "chats", label: "Chats" },
            { key: "status", label: "Status" },
            { key: "calls", label: "Calls" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => handleTabChange(tab.key)}
              className={`rounded-full px-4 py-2 text-xs font-semibold ${
                activeTab === tab.key
                  ? "bg-[#25d366] text-[#073e2a]"
                  : "text-white/70"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export default Chat;
