import { supabaseClient } from '../db/supabase';
import { Lecture } from '../types';

export interface InsertLectureData {
  course_id: string;
  title: string;
  video_type: string;
  video_url: string;
}

/**
 * Inserts a new lecture row with `ingestion_status` defaulting to `'pending'`.
 * Returns the full inserted row.
 *
 * Satisfies Requirements 2.2, 11.7.
 */
export async function insertLecture(data: InsertLectureData): Promise<Lecture> {
  const { data: row, error } = await supabaseClient
    .from('lectures')
    .insert({ ...data, ingestion_status: 'pending' })
    .select()
    .single();

  if (error) throw error;
  return row as Lecture;
}

/**
 * Returns all lectures belonging to the specified course.
 *
 * Satisfies Requirements 11.5.
 */
export async function getLecturesByCourse(courseId: string): Promise<Lecture[]> {
  const { data, error } = await supabaseClient
    .from('lectures')
    .select('*')
    .eq('course_id', courseId);

  if (error) throw error;
  return (data ?? []) as Lecture[];
}

/**
 * Returns the `ingestion_status` string for the given lecture.
 * Throws if the lecture does not exist.
 *
 * Satisfies Requirements 11.8.
 */
export async function getLectureStatus(lectureId: string): Promise<string> {
  const { data, error } = await supabaseClient
    .from('lectures')
    .select('ingestion_status')
    .eq('id', lectureId)
    .maybeSingle();

  if (error) throw error;
  if (!data) throw new Error(`Lecture not found: ${lectureId}`);
  return (data as { ingestion_status: string }).ingestion_status;
}

/**
 * Updates the `ingestion_status` of a lecture.
 *
 * Satisfies Requirements 2.2.
 */
export async function updateIngestionStatus(lectureId: string, status: string): Promise<void> {
  const { error } = await supabaseClient
    .from('lectures')
    .update({ ingestion_status: status })
    .eq('id', lectureId);

  if (error) throw error;
}

/**
 * Returns the full lecture row for the given lecture ID.
 * Throws if the lecture does not exist.
 *
 * Used by `ragQueryService` to obtain `video_url` for citation deeplinks.
 *
 * Satisfies Requirements 8.1, 8.2.
 */
export async function getLectureById(lectureId: string): Promise<Lecture> {
  const { data, error } = await supabaseClient
    .from('lectures')
    .select('*')
    .eq('id', lectureId)
    .single();

  if (error) throw error;
  return data as Lecture;
}
