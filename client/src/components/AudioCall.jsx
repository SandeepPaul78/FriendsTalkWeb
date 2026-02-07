import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../services/socket";

const ICE_SERVERS = [{ urls: "stun:stun.l.google.com:19302" }];

const createCallId = () => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
};

const formatDuration = (seconds) => {
  const mins = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const secs = (seconds % 60).toString().padStart(2, "0");
  return `${mins}:${secs}`;
};

const safePlay = (mediaEl) => {
  if (!mediaEl) return;
  const playPromise = mediaEl.play?.();
  if (playPromise?.catch) {
    playPromise.catch(() => {});
  }
};

function AudioCall({ selectedUser, selectedUserLabel, onStart, onEnd, onMissedCall }) {
  const localAudioRef = useRef(null);
  const remoteAudioRef = useRef(null);

  const peerRef = useRef(null);
  const localStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const activeCallRef = useRef(null); // { peer, callId }
  const incomingCallRef = useRef(null);
  const pendingIceCandidatesRef = useRef([]);
  const durationTimerRef = useRef(null);
  const ringtoneContextRef = useRef(null);
  const ringtoneIntervalRef = useRef(null);

  const [incomingCall, setIncomingCall] = useState(null);
  const [callActive, setCallActive] = useState(false);
  const [statusText, setStatusText] = useState("Idle");
  const [durationSeconds, setDurationSeconds] = useState(0);

  const stopRingtone = useCallback(() => {
    if (ringtoneIntervalRef.current) {
      clearInterval(ringtoneIntervalRef.current);
      ringtoneIntervalRef.current = null;
    }

    if (ringtoneContextRef.current) {
      ringtoneContextRef.current.close().catch(() => {});
      ringtoneContextRef.current = null;
    }
  }, []);

  const startRingtone = useCallback(() => {
    if (ringtoneIntervalRef.current) return;

    const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtxClass) return;

    try {
      const context = new AudioCtxClass();
      ringtoneContextRef.current = context;

      const pulseTone = () => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = "triangle";
        oscillator.frequency.value = 720;

        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start();
        oscillator.stop(context.currentTime + 0.22);
      };

      const runRingtoneCycle = () => {
        if (context.state === "suspended") {
          context.resume().catch(() => {});
        }

        pulseTone();
        setTimeout(pulseTone, 260);
      };

      runRingtoneCycle();
      ringtoneIntervalRef.current = setInterval(runRingtoneCycle, 1550);
    } catch (error) {
      console.error("Audio ringtone start failed:", error);
      stopRingtone();
    }
  }, [stopRingtone]);

  const stopDurationTimer = useCallback(() => {
    if (durationTimerRef.current) {
      clearInterval(durationTimerRef.current);
      durationTimerRef.current = null;
    }
  }, []);

  const resetDuration = useCallback(() => {
    stopDurationTimer();
    setDurationSeconds(0);
  }, [stopDurationTimer]);

  const startDurationTimer = useCallback(() => {
    if (durationTimerRef.current) return;
    durationTimerRef.current = setInterval(() => {
      setDurationSeconds((prev) => prev + 1);
    }, 1000);
  }, []);

  const stopTrackList = (stream) => {
    if (!stream) return;
    stream.getTracks().forEach((track) => track.stop());
  };

  const releaseMedia = useCallback(() => {
    stopTrackList(localStreamRef.current);
    stopTrackList(remoteStreamRef.current);

    localStreamRef.current = null;
    remoteStreamRef.current = null;

    if (localAudioRef.current) {
      localAudioRef.current.srcObject = null;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = null;
    }
  }, []);

  const cleanupCall = useCallback(
    (notifyRemote = false) => {
      const activeCall = activeCallRef.current;

      if (notifyRemote && activeCall?.peer) {
        socket.emit("end-call", {
          to: activeCall.peer,
          callType: "audio",
          callId: activeCall.callId,
        });
      }

      if (peerRef.current) {
        peerRef.current.onicecandidate = null;
        peerRef.current.ontrack = null;
        peerRef.current.onconnectionstatechange = null;
        peerRef.current.close();
      }

      peerRef.current = null;
      activeCallRef.current = null;
      incomingCallRef.current = null;
      pendingIceCandidatesRef.current = [];
      setIncomingCall(null);
      setCallActive(false);
      setStatusText("Idle");
      resetDuration();
      releaseMedia();
      stopRingtone();

      if (activeCall) {
        onEnd?.();
      }
    },
    [onEnd, releaseMedia, resetDuration, stopRingtone]
  );

  useEffect(() => {
    incomingCallRef.current = incomingCall;
  }, [incomingCall]);

  const ensureRemoteStream = useCallback(() => {
    if (!remoteStreamRef.current) {
      remoteStreamRef.current = new MediaStream();
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }

    return remoteStreamRef.current;
  }, []);

  const flushPendingIceCandidates = useCallback(async () => {
    const peer = peerRef.current;
    if (!peer) return;
    if (!peer.remoteDescription || !peer.remoteDescription.type) return;

    const queue = pendingIceCandidatesRef.current;
    pendingIceCandidatesRef.current = [];

    for (const candidate of queue) {
      try {
        await peer.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error("Audio queued ICE candidate failed:", error);
      }
    }
  }, []);

  const addRemoteIceCandidate = useCallback(async (candidate) => {
    const peer = peerRef.current;
    if (!peer) return;

    if (!peer.remoteDescription || !peer.remoteDescription.type) {
      pendingIceCandidatesRef.current.push(candidate);
      return;
    }

    try {
      await peer.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error("Audio ICE candidate failed:", error);
    }
  }, []);

  const createPeerConnection = useCallback(
    (targetUser, callId) => {
      const peer = new RTCPeerConnection({ iceServers: ICE_SERVERS });

      peer.onicecandidate = (event) => {
        if (!event.candidate) return;

        socket.emit("ice-candidate", {
          to: targetUser,
          candidate: event.candidate,
          callType: "audio",
          callId,
        });
      };

      peer.ontrack = (event) => {
        const remoteStream = ensureRemoteStream();
        const alreadyExists = remoteStream
          .getTracks()
          .some((track) => track.id === event.track.id);

        if (!alreadyExists) {
          remoteStream.addTrack(event.track);
        }

        if (remoteAudioRef.current) {
          remoteAudioRef.current.srcObject = remoteStream;
          safePlay(remoteAudioRef.current);
        }
      };

      peer.onconnectionstatechange = () => {
        if (peer.connectionState === "connected") {
          setStatusText("In call");
          startDurationTimer();
        }

        if (peer.connectionState === "failed" || peer.connectionState === "closed") {
          cleanupCall(false);
        }

        if (peer.connectionState === "disconnected") {
          setTimeout(() => {
            if (peer.connectionState === "disconnected") {
              cleanupCall(false);
            }
          }, 1200);
        }
      };

      return peer;
    },
    [cleanupCall, ensureRemoteStream, startDurationTimer]
  );

  const getAudioStream = async () => {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  };

  const startCall = async () => {
    if (!selectedUser || activeCallRef.current) return;

    try {
      const stream = await getAudioStream();
      localStreamRef.current = stream;

      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }

      const callId = createCallId();
      activeCallRef.current = {
        peer: selectedUser,
        callId,
      };

      ensureRemoteStream();

      const peer = createPeerConnection(selectedUser, callId);
      peerRef.current = peer;

      stream.getTracks().forEach((track) => {
        peer.addTrack(track, stream);
      });

      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);

      socket.emit("call-user", {
        to: selectedUser,
        offer,
        callType: "audio",
        callId,
      });

      setCallActive(true);
      setStatusText(
        selectedUserLabel ? `Ringing ${selectedUserLabel}` : "Ringing"
      );
      onStart?.();
    } catch (error) {
      console.error("Audio call start failed:", error);
      cleanupCall(false);
      setStatusText("Microphone access denied");
    }
  };

  const acceptCall = async () => {
    if (!incomingCall || activeCallRef.current) return;

    try {
      stopRingtone();
      const stream = await getAudioStream();
      localStreamRef.current = stream;

      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
      }

      const callId = incomingCall.callId || createCallId();
      activeCallRef.current = {
        peer: incomingCall.from,
        callId,
      };

      ensureRemoteStream();

      const peer = createPeerConnection(incomingCall.from, callId);
      peerRef.current = peer;

      stream.getTracks().forEach((track) => {
        peer.addTrack(track, stream);
      });

      await peer.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      await flushPendingIceCandidates();

      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);

      socket.emit("answer-call", {
        to: incomingCall.from,
        answer,
        callType: "audio",
        callId,
      });

      setIncomingCall(null);
      setCallActive(true);
      setStatusText("Connecting");
      onStart?.();
    } catch (error) {
      console.error("Audio call accept failed:", error);
      cleanupCall(false);
    }
  };

  const rejectCall = () => {
    if (!incomingCall) return;

    socket.emit("reject-call", {
      to: incomingCall.from,
      callType: "audio",
      callId: incomingCall.callId,
      reason: "rejected",
    });

    stopRingtone();
    setIncomingCall(null);
    setStatusText("Idle");
  };

  useEffect(() => {
    const handleIncomingCall = (data) => {
      if (data?.callType && data.callType !== "audio") return;

      if (activeCallRef.current) {
        socket.emit("reject-call", {
          to: data.from,
          callType: "audio",
          callId: data.callId,
          reason: "busy",
        });
        return;
      }

      setIncomingCall(data);
      setStatusText("Incoming audio call");
      startRingtone();
    };

    const handleCallAnswered = async ({ answer, callType, callId }) => {
      if (callType && callType !== "audio") return;

      const activeCall = activeCallRef.current;
      if (!activeCall) return;
      if (callId && activeCall.callId !== callId) return;

      try {
        await peerRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingIceCandidates();
        setStatusText("Connecting");
      } catch (error) {
        console.error("Audio answer handling failed:", error);
        cleanupCall(false);
      }
    };

    const handleIceCandidate = async ({ candidate, callType, callId }) => {
      if (callType && callType !== "audio") return;

      const activeCall = activeCallRef.current;
      if (!activeCall || !peerRef.current) return;
      if (callId && activeCall.callId !== callId) return;

      await addRemoteIceCandidate(candidate);
    };

    const handleCallEnded = ({ callType, callId } = {}) => {
      if (callType && callType !== "audio") return;

      const activeCall = activeCallRef.current;
      if (activeCall && (!callId || activeCall.callId === callId)) {
        cleanupCall(false);
        return;
      }

      const pendingIncoming = incomingCallRef.current;
      const isMatchingIncoming =
        pendingIncoming &&
        (!callId ||
          !pendingIncoming.callId ||
          pendingIncoming.callId === callId);

      if (isMatchingIncoming) {
        stopRingtone();
        setIncomingCall(null);
        setStatusText("Missed call");
        onMissedCall?.({ from: pendingIncoming.from, callType: "audio" });
        setTimeout(() => setStatusText("Idle"), 1800);
        return;
      }

      setStatusText("Idle");
    };

    const handleCallRejected = ({ callType, callId, reason }) => {
      if (callType && callType !== "audio") return;

      const activeCall = activeCallRef.current;
      if (!activeCall) return;
      if (callId && activeCall.callId !== callId) return;

      cleanupCall(false);
      setStatusText(reason === "busy" ? "User is busy" : "Call rejected");
      setTimeout(() => setStatusText("Idle"), 1800);
    };

    const handleSessionReplaced = () => {
      cleanupCall(false);
    };

    socket.on("incoming-call", handleIncomingCall);
    socket.on("call-answered", handleCallAnswered);
    socket.on("ice-candidate", handleIceCandidate);
    socket.on("call-ended", handleCallEnded);
    socket.on("call-rejected", handleCallRejected);
    socket.on("session-replaced", handleSessionReplaced);

    return () => {
      socket.off("incoming-call", handleIncomingCall);
      socket.off("call-answered", handleCallAnswered);
      socket.off("ice-candidate", handleIceCandidate);
      socket.off("call-ended", handleCallEnded);
      socket.off("call-rejected", handleCallRejected);
      socket.off("session-replaced", handleSessionReplaced);
    };
  }, [
    addRemoteIceCandidate,
    cleanupCall,
    flushPendingIceCandidates,
    onMissedCall,
    startRingtone,
    stopRingtone,
  ]);

  useEffect(() => {
    return () => {
      cleanupCall(false);
      stopDurationTimer();
      stopRingtone();
    };
  }, [cleanupCall, stopDurationTimer, stopRingtone]);

  const durationLabel = formatDuration(durationSeconds);

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!callActive && !incomingCall && (
        <button
          onClick={startCall}
          disabled={!selectedUser}
          className="rounded-xl bg-sky-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Audio Call
        </button>
      )}

      {incomingCall && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-xs text-emerald-900">
          <span>{incomingCall.fromPhone || incomingCall.from} is calling (audio)</span>
          <button
            onClick={acceptCall}
            className="rounded-lg bg-emerald-600 px-3 py-1.5 font-semibold text-white hover:bg-emerald-700"
          >
            Accept
          </button>
          <button
            onClick={rejectCall}
            className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-700"
          >
            Reject
          </button>
        </div>
      )}

      {callActive && (
        <div className="flex items-center gap-2 rounded-xl border border-slate-300/70 bg-white/80 px-3 py-2 text-xs text-slate-700">
          <span>
            {statusText}
            {durationSeconds > 0 ? ` · ${durationLabel}` : ""}
          </span>
          <button
            onClick={() => cleanupCall(true)}
            className="rounded-lg bg-rose-600 px-3 py-1.5 font-semibold text-white hover:bg-rose-700"
          >
            End
          </button>
        </div>
      )}

      {!callActive && !incomingCall && statusText !== "Idle" && (
        <span className="text-xs text-slate-500">{statusText}</span>
      )}

      <audio ref={localAudioRef} autoPlay muted className="hidden" />
      <audio
        ref={remoteAudioRef}
        autoPlay
        controls
        className={callActive ? "h-8" : "hidden"}
      />
    </div>
  );
}

export default AudioCall;
