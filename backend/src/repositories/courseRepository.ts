import { supabaseClient } from '../db/supabase';
import { Course } from '../types';

export async function insertCourse(title: string): Promise<Course> {
  const { data, error } = await supabaseClient
    .from('courses')
    .insert({ title })
    .select()
    .single();

  if (error) throw error;
  return data as Course;
}

export async function getAllCourses(): Promise<Course[]> {
  const { data, error } = await supabaseClient
    .from('courses')
    .select('*');

  if (error) throw error;
  return (data ?? []) as Course[];
}
