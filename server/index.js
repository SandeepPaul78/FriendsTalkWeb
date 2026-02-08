require("dotenv").config();

const crypto = require("crypto");
const cors = require("cors");
const { v2: cloudinary } = require("cloudinary");
const express = require("express");
const http = require("http");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const multer = require("multer");
const { Readable } = require("stream");
const { Server } = require("socket.io");

const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET = process.env.JWT_SECRET || "sandycall123";
const OTP_HASH_SECRET = process.env.OTP_HASH_SECRET || JWT_SECRET;
const OTP_TTL_MS = Number(process.env.OTP_TTL_MS || 5 * 60 * 1000);
const OTP_PROVIDER = process.env.OTP_PROVIDER || "test";
const OTP_DEBUG = process.env.OTP_DEBUG !== "false";
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const OTP_FROM_EMAIL = process.env.OTP_FROM_EMAIL || "";
const OTP_FROM_NAME = process.env.OTP_FROM_NAME || "FriendsTalk";
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 15);

if (process.env.CLOUDINARY_URL) {
  cloudinary.config({ cloudinary_url: process.env.CLOUDINARY_URL });
} else if (process.env.CLOUDINARY_CLOUD_NAME) {
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
}

const normalizeMongoUri = (uri) => {
  if (!uri || !uri.includes("@")) return uri;

  const match = uri.match(/^(mongodb(?:\+srv)?:\/\/)([^/]+)(\/?.*)$/i);
  if (!match) return uri;

  const [, prefix, authority, suffix] = match;
  const atPos = authority.lastIndexOf("@");
  if (atPos === -1) return uri;

  const credentials = authority.slice(0, atPos);
  const host = authority.slice(atPos + 1);

  const colonPos = credentials.indexOf(":");
  if (colonPos === -1) return uri;

  const rawUser = credentials.slice(0, colonPos);
  const rawPassword = credentials.slice(colonPos + 1);

  const safeDecode = (value) => {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  };

  const encodedUser = encodeURIComponent(safeDecode(rawUser));
  const encodedPassword = encodeURIComponent(safeDecode(rawPassword));

  return `${prefix}${encodedUser}:${encodedPassword}@${host}${suffix}`;
};

const MONGODB_URI = normalizeMongoUri(process.env.MONGODB_URI || "");

if (!MONGODB_URI) {
  console.error("MONGODB_URI is required in server/.env");
  process.exit(1);
}

const app = express();
app.use(cors());
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

const uploadBufferToCloudinary = (buffer, options) =>
  new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(options, (error, result) => {
      if (error) return reject(error);
      return resolve(result);
    });

    Readable.from(buffer).pipe(uploadStream);
  });

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
  },
});

