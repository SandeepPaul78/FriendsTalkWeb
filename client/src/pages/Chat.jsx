import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import AudioCall from "../components/AudioCall";
import ChatWindow from "../components/ChatWindow";
import Sidebar from "../components/Sidebar";
import VideoCall from "../components/VideoCall";
import { apiRequest, uploadRequest } from "../services/api";
import { socket } from "../services/socket";

const formatClipTime = (seconds) => {
  const safe = Math.max(0, Number(seconds) || 0);
  const mins = Math.floor(safe / 60)
    .toString()
    .padStart(2, "0");
  const secs = Math.floor(safe % 60)
    .toString()
    .padStart(2, "0");
  return `${mins}:${secs}`;
};

const STATUS_VIDEO_CLIP_MAX_SEC = 15;

const isVideoFile = (file) => {
  if (!file) return false;
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("video/")) return true;

  const name = String(file.name || "").toLowerCase();
  return /\.(mp4|mov|m4v|webm|3gp|mkv|avi|mpg|mpeg|ts|mts|m2ts|ogv|ogg|wmv|flv|asf)$/i.test(name);
};

const isImageFile = (file) => {
  if (!file) return false;
  const mime = String(file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return true;

  const name = String(file.name || "").toLowerCase();
  return /\.(jpg|jpeg|png|gif|bmp|webp|avif|heic|heif|tif|tiff|jxl)$/i.test(name);
};

const createStatusVideoClip = async ({ file, startSec, durationSec, onProgress }) => {
  if (!file) {
    throw new Error("No file selected");
  }

  const canRecordInBrowser =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    typeof document !== "undefined";

  if (!canRecordInBrowser) {
    return {
      file,
      clipStartSec: startSec,
      clipDurationSec: durationSec,
      trimmed: false,
    };
  }

  return new Promise((resolve) => {
    const sourceUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = sourceUrl;

    let stream = null;
    let recorder = null;
    let timeoutId = null;
    let settled = false;
    const chunks = [];

    const finish = (payload) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(sourceUrl);
      resolve(payload);
    };

    const fallback = (clipStartOverride, clipDurationOverride) =>
      finish({
        file,
        clipStartSec: clipStartOverride,
        clipDurationSec: clipDurationOverride,
        trimmed: false,
      });

    video.onerror = () => fallback(startSec, durationSec);

    video.onloadedmetadata = () => {
      const totalDuration = Number(video.duration || 0);
      const safeStart = Math.max(0, Math.min(Number(startSec || 0), Math.max(0, totalDuration - 0.5)));
      const safeDuration =
        totalDuration > 0
          ? Math.max(0.5, Math.min(Number(durationSec || STATUS_VIDEO_CLIP_MAX_SEC), totalDuration - safeStart))
          : Math.max(0.5, Number(durationSec || STATUS_VIDEO_CLIP_MAX_SEC));
      const endSec = safeStart + safeDuration;

      const captureStream = video.captureStream || video.mozCaptureStream;
      if (!captureStream) {
        return fallback(safeStart, safeDuration);
      }

      try {
        stream = captureStream.call(video);
      } catch {
        return fallback(safeStart, safeDuration);
      }

      const supportedMimeTypes = [
        "video/webm;codecs=vp9,opus",
        "video/webm;codecs=vp8,opus",
        "video/webm",
      ];
      let selectedMimeType = "";
      if (typeof window.MediaRecorder.isTypeSupported === "function") {
        selectedMimeType = supportedMimeTypes.find((item) =>
          window.MediaRecorder.isTypeSupported(item)
        ) || "";
      }

      const recorderOptions = selectedMimeType
        ? { mimeType: selectedMimeType, videoBitsPerSecond: 1_600_000 }
        : { videoBitsPerSecond: 1_600_000 };

      try {
        recorder = new window.MediaRecorder(stream, recorderOptions);
      } catch {
        return fallback(safeStart, safeDuration);
      }

      recorder.ondataavailable = (event) => {
        if (event.data?.size) {
          chunks.push(event.data);
        }
      };

      recorder.onerror = () => fallback(safeStart, safeDuration);

      recorder.onstop = () => {
        if (!chunks.length) {
          return fallback(safeStart, safeDuration);
        }

        const outputType = selectedMimeType || "video/webm";
        const clippedBlob = new Blob(chunks, { type: outputType });
        if (!clippedBlob.size) {
          return fallback(safeStart, safeDuration);
        }

        const outputNameBase = String(file.name || "status-video").replace(/\.[^.]+$/, "");
        const clippedFile = new File([clippedBlob], `${outputNameBase}-clip.webm`, {
          type: outputType,
        });

        finish({
          file: clippedFile,
          clipStartSec: 0,
          clipDurationSec: Math.min(STATUS_VIDEO_CLIP_MAX_SEC, safeDuration),
          trimmed: true,
        });
      };

      const stopCapture = () => {
        if (recorder?.state && recorder.state !== "inactive") {
          recorder.stop();
        } else {
          fallback(safeStart, safeDuration);
        }
      };

      video.ontimeupdate = () => {
        const current = Number(video.currentTime || safeStart);
        if (typeof onProgress === "function" && safeDuration > 0) {
          const progress = Math.min(100, Math.max(0, ((current - safeStart) / safeDuration) * 100));
          onProgress(progress);
        }
        if (current >= endSec - 0.03) {
          stopCapture();
        }
      };

      video.onended = stopCapture;

      video.onseeked = () => {
        try {
          recorder.start(250);
        } catch {
          return fallback(safeStart, safeDuration);
        }

        video.play().catch(() => {
          stopCapture();
        });
      };

      timeoutId = setTimeout(() => {
        stopCapture();
      }, Math.max(1_500, safeDuration * 1_000 + 1_500));

      try {
        video.currentTime = safeStart;
      } catch {
        fallback(safeStart, safeDuration);
      }
    };
  });
};

