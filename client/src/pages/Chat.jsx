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
  const [statusError, setStatusError] = useState("");
  const [activeStatus, setActiveStatus] = useState(null);
  const [statusReply, setStatusReply] = useState("");
  const [statusReplyError, setStatusReplyError] = useState("");
  const [statusMenuOpenId, setStatusMenuOpenId] = useState(null);
  const [statusDeletingId, setStatusDeletingId] = useState(null);
  const statusTimerRef = useRef(null);
  const statusProgressRef = useRef(null);
  const statusQueueRef = useRef([]);
  const statusIndexRef = useRef(0);
  const [statusProgress, setStatusProgress] = useState(0);
  const STATUS_DURATION_MS = 30000;
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

  const contactNameById = useMemo(() => {
    const map = new Map();
    contacts.forEach((contact) => {
      map.set(contact.id, contact.displayName || contact.phoneNumber);
    });
    return map;
  }, [contacts]);

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
        statusId: data.statusId || null,
        statusOwner: data.statusOwner || null,
        statusMediaUrl: data.statusMediaUrl || "",
        statusMediaType: data.statusMediaType || "",
        statusText: data.statusText || "",
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

  const isStatusSeen = useCallback((statusId) => {
    const status = statuses.find((item) => item.id === statusId);
    return Boolean(status?.isSeen);
  }, [statuses]);

  const markStatusSeen = useCallback(
    async (statusId) => {
      if (!statusId) return;
      try {
        await apiRequest(`/status/${statusId}/seen`, { method: "POST", token: authToken });
            setStatuses((prev) =>
              prev.map((item) =>
                item.id === statusId ? { ...item, isSeen: true } : item
              )
            );
      } catch (error) {
        console.error("mark status seen failed", error);
      }
    },
    [authToken]
  );

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
    setStatusError("");
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
      setStatusError(error.message || "Status upload failed");
    } finally {
      setStatusUploading(false);
    }
  };

  const handleTextStatus = async () => {
    const text = window.prompt("Write your status") || "";
    if (!text.trim()) return;
    setStatusUploading(true);
    setStatusError("");
    try {
      await uploadRequest("/status/upload", {
        token: authToken,
        file: null,
        fields: { text: text.trim() },
      });
      await loadStatuses();
    } catch (error) {
      setStatusError(error.message || "Status upload failed");
    } finally {
      setStatusUploading(false);
    }
  };

  const handleStatusReply = async () => {
    if (!activeStatus || !statusReply.trim()) return;
    setStatusReplyError("");
    try {
      await apiRequest(`/status/${activeStatus.id}/reply`, {
        method: "POST",
        token: authToken,
        body: { message: statusReply.trim() },
      });
      setStatusReply("");
      setActiveStatus(null);
    } catch (error) {
      setStatusReplyError(error.message || "Failed to reply");
    }
  };

  const handleDeleteStatus = useCallback(
    async (statusId) => {
      if (!statusId) return;
      setStatusDeletingId(statusId);
      try {
        await apiRequest(`/status/${statusId}`, {
          method: "DELETE",
          token: authToken,
        });
        setStatusMenuOpenId(null);
        await loadStatuses();
      } catch (error) {
        setStatusError(error.message || "Failed to delete status");
      } finally {
        setStatusDeletingId(null);
      }
    },
    [authToken, loadStatuses]
  );

  const stopStatusTimer = () => {
    if (statusTimerRef.current) {
      clearInterval(statusTimerRef.current);
      statusTimerRef.current = null;
    }
  };

  const startStatusTimer = useCallback(() => {
    stopStatusTimer();
    setStatusProgress(0);
    const startedAt = Date.now();
    statusTimerRef.current = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      const progress = Math.min(100, (elapsed / STATUS_DURATION_MS) * 100);
      setStatusProgress(progress);
      if (progress >= 100) {
        stopStatusTimer();
        const nextIndex = statusIndexRef.current + 1;
        const queue = statusQueueRef.current;
        if (nextIndex < queue.length) {
          statusIndexRef.current = nextIndex;
          const nextStatus = queue[nextIndex];
          setActiveStatus(nextStatus);
          if (nextStatus.ownerId !== currentUser.id) {
            markStatusSeen(nextStatus.id);
          }
          setTimeout(startStatusTimer, 0);
        } else {
          setActiveStatus(null);
        }
      }
    }, 120);
  }, [STATUS_DURATION_MS, currentUser.id, markStatusSeen]);

  useEffect(() => {
    if (activeTab === "status") {
      loadStatuses();
    }
  }, [activeTab, loadStatuses]);

  useEffect(() => {
    if (!activeStatus) {
      stopStatusTimer();
      return;
    }
    startStatusTimer();
    return () => stopStatusTimer();
  }, [activeStatus, startStatusTimer]);

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
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold">My Status</p>
                      <p className="text-xs text-white/60">
                        Add a photo, video, or text update
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleTextStatus}
                        disabled={statusUploading}
                        className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/90 hover:bg-white/10 disabled:opacity-60"
                      >
                        Text
                      </button>
                      <button
                        type="button"
                        onClick={() => statusFileRef.current?.click()}
                        disabled={statusUploading}
                        className="rounded-full bg-[#25d366] px-3 py-1 text-xs font-semibold text-[#073e2a] hover:bg-[#1fc15c] disabled:opacity-60"
                      >
                        {statusUploading ? "Uploading..." : "Media"}
                      </button>
                    </div>
                  </div>
                </div>

                {statusError && (
                  <div className="rounded-xl border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                    {statusError}
                  </div>
                )}

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

                {(() => {
                  const list = statuses.filter((s) => s.ownerId !== currentUser.id);
                  const unseen = list.filter((s) => !isStatusSeen(s.id));
                  const seen = list.filter((s) => isStatusSeen(s.id));

                  const openStatus = (status) => {
                    setStatusMenuOpenId(null);
                    const list =
                      status.ownerId === currentUser.id
                        ? statuses.filter((s) => s.ownerId === currentUser.id)
                        : [...unseen, ...seen];
                    statusQueueRef.current = list;
                    const index = list.findIndex((item) => item.id === status.id);
                    statusIndexRef.current = index >= 0 ? index : 0;
                    setActiveStatus(list[statusIndexRef.current]);
                    if (status.ownerId !== currentUser.id) {
                      markStatusSeen(status.id);
                    }
                  };

                  const renderRow = (status) => (
                    <div
                      key={status.id}
                      className="flex w-full items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/5 px-3 py-2"
                    >
                      <button
                        type="button"
                        onClick={() => openStatus(status)}
                        className="flex min-w-0 flex-1 items-center gap-3 text-left"
                      >
                      <div className="relative">
                        <div
                          className={`h-12 w-12 rounded-full border-2 ${
                            isStatusSeen(status.id) ? "border-white/20" : "border-[#25d366]"
                          }`}
                        />
                        {status.mediaType === "image" && (
                          <img
                            src={status.mediaUrl}
                            alt="Status"
                            className="absolute inset-1 h-10 w-10 rounded-full object-cover"
                          />
                        )}
                        {status.mediaType === "video" && (
                          <div className="absolute inset-1 flex h-10 w-10 items-center justify-center rounded-full bg-black/60 text-xs">
                            ▶
                          </div>
                        )}
                        {status.mediaType === "text" && (
                          <div className="absolute inset-1 flex h-10 w-10 items-center justify-center rounded-full bg-[#1f2c34] text-[10px] font-semibold text-white">
                            T
                          </div>
                        )}
                      </div>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold">
                          {status.ownerId === currentUser.id
                            ? "My Status"
                            : contactNameById.get(status.ownerId) || status.ownerPhone}
                        </p>
                        <p className="text-xs text-white/60">
                          {new Date(status.createdAt).toLocaleString()}
                        </p>
                      </div>
                      </button>

                      {status.ownerId === currentUser.id && (
                        <div className="relative">
                          <button
                            type="button"
                            onClick={() =>
                              setStatusMenuOpenId((prev) => (prev === status.id ? null : status.id))
                            }
                            className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-white/80 hover:bg-white/10"
                            aria-label="Status options"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                              <path d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                            </svg>
                          </button>

                          {statusMenuOpenId === status.id && (
                            <div className="absolute right-0 top-9 z-20 w-32 rounded-lg border border-white/20 bg-[#111b21] p-1 shadow-xl">
                              <button
                                type="button"
                                onClick={() => handleDeleteStatus(status.id)}
                                disabled={statusDeletingId === status.id}
                                className="w-full rounded-md px-3 py-2 text-left text-xs text-rose-300 hover:bg-white/10 disabled:opacity-60"
                              >
                                {statusDeletingId === status.id ? "Deleting..." : "Delete"}
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );

                  return (
                    <div className="grid gap-3">
                      {statuses.filter((s) => s.ownerId === currentUser.id).length > 0 && (
                        <>
                          <div className="text-xs font-semibold text-white/60">My Status</div>
                          {statuses
                            .filter((s) => s.ownerId === currentUser.id)
                            .map(renderRow)}
                        </>
                      )}
                      {unseen.length > 0 && (
                        <div className="text-xs font-semibold text-white/60">Recent</div>
                      )}
                      {unseen.map(renderRow)}
                      {seen.length > 0 && (
                        <div className="text-xs font-semibold text-white/40">Viewed</div>
                      )}
                      {seen.map(renderRow)}
                    </div>
                  );
                })()}
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
                      <p className="truncate text-sm font-semibold">
                        {contactNameById.get(call.peerId) || call.peerPhone}
                      </p>
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

      {!isChatOpen && (
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
      )}

      {activeStatus && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="h-1 w-full bg-white/20">
            <div
              className="h-full bg-white"
              style={{ width: `${statusProgress}%` }}
            />
          </div>
          <div className="flex items-center justify-between px-4 py-3 text-white">
            <div>
              <p className="text-sm font-semibold">
                {activeStatus.ownerId === currentUser.id
                  ? "My Status"
                  : contactNameById.get(activeStatus.ownerId) || activeStatus.ownerPhone}
              </p>
              <p className="text-xs text-white/60">
                {new Date(activeStatus.createdAt).toLocaleString()}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {activeStatus.ownerId === currentUser.id && (
                <button
                  type="button"
                  onClick={async () => {
                    await apiRequest(`/status/${activeStatus.id}`, {
                      method: "DELETE",
                      token: authToken,
                    });
                    setActiveStatus(null);
                    loadStatuses();
                  }}
                  className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold text-white/90"
                >
                  Delete
                </button>
              )}
              <button
                type="button"
                onClick={() => setActiveStatus(null)}
                className="rounded-full border border-white/30 px-3 py-1 text-xs font-semibold text-white/90"
              >
                Close
              </button>
            </div>
          </div>
          <div
            className="flex flex-1 items-center justify-center p-4"
            onClick={() => {
              const queue = statusQueueRef.current;
              const nextIndex = statusIndexRef.current + 1;
              if (nextIndex < queue.length) {
                statusIndexRef.current = nextIndex;
                const nextStatus = queue[nextIndex];
                setActiveStatus(nextStatus);
                if (nextStatus.ownerId !== currentUser.id) {
                  markStatusSeen(nextStatus.id);
                }
              } else {
                setActiveStatus(null);
              }
            }}
          >
            {activeStatus.mediaType === "image" && (
              <img
                src={activeStatus.mediaUrl}
                alt="Status"
                className="max-h-full w-full rounded-2xl object-contain"
              />
            )}
            {activeStatus.mediaType === "video" && (
              <video
                src={activeStatus.mediaUrl}
                controls
                autoPlay
                className="max-h-full w-full rounded-2xl bg-black object-contain"
              />
            )}
            {activeStatus.mediaType === "text" && (
              <div className="flex h-full w-full items-center justify-center rounded-2xl bg-[#1f2c34] p-6 text-center text-xl font-semibold text-white">
                {activeStatus.text}
              </div>
            )}
          </div>
          {activeStatus.text && (
            <div className="px-4 pb-4 text-sm text-white/90">{activeStatus.text}</div>
          )}
          {activeStatus.ownerId === currentUser.id ? (
            <div className="border-t border-white/10 px-4 py-3 text-xs text-white/70">
              Seen by {activeStatus.seenCount || 0}
              {activeStatus.viewers?.length > 0 && (
                <div className="mt-2 max-h-40 overflow-y-auto rounded-xl border border-white/10 bg-white/5 p-2">
                  {activeStatus.viewers.map((viewer) => (
                    <div key={viewer.viewerId} className="py-1 text-xs text-white/80">
                      {contactNameById.get(viewer.viewerId) || viewer.viewerPhone} ·{" "}
                      {new Date(viewer.seenAt).toLocaleString()}
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="border-t border-white/10 px-4 py-3">
              {statusReplyError && (
                <p className="mb-2 text-xs text-rose-300">{statusReplyError}</p>
              )}
              <div className="flex items-center gap-2">
                <input
                  value={statusReply}
                  onChange={(e) => setStatusReply(e.target.value)}
                  placeholder="Reply to status..."
                  className="flex-1 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-xs text-white outline-none"
                />
                <button
                  type="button"
                  onClick={handleStatusReply}
                  className="rounded-full bg-[#25d366] px-4 py-2 text-xs font-semibold text-[#073e2a]"
                >
                  Send
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Chat;
