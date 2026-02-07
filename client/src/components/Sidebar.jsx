import { useState } from "react";

function Sidebar({
  currentUser,
  contacts,
  onlineUserIds,
  selectedContactId,
  onSelectContact,
  isCallLocked,
  unreadCounts,
  missedCallCounts,
  onAddContact,
  addingContact,
  addContactError,
  onLogout,
}) {
  const [newContactPhone, setNewContactPhone] = useState("");
  const [newContactName, setNewContactName] = useState("");

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
    }
  };

  return (
    <aside className="flex h-full w-full flex-col border-b border-slate-200/70 bg-white/65 backdrop-blur-lg md:w-96 md:border-b-0 md:border-r">
      <div className="border-b border-slate-200/70 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Logged in as
        </p>
        <h2 className="mt-1 font-display text-lg font-semibold text-slate-900">
          {currentUser.phoneNumber}
        </h2>

        <div className="mt-3 space-y-2">
          <input
            className="h-10 w-full rounded-lg border border-slate-300 px-3 text-xs text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
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

          <div className="flex gap-2">
            <input
              className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-xs text-slate-700 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
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
            <button
              onClick={handleAddContact}
              disabled={addingContact || !newContactPhone.trim()}
              className="rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {addingContact ? "..." : "Save"}
            </button>
          </div>
        </div>

        {addContactError && (
          <p className="mt-2 text-xs text-rose-600">{addContactError}</p>
        )}

        {(totalUnread > 0 || totalMissed > 0) && (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] font-semibold">
            {totalUnread > 0 && (
              <span className="rounded-full bg-sky-100 px-2 py-1 text-sky-700">
                {totalUnread} unread
              </span>
            )}
            {totalMissed > 0 && (
              <span className="rounded-full bg-rose-100 px-2 py-1 text-rose-700">
                {totalMissed} missed calls
              </span>
            )}
          </div>
        )}

        {isCallLocked && (
          <p className="mt-2 rounded-lg bg-amber-100 px-2 py-1 text-xs font-medium text-amber-900">
            Contact switch disabled while call is active
          </p>
        )}
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
        {contacts.length === 0 && (
          <div className="rounded-xl border border-dashed border-slate-300/70 px-3 py-6 text-center text-sm text-slate-500">
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
              onClick={() => onSelectContact(contact.id)}
              className={`w-full rounded-xl px-3 py-2 text-left transition ${
                isSelected
                  ? "bg-slate-900 text-white shadow-sm"
                  : "bg-white/80 text-slate-700 hover:bg-slate-100"
              } ${isDisabled ? "cursor-not-allowed opacity-55" : ""}`}
            >
              <span className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span
                    className={`h-2.5 w-2.5 rounded-full ${
                      isOnline ? "bg-emerald-500" : "bg-slate-300"
                    }`}
                  />
                  <span className="flex flex-col">
                    <span className="text-sm font-semibold">
                      {contact.displayName || contact.phoneNumber}
                    </span>
                    <span
                      className={`text-[11px] ${
                        isSelected ? "text-white/70" : "text-slate-500"
                      }`}
                    >
                      {contact.phoneNumber}
                    </span>
                  </span>
                </span>

                <span className="flex items-center gap-1">
                  {!contact.isSaved && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-slate-200 text-slate-600"
                      }`}
                    >
                      Unsaved
                    </span>
                  )}

                  {missedCount > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isSelected
                          ? "bg-rose-200 text-rose-900"
                          : "bg-rose-100 text-rose-700"
                      }`}
                    >
                      Missed {missedCount}
                    </span>
                  )}

                  {unreadCount > 0 && (
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        isSelected
                          ? "bg-white/20 text-white"
                          : "bg-sky-100 text-sky-700"
                      }`}
                    >
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  )}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="border-t border-slate-200/70 p-3">
        <button
          type="button"
          onClick={onLogout}
          className="h-10 w-full rounded-xl border border-slate-300 bg-white text-sm font-semibold text-slate-700 transition hover:bg-slate-100"
        >
          Logout
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
