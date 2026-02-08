import { useRef, useState } from "react";

function Sidebar({
  currentUser,
  contacts,
  onlineUserIds,
  selectedContactId,
  onSelectContact,
  isChatOpen,
  isCallLocked,
  unreadCounts,
  missedCallCounts,
  onAddContact,
  onDeleteContact,
  addingContact,
  addContactError,
  onLogout,
}) {
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactName, setNewContactName] = useState("");
  const [isAddOpen, setIsAddOpen] = useState(false);
  const longPressTimerRef = useRef(null);
  const longPressTriggeredRef = useRef(false);

  const totalUnread = Object.values(unreadCounts || {}).reduce(
    (sum, count) => sum + count,
    0
  );
  const totalMissed = Object.values(missedCallCounts || {}).reduce(
    (sum, count) => sum + count,
    0
  );

  const handleAddContact = async () => {
    const trimmedPhone = newContactPhone.trim();
    const trimmedName = newContactName.trim();
    if (!trimmedPhone) return;

    const isAdded = await onAddContact({
      phoneNumber: trimmedPhone,
      name: trimmedName,
    });
    if (isAdded) {
      setNewContactPhone("");
      setNewContactName("");
      setIsAddOpen(false);
    }
  };

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const confirmDelete = (contact) => {
    if (!onDeleteContact) return;
    if (isCallLocked) return;
    const label = contact.displayName || contact.phoneNumber;
    const confirmed = window.confirm(`Delete ${label} and clear chat?`);
    if (confirmed) {
      onDeleteContact(contact.id);
    }
  };

  return (
    <aside
      className={`flex min-h-0 w-full flex-col border-b border-[#1f2c34] bg-[#111b21] md:w-96 md:border-b-0 md:border-r ${
        isChatOpen ? "hidden md:flex" : "flex"
      }`}
    >
      <div className="bg-[#005c4b] px-4 py-3 text-white">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">FriendsTalk</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="h-8 rounded-full bg-white/15 px-3 text-[11px] font-semibold text-white hover:bg-white/20"
            >
              New
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="h-8 rounded-full border border-white/30 px-3 text-[11px] font-semibold text-white/90 hover:bg-white/10"
            >
              Logout
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-white/70">{currentUser.phoneNumber}</p>

        {(totalUnread > 0 || totalMissed > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            {totalUnread > 0 && (
              <span className="rounded-full bg-[#25d366]/15 px-2 py-1 text-[#25d366]">
                {totalUnread} unread
              </span>
            )}
            {totalMissed > 0 && (
              <span className="rounded-full bg-rose-500/15 px-2 py-1 text-rose-300">
                {totalMissed} missed calls
              </span>
            )}
          </div>
        )}

        {isCallLocked && (
          <p className="mt-2 rounded-lg bg-amber-500/15 px-2 py-1 text-xs font-medium text-amber-200">
            Contact switch disabled while call is active
          </p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
        {contacts.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#33424a] px-3 py-6 text-center text-sm text-white/60">
            No contacts yet. Add contact by mobile number.
          </div>
        )}

        {contacts.map((contact) => {
          const isSelected = selectedContactId === contact.id;
          const isDisabled = Boolean(isCallLocked && !isSelected);
          const unreadCount = unreadCounts?.[contact.id] || 0;
          const missedCount = missedCallCounts?.[contact.id] || 0;
          const isOnline = onlineUserIds.includes(contact.id);

          return (
            <button
              key={contact.id}
              type="button"
              disabled={isDisabled}
              onClick={() => {
                if (longPressTriggeredRef.current) {
                  longPressTriggeredRef.current = false;
                  return;
                }
                onSelectContact(contact.id);
              }}
              onMouseDown={() => {
                if (isDisabled) return;
                longPressTriggeredRef.current = false;
                clearLongPress();
                longPressTimerRef.current = setTimeout(() => {
                  longPressTriggeredRef.current = true;
                  confirmDelete(contact);
                }, 650);
              }}
              onMouseUp={clearLongPress}
              onMouseLeave={clearLongPress}
              onTouchStart={() => {
                if (isDisabled) return;
                longPressTriggeredRef.current = false;
                clearLongPress();
                longPressTimerRef.current = setTimeout(() => {
                  longPressTriggeredRef.current = true;
                  confirmDelete(contact);
                }, 650);
              }}
              onTouchEnd={clearLongPress}
              onTouchMove={clearLongPress}
              onContextMenu={(event) => {
                event.preventDefault();
                confirmDelete(contact);
              }}
              className={`w-full rounded-xl px-3 py-2 text-left transition ${
                isSelected
                  ? "bg-[#202c33] text-white"
                  : "bg-[#111b21] text-white/80 hover:bg-[#1f2c34]"
              } ${isDisabled ? "cursor-not-allowed opacity-50" : ""}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-3">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isOnline ? "bg-[#25d366]" : "bg-white/30"
                    }`}
                  />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold">
                      {contact.displayName || contact.phoneNumber}
                    </span>
                    <span className="truncate text-[11px] text-white/60">
                      {contact.phoneNumber}
                    </span>
                  </span>
                </span>

                <span className="flex items-center gap-1">
                  {!contact.isSaved && (
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-bold text-white/70">
                      Unsaved
                    </span>
                  )}

                  {missedCount > 0 && (
                    <span className="rounded-full bg-rose-500/20 px-2 py-0.5 text-[10px] font-bold text-rose-200">
                      Missed {missedCount}
                    </span>
                  )}

                  {unreadCount > 0 && (
                    <span className="rounded-full bg-[#25d366] px-2 py-0.5 text-[10px] font-bold text-[#073e2a]">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-[#1f2c34] px-4 py-2 text-[10px] uppercase tracking-[0.16em] text-white/40">
        Long press to delete
      </div>

      {isAddOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6">
          <div className="w-full max-w-sm rounded-2xl border border-[#1f2c34] bg-[#111b21] p-5 text-white">
            <h3 className="font-display text-lg font-semibold">New contact</h3>
            <p className="mt-1 text-xs text-white/60">
              Add contact by phone number
            </p>

            <div className="mt-4 space-y-2">
              <input
                className="h-10 w-full rounded-lg border border-[#33424a] bg-[#0b141a] px-3 text-xs text-white outline-none placeholder:text-white/50 focus:border-[#25d366]"
                placeholder="Contact name (optional)"
                value={newContactName}
                onChange={(event) => setNewContactName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleAddContact();
                  }
                }}
                disabled={addingContact}
              />

              <input
                className="h-10 w-full rounded-lg border border-[#33424a] bg-[#0b141a] px-3 text-xs text-white outline-none placeholder:text-white/50 focus:border-[#25d366]"
                placeholder="Add contact: +91xxxxxxxxxx"
                value={newContactPhone}
                onChange={(event) => setNewContactPhone(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    handleAddContact();
                  }
                }}
                disabled={addingContact}
              />
            </div>

            {addContactError && (
              <p className="mt-2 text-xs text-rose-300">{addContactError}</p>
            )}

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsAddOpen(false)}
                className="rounded-full border border-white/30 px-4 py-2 text-xs font-semibold text-white/90 hover:bg-white/10"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddContact}
                disabled={addingContact || !newContactPhone.trim()}
                className="rounded-full bg-[#25d366] px-4 py-2 text-xs font-semibold text-[#073e2a] hover:bg-[#1fc15c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {addingContact ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}

export default Sidebar;
