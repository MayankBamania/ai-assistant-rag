import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface Citation {
  timestamp: number;
  url: string;
}

export interface QuerySSEPayload {
  type: 'token' | 'citations' | 'done' | 'error';
  content?: string;
  items?: Citation[];
  status?: number;
  message?: string;
}

/**
 * ChatService
 *
 * Encapsulates the SSE-over-fetch client for the RAG query endpoint.
 * Reconnect is intentionally NOT automatic — each generator call is
 * request-scoped and terminates when the stream ends, errors, or the
 * caller disposes of the generator.
 *
 * Requirements: 9.6, 9.7, 9.8
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  /**
   * Opens a streaming query to the backend and yields each parsed
   * `QuerySSEPayload` as it arrives.
   *
   * The caller drives consumption:
   *   for await (const payload of this.chatService.streamQuery(...)) { ... }
   *
   * To cancel mid-stream, call `return()` on the generator or break out of
   * the for-await loop — the underlying `ReadableStreamDefaultReader` is
   * cancelled automatically in the finally block.
   */
  async *streamQuery(
    courseId: string,
    lectureId: string,
    question: string,
  ): AsyncGenerator<QuerySSEPayload> {
    const url = new URL(`${environment.apiBaseUrl}/api/query`);
    url.searchParams.set('courseId', courseId);
    url.searchParams.set('lectureId', lectureId);
    url.searchParams.set('question', question);

    const response = await fetch(url.toString());

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is empty.');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? ''; // retain incomplete trailing line

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            try {
              const payload: QuerySSEPayload = JSON.parse(line.slice(6));
              yield payload;
            } catch {
              // Malformed JSON line — skip silently
            }
          }
        }
      }
    } finally {
      // Always release the reader lock, even if the caller breaks early
      reader.cancel();
    }
  }
}
