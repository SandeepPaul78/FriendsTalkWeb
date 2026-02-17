const formatTime = (timestamp) => {
  if (!timestamp) return "";

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

const formatBytes = (bytes) => {
  if (!bytes || Number.isNaN(bytes)) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
};

function MessageBubble({ message, isOwn }) {
  const type = message.type || "text";
  const hasMedia = Boolean(message.mediaUrl);

  return (
    <div className={`mb-2 flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`ft-message-bubble max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[72%] ${
          isOwn
            ? "ft-message-own rounded-br-md"
            : "ft-message-peer rounded-bl-md"
        }`}
      >
        {message.statusId && (
          <div className="mb-2 rounded-xl border border-white/20 bg-white/10 p-2 text-[11px] opacity-85">
            <p className="font-semibold">Status reply</p>
            {message.statusMediaType === "image" && message.statusMediaUrl && (
              <img
                src={message.statusMediaUrl}
                alt="Status"
                className="mt-2 max-h-24 w-full rounded-lg object-cover"
              />
            )}
            {message.statusMediaType === "video" && (
              <div className="mt-2 rounded-lg bg-black/70 px-2 py-3 text-center text-white">
                Video
              </div>
            )}
            {message.statusMediaType === "text" && message.statusText && (
              <div className="mt-2 rounded-lg bg-white/20 px-2 py-2 text-xs">
                {message.statusText}
              </div>
            )}
          </div>
        )}

        {type === "text" && (
          <p className="text-[13px] leading-relaxed">{message.message}</p>
        )}

        {type === "image" && hasMedia && (
          <img
            src={message.mediaUrl}
            alt={message.mediaName || "Image"}
            className="mt-1 max-h-64 w-full rounded-xl object-cover"
          />
        )}

        {type === "video" && hasMedia && (
          <video
            src={message.mediaUrl}
            controls
            className="mt-1 max-h-64 w-full rounded-xl bg-black object-cover"
          />
        )}

        {type === "audio" && hasMedia && (
          <audio src={message.mediaUrl} controls className="mt-2 w-full" />
        )}

        {type === "file" && hasMedia && (
          <a
            href={message.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-1 block rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-xs font-semibold hover:bg-white/20"
          >
            {message.mediaName || "Document"}
            {message.mediaSize ? ` · ${formatBytes(message.mediaSize)}` : ""}
          </a>
        )}

        {message.message && type !== "text" && (
          <p className="mt-2 text-[13px] leading-relaxed">{message.message}</p>
        )}
        <div
          className={`mt-1 flex items-center gap-1 text-[10px] ${
            isOwn ? "text-[#4f6f5d]" : "text-slate-500"
          }`}
        >
          <span>{formatTime(message.timestamp)}</span>
          {isOwn && message.status && (
            <span
              className={`text-[11px] ${
                message.status === "read" ? "text-sky-500" : ""
              }`}
              aria-label={message.status}
            >
              {message.status === "sent" && "✓"}
              {(message.status === "delivered" || message.status === "read") && "✓✓"}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

export default MessageBubble;
