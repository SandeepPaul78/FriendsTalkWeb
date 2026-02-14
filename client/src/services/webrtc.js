const parseIceServersFromJson = () => {
  const raw = import.meta.env.VITE_ICE_SERVERS_JSON;
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((server) => server && server.urls);
  } catch {
    return null;
  }
};

const buildIceServersFromEnv = () => {
  const servers = [
    {
      urls: [
        "stun:stun.l.google.com:19302",
        "stun:stun1.l.google.com:19302",
        "stun:stun2.l.google.com:19302",
      ],
    },
  ];

  const turnRaw = import.meta.env.VITE_TURN_URLS || import.meta.env.VITE_TURN_URL || "";
  const turnUrls = String(turnRaw)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const turnUsername = import.meta.env.VITE_TURN_USERNAME || "";
  const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL || "";

  if (turnUrls.length && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrls,
      username: turnUsername,
      credential: turnCredential,
    });
  }

  return servers;
};

export const ICE_SERVERS = parseIceServersFromJson() || buildIceServersFromEnv();