function Chat({
  authToken,
  currentUser,
  onlineUserIds,
  onLogout,
  themeMode,
  onThemeToggle,
}) {
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
  const [statusUploadHint, setStatusUploadHint] = useState("");
  const [statusError, setStatusError] = useState("");
  const [activeStatus, setActiveStatus] = useState(null);
  const [statusReply, setStatusReply] = useState("");
  const [statusReplyError, setStatusReplyError] = useState("");
  const [statusMenuOpenId, setStatusMenuOpenId] = useState(null);
  const [statusDeletingId, setStatusDeletingId] = useState(null);
  const [statusVideoEditor, setStatusVideoEditor] = useState(null);
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
  const statusTrimVideoRef = useRef(null);

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

  useEffect(() => {
    return () => {
      if (statusVideoEditor?.previewUrl) {
        URL.revokeObjectURL(statusVideoEditor.previewUrl);
      }
    };
  }, [statusVideoEditor?.previewUrl]);

  const openStatusVideoEditor = useCallback((file) => {
    if (!file) return;
    setStatusError("");
    setStatusUploadHint("");
    setStatusVideoEditor({
      file,
      previewUrl: URL.createObjectURL(file),
      loadingMeta: true,
      durationSec: 0,
      startSec: 0,
      text: "",
    });
  }, []);

  const closeStatusVideoEditor = useCallback(() => {
    setStatusUploadHint("");
    setStatusVideoEditor(null);
  }, []);

  const handleStatusUpload = async (file, options = {}) => {
    if (!file) return;

    setStatusUploading(true);
    setStatusError("");
    try {
      const text =
        options.text !== undefined ? String(options.text || "") : window.prompt("Status text (optional)") || "";
      const fields = { text };
      if (typeof options.clipStartSec === "number") {
        fields.clipStartSec = String(options.clipStartSec);
      }
      if (typeof options.clipDurationSec === "number") {
        fields.clipDurationSec = String(options.clipDurationSec);
      }
      await uploadRequest("/status/upload", {
        token: authToken,
        file,
        fields,
      });
      await loadStatuses();
      setStatusUploadHint("");
      return true;
    } catch (error) {
      console.error("status upload failed", error);
      setStatusError(error.message || "Status upload failed");
      setStatusUploadHint("");
      return false;
    } finally {
      setStatusUploading(false);
    }
  };

  const handleStatusVideoTrimUpload = useCallback(async () => {
    if (!statusVideoEditor?.file) return;

    const durationSec = Number(statusVideoEditor.durationSec) || 0;
    const maxStartSec = Math.max(0, durationSec - STATUS_VIDEO_CLIP_MAX_SEC);
    const clipStartSec = Math.min(Math.max(Number(statusVideoEditor.startSec) || 0, 0), maxStartSec);
    const clipDurationSec = Math.min(
      STATUS_VIDEO_CLIP_MAX_SEC,
      Math.max(0.5, durationSec - clipStartSec || STATUS_VIDEO_CLIP_MAX_SEC)
    );

    setStatusError("");
    setStatusUploadHint(`Preparing ${STATUS_VIDEO_CLIP_MAX_SEC}s clip...`);
    const prepared = await createStatusVideoClip({
      file: statusVideoEditor.file,
      startSec: clipStartSec,
      durationSec: clipDurationSec,
      onProgress: (progress) => {
        setStatusUploadHint(`Preparing clip ${Math.round(progress)}%`);
      },
    });

    setStatusUploadHint(prepared.trimmed ? "Uploading trimmed clip..." : "Uploading status...");

    const success = await handleStatusUpload(prepared.file, {
      text: statusVideoEditor.text || "",
      clipStartSec: prepared.clipStartSec,
      clipDurationSec: prepared.clipDurationSec,
    });
    if (success) {
      closeStatusVideoEditor();
    } else {
      setStatusUploadHint("");
    }
  }, [closeStatusVideoEditor, handleStatusUpload, statusVideoEditor]);

  const handleTextStatus = async () => {
    const text = window.prompt("Write your status") || "";
    if (!text.trim()) return;
    setStatusUploading(true);
    setStatusUploadHint("Uploading status...");
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
      setStatusUploadHint("");
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
    <div className={`ft-theme ft-theme-${themeMode} ft-page-bg min-h-[100dvh] sm:px-5 sm:py-6`}>
      <div className="ft-shell mx-auto flex h-[100dvh] w-full max-w-6xl flex-col overflow-hidden sm:h-[calc(100dvh-3rem)] sm:rounded-2xl md:flex-row">
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
          themeMode={themeMode}
          onThemeToggle={onThemeToggle}
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
            <div className="ft-chat-surface flex min-h-0 flex-1 flex-col pb-16 md:pb-0">
              <div className="ft-topbar px-4 py-3 sm:px-6">
                <h3 className="font-display text-lg font-semibold">Status</h3>
                <p className="text-xs opacity-80">Share a photo or video update</p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-6">
                <div className="ft-card p-3">
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
                        className="ft-btn-soft rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-60"
                      >
                        Text
                      </button>
                      <button
                        type="button"
                        onClick={() => statusFileRef.current?.click()}
                        disabled={statusUploading}
                        className="ft-btn-primary rounded-full px-3 py-1 text-xs font-semibold disabled:opacity-60"
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
                {statusUploadHint && (
                  <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                    {statusUploadHint}
                  </div>
                )}

                <button
                  type="button"
                  onClick={loadStatuses}
                  className="ft-btn-soft self-start rounded-full px-3 py-1 text-[11px] font-semibold"
                >
                  Refresh
                </button>

                {statusLoading && (
                  <div className="text-sm text-white/60">Loading status...</div>
                )}

                {!statusLoading && statuses.length === 0 && (
                  <div className="ft-card px-4 py-6 text-center text-sm opacity-75">
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
                      className="ft-card flex w-full items-center justify-between gap-3 px-3 py-2"
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
                            className="ft-btn-soft flex h-8 w-8 items-center justify-center rounded-full"
                            aria-label="Status options"
                          >
                            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                              <path d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                            </svg>
                          </button>

                          {statusMenuOpenId === status.id && (
                            <div className="ft-popover absolute right-0 top-9 z-20 w-32 rounded-lg p-1 shadow-xl">
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
                accept="image/*,video/*,.heic,.heif,.ogv,.ogg,.webm,.mkv,.avi,.mov,.mp4,.m4v,.3gp,.wmv,.flv"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    if (isVideoFile(file)) {
                      openStatusVideoEditor(file);
                    } else if (isImageFile(file)) {
                      handleStatusUpload(file);
                    } else {
                      openStatusVideoEditor(file);
                    }
                  }
                  event.target.value = "";
                }}
              />
            </div>
          )}

          {activeTab === "calls" && (
            <div className="ft-chat-surface flex min-h-0 flex-1 flex-col pb-16 md:pb-0">
              <div className="ft-topbar px-4 py-3 sm:px-6">
                <h3 className="font-display text-lg font-semibold">Calls</h3>
                <p className="text-xs opacity-80">Audio & video call history</p>
              </div>
              <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={loadCallHistory}
                  className="ft-btn-soft self-start rounded-full px-3 py-1 text-[11px] font-semibold"
                >
                  Refresh
                </button>

                {callHistoryLoading && (
                  <div className="text-sm text-white/60">Loading calls...</div>
                )}

                {!callHistoryLoading && callHistory.length === 0 && (
                  <div className="ft-card px-4 py-6 text-center text-sm opacity-75">
                    No calls yet.
                  </div>
                )}

                <div className="grid gap-3">
                  {callHistory.map((call) => (
                    <div
                      key={call.id}
                      className="ft-card flex items-center justify-between gap-3 px-4 py-3"
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
                          className="ft-btn-soft rounded-full px-3 py-1 text-[11px] font-semibold"
                        >
                          Audio
                        </button>
                        <button
                          type="button"
                          onClick={() => triggerAutoCall(call.peerId, "video")}
                          className="ft-btn-soft rounded-full px-3 py-1 text-[11px] font-semibold"
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
        <div className="ft-mobile-tabs fixed bottom-0 left-0 right-0 z-40 md:hidden">
          <div className="mx-auto flex max-w-6xl items-center justify-around px-4 py-2 text-xs">
            {[
              { key: "chats", label: "Chats" },
              { key: "status", label: "Status" },
              { key: "calls", label: "Calls" },
            ].map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => handleTabChange(tab.key)}
                className={`rounded-full px-4 py-2 text-xs font-semibold transition ${
                  activeTab === tab.key
                    ? "ft-btn-primary"
                    : "ft-btn-soft"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {statusVideoEditor &&
        (() => {
          const durationSec = Number(statusVideoEditor.durationSec) || 0;
          const clipWindowSec = Math.min(
            STATUS_VIDEO_CLIP_MAX_SEC,
            durationSec || STATUS_VIDEO_CLIP_MAX_SEC
          );
          const maxStartSec = Math.max(0, durationSec - clipWindowSec);
          const startSec = Math.min(
            Math.max(Number(statusVideoEditor.startSec) || 0, 0),
            maxStartSec
          );
          const endSec = Math.min(durationSec, startSec + clipWindowSec);
          const startPercent = durationSec > 0 ? (startSec / durationSec) * 100 : 0;
          const widthPercent = durationSec > 0 ? (clipWindowSec / durationSec) * 100 : 100;

          return (
            <div className="fixed inset-0 z-50 flex items-end bg-black/70 p-0 sm:items-center sm:justify-center sm:p-6">
              <div className="w-full rounded-t-2xl border border-white/10 bg-[#111b21] p-4 text-white sm:max-w-xl sm:rounded-2xl">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-sm font-semibold">
                    Trim status video ({STATUS_VIDEO_CLIP_MAX_SEC}s)
                  </p>
                  <button
                    type="button"
                    onClick={closeStatusVideoEditor}
                    disabled={statusUploading}
                    className="rounded-full border border-white/20 px-3 py-1 text-xs font-semibold text-white/90 hover:bg-white/10 disabled:opacity-60"
                  >
                    Cancel
                  </button>
                </div>

                <video
                  ref={statusTrimVideoRef}
                  src={statusVideoEditor.previewUrl}
                  controls
                  className="mb-3 h-56 w-full rounded-xl bg-black object-contain"
                  onLoadedMetadata={(event) => {
                    const measuredDuration = Number(event.currentTarget.duration) || 0;
                    setStatusVideoEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            loadingMeta: false,
                            durationSec: measuredDuration,
                          }
                        : prev
                    );
                    const player = event.currentTarget;
                    if (player.currentTime < startSec || player.currentTime > endSec) {
                      player.currentTime = startSec;
                    }
                  }}
                  onError={() => {
                    setStatusVideoEditor((prev) =>
                      prev
                        ? {
                            ...prev,
                            loadingMeta: false,
                          }
                        : prev
                    );
                  }}
                  onTimeUpdate={(event) => {
                    const player = event.currentTarget;
                    if (endSec > startSec && player.currentTime >= endSec) {
                      player.currentTime = startSec;
                      if (!player.paused) {
                        player.play().catch(() => {});
                      }
                    }
                  }}
                />

                <div className="mb-2 text-xs text-white/80">
                  Clip: {formatClipTime(startSec)} - {formatClipTime(endSec)} ({Math.round(clipWindowSec)}s)
                </div>
                <div className="mb-2 relative h-2 w-full rounded-full bg-white/20">
                  <div
                    className="absolute inset-y-0 rounded-full bg-[#25d366]"
                    style={{
                      left: `${startPercent}%`,
                      width: `${Math.max(3, Math.min(100 - startPercent, widthPercent))}%`,
                    }}
                  />
                </div>
                <input
                  type="range"
                  min={0}
                  max={maxStartSec}
                  step={0.1}
                  value={startSec}
                  onChange={(event) => {
                    const nextStart = Number(event.target.value) || 0;
                    setStatusVideoEditor((prev) => (prev ? { ...prev, startSec: nextStart } : prev));
                    if (statusTrimVideoRef.current) {
                      statusTrimVideoRef.current.currentTime = nextStart;
                    }
                  }}
                  className="mb-3 w-full accent-[#25d366]"
                  disabled={statusUploading || maxStartSec <= 0}
                />

                <input
                  value={statusVideoEditor.text}
                  onChange={(event) =>
                    setStatusVideoEditor((prev) =>
                      prev ? { ...prev, text: event.target.value.slice(0, 240) } : prev
                    )
                  }
                  placeholder="Status text (optional)"
                  className="mb-3 w-full rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white outline-none"
                  disabled={statusUploading}
                />

                <button
                  type="button"
                  onClick={handleStatusVideoTrimUpload}
                  disabled={statusUploading}
                  className="w-full rounded-xl bg-[#25d366] px-4 py-2 text-sm font-semibold text-[#073e2a] disabled:opacity-60"
                >
                  {statusUploading
                    ? "Uploading..."
                    : `Upload ${STATUS_VIDEO_CLIP_MAX_SEC}s status`}
                </button>
              </div>
            </div>
          );
        })()}

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