const userSchema = new mongoose.Schema(
  {
    phoneNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

const contactSchema = new mongoose.Schema(
  {
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    contact: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true }
);

contactSchema.index({ owner: 1, contact: 1 }, { unique: true });

const otpSchema = new mongoose.Schema(
  {
    phoneNumber: { type: String, required: true, index: true },
    codeHash: { type: String, required: true },
    expiresAt: { type: Date, required: true, index: true },
    attempts: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const messageSchema = new mongoose.Schema(
  {
    sender: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receiver: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    text: { type: String, trim: true },
    type: {
      type: String,
      enum: ["text", "image", "video", "audio", "file"],
      default: "text",
      index: true,
    },
    mediaUrl: { type: String, trim: true },
    mediaPublicId: { type: String, trim: true },
    mediaMime: { type: String, trim: true },
    mediaName: { type: String, trim: true },
    mediaSize: { type: Number },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

messageSchema.index({ sender: 1, receiver: 1, createdAt: 1 });

const User = mongoose.model("User", userSchema);
const Contact = mongoose.model("Contact", contactSchema);
const OtpCode = mongoose.model("OtpCode", otpSchema);
const Message = mongoose.model("Message", messageSchema);

const onlineUserSockets = new Map(); // userId -> socketId
const userBySocket = new Map(); // socketId -> userId
const activeCalls = new Map(); // userId -> { peer, callType, callId }

const normalizePhoneNumber = (rawPhone) => {
  if (!rawPhone) return "";
  const trimmed = String(rawPhone).trim();
  const onlyDigits = trimmed.replace(/[^\d+]/g, "");

  if (!onlyDigits) return "";

  if (onlyDigits.startsWith("+")) {
    return `+${onlyDigits.slice(1).replace(/\D/g, "")}`;
  }

  return `+${onlyDigits.replace(/\D/g, "")}`;
};

const isValidPhoneNumber = (phoneNumber) => /^\+[1-9]\d{7,14}$/.test(phoneNumber);
const isValidEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

const createOtpHash = (phoneNumber, otp) => {
  return crypto
    .createHash("sha256")
    .update(`${phoneNumber}:${otp}:${OTP_HASH_SECRET}`)
    .digest("hex");
};

const sendOtpByBrevoEmail = async ({ toEmail, otpCode, phoneNumber }) => {
  if (!BREVO_API_KEY) {
    throw new Error("BREVO_API_KEY missing in .env");
  }

  if (!OTP_FROM_EMAIL) {
    throw new Error("OTP_FROM_EMAIL missing in .env");
  }

  if (typeof fetch !== "function") {
    throw new Error("Global fetch is not available in current Node runtime");
  }

  const expiresInMinutes = Math.max(1, Math.round(OTP_TTL_MS / 60000));

  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "api-key": BREVO_API_KEY,
    },
    body: JSON.stringify({
      sender: {
        name: OTP_FROM_NAME,
        email: OTP_FROM_EMAIL,
      },
      to: [{ email: toEmail }],
      subject: "FriendsTalk OTP Verification",
      htmlContent: `
        <div style="font-family:Arial,sans-serif;line-height:1.5;color:#0f172a;">
          <h2 style="margin:0 0 12px;">FriendsTalk Verification</h2>
          <p style="margin:0 0 12px;">Phone number: <b>${phoneNumber}</b></p>
          <p style="margin:0 0 8px;">Your OTP is:</p>
          <div style="font-size:28px;font-weight:700;letter-spacing:4px;margin:0 0 12px;">${otpCode}</div>
          <p style="margin:0 0 8px;">This OTP expires in ${expiresInMinutes} minute(s).</p>
          <p style="margin:0;color:#64748b;">If you did not request this, you can ignore this email.</p>
        </div>
      `,
    }),
  });

  if (!response.ok) {
    const rawError = await response.text().catch(() => "");
    throw new Error(`Brevo send failed (${response.status}): ${rawError || "Unknown error"}`);
  }
};

const signAuthToken = (userId) => {
  return jwt.sign({ sub: userId }, JWT_SECRET, {
    expiresIn: "30d",
  });
};

const toClientUser = (userDoc) => ({
  id: userDoc._id.toString(),
  phoneNumber: userDoc.phoneNumber,
});

const emitOnlineUsers = () => {
  io.emit("online-users", Array.from(onlineUserSockets.keys()));
};

const relayToUser = (toUserId, eventName, payload) => {
  const toSocketId = onlineUserSockets.get(toUserId);
  if (!toSocketId) return false;

  io.to(toSocketId).emit(eventName, payload);
  return true;
};

const clearActiveCall = (userId) => {
  const active = activeCalls.get(userId);
  if (!active) return null;

  activeCalls.delete(userId);
  if (active.peer) {
    activeCalls.delete(active.peer);
  }

  return active;
};

const sanitizeDisplayName = (rawName) => {
  const cleaned = String(rawName || "")
    .trim()
    .replace(/\s+/g, " ");

  if (!cleaned) return "";
  return cleaned.slice(0, 60);
};

const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || "";
    const rawToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice("Bearer ".length)
      : null;

    if (!rawToken) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const payload = jwt.verify(rawToken, JWT_SECRET);
    req.userId = payload.sub;

    const user = await User.findById(payload.sub).lean();
    if (!user) {
      return res.status(401).json({ error: "User not found" });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
};

app.get("/health", (req, res) => {
  res.json({ ok: true, otpProvider: OTP_PROVIDER });
});

app.post("/auth/request-otp", async (req, res) => {
  try {
    const phoneNumber = normalizePhoneNumber(req.body?.phoneNumber);
    const email = String(req.body?.email || "")
      .trim()
      .toLowerCase();

    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ error: "Please enter valid phone number with country code" });
    }

    if (OTP_PROVIDER === "brevo_email" && !isValidEmail(email)) {
      return res.status(400).json({
        error: "Valid email is required to receive OTP in brevo_email mode",
      });
    }

    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const codeHash = createOtpHash(phoneNumber, otpCode);

    await OtpCode.deleteMany({ phoneNumber });

    await OtpCode.create({
      phoneNumber,
      codeHash,
      expiresAt: new Date(Date.now() + OTP_TTL_MS),
    });

    if (OTP_PROVIDER === "brevo_email") {
      await sendOtpByBrevoEmail({
        toEmail: email,
        otpCode,
        phoneNumber,
      });
    } else {
      console.log(`[OTP:test] ${phoneNumber} -> ${otpCode}`);
    }

    return res.json({
      message: "OTP sent",
      expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
      ...(OTP_PROVIDER === "test" && OTP_DEBUG ? { debugOtp: otpCode } : {}),
    });
  } catch (error) {
    console.error("request-otp failed", error);
    return res.status(500).json({ error: "Failed to request OTP" });
  }
});

