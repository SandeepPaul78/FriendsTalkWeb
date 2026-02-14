import { useCallback, useEffect, useRef, useState } from "react";
import { socket } from "../services/socket";
import { ICE_SERVERS } from "../services/webrtc";

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

function VideoCall({
  selectedUser,
  selectedUserLabel,
  onStart,
  onEnd,
  onMissedCall,
  autoStartToken,
}) {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
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
  const lastAutoStartRef = useRef(null);

  const [incomingCall, setIncomingCall] = useState(null);
  const [callActive, setCallActive] = useState(false);
  const [callPeer, setCallPeer] = useState(null);
  const [statusText, setStatusText] = useState("Idle");
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [videoFacing, setVideoFacing] = useState("user");
  const [isSwitchingCamera, setIsSwitchingCamera] = useState(false);
  const [isLocalFull, setIsLocalFull] = useState(false);

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

        oscillator.type = "sine";
        oscillator.frequency.value = 680;

        gain.gain.setValueAtTime(0.0001, context.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.07, context.currentTime + 0.02);
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
        setTimeout(pulseTone, 280);
      };

      runRingtoneCycle();
      ringtoneIntervalRef.current = setInterval(runRingtoneCycle, 1600);
    } catch (error) {
      console.error("Video ringtone start failed:", error);
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

    if (localVideoRef.current) {
      localVideoRef.current.srcObject = null;
    }

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = null;
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
          callType: "video",
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
      setCallPeer(null);
      setStatusText("Idle");
      setVideoFacing("user");
      setIsLocalFull(false);
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

    if (remoteVideoRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
    }

    if (remoteAudioRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
    }

    return remoteStreamRef.current;
  }, []);

  const attachMediaElements = useCallback(() => {
    if (localVideoRef.current && localStreamRef.current) {
      localVideoRef.current.srcObject = localStreamRef.current;
      safePlay(localVideoRef.current);
    }

    if (remoteVideoRef.current && remoteStreamRef.current) {
      remoteVideoRef.current.srcObject = remoteStreamRef.current;
      safePlay(remoteVideoRef.current);
    }

    if (remoteAudioRef.current && remoteStreamRef.current) {
      remoteAudioRef.current.srcObject = remoteStreamRef.current;
      safePlay(remoteAudioRef.current);
    }
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
        console.error("Video queued ICE candidate failed:", error);
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
      console.error("Video ICE candidate failed:", error);
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
          callType: "video",
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

        if (remoteVideoRef.current) {
          remoteVideoRef.current.srcObject = remoteStream;
          safePlay(remoteVideoRef.current);
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

  const getMediaStream = async () => {
    return navigator.mediaDevices.getUserMedia({
      video: { facingMode: videoFacing },
      audio: true,
    });
  };

  const switchCamera = useCallback(async () => {
    if (!localStreamRef.current || isSwitchingCamera) return;
    const nextFacing = videoFacing === "user" ? "environment" : "user";
    setIsSwitchingCamera(true);

    try {
      const newStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing },
        audio: false,
      });

      const newTrack = newStream.getVideoTracks()[0];
      if (!newTrack) return;

      const oldTrack = localStreamRef.current.getVideoTracks()[0];
      if (oldTrack) {
        localStreamRef.current.removeTrack(oldTrack);
        oldTrack.stop();
      }

      localStreamRef.current.addTrack(newTrack);

      const sender = peerRef.current
        ?.getSenders()
        .find((trackSender) => trackSender.track?.kind === "video");
      if (sender) {
        await sender.replaceTrack(newTrack);
      }

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = localStreamRef.current;
        safePlay(localVideoRef.current);
      }

      setVideoFacing(nextFacing);
    } catch (error) {
      console.error("Switch camera failed:", error);
    } finally {
      setIsSwitchingCamera(false);
    }
  }, [isSwitchingCamera, videoFacing]);

  const startCall = async () => {
    if (!selectedUser || activeCallRef.current) return;

    try {
      const stream = await getMediaStream();
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        safePlay(localVideoRef.current);
      }

      const callId = createCallId();
      activeCallRef.current = {
        peer: selectedUser,
        callId,
      };

      setCallPeer(selectedUserLabel || selectedUser);
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
        callType: "video",
        callId,
      });

      setCallActive(true);
      setStatusText("Ringing");
      onStart?.();
      setTimeout(attachMediaElements, 0);
    } catch (error) {
      console.error("Video call start failed:", error);
      cleanupCall(false);
      setStatusText("Camera or microphone denied");
    }
  };

  const acceptCall = async () => {
    if (!incomingCall || activeCallRef.current) return;

    try {
      stopRingtone();
      const stream = await getMediaStream();
      localStreamRef.current = stream;

      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
        safePlay(localVideoRef.current);
      }

      const callId = incomingCall.callId || createCallId();
      activeCallRef.current = {
        peer: incomingCall.from,
        callId,
      };

      setCallPeer(incomingCall.fromPhone || incomingCall.from);
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
        callType: "video",
        callId,
      });

      setIncomingCall(null);
      setCallActive(true);
      setStatusText("Connecting");
      onStart?.();
      setTimeout(attachMediaElements, 0);
    } catch (error) {
      console.error("Video call accept failed:", error);
      cleanupCall(false);
    }
  };

  const rejectCall = () => {
    if (!incomingCall) return;

    socket.emit("reject-call", {
      to: incomingCall.from,
      callType: "video",
      callId: incomingCall.callId,
      reason: "rejected",
    });

    stopRingtone();
    setIncomingCall(null);
    setStatusText("Idle");
  };

  useEffect(() => {
    const handleIncomingCall = (data) => {
      if (data?.callType && data.callType !== "video") return;

      if (activeCallRef.current) {
        socket.emit("reject-call", {
          to: data.from,
          callType: "video",
          callId: data.callId,
          reason: "busy",
        });
        return;
      }

      setIncomingCall(data);
      setStatusText("Incoming video call");
      startRingtone();
    };

    const handleCallAnswered = async ({ answer, callType, callId }) => {
      if (callType && callType !== "video") return;

      const activeCall = activeCallRef.current;
      if (!activeCall) return;
      if (callId && activeCall.callId !== callId) return;

      try {
        await peerRef.current?.setRemoteDescription(new RTCSessionDescription(answer));
        await flushPendingIceCandidates();
        setStatusText("Connecting");
      } catch (error) {
        console.error("Video answer handling failed:", error);
        cleanupCall(false);
      }
    };

    const handleIceCandidate = async ({ candidate, callType, callId }) => {
      if (callType && callType !== "video") return;

      const activeCall = activeCallRef.current;
      if (!activeCall || !peerRef.current) return;
      if (callId && activeCall.callId !== callId) return;

      await addRemoteIceCandidate(candidate);
    };

    const handleCallEnded = ({ callType, callId } = {}) => {
      if (callType && callType !== "video") return;

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
        onMissedCall?.({ from: pendingIncoming.from, callType: "video" });
        setTimeout(() => setStatusText("Idle"), 1800);
        return;
      }

      setStatusText("Idle");
    };

    const handleCallRejected = ({ callType, callId, reason }) => {
      if (callType && callType !== "video") return;

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

  useEffect(() => {
    if (!callActive) return;
    attachMediaElements();
  }, [attachMediaElements, callActive]);

  useEffect(() => {
    if (!autoStartToken) return;
    if (!selectedUser) return;
    if (callActive || incomingCall) return;
    if (lastAutoStartRef.current === autoStartToken) return;
    lastAutoStartRef.current = autoStartToken;
    startCall();
  }, [autoStartToken, callActive, incomingCall, selectedUser, startCall]);

  const durationLabel = formatDuration(durationSeconds);
  const showInlineButton = !callActive && !incomingCall;
  const showOverlay = callActive || incomingCall;

  return (
    <>
      {showInlineButton && (
        <button
          onClick={startCall}
          disabled={!selectedUser}
          aria-label="Start video call"
          className="flex h-8 w-8 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white transition hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="currentColor" aria-hidden="true">
            <path d="M15 8.5V7c0-1.1-.9-2-2-2H5C3.9 5 3 5.9 3 7v10c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2v-1.5l5 2.5V6l-5 2.5z" />
          </svg>
        </button>
      )}

      {showOverlay && (
        <div className="fixed inset-0 z-50 flex flex-col bg-black">
          <div className="absolute inset-0">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              onClick={
                isLocalFull ? () => setIsLocalFull(false) : undefined
              }
              className={`bg-black object-cover ${
                isLocalFull
                  ? "absolute bottom-24 right-4 z-10 h-32 w-24 cursor-pointer rounded-2xl border border-white/20 shadow-lg"
                  : "absolute inset-0 z-0 h-full w-full"
              }`}
            />
            <video
              ref={localVideoRef}
              autoPlay
              muted
              playsInline
              onClick={
                isLocalFull ? undefined : () => setIsLocalFull(true)
              }
              className={`bg-black object-cover ${
                isLocalFull
                  ? "absolute inset-0 z-0 h-full w-full"
                  : "absolute bottom-24 right-4 z-10 h-32 w-24 cursor-pointer rounded-2xl border border-white/20 shadow-lg"
              }`}
            />
          </div>

          <div className="pointer-events-none relative z-10 flex items-start justify-between px-5 py-4 text-white">
            <div>
              <p className="text-[11px] uppercase tracking-[0.16em] text-white/60">
                Video Call
              </p>
              <h3 className="mt-1 text-lg font-semibold">
                {incomingCall?.fromPhone || callPeer || selectedUserLabel || selectedUser || "Unknown"}
              </h3>
              <p className="text-xs text-white/70">
                {incomingCall ? "Incoming call" : statusText}
                {durationSeconds > 0 ? ` · ${durationLabel}` : ""}
              </p>
            </div>
          </div>

          <div className="pointer-events-none absolute bottom-0 left-0 right-0 z-10 flex justify-center pb-6">
            <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-black/50 px-4 py-2 backdrop-blur">
              {incomingCall ? (
                <>
                  <button
                    onClick={acceptCall}
                    className="h-12 rounded-full bg-[#25d366] px-5 text-sm font-semibold text-[#073e2a] hover:bg-[#1fc15c]"
                  >
                    Accept
                  </button>
                  <button
                    onClick={rejectCall}
                    className="h-12 rounded-full bg-rose-600 px-5 text-sm font-semibold text-white hover:bg-rose-700"
                  >
                    Reject
                  </button>
                </>
              ) : (
                <>
                  <button
                    onClick={switchCamera}
                    disabled={isSwitchingCamera}
                    className="h-10 rounded-full border border-white/30 px-4 text-xs font-semibold text-white/90 hover:bg-white/10 disabled:opacity-60"
                  >
                    Flip
                  </button>
                  <button
                    onClick={() => cleanupCall(true)}
                    className="h-12 rounded-full bg-rose-600 px-6 text-sm font-semibold text-white hover:bg-rose-700"
                  >
                    End
                  </button>
                </>
              )}
            </div>
          </div>

        </div>
      )}

      <audio ref={remoteAudioRef} autoPlay className="hidden" />
    </>
  );
}

export default VideoCall;
