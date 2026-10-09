export function encode(chunks, sampleRate) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./encode-worker.js', import.meta.url), { type: 'module' });
    const timer = setTimeout(() => {
      worker.terminate();
      reject(new Error('Audio export timed out.'));
    }, 60000);
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(new Blob([data.buffer], { type: 'audio/wav' }));
    };
    worker.onerror = () => {
      finish();
      reject(new Error('Audio export failed.'));
    };
    worker.postMessage(
      { chunks, sampleRate },
      chunks.map((chunk) => chunk.buffer),
    );
  });
}
