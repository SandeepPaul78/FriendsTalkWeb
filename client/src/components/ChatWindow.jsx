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
}) {
  const hasSelection = Boolean(selectedContact);

  return (
    <section className="flex h-full flex-1 flex-col bg-gradient-to-br from-white via-slate-50 to-blue-50/70">
      <header className="border-b border-slate-200/80 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                Conversation
              </p>
              <h3 className="font-display text-xl font-semibold text-slate-900">
                {selectedContact?.displayName || selectedContact?.phoneNumber || "Select a contact"}
              </h3>
              {selectedContact?.displayName && (
                <p className="text-xs text-slate-500">{selectedContact.phoneNumber}</p>
              )}
            </div>
            <div className="rounded-full bg-slate-900/90 px-3 py-1 text-[11px] font-semibold text-white">
              {currentUser.phoneNumber}
            </div>
          </div>

          <div>{callControls}</div>
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
          <div className="flex-1 overflow-y-auto px-4 py-4 sm:px-6">
            {messages.length === 0 && (
              <div className="rounded-xl border border-slate-200 bg-white/70 p-4 text-center text-sm text-slate-500">
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

          <div className="border-t border-slate-200/80 bg-white/85 px-4 py-3 sm:px-6">
            {typingContactLabel && (
              <p className="mb-2 text-xs text-slate-500">{typingContactLabel} is typing...</p>
            )}

            <div className="flex items-end gap-2">
              <textarea
                rows={1}
                disabled={!selectedContact}
                className="max-h-28 min-h-11 flex-1 resize-none rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 outline-none transition focus:border-sky-500 focus:ring-2 focus:ring-sky-200 disabled:cursor-not-allowed disabled:bg-slate-100"
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
                className="h-11 rounded-xl bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
              >
                Send
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

export default ChatWindow;
