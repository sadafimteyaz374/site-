import React, { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import { Upload, FileAudio, CheckCircle2 } from 'lucide-react';
import MeetRoom from './MeetRoom';
import { transcribeAudio } from './lib/transcribe';
import { extractAudioFromVideo } from './lib/videoAudio';
import { generateAnalysis } from './lib/analysis';

const decodeHtml = (html: string): string => {
  const txt = document.createElement('textarea');
  txt.innerHTML = html;
  return txt.value;
};

interface MediaResult {
  summary: string;
  transcript: string;
  keyInsights: string[];
}

export default function App() {
  const [inputText, setInputText] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [inputSource, setInputSource] = useState<'MANUAL' | 'EMAIL' | 'MEET' | 'MEDIA'>('MANUAL');
  const [isEmailConnected, setIsEmailConnected] = useState<boolean>(false);
  const [userEmail, setUserEmail] = useState<string>('');
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const [meetingTranscript, setMeetingTranscript] = useState<string | null>(null);

  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaResult, setMediaResult] = useState<MediaResult | null>(null);
  const [mediaStatus, setMediaStatus] = useState<string | null>(null);

  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [expandedItems, setExpandedItems] = useState<{ [key: number]: boolean }>({});

  const toggleAccordion = (index: number) => {
    setExpandedItems((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const loginWithGoogle = useGoogleLogin({
    flow: 'implicit',
    scope: 'https://www.googleapis.com/auth/gmail.readonly openid email profile',
    onSuccess: async (tokenResponse) => {
      setAccessToken(tokenResponse.access_token);
      setIsEmailConnected(true);
      setError(null);

      try {
        const userInfo = await fetch(
          `https://www.googleapis.com/oauth2/v3/userinfo?access_token=${tokenResponse.access_token}`
        ).then((res) => res.json());

        setUserEmail(userInfo.email || 'Connected Google Account');
      } catch (err) {
        setUserEmail('Active User Session');
      }
    },
    onError: (err) => {
      console.error('OAuth Error:', err);
      setError('Google Sign-In was cancelled or failed.');
    },
  });

  const sampleScenarios = {
    safety: `EMERGENCY - 09:15 AM: Main hoist cable on Tower Crane 1 showed severe strand deformation during a 6-ton precast panel lift on Block B. Safety Manager immediately executed site-wide work suspension around Crane 1 radius. Urgent approval required for $4,200/day mobile crane deployment to maintain structural schedule.`,
    delay: `CRITICAL DELAY: Ready-mix supplier reports main batching plant power failure. 8 transit mixers carrying 65m³ concrete delayed by 3 hours for Level 4 deck pour. Structural Engineer warning of cold joint formation risks. Emergency change order #14 for $15,500 needed to divert trucks to secondary batch plant before 2:00 PM.`,
    financial: `PERMIT VIOLATION ALERT: Structural Inspector rejected pre-pour sign-off for Section 3 footing due to non-compliant rebar spacing (200mm vs 150mm spec). Concrete pump truck on standby charging $500/hour. Immediate supervisor sign-off required for manual rebar correction team ($2,800 estimate) before 4:00 PM site audit.`
  };

  const generateFallbackAnalysis = (text: string) => generateAnalysis(text, userEmail || 'Site Supervisor');

  const handleTriage = async (textToProcess: string = inputText) => {
    if (!textToProcess.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const fallbackResult = generateFallbackAnalysis(textToProcess);
      setResult(fallbackResult);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setActiveFilter('ALL');
      setLoading(false);
    }
  };

  const handleFetchEmails = async () => {
    if (!accessToken) {
      setError("Please connect your Google account first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const queryParam = encodeURIComponent('job OR assignment OR urgent OR important');
      const listResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=1&q=${queryParam}&access_token=${accessToken}`
      );

      if (!listResponse.ok) {
        throw new Error(`Gmail API status ${listResponse.status}`);
      }

      const listData = await listResponse.json();

      if (listData.messages && listData.messages.length > 0) {
        const msgId = listData.messages[0].id;

        const msgResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full&access_token=${accessToken}`
        );
        const msgData = await msgResponse.json();

        const subjectHeader = msgData.payload?.headers?.find((h: any) => h.name.toLowerCase() === 'subject');
        const subject = subjectHeader ? subjectHeader.value : '';

        const rawSnippet = msgData.snippet || "No text content found in email.";
        const cleanSnippet = decodeHtml(rawSnippet);

        const directMessage = subject ? `[${subject}] ${cleanSnippet}` : cleanSnippet;
        
        setInputText(directMessage);
        await handleTriage(directMessage);
      } else {
        const fallbackMsg = "No recent emails found matching important or job-related queries.";
        setInputText(fallbackMsg);
        await handleTriage(fallbackMsg);
      }
    } catch (err: any) {
      console.error('Gmail Error:', err);
      setError("Failed to access Gmail API directly.");
    } finally {
      setLoading(false);
    }
  };

  const handleMeetingConcluded = (analysis: any, transcript: string) => {
    setMeetingTranscript(transcript);
    setInputText(transcript);
    setResult(analysis);
    setActiveFilter('ALL');
  };

  const handleMediaFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      if (selectedFile.type.startsWith('audio/') || selectedFile.type.startsWith('video/')) {
        setMediaFile(selectedFile);
        setError(null);
      } else {
        setError('Please upload a valid audio or video file (MP3, WAV, MP4, etc.)');
      }
    }
  };

  const handleProcessMedia = async () => {
    if (!mediaFile) return;
    setLoading(true);
    setError(null);

    const hfToken = import.meta.env.VITE_HF_API_TOKEN;

    if (!hfToken) {
      setError("VITE_HF_API_TOKEN is missing in your .env file!");
      setLoading(false);
      return;
    }

    try {
      let audioBlob: Blob = mediaFile;

      if (mediaFile.type.startsWith('video/')) {
        setMediaStatus('Extracting audio track from video...');
        audioBlob = await extractAudioFromVideo(mediaFile);
      }

      setMediaStatus('Transcribing via Hugging Face...');
      const transcriptText = await transcribeAudio(audioBlob, hfToken);

      setMediaResult({
        summary: `Successfully transcribed media file [${mediaFile.name}] using Whisper AI.`,
        transcript: transcriptText,
        keyInsights: [
          "Real audio-to-text extraction completed.",
          "Check full transcript below for exact spoken phrases."
        ]
      });
    } catch (err: any) {
      console.error("HF Audio Processing Error:", err);
      setError(err.message || "Failed to process audio file with Hugging Face.");
    } finally {
      setLoading(false);
      setMediaStatus(null);
    }
  };

  const filteredActionItems = result?.actionItems?.filter((item: any) => {
    if (activeFilter === 'ALL') return true;
    return item.status === activeFilter || result?.riskLevel === activeFilter;
  }) || [];

  return (
    <div style={{ backgroundColor: '#f8fafc', color: '#0f172a', minHeight: '100vh', padding: '24px', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <header style={{ marginBottom: '24px', borderBottom: '1px solid #e2e8f0', paddingBottom: '16px' }}>
        <h1 style={{ fontSize: '24px', fontWeight: 'bold', margin: '0 0 8px 0', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '8px' }}>
          🏗️ SitePulse AI
        </h1>
        <p style={{ color: '#475569', margin: '0 0 8px 0', fontSize: '15px', fontWeight: '500' }}>
          Autonomous Multi-Source Communication Triage & Risk Intelligence Engine
        </p>
      </header>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px' }}>
        <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
          <div style={{ marginBottom: '16px' }}>
            <label style={{ display: 'block', fontWeight: '600', marginBottom: '8px', fontSize: '12px', color: '#64748b', letterSpacing: '0.5px' }}>
              SELECT DATA INGESTION SOURCE:
            </label>
            <div style={{ display: 'flex', gap: '8px', borderBottom: '1px solid #e2e8f0', paddingBottom: '12px', flexWrap: 'wrap' }}>
              <button onClick={() => setInputSource('MANUAL')} style={tabBtnStyle(inputSource === 'MANUAL')}>📝 Manual Input</button>
              <button onClick={() => setInputSource('EMAIL')} style={tabBtnStyle(inputSource === 'EMAIL')}>✉️ Gmail</button>
              <button onClick={() => setInputSource('MEET')} style={tabBtnStyle(inputSource === 'MEET')}>🎙️ Team Meeting</button>
              <button onClick={() => setInputSource('MEDIA')} style={tabBtnStyle(inputSource === 'MEDIA')}>📁 Media Extractor</button>
            </div>
          </div>

          {inputSource === 'MANUAL' && (
            <div>
              <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 10px 0' }}>
                <strong>Manual Input Mode:</strong> Paste site log or select standard test scenario below:
              </p>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '12px', flexWrap: 'wrap' }}>
                <button onClick={() => setInputText(sampleScenarios.safety)} style={btnPresetStyle}>🚨 Crane Safety Hazard</button>
                <button onClick={() => setInputText(sampleScenarios.delay)} style={btnPresetStyle}>⏱️ Concrete Plant Delay</button>
                <button onClick={() => setInputText(sampleScenarios.financial)} style={btnPresetStyle}>💲 Rebar Compliance Failure</button>
              </div>

              <textarea
                rows={8}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste raw site communications, logs, or chat messages here..."
                style={{ width: '100%', backgroundColor: '#f8fafc', color: '#0f172a', border: '1px solid #cbd5e1', borderRadius: '8px', padding: '12px', fontSize: '13px', resize: 'vertical', boxSizing: 'border-box', outline: 'none' }}
              />

              <button onClick={() => handleTriage()} disabled={loading || !inputText.trim()} style={actionBtnStyle(loading || !inputText.trim())}>
                {loading ? 'Analyzing Site Logs...' : '⚡ Run AI Triage'}
              </button>
            </div>
          )}

          {inputSource === 'EMAIL' && (
            <div style={{ backgroundColor: '#f1f5f9', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', color: '#0f172a' }}>🔒 Secure User Gmail Integration</h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 16px 0', lineHeight: '1.4' }}>
                Connect your Google account securely to fetch and analyze your important emails.
              </p>

              {!isEmailConnected ? (
                <button onClick={() => loginWithGoogle()} style={{ backgroundColor: '#10b981', color: '#ffffff', border: 'none', padding: '12px 18px', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  🔑 Connect My Google Account (OAuth 2.0)
                </button>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', backgroundColor: '#ffffff', padding: '10px 14px', borderRadius: '6px', border: '1px solid #22c55e' }}>
                    <span style={{ color: '#16a34a', fontWeight: 'bold' }}>● Authenticated User:</span>
                    <strong style={{ fontSize: '13px', color: '#0f172a' }}>{userEmail}</strong>
                  </div>

                  <button onClick={handleFetchEmails} disabled={loading} style={actionBtnStyle(loading)}>
                    {loading ? 'Fetching Important Email...' : '🔄 Fetch & Triage My Live Email'}
                  </button>
                </div>
              )}
            </div>
          )}

          {inputSource === 'MEET' && (
            <MeetRoom
              hfToken={import.meta.env.VITE_HF_API_TOKEN}
              onMeetingConcluded={handleMeetingConcluded}
            />
          )}

          {inputSource === 'MEDIA' && (
            <div style={{ backgroundColor: '#f1f5f9', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
              <h3 style={{ margin: '0 0 6px 0', fontSize: '15px', color: '#0f172a', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <FileAudio size={18} /> Media Extractor (Hugging Face Whisper)
              </h3>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 12px 0', lineHeight: '1.4' }}>
                Upload an audio or video file to extract the real transcription using AI.
              </p>

              <div style={{ border: '2px dashed #cbd5e1', borderRadius: '8px', padding: '16px', textAlign: 'center', backgroundColor: '#ffffff', marginBottom: '12px' }}>
                <input
                  type="file"
                  accept="audio/*,video/*"
                  onChange={handleMediaFileChange}
                  style={{ display: 'none' }}
                  id="media-upload-input"
                />
                <label htmlFor="media-upload-input" style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                  <Upload size={24} color="#64748b" />
                  <span style={{ fontSize: '13px', fontWeight: '500', color: '#334155' }}>
                    {mediaFile ? mediaFile.name : "Click to upload Audio/Video file"}
                  </span>
                  <span style={{ fontSize: '11px', color: '#94a3b8' }}>Supports MP3, WAV, MP4, M4A</span>
                </label>
              </div>

              <button onClick={handleProcessMedia} disabled={loading || !mediaFile} style={actionBtnStyle(loading || !mediaFile)}>
                {loading ? 'Transcribing via Hugging Face...' : '🎙️ Extract Media Transcript'}
              </button>

              {mediaStatus && (
                <p style={{ fontSize: '12px', color: '#0284c7', marginTop: '8px', textAlign: 'center', fontWeight: '500' }}>
                  ⏳ {mediaStatus}
                </p>
              )}
            </div>
          )}

          {error && (
            <div style={{ marginTop: '16px', padding: '12px', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', borderRadius: '6px', color: '#991b1b', fontSize: '13px' }}>
              {error}
            </div>
          )}
        </div>

        <div>
          {inputSource === 'MEDIA' && mediaResult ? (
            <div style={{ backgroundColor: '#ffffff', padding: '20px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', color: '#0f172a' }}>📁 Media Transcription Results</h3>
              
              <div>
                <h4 style={{ fontSize: '12px', color: '#64748b', textTransform: 'uppercase', margin: '0 0 4px 0' }}>Status Summary</h4>
                <p style={{ margin: 0, fontSize: '13px', color: '#334155', backgroundColor: '#f8fafc', padding: '10px', borderRadius: '6px' }}>{mediaResult.summary}</p>
              </div>

              <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '12px', borderRadius: '8px' }}>
                <h5 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#166534', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <CheckCircle2 size={14} /> Full Spoken Transcript
                </h5>
                <p style={{ margin: 0, fontSize: '13px', color: '#15803d', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                  {mediaResult.transcript}
                </p>
              </div>
            </div>
          ) : result ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px' }}>
                <MetricCard title="RISK SEVERITY" value={result.riskLevel} color={getSeverityColor(result.riskLevel)} bg={getSeverityBg(result.riskLevel)} />
                <MetricCard title="RISK SCORE" value={`${result.riskScore} / 100`} color="#0284c7" bg="#f0f9ff" />
                <MetricCard title="FINANCIAL EXPOSURE" value={result.financialImpact} color="#d97706" bg="#fffbeb" />
              </div>

              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <h3 style={{ margin: '0 0 8px 0', fontSize: '12px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Short Extracted Summary</h3>
                <p style={{ margin: 0, fontSize: '14px', lineHeight: '1.5', color: '#334155' }}>{result.summary}</p>
              </div>

              {inputSource === 'MEET' && meetingTranscript && (
                <div style={{ backgroundColor: '#f0fdf4', border: '1px solid #bbf7d0', padding: '12px', borderRadius: '8px' }}>
                  <h5 style={{ margin: '0 0 8px 0', fontSize: '13px', color: '#166534', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <CheckCircle2 size={14} /> Full Meeting Transcript
                  </h5>
                  <p style={{ margin: 0, fontSize: '13px', color: '#15803d', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                    {meetingTranscript}
                  </p>
                </div>
              )}

              <div style={{ backgroundColor: '#ffffff', padding: '16px', borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: '0 1px 3px rgba(0,0,0,0.05)' }}>
                <h3 style={{ margin: '0 0 12px 0', fontSize: '15px', color: '#0f172a' }}>🎯 Actionable Mitigation Plan ({filteredActionItems.length})</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {filteredActionItems.map((item: any, idx: number) => {
                    const isOpen = !!expandedItems[idx];
                    return (
                      <div key={idx} style={{ border: '1px solid #cbd5e1', borderRadius: '8px', backgroundColor: '#ffffff', overflow: 'hidden' }}>
                        <div onClick={() => toggleAccordion(idx)} style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: isOpen ? '#f8fafc' : '#ffffff' }}>
                          <span style={{ fontWeight: '600', fontSize: '14px', color: '#0f172a' }}>{isOpen ? '▼' : '▶'} {item.task}</span>
                          <span style={{ fontSize: '11px', color: '#dc2626', backgroundColor: '#fef2f2', border: '1px solid #fca5a5', padding: '2px 8px', borderRadius: '4px', fontWeight: 'bold' }}>Due: {item.deadline}</span>
                        </div>

                        {isOpen && (
                          <div style={{ padding: '16px', borderTop: '1px solid #e2e8f0', backgroundColor: '#f8fafc', fontSize: '13px', color: '#334155' }}>
                            <p><strong>👤 Assigned To:</strong> {item.owner}</p>
                            <p><strong>💡 Operational Context:</strong> {item.context}</p>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          ) : (
            <div style={{ backgroundColor: '#ffffff', padding: '40px', borderRadius: '12px', border: '2px dashed #cbd5e1', textAlign: 'center', color: '#94a3b8' }}>
              Select an input source to triage site communications.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, color, bg }: { title: string; value: string; color: string; bg: string }) {
  return (
    <div style={{ backgroundColor: bg, padding: '14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
      <span style={{ fontSize: '11px', color: '#64748b', fontWeight: 'bold' }}>{title}</span>
      <div style={{ fontSize: '18px', fontWeight: 'bold', color: color, marginTop: '4px' }}>{value}</div>
    </div>
  );
}

function getSeverityColor(level: string) {
  switch (level) {
    case 'CRITICAL': return '#dc2626';
    case 'WARNING': return '#d97706';
    default: return '#2563eb';
  }
}

function getSeverityBg(level: string) {
  switch (level) {
    case 'CRITICAL': return '#fef2f2';
    case 'WARNING': return '#fffbeb';
    default: return '#eff6ff';
  }
}

const tabBtnStyle = (isActive: boolean) => ({
  backgroundColor: isActive ? '#0284c7' : '#f1f5f9',
  color: isActive ? '#ffffff' : '#475569',
  border: '1px solid #cbd5e1',
  padding: '8px 14px',
  borderRadius: '6px',
  fontSize: '12px',
  fontWeight: 'bold',
  cursor: 'pointer'
});

const actionBtnStyle = (isDisabled: boolean) => ({
  width: '100%',
  marginTop: '8px',
  padding: '12px',
  backgroundColor: isDisabled ? '#94a3b8' : '#0284c7',
  color: '#ffffff',
  fontWeight: 'bold',
  border: 'none',
  borderRadius: '6px',
  cursor: isDisabled ? 'not-allowed' : 'pointer',
  fontSize: '13px'
});

const btnPresetStyle = {
  backgroundColor: '#f1f5f9',
  color: '#334155',
  border: '1px solid #cbd5e1',
  padding: '6px 12px',
  borderRadius: '6px',
  fontSize: '12px',
  cursor: 'pointer',
  fontWeight: '500'
};
