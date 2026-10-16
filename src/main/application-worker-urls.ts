/** 主进程业务服务使用的后台工作线程脚本地址。 */
export interface ApplicationWorkerUrls {
  legacyData: URL
  pocketTts: URL
  pronunciationAssessment: URL
  speechRecognition: URL
}

/** 相对调用方模块定位构建后的脚本，统一各服务的工作线程入口。 */
export function createApplicationWorkerUrls(baseUrl: string | URL): ApplicationWorkerUrls {
  return {
    legacyData: new URL('./legacy-data-worker.js', baseUrl),
    pocketTts: new URL('./pocket-tts-worker.js', baseUrl),
    pronunciationAssessment: new URL('./pronunciation-assessment-worker.js', baseUrl),
    speechRecognition: new URL('./qwen3-asr-worker.js', baseUrl)
  }
}
