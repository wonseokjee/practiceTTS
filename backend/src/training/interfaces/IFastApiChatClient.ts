/** FastAPI /chat 엔드포인트 요청 타입 */
export interface ChatRequest {
  session_id: string;
  user_message: string;
  hint_level: 0 | 1 | 2;
  memory_entry_id: string;
}

/** FastAPI /chat 엔드포인트 응답 타입 */
export interface ChatResponse {
  session_id: string;
  ai_message: string;
  hint_triggered: boolean;
  hint_level: number;
}

/**
 * FastAPI chat 클라이언트 인터페이스
 * 테스트 시 MockFastApiChatClient로 교체 가능
 */
export interface IFastApiChatClient {
  chat(request: ChatRequest): Promise<ChatResponse>;
}
