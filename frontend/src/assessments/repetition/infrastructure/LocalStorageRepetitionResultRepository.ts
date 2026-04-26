import type { IRepetitionResultRepository, RepetitionResult } from '../domain/RepetitionTypes';

export class LocalStorageRepetitionResultRepository implements IRepetitionResultRepository {
  private readonly STORAGE_KEY = 'practiveTTS_repetition_results';

  async saveResult(sessionId: string, result: RepetitionResult): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        const data = localStorage.getItem(this.STORAGE_KEY);
        const parsedMap = data ? JSON.parse(data) : {};
        
        if (!parsedMap[sessionId]) {
          parsedMap[sessionId] = [];
        }
        
        const sessionResults = parsedMap[sessionId] as RepetitionResult[];
        const existingIdx = sessionResults.findIndex(r => r.itemId === result.itemId);
        
        if (existingIdx >= 0) {
          sessionResults[existingIdx] = result; // 덮어쓰기
        } else {
          sessionResults.push(result);
        }

        parsedMap[sessionId] = sessionResults;
        localStorage.setItem(this.STORAGE_KEY, JSON.stringify(parsedMap));
        resolve();
      } catch (e) {
        console.error('Failed to save result to LocalStorage', e);
        reject(e);
      }
    });
  }

  async getResultsBySession(sessionId: string): Promise<RepetitionResult[]> {
    return new Promise((resolve) => {
      try {
        const data = localStorage.getItem(this.STORAGE_KEY);
        const parsedMap = data ? JSON.parse(data) : {};
        resolve(parsedMap[sessionId] || []);
      } catch (e) {
        resolve([]);
      }
    });
  }
}
