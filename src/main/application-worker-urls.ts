export interface ApplicationWorkerUrls {
  legacyData: URL
  pocketTts: URL
  pronunciationAssessment: URL
  speechRecognition: URL
}

export function createApplicationWorkerUrls(baseUrl: string | URL): ApplicationWorkerUrls {
  return {
    legacyData: new URL('./legacy-data-worker.js', baseUrl),
    pocketTts: new URL('./pocket-tts-worker.js', baseUrl),
    pronunciationAssessment: new URL('./pronunciation-assessment-worker.js', baseUrl),
    speechRecognition: new URL('./qwen3-asr-worker.js', baseUrl)
  }
}
