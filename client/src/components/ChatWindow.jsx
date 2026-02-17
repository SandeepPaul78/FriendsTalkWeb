import { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";
import { uploadRequest } from "../services/api";

function ChatWindow({
  authToken,
  currentUser,
  selectedContact,
  messages,
  typingContactLabel,
  draftMessage,
  onDraftChange,
  onSendMessage,
  onAddMessage,
  onSaveContact,
  callControls,
  onBack,
}) {
  const hasSelection = Boolean(selectedContact);
  const [wallpaper, setWallpaper] = useState(null);
  const [showEmoji, setShowEmoji] = useState(false);
  const [showAttach, setShowAttach] = useState(false);
  const [showCamera, setShowCamera] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [saveContactError, setSaveContactError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const imageInputRef = useRef(null);
  const docInputRef = useRef(null);
  const audioInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const cameraVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const cameraCanvasRef = useRef(null);

  const EMOJIS = ["😀", "😂", "😍", "😎", "😭", "👍", "🙏", "❤️", "🔥", "🎉"];

  useEffect(() => {
    if (!selectedContact?.id) {
      setWallpaper(null);
      return;
    }
    const stored = localStorage.getItem(`ft_wallpaper_${selectedContact.id}`);
    setWallpaper(stored || null);
  }, [selectedContact?.id]);

  const handleWallpaperPick = (event) => {
    const file = event.target.files?.[0];
    if (!file || !selectedContact?.id) return;

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result?.toString() || "";
      if (!dataUrl) return;
      localStorage.setItem(`ft_wallpaper_${selectedContact.id}`, dataUrl);
      setWallpaper(dataUrl);
    };
    reader.readAsDataURL(file);
    event.target.value = "";
  };

  const handleUpload = async (file) => {
    if (!file || !selectedContact?.id) return;
    setUploadError("");
    setIsUploading(true);

    try {
      const response = await uploadRequest(`/messages/${selectedContact.id}/upload`, {
        token: authToken,
        file,
      });
      if (response?.message) {
        onAddMessage?.(response.message);
      }
    } catch (error) {
      setUploadError(error.message || "Upload failed");
    } finally {
      setIsUploading(false);
      setShowAttach(false);
    }
  };

  const handleEmojiPick = (emoji) => {
    onDraftChange(`${draftMessage}${emoji}`);
  };

  const stopCameraStream = () => {
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((track) => track.stop());
      cameraStreamRef.current = null;
    }
  };

  const openCamera = async () => {
    setCameraError("");
    setShowCamera(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      cameraStreamRef.current = stream;
      if (cameraVideoRef.current) {
        cameraVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error("Camera open failed:", error);
      setCameraError("Camera access denied");
    }
  };

  const closeCamera = () => {
    stopCameraStream();
    setShowCamera(false);
  };

  const capturePhoto = async () => {
    if (!cameraVideoRef.current || !cameraCanvasRef.current) return;

    const video = cameraVideoRef.current;
    const canvas = cameraCanvasRef.current;
    canvas.width = video.videoWidth || 720;
    canvas.height = video.videoHeight || 1280;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.9)
    );
    if (!blob) return;

    const file = new File([blob], `camera_${Date.now()}.jpg`, {
      type: "image/jpeg",
    });

    await handleUpload(file);
    closeCamera();
  };

  useEffect(() => {
    return () => stopCameraStream();
  }, []);

  const clearWallpaper = () => {
    if (!selectedContact?.id) return;
    localStorage.removeItem(`ft_wallpaper_${selectedContact.id}`);
    setWallpaper(null);
  };

  const handleSaveContact = async () => {
    if (!selectedContact?.phoneNumber || !onSaveContact) return;
    setSaveContactError("");
    const name = window.prompt("Contact name (optional)") || "";
    const ok = await onSaveContact({
      phoneNumber: selectedContact.phoneNumber,
      name,
    });
    if (!ok) {
      setSaveContactError("Failed to save contact");
    }
  };

  return (
    <section className="ft-chat-window flex min-h-0 flex-1 flex-col overflow-x-hidden pb-16 md:pb-0">
      <header className="ft-topbar px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="ft-btn-soft flex h-8 w-8 items-center justify-center rounded-full md:hidden"
              aria-label="Back"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                <path d="M15.5 5.5 9 12l6.5 6.5-1.4 1.4L6.2 12l7.9-7.9z" />
              </svg>
            </button>
            <div className="min-w-0">
              <h3 className="truncate font-display text-lg font-semibold">
                {selectedContact?.displayName || selectedContact?.phoneNumber || "Select a contact"}
              </h3>
              {selectedContact?.displayName && (
                <p className="text-xs opacity-80">{selectedContact.phoneNumber}</p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {callControls}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowMenu((prev) => !prev)}
                className="ft-btn-soft flex h-8 w-8 items-center justify-center rounded-full"
                aria-label="Menu"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4zm0 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z" />
                </svg>
              </button>

              {showMenu && (
                <div className="ft-popover absolute right-0 top-10 z-20 w-44 rounded-xl p-1 text-xs shadow-xl">
                  {selectedContact && (
                    <button
                      type="button"
                      onClick={() => {
                        setShowProfile(true);
                        setShowMenu(false);
                      }}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
                    >
                      View profile
                    </button>
                  )}
                  {selectedContact && !selectedContact.isSaved && (
                    <button
                      type="button"
                      onClick={() => {
                        handleSaveContact();
                        setShowMenu(false);
                      }}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
                    >
                      Add contact
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      fileInputRef.current?.click();
                      setShowMenu(false);
                    }}
                    className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
                  >
                    Wallpaper
                  </button>
                  {wallpaper && (
                    <button
                      type="button"
                      onClick={() => {
                        clearWallpaper();
                        setShowMenu(false);
                      }}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-white/10"
                    >
                      Clear wallpaper
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {!hasSelection ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="max-w-sm rounded-2xl border border-dashed border-slate-300 bg-white/70 px-6 py-8 text-center">
            <h4 className="font-display text-lg font-semibold text-slate-900">
              Add and select a contact
            </h4>
            <p className="mt-2 text-sm text-slate-600">
              Use mobile number with country code and start chat/audio/video calls.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div
            className="chat-wallpaper flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden px-4 py-4 sm:px-6"
            style={wallpaper ? { backgroundImage: `url(${wallpaper})` } : undefined}
          >
            {messages.length === 0 && (
            <div className="ft-card p-4 text-center text-sm">
              No messages yet. Say hello to{" "}
              {selectedContact.displayName || selectedContact.phoneNumber}.
            </div>
            )}

            {messages.map((msg, idx) => (
              <MessageBubble
                key={`${msg.from}-${msg.timestamp || idx}-${idx}`}
                message={msg}
                isOwn={msg.from === currentUser.id}
              />
            ))}
          </div>

          <div className="ft-input-wrap px-4 py-3 sm:px-6">
            {typingContactLabel && (
              <p className="mb-2 text-xs text-slate-600">{typingContactLabel} is typing...</p>
            )}

            {uploadError && (
              <p className="mb-2 text-xs text-rose-600">{uploadError}</p>
            )}

            {saveContactError && (
              <p className="mb-2 text-xs text-rose-600">{saveContactError}</p>
            )}

            <div className="flex flex-wrap items-end gap-2">
              <div className="relative flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowEmoji((prev) => !prev);
                    setShowAttach(false);
                  }}
                  disabled={!selectedContact}
                  className="ft-circle-btn h-11 w-11 rounded-full text-sm font-semibold"
                >
                  🙂
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setShowAttach((prev) => !prev);
                    setShowEmoji(false);
                  }}
                  disabled={!selectedContact}
                  className="ft-circle-btn h-11 w-11 rounded-full text-sm font-semibold"
                >
                  +
                </button>

                {showEmoji && (
                  <div className="ft-popover absolute bottom-14 left-0 z-20 w-52 rounded-2xl p-2 shadow-lg">
                    <div className="grid grid-cols-5 gap-1">
                      {EMOJIS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => handleEmojiPick(emoji)}
                          className="h-9 w-9 rounded-lg text-lg hover:bg-white/15"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {showAttach && (
                  <div className="ft-popover absolute bottom-14 left-0 z-20 w-56 rounded-2xl p-2 text-sm shadow-lg">
                    <button
                      type="button"
                      onClick={() => imageInputRef.current?.click()}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
                    >
                      Photo / Video
                    </button>
                    <button
                      type="button"
                      onClick={() => docInputRef.current?.click()}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
                    >
                      Document (PDF)
                    </button>
                    <button
                      type="button"
                      onClick={() => audioInputRef.current?.click()}
                      className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-100"
                    >
                      Audio
                    </button>
                  </div>
                )}
              </div>

              <textarea
                rows={1}
                disabled={!selectedContact}
                className="ft-input max-h-28 min-h-11 min-w-0 flex-1 resize-none rounded-2xl px-3 py-2 text-sm outline-none transition disabled:cursor-not-allowed disabled:opacity-70"
                placeholder={selectedContact ? "Type a message..." : "Select a contact first"}
                value={draftMessage}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSendMessage();
                  }
                }}
              />
              <button
                type="button"
                onClick={openCamera}
                disabled={!selectedContact}
                className="ft-circle-btn h-11 w-11 rounded-full text-sm font-semibold"
              >
                📷
              </button>
              <button
                type="button"
                disabled={!selectedContact || !draftMessage.trim()}
                onClick={onSendMessage}
                className="ft-btn-primary h-11 rounded-2xl px-4 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-45"
              >
                Send
              </button>
            </div>
            {isUploading && (
              <p className="mt-2 text-xs text-slate-500">Uploading...</p>
            )}
          </div>
        </>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={handleWallpaperPick}
      />

      <input
        ref={imageInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleUpload(file);
          event.target.value = "";
        }}
      />
      <input
        ref={docInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleUpload(file);
          event.target.value = "";
        }}
      />
      <input
        ref={audioInputRef}
        type="file"
        accept="audio/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleUpload(file);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleUpload(file);
          event.target.value = "";
        }}
      />

      {showCamera && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="relative flex-1">
            <video
              ref={cameraVideoRef}
              autoPlay
              playsInline
              className="h-full w-full object-cover"
            />
            <canvas ref={cameraCanvasRef} className="hidden" />

            <div className="absolute left-4 top-4 rounded-full bg-black/50 px-3 py-1 text-xs text-white">
              Camera
            </div>
          </div>

          {cameraError && (
            <div className="bg-rose-600 px-4 py-2 text-center text-sm text-white">
              {cameraError}
            </div>
          )}

          <div className="flex items-center justify-between bg-black px-6 py-4">
            <button
              type="button"
              onClick={closeCamera}
              className="rounded-full border border-white/40 px-4 py-2 text-sm font-semibold text-white"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={capturePhoto}
              className="h-14 w-14 rounded-full border-4 border-white bg-white/10"
            />
            
            <div className="w-20" />
          </div>
        </div>
      )}

      {showProfile && selectedContact && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-6">
          <div className="ft-modal w-full max-w-sm rounded-2xl p-5">
            <h3 className="font-display text-lg font-semibold">Contact info</h3>
            <p className="mt-2 text-sm">
              {selectedContact.displayName || "Unknown"}
            </p>
            <p className="text-xs opacity-75">{selectedContact.phoneNumber}</p>
            {!selectedContact.isSaved && (
              <p className="mt-2 text-xs text-amber-300">Unsaved contact</p>
            )}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowProfile(false)}
                className="ft-btn-soft rounded-full px-4 py-2 text-xs font-semibold"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default ChatWindow;
