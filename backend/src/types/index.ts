export interface Course {
  id: string;
  title: string;
}

export interface Lecture {
  id: string;
  course_id: string;
  title: string;
  video_type: 'youtube' | 'upload';
  video_url: string;
  ingestion_status: 'pending' | 'processing' | 'ready' | 'failed';
}

export interface Chunk {
  id: string;
  lecture_id: string;
  course_id: string;
  text: string;
  embedding: number[];       // 768-dim
  timestamp_start: number;   // seconds
  timestamp_end: number;     // seconds
}

export interface SemanticCacheEntry {
  id: string;
  lecture_id: string;
  course_id: string;
  question_text: string;
  question_embedding: number[];  // 768-dim
  answer_text: string;
  created_at: string;            // ISO 8601
}

export interface Citation {
  timestamp: number;  // seconds
  url: string;        // deeplink: {video_url}&t={timestamp}s
}

export interface QuerySSEPayload {
  type: 'token' | 'citations' | 'done' | 'error';
  content?: string;           // type === 'token'
  items?: Citation[];         // type === 'citations'
  status?: number;            // type === 'error'
  message?: string;           // type === 'error'
}

export interface TranscriptSegment {
  text: string;
  start: number; // seconds (normalized)
}
