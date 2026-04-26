export enum RepetitionErrorCode {
  ITEMS_LOAD_FAILED = 'ITEMS_LOAD_FAILED',
  STT_FAILED = 'STT_FAILED',
  SAVE_FAILED = 'SAVE_FAILED',
  FILE_NOT_FOUND = 'FILE_NOT_FOUND',
}

export class RepetitionError extends Error {
  constructor(public code: RepetitionErrorCode, message: string) {
    super(message);
    this.name = 'RepetitionError';
  }
}
