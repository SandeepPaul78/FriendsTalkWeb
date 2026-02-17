import { useRef, useState } from "react";

function Sidebar({
  currentUser,
  contacts,
  onlineUserIds,
  selectedContactId,
  onSelectContact,
  isChatOpen,
  activeTab,
  onTabChange,
  isCallLocked,
  unreadCounts,
  missedCallCounts,
  onAddContact,
  onDeleteContact,
  addingContact,
  addContactError,
  onLogout,
  themeMode,
  onThemeToggle,
  themeVariant,
  onThemeVariantChange,
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
      className={`ft-sidebar flex min-h-0 w-full flex-col md:w-96 ${
        isChatOpen ? "hidden md:flex" : "flex"
      }`}
    >
      <div className="ft-topbar px-4 py-3">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">FriendsTalk</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onThemeToggle}
              className="ft-btn-soft flex h-8 w-8 items-center justify-center rounded-full"
              aria-label="Toggle theme"
              title={themeMode === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            >
              {themeMode === "dark" ? (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M6.8 4.6 5.4 3.2 4 4.6 5.4 6l1.4-1.4zm10.4 0L18.6 6 20 4.6l-1.4-1.4-1.4 1.4zM12 5a1 1 0 0 0 1-1V2h-2v2a1 1 0 0 0 1 1zm7 8a1 1 0 0 0 1-1h2v-2h-2a1 1 0 0 0-1 1v2zM4 12a1 1 0 0 0-1-1H1v2h2a1 1 0 0 0 1-1zm1.4 6L4 19.4l1.4 1.4L6.8 19 5.4 18zm13.2 0-1.4 1.4 1.4 1.4 1.4-1.4-1.4-1.4zM12 19a1 1 0 0 0-1 1v2h2v-2a1 1 0 0 0-1-1zm0-11a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
                  <path d="M20.7 13.4A8.5 8.5 0 0 1 10.6 3.3a.7.7 0 0 0-.9-.8A10 10 0 1 0 21.5 14a.7.7 0 0 0-.8-.6z" />
                </svg>
              )}
            </button>
            <button
              type="button"
              onClick={() => setIsAddOpen(true)}
              className="ft-btn-soft h-8 rounded-full px-3 text-[11px] font-semibold"
            >
              New
            </button>
            <button
              type="button"
              onClick={onLogout}
              className="ft-btn-soft h-8 rounded-full px-3 text-[11px] font-semibold"
            >
              Logout
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] opacity-80">{currentUser.phoneNumber}</p>

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

        <div className="mt-3 hidden items-center gap-2 md:flex">
          {[
            { key: "chats", label: "Chats" },
            { key: "status", label: "Status" },
            { key: "calls", label: "Calls" },
          ].map((tab) => (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange?.(tab.key)}
              className={`rounded-full px-3 py-1 text-[11px] font-semibold transition ${
                activeTab === tab.key
                  ? "ft-btn-primary"
                  : "ft-btn-soft"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-2">
          {[
            { key: "neon", label: "Neon" },
            { key: "gold", label: "Gold" },
            { key: "corporate", label: "Corp" },
          ].map((variant) => (
            <button
              key={variant.key}
              type="button"
              onClick={() => onThemeVariantChange?.(variant.key)}
              className={`ft-variant-chip ${
                themeVariant === variant.key ? "ft-variant-chip-active" : ""
              }`}
            >
              {variant.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-2 py-3">
        {contacts.length === 0 && (
          <div className="rounded-xl border border-dashed border-[#33424a] px-3 py-6 text-center text-sm text-white/60">
            No contacts yet. Add contact by mobile number.
          </div>
        )}

        {activeTab === "chats" &&
          contacts.map((contact) => {
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
                  ? "ft-contact-row-active"
                  : "ft-contact-row"
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

      <div className="ft-divider px-4 py-2 text-[10px] uppercase tracking-[0.16em] opacity-60">
        Long press to delete
      </div>

      {isAddOpen && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 px-6">
          <div className="ft-modal w-full max-w-sm rounded-2xl p-5">
            <h3 className="font-display text-lg font-semibold">New contact</h3>
            <p className="mt-1 text-xs opacity-75">
              Add contact by phone number
            </p>

            <div className="mt-4 space-y-2">
              <input
                className="ft-input h-10 w-full rounded-lg px-3 text-xs outline-none placeholder:opacity-60"
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
                className="ft-input h-10 w-full rounded-lg px-3 text-xs outline-none placeholder:opacity-60"
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
                className="ft-btn-soft rounded-full px-4 py-2 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleAddContact}
                disabled={addingContact || !newContactPhone.trim()}
                className="ft-btn-primary rounded-full px-4 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-50"
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
