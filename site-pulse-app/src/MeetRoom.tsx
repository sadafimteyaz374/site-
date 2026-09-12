import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Mic, MicOff, PhoneOff, Users, Radio } from 'lucide-react';
import { transcribeAudio } from './lib/transcribe';
import { generateAnalysis, type AnalysisResult } from './lib/analysis';

interface Participant {
  id: string;
  displayName: string;
}

interface MeetRoomProps {
  hfToken: string;
  onMeetingConcluded: (analysis: AnalysisResult, transcript: string) => void;
}

const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || 'http://localhost:4000';
const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

export default function MeetRoom({ hfToken, onMeetingConcluded }: MeetRoomProps) {
  const [roomId, setRoomId] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [joined, setJoined] = useState(false);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isEnding, setIsEnding] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const remoteAudioElsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const audioCtxRef = useRef<AudioContext | null>(null);
  const destRef = useRef<MediaStreamAudioDestinationNode | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  useEffect(() => {
    return () => cleanup();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensureMixer = () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new AudioContext();
      destRef.current = audioCtxRef.current.createMediaStreamDestination();
    }
    return { ctx: audioCtxRef.current, dest: destRef.current! };
  };

  const addStreamToMixer = (stream: MediaStream) => {
    const { ctx, dest } = ensureMixer();
    const source = ctx.createMediaStreamSource(stream);
    source.connect(dest);
  };

  const startRecording = () => {
    const { dest } = ensureMixer();
    const recorder = new MediaRecorder(dest.stream, { mimeType: 'audio/webm' });
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.start(1000);
    recorderRef.current = recorder;
  };

  const createPeerConnection = (peerId: string, initiator: boolean) => {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    localStreamRef.current?.getTracks().forEach((track) => {
      pc.addTrack(track, localStreamRef.current!);
    });

    pc.onicecandidate = (e) => {
      if (e.candidate) {
        socketRef.current?.emit('signal', {
          to: peerId,
          data: { type: 'candidate', candidate: e.candidate },
        });
      }
    };

    pc.ontrack = (e) => {
      addStreamToMixer(e.streams[0]);

      // Also play it back so participants can actually hear each other.
      let audioEl = remoteAudioElsRef.current.get(peerId);
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.autoplay = true;
        remoteAudioElsRef.current.set(peerId, audioEl);
      }
      audioEl.srcObject = e.streams[0];
    };

    peerConnectionsRef.current.set(peerId, pc);

    if (initiator) {
      (async () => {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        socketRef.current?.emit('signal', {
          to: peerId,
          data: { type: 'offer', sdp: offer },
        });
      })();
    }

    return pc;
  };

  const handleSignal = async ({ from, data }: { from: string; data: any }) => {
    let pc = peerConnectionsRef.current.get(from);
    if (!pc) pc = createPeerConnection(from, false);

    if (data.type === 'offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('signal', { to: from, data: { type: 'answer', sdp: answer } });
    } else if (data.type === 'answer') {
      await pc.setRemoteDescription(new RTCSessionDescription(data.sdp));
    } else if (data.type === 'candidate') {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
      } catch {
        // ignore late/duplicate candidates
      }
    }
  };

  const cleanup = () => {
    recorderRef.current?.stop();
    recorderRef.current = null;

    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    remoteAudioElsRef.current.forEach((el) => {
      el.srcObject = null;
    });
    remoteAudioElsRef.current.clear();

    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;

    audioCtxRef.current?.close().catch(() => {});
    audioCtxRef.current = null;
    destRef.current = null;

    socketRef.current?.disconnect();
    socketRef.current = null;
  };

  const handleJoin = async () => {
    setError(null);
    const cleanRoomId = roomId.trim();
    const cleanName = displayName.trim() || 'Site Team Member';

    if (!cleanRoomId) {
      setError('Please enter a meeting code to create or join a meeting.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      localStreamRef.current = stream;
      addStreamToMixer(stream);
      startRecording();

      const socket = io(SIGNALING_URL, { transports: ['websocket'] });
      socketRef.current = socket;

      socket.on('connect_error', () => {
        setError(
          `Couldn't reach the meeting server at ${SIGNALING_URL}. Make sure it is running (see server/README).`
        );
      });

      socket.on('existing-users', (users: Participant[]) => {
        setParticipants(users);
        users.forEach((u) => createPeerConnection(u.id, true));
      });

      socket.on('user-joined', (user: Participant) => {
        setParticipants((prev) => [...prev, user]);
      });

      socket.on('signal', handleSignal);

      socket.on('user-left', ({ id }: { id: string }) => {
        peerConnectionsRef.current.get(id)?.close();
        peerConnectionsRef.current.delete(id);
        remoteAudioElsRef.current.get(id)?.remove();
        remoteAudioElsRef.current.delete(id);
        setParticipants((prev) => prev.filter((p) => p.id !== id));
      });

      socket.on('meeting-ended', ({ summary }: { summary: { transcript: string; analysis: AnalysisResult } }) => {
        onMeetingConcluded(summary.analysis, summary.transcript);
        cleanup();
        setJoined(false);
      });

      socket.emit('join-room', { roomId: cleanRoomId, displayName: cleanName });
      setJoined(true);
    } catch (err: any) {
      console.error('Meeting join error:', err);
      setError(err.message || 'Could not access your microphone.');
    }
  };

  const toggleMute = () => {
    localStreamRef.current?.getAudioTracks().forEach((t) => (t.enabled = isMuted));
    setIsMuted((m) => !m);
  };

  const handleEndMeeting = async () => {
    setIsEnding(true);
    setError(null);
    setStatusMsg('Stopping recording...');

    try {
      const recorder = recorderRef.current;
      const stopped = new Promise<void>((resolve) => {
        if (!recorder || recorder.state === 'inactive') return resolve();
        recorder.onstop = () => resolve();
        recorder.stop();
      });
      await stopped;

      const blob = new Blob(chunksRef.current, { type: 'audio/webm' });

      setStatusMsg('Transcribing meeting audio via Whisper...');
      const transcript = await transcribeAudio(blob, hfToken);

      setStatusMsg('Extracting key data and action items...');
      const analysis = generateAnalysis(transcript, displayName || 'Site Team Member');

      socketRef.current?.emit('meeting-ended', {
        roomId: roomId.trim(),
        summary: { transcript, analysis },
      });

      onMeetingConcluded(analysis, transcript);
      cleanup();
      setJoined(false);
    } catch (err: any) {
      console.error('End meeting error:', err);
      setError(err.message || 'Failed to process the meeting recording.');
    } finally {
      setIsEnding(false);
      setStatusMsg(null);
    }
  };

  if (!joined) {
    return (
      <div style={{ backgroundColor: '#f1f5f9', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
        <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Users size={18} /> Team Meeting (Audio)
        </h3>
        <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 12px 0', lineHeight: '1.4' }}>
          Create or join a meeting with your team using just a shared code. When the meeting ends,
          SitePulse automatically transcribes it and extracts the key risks and action items.
        </p>

        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Your name"
          style={{ width: '100%', backgroundColor: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px', fontSize: '13px', marginBottom: '10px', boxSizing: 'border-box', outline: 'none' }}
        />
        <input
          type="text"
          value={roomId}
          onChange={(e) => setRoomId(e.target.value)}
          placeholder="Meeting code (e.g. site-a-standup)"
          style={{ width: '100%', backgroundColor: '#ffffff', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '6px', padding: '10px', fontSize: '13px', marginBottom: '12px', boxSizing: 'border-box', outline: 'none' }}
        />

        <button
          onClick={handleJoin}
          style={{ width: '100%', padding: '12px', backgroundColor: '#0284c7', color: '#ffffff', fontWeight: 'bold', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
        >
          🎙️ Create / Join Meeting
        </button>

        {error && (
          <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#991b1b', fontSize: '12px' }}>
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div style={{ backgroundColor: '#f1f5f9', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '12px' }}>
        <h3 style={{ margin: 0, fontSize: '15px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Radio size={16} color="#dc2626" /> Meeting: {roomId}
        </h3>
        <span style={{ fontSize: '11px', color: '#dc2626', fontWeight: 'bold' }}>● RECORDING</span>
      </div>

      <div style={{ backgroundColor: '#ffffff', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '12px', marginBottom: '12px' }}>
        <p style={{ fontSize: '11px', color: '#64748b', margin: '0 0 8px 0', fontWeight: 'bold', textTransform: 'uppercase' }}>
          In this meeting ({participants.length + 1})
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          <span style={{ fontSize: '13px', color: '#0f172a' }}>👤 {displayName || 'You'} (you)</span>
          {participants.map((p) => (
            <span key={p.id} style={{ fontSize: '13px', color: '#0f172a' }}>👤 {p.displayName}</span>
          ))}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '8px' }}>
        <button
          onClick={toggleMute}
          style={{ flex: 1, padding: '10px', backgroundColor: isMuted ? '#f1f5f9' : '#ffffff', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', color: '#334155' }}
        >
          {isMuted ? <MicOff size={14} /> : <Mic size={14} />} {isMuted ? 'Unmute' : 'Mute'}
        </button>
        <button
          onClick={handleEndMeeting}
          disabled={isEnding}
          style={{ flex: 1, padding: '10px', backgroundColor: isEnding ? '#94a3b8' : '#dc2626', color: '#ffffff', border: 'none', borderRadius: '6px', cursor: isEnding ? 'not-allowed' : 'pointer', fontSize: '13px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}
        >
          <PhoneOff size={14} /> {isEnding ? 'Processing...' : 'End Meeting for Everyone'}
        </button>
      </div>

      {statusMsg && (
        <p style={{ marginTop: '10px', fontSize: '12px', color: '#0284c7', fontWeight: '500' }}>{statusMsg}</p>
      )}

      {error && (
        <div style={{ marginTop: '12px', padding: '10px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#991b1b', fontSize: '12px' }}>
          {error}
        </div>
      )}
    </div>
  );
}
