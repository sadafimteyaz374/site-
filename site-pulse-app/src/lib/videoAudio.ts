export async function extractAudioFromVideo(file: File): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.src = URL.createObjectURL(file);
    video.muted = true;
    video.playsInline = true;

    const cleanupUrl = () => URL.revokeObjectURL(video.src);

    video.onloadedmetadata = () => {
      const captureFn =
        (video as any).captureStream || (video as any).mozCaptureStream;

      if (!captureFn) {
        cleanupUrl();
        reject(
          new Error(
            'Your browser cannot extract audio from video files (captureStream not supported). Try Chrome or Edge, or upload an audio file instead.'
          )
        );
        return;
      }

      const fullStream: MediaStream = captureFn.call(video);
      const audioTracks = fullStream.getAudioTracks();

      if (audioTracks.length === 0) {
        cleanupUrl();
        reject(new Error('This video does not seem to have an audio track.'));
        return;
      }

      const audioOnlyStream = new MediaStream(audioTracks);
      const recorder = new MediaRecorder(audioOnlyStream, { mimeType: 'audio/webm' });
      const chunks: Blob[] = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };
      recorder.onstop = () => {
        cleanupUrl();
        resolve(new Blob(chunks, { type: 'audio/webm' }));
      };
      recorder.onerror = (e: any) => {
        cleanupUrl();
        reject(e.error || new Error('Failed to record audio from video.'));
      };

      recorder.start();
      video.play().catch((err) => {
        recorder.stop();
        cleanupUrl();
        reject(err);
      });

      video.onended = () => recorder.stop();
    };

    video.onerror = () => {
      cleanupUrl();
      reject(new Error('Could not read the video file.'));
    };
  });
}