app.post("/auth/verify-otp", async (req, res) => {
  try {
    const phoneNumber = normalizePhoneNumber(req.body?.phoneNumber);
    const otpCode = String(req.body?.otp || "").trim();

    if (!isValidPhoneNumber(phoneNumber) || !/^\d{6}$/.test(otpCode)) {
      return res.status(400).json({ error: "Invalid phone or OTP" });
    }

    const otpDoc = await OtpCode.findOne({
      phoneNumber,
      expiresAt: { $gt: new Date() },
    }).sort({ createdAt: -1 });

    if (!otpDoc) {
      return res.status(400).json({ error: "OTP expired or not found" });
    }

    const incomingHash = createOtpHash(phoneNumber, otpCode);
    if (incomingHash !== otpDoc.codeHash) {
      otpDoc.attempts += 1;
      await otpDoc.save();

      if (otpDoc.attempts >= 5) {
        await OtpCode.deleteMany({ phoneNumber });
      }

      return res.status(400).json({ error: "Incorrect OTP" });
    }

    await OtpCode.deleteMany({ phoneNumber });

    const user = await User.findOneAndUpdate(
      { phoneNumber },
      {
        $set: { lastSeenAt: new Date() },
        $setOnInsert: { phoneNumber },
      },
      { new: true, upsert: true }
    );

    const token = signAuthToken(user._id.toString());

    return res.json({
      token,
      user: toClientUser(user),
    });
  } catch (error) {
    console.error("verify-otp failed", error);
    return res.status(500).json({ error: "Failed to verify OTP" });
  }
});

app.get("/auth/me", requireAuth, async (req, res) => {
  return res.json({ user: toClientUser(req.user) });
});

