const formatTime = (timestamp) => {
  if (!timestamp) return "";

  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
};

function MessageBubble({ message, isOwn }) {
  return (
    <div className={`mb-2 flex ${isOwn ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[72%] ${
          isOwn
            ? "rounded-br-md bg-[#d9fdd3] text-[#1f2c34]"
            : "rounded-bl-md bg-white text-[#111b21]"
        }`}
      >
        <p className="text-[13px] leading-relaxed">{message.message}</p>
        <p
          className={`mt-1 text-[10px] ${
            isOwn ? "text-[#4f6f5d]" : "text-slate-500"
          }`}
        >
          {formatTime(message.timestamp)}
        </p>
      </div>
    </div>
  );
}

export default MessageBubble;
