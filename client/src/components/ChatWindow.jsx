import { useEffect, useRef, useState } from "react";
import MessageBubble from "./MessageBubble";

function ChatWindow({
  currentUser,
  selectedContact,
  messages,
  typingContactLabel,
  draftMessage,
  onDraftChange,
  onSendMessage,
  callControls,
  onBack,
}) {
  const hasSelection = Boolean(selectedContact);
  const [wallpaper, setWallpaper] = useState(null);
  const fileInputRef = useRef(null);

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

  const clearWallpaper = () => {
    if (!selectedContact?.id) return;
    localStorage.removeItem(`ft_wallpaper_${selectedContact.id}`);
    setWallpaper(null);
  };

  return (
    <section className="flex min-h-0 flex-1 flex-col bg-[#0b141a]">
      <header className="border-b border-[#1f2c34] bg-[#005c4b] px-4 py-3 sm:px-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={onBack}
              className="rounded-full border border-white/30 px-3 py-1 text-[11px] font-semibold text-white/90 hover:bg-white/10 md:hidden"
            >
              Back
            </button>
            <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/60">
              Conversation
            </p>
            <h3 className="truncate font-display text-lg font-semibold text-white">
              {selectedContact?.displayName || selectedContact?.phoneNumber || "Select a contact"}
            </h3>
            {selectedContact?.displayName && (
              <p className="text-xs text-white/70">{selectedContact.phoneNumber}</p>
            )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {callControls}

            {selectedContact && (
              <>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-full border border-white/30 px-3 py-1 text-[11px] font-semibold text-white/90 transition hover:bg-white/10"
                >
                  Wallpaper
                </button>
                {wallpaper && (
                  <button
                    type="button"
                    onClick={clearWallpaper}
                    className="rounded-full border border-white/30 px-3 py-1 text-[11px] font-semibold text-white/80 transition hover:bg-white/10"
                  >
                    Clear
                  </button>
                )}
              </>
            )}
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
            className="chat-wallpaper flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-4 py-4 sm:px-6"
            style={wallpaper ? { backgroundImage: `url(${wallpaper})` } : undefined}
          >
            {messages.length === 0 && (
              <div className="rounded-xl border border-white/50 bg-white/75 p-4 text-center text-sm text-slate-600">
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

          <div className="border-t border-[#1f2c34] bg-[#f0f2f5] px-4 py-3 sm:px-6">
            {typingContactLabel && (
              <p className="mb-2 text-xs text-slate-600">{typingContactLabel} is typing...</p>
            )}

            <div className="flex items-end gap-2">
              <textarea
                rows={1}
                disabled={!selectedContact}
                className="max-h-28 min-h-11 flex-1 resize-none rounded-2xl border border-[#cfd4d7] bg-white px-3 py-2 text-sm text-slate-900 outline-none transition focus:border-[#25d366] disabled:cursor-not-allowed disabled:bg-slate-200"
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
                disabled={!selectedContact || !draftMessage.trim()}
                onClick={onSendMessage}
                className="h-11 rounded-2xl bg-[#25d366] px-4 text-sm font-semibold text-[#073e2a] transition hover:bg-[#1fc15c] disabled:cursor-not-allowed disabled:opacity-45"
              >
                Send
              </button>
            </div>
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
    </section>
  );
}

export default ChatWindow;