app.get("/contacts", requireAuth, async (req, res) => {
  try {
    const ownerId = new mongoose.Types.ObjectId(req.userId);

    const savedContacts = await Contact.find({ owner: req.userId })
      .populate({ path: "contact", select: "phoneNumber" })
      .lean();

    const peerMessageData = await Message.aggregate([
      {
        $match: {
          $or: [{ sender: ownerId }, { receiver: ownerId }],
        },
      },
      {
        $project: {
          peer: {
            $cond: [{ $eq: ["$sender", ownerId] }, "$receiver", "$sender"],
          },
          createdAt: 1,
        },
      },
      { $sort: { createdAt: -1 } },
      {
        $group: {
          _id: "$peer",
          lastMessageAt: { $first: "$createdAt" },
        },
      },
    ]);

    const contactsMap = new Map();

    for (const entry of savedContacts) {
      if (!entry.contact) continue;
      const contactId = entry.contact._id.toString();
      contactsMap.set(contactId, {
        id: contactId,
        phoneNumber: entry.contact.phoneNumber,
        displayName: sanitizeDisplayName(entry.displayName) || entry.contact.phoneNumber,
        isSaved: true,
        lastMessageAt: null,
      });
    }

    const peerIds = peerMessageData.map((entry) => entry._id.toString());
    const peerUsers = peerIds.length
      ? await User.find({ _id: { $in: peerIds } }).select("phoneNumber").lean()
      : [];
    const peerUserById = new Map(peerUsers.map((user) => [user._id.toString(), user]));

    for (const peer of peerMessageData) {
      const peerId = peer._id.toString();
      const peerUser = peerUserById.get(peerId);
      if (!peerUser) continue;

      const existing = contactsMap.get(peerId);
      if (existing) {
        existing.lastMessageAt = peer.lastMessageAt;
      } else {
        contactsMap.set(peerId, {
          id: peerId,
          phoneNumber: peerUser.phoneNumber,
          displayName: peerUser.phoneNumber,
          isSaved: false,
          lastMessageAt: peer.lastMessageAt,
        });
      }
    }

    const contacts = Array.from(contactsMap.values())
      .map((contact) => ({
        ...contact,
        isOnline: onlineUserSockets.has(contact.id),
      }))
      .sort((a, b) => {
        const timeA = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
        const timeB = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
        if (timeA !== timeB) return timeB - timeA;
        return a.displayName.localeCompare(b.displayName);
      });

    return res.json({ contacts });
  } catch (error) {
    console.error("get contacts failed", error);
    return res.status(500).json({ error: "Failed to fetch contacts" });
  }
});

app.post("/contacts", requireAuth, async (req, res) => {
  try {
    const rawPhone = req.body?.phoneNumber;
    const requestedName = sanitizeDisplayName(req.body?.name);
    const phoneNumber = normalizePhoneNumber(rawPhone);

    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({ error: "Enter a valid phone number with country code" });
    }

    const me = await User.findById(req.userId);
    if (!me) {
      return res.status(404).json({ error: "User not found" });
    }

    if (me.phoneNumber === phoneNumber) {
      return res.status(400).json({ error: "You cannot add your own number" });
    }

    const target = await User.findOne({ phoneNumber });
    if (!target) {
      return res.status(404).json({ error: "This number is not registered yet" });
    }

    const displayName = requestedName || target.phoneNumber;

    await Contact.findOneAndUpdate(
      { owner: req.userId, contact: target._id },
      {
        $set: { displayName },
      },
      { upsert: true, new: true }
    );

    return res.json({
      contact: {
        id: target._id.toString(),
        phoneNumber: target.phoneNumber,
        displayName,
        isSaved: true,
        isOnline: onlineUserSockets.has(target._id.toString()),
      },
    });
  } catch (error) {
    console.error("add contact failed", error);
    return res.status(500).json({ error: "Failed to add contact" });
  }
});

app.patch("/contacts/:contactId", requireAuth, async (req, res) => {
  try {
    const { contactId } = req.params;
    const requestedName = sanitizeDisplayName(req.body?.name);

    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      return res.status(400).json({ error: "Invalid contact id" });
    }

    if (!requestedName) {
      return res.status(400).json({ error: "Name is required" });
    }

    const target = await User.findById(contactId).select("phoneNumber").lean();
    if (!target) {
      return res.status(404).json({ error: "Contact user not found" });
    }

    await Contact.findOneAndUpdate(
      { owner: req.userId, contact: contactId },
      {
        $set: { displayName: requestedName },
      },
      { upsert: true, new: true }
    );

    return res.json({
      contact: {
        id: contactId,
        phoneNumber: target.phoneNumber,
        displayName: requestedName,
        isSaved: true,
        isOnline: onlineUserSockets.has(contactId),
      },
    });
  } catch (error) {
    console.error("update contact failed", error);
    return res.status(500).json({ error: "Failed to update contact" });
  }
});

app.delete("/contacts/:contactId", requireAuth, async (req, res) => {
  try {
    const { contactId } = req.params;
    const deleteMessages = req.query?.deleteMessages === "true";

    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      return res.status(400).json({ error: "Invalid contact id" });
    }

    await Contact.deleteMany({ owner: req.userId, contact: contactId });

    if (deleteMessages) {
      await Message.deleteMany({
        $or: [
          { sender: req.userId, receiver: contactId },
          { sender: contactId, receiver: req.userId },
        ],
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error("delete contact failed", error);
    return res.status(500).json({ error: "Failed to delete contact" });
  }
});

app.post(
  "/messages/:contactId/upload",
  requireAuth,
  upload.single("file"),
  async (req, res) => {
    try {
      const { contactId } = req.params;

      if (!mongoose.Types.ObjectId.isValid(contactId)) {
        return res.status(400).json({ error: "Invalid contact id" });
      }

      if (!req.file) {
        return res.status(400).json({ error: "File is required" });
      }

      if (!cloudinary.config().cloud_name) {
        return res.status(500).json({ error: "Cloudinary config missing" });
      }

      const mime = req.file.mimetype || "";
      const isImage = mime.startsWith("image/");
      const isVideo = mime.startsWith("video/");
      const isAudio = mime.startsWith("audio/");
      const type = isImage ? "image" : isVideo ? "video" : isAudio ? "audio" : "file";

      const uploadResult = await uploadBufferToCloudinary(req.file.buffer, {
        folder: "friendstalk",
        resource_type: "auto",
      });

      const messageDoc = await Message.create({
        sender: req.userId,
        receiver: contactId,
        text: "",
        type,
        mediaUrl: uploadResult.secure_url,
        mediaPublicId: uploadResult.public_id,
        mediaMime: mime,
        mediaName: req.file.originalname,
        mediaSize: req.file.size,
      });

      const payload = {
        id: messageDoc._id.toString(),
        from: req.userId,
        fromPhone: req.user?.phoneNumber,
        to: contactId,
        message: "",
        type,
        mediaUrl: uploadResult.secure_url,
        mediaMime: mime,
        mediaName: req.file.originalname,
        mediaSize: req.file.size,
        timestamp: messageDoc.createdAt,
        deliveredAt: messageDoc.deliveredAt || null,
        readAt: messageDoc.readAt || null,
      };

      const delivered = relayToUser(contactId, "private-message", payload);
      if (delivered) {
        messageDoc.deliveredAt = new Date();
        await messageDoc.save();
        payload.deliveredAt = messageDoc.deliveredAt;
      }

      return res.json({ message: payload });
    } catch (error) {
      console.error("upload message failed", error);
      return res.status(500).json({ error: "Failed to upload file" });
    }
  }
);

app.get("/messages/:contactId", requireAuth, async (req, res) => {
  try {
    const { contactId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(contactId)) {
      return res.status(400).json({ error: "Invalid contact id" });
    }

    const messages = await Message.find({
      $or: [
        { sender: req.userId, receiver: contactId },
        { sender: contactId, receiver: req.userId },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(300)
      .lean();

    return res.json({
      messages: messages.map((message) => ({
        id: message._id.toString(),
        from: message.sender.toString(),
        to: message.receiver.toString(),
        message: message.text || "",
        type: message.type || "text",
        mediaUrl: message.mediaUrl || null,
        mediaMime: message.mediaMime || null,
        mediaName: message.mediaName || null,
        mediaSize: message.mediaSize || null,
        deliveredAt: message.deliveredAt || null,
        readAt: message.readAt || null,
        timestamp: message.createdAt,
      })),
    });
  } catch (error) {
    console.error("get messages failed", error);
    return res.status(500).json({ error: "Failed to fetch messages" });
  }
});

io.use(async (socket, next) => {
  try {
    const handshakeToken = socket.handshake.auth?.token || "";
    const authHeader = socket.handshake.headers?.authorization || "";

    let rawToken = handshakeToken;
    if (!rawToken && authHeader.startsWith("Bearer ")) {
      rawToken = authHeader.slice("Bearer ".length);
    }

    if (!rawToken) {
      return next(new Error("Unauthorized"));
    }

    const payload = jwt.verify(rawToken, JWT_SECRET);
    const user = await User.findById(payload.sub).select("phoneNumber").lean();

    if (!user) {
      return next(new Error("User not found"));
    }

    socket.data.userId = user._id.toString();
    socket.data.phoneNumber = user.phoneNumber;
    next();
  } catch (error) {
    next(new Error("Unauthorized"));
  }
});

io.on("connection", (socket) => {
  const userId = socket.data.userId;
  const phoneNumber = socket.data.phoneNumber;

  const existingSocketId = onlineUserSockets.get(userId);
  if (existingSocketId && existingSocketId !== socket.id) {
    const oldSocket = io.sockets.sockets.get(existingSocketId);
    oldSocket?.emit("session-replaced");
    oldSocket?.disconnect(true);
  }

  onlineUserSockets.set(userId, socket.id);
  userBySocket.set(socket.id, userId);
  emitOnlineUsers();

  socket.on("private-message", async ({ to, message, clientId }) => {
    try {
      if (!to || !mongoose.Types.ObjectId.isValid(to)) return;
      const cleanMessage = String(message || "").trim();
      if (!cleanMessage) return;

      const messageDoc = await Message.create({
        sender: userId,
        receiver: to,
        text: cleanMessage,
        type: "text",
      });

      const delivered = relayToUser(to, "private-message", {
        id: messageDoc._id.toString(),
        from: userId,
        fromPhone: phoneNumber,
        to,
        message: cleanMessage,
        type: "text",
        timestamp: messageDoc.createdAt,
      });

      if (delivered) {
        messageDoc.deliveredAt = new Date();
        await messageDoc.save();
      }

      const payload = {
        id: messageDoc._id.toString(),
        from: userId,
        fromPhone: phoneNumber,
        to,
        message: cleanMessage,
        type: "text",
        timestamp: messageDoc.createdAt,
        deliveredAt: messageDoc.deliveredAt || null,
        readAt: messageDoc.readAt || null,
      };

      socket.emit("message-status", {
        clientId: clientId || null,
        messageId: messageDoc._id.toString(),
        status: delivered ? "delivered" : "sent",
        deliveredAt: messageDoc.deliveredAt || null,
      });
    } catch (error) {
      console.error("socket private-message failed", error);
    }
  });

  socket.on("typing", ({ to }) => {
    if (!to || !mongoose.Types.ObjectId.isValid(to)) return;
    relayToUser(to, "typing", {
      from: userId,
      fromPhone: phoneNumber,
    });
  });

  socket.on("stop-typing", ({ to }) => {
    if (!to || !mongoose.Types.ObjectId.isValid(to)) return;
    relayToUser(to, "stop-typing", {
      from: userId,
      fromPhone: phoneNumber,
    });
  });

  socket.on("mark-read", async ({ contactId }) => {
    try {
      if (!contactId || !mongoose.Types.ObjectId.isValid(contactId)) return;

      const unreadMessages = await Message.find({
        sender: contactId,
        receiver: userId,
        readAt: null,
      })
        .select("_id")
        .lean();

      if (unreadMessages.length === 0) return;

      const messageIds = unreadMessages.map((msg) => msg._id);
      const now = new Date();

      await Message.updateMany(
        { _id: { $in: messageIds } },
        [
          {
            $set: {
              readAt: now,
              deliveredAt: { $ifNull: ["$deliveredAt", now] },
            },
          },
        ]
      );

      relayToUser(contactId, "message-read", {
        from: userId,
        messageIds: messageIds.map((id) => id.toString()),
        readAt: now,
      });
    } catch (error) {
      console.error("mark-read failed", error);
    }
  });

  socket.on("call-user", ({ to, offer, callType, callId }) => {
    if (!to || !mongoose.Types.ObjectId.isValid(to) || !offer) return;

    const delivered = relayToUser(to, "incoming-call", {
      from: userId,
      fromPhone: phoneNumber,
      offer,
      callType,
      callId,
    });

    if (!delivered) {
      socket.emit("call-rejected", {
        from: to,
        callType,
        callId,
        reason: "offline",
      });
    }
  });

  socket.on("answer-call", ({ to, answer, callType, callId }) => {
    if (!to || !mongoose.Types.ObjectId.isValid(to) || !answer) return;

    activeCalls.set(userId, { peer: to, callType, callId });
    activeCalls.set(to, { peer: userId, callType, callId });

    relayToUser(to, "call-answered", {
      from: userId,
      fromPhone: phoneNumber,
      answer,
      callType,
      callId,
    });
  });

  socket.on("reject-call", ({ to, callType, callId, reason }) => {
    if (!to || !mongoose.Types.ObjectId.isValid(to)) return;

    relayToUser(to, "call-rejected", {
      from: userId,
      fromPhone: phoneNumber,
      callType,
      callId,
      reason: reason || "rejected",
    });
  });

  socket.on("end-call", ({ to, callType, callId }) => {
    const active = activeCalls.get(userId);
    if (active && (!callId || active.callId === callId)) {
      activeCalls.delete(userId);
      activeCalls.delete(active.peer);

      relayToUser(active.peer, "call-ended", {
        from: userId,
        fromPhone: phoneNumber,
        callType: active.callType || callType,
        callId: active.callId || callId,
      });
      return;
    }

    if (!to || !mongoose.Types.ObjectId.isValid(to)) return;
    relayToUser(to, "call-ended", {
      from: userId,
      fromPhone: phoneNumber,
      callType,
      callId,
    });
  });

  socket.on("ice-candidate", ({ to, candidate, callType, callId }) => {
    if (!to || !mongoose.Types.ObjectId.isValid(to) || !candidate) return;

    relayToUser(to, "ice-candidate", {
      from: userId,
      candidate,
      callType,
      callId,
    });
  });

  socket.on("disconnect", async () => {
    const disconnectingUserId = userBySocket.get(socket.id);
    if (!disconnectingUserId) return;

    userBySocket.delete(socket.id);

    if (onlineUserSockets.get(disconnectingUserId) === socket.id) {
      onlineUserSockets.delete(disconnectingUserId);
    }

    const active = clearActiveCall(disconnectingUserId);
    if (active?.peer) {
      relayToUser(active.peer, "call-ended", {
        from: disconnectingUserId,
        callType: active.callType,
        callId: active.callId,
        reason: "peer-disconnected",
      });
    }

    await User.findByIdAndUpdate(disconnectingUserId, {
      $set: { lastSeenAt: new Date() },
    }).catch(() => {});

    emitOnlineUsers();
  });
});

const bootstrap = async () => {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log("Connected to MongoDB");

    server.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`OTP provider mode: ${OTP_PROVIDER}`);
    });
  } catch (error) {
    console.error("Server bootstrap failed", error);
    process.exit(1);
  }
};

bootstrap();
