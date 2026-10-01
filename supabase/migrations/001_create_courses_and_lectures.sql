-- Migration 001: Enable pgvector and create courses and lectures tables
-- Requirements: 1.1, 1.2, 1.3, 1.12

-- Enable pgvector extension for vector similarity search
CREATE EXTENSION IF NOT EXISTS vector;

-- Courses table
CREATE TABLE courses (
  id    uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  title text NOT NULL
);

-- Lectures table
CREATE TABLE lectures (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  course_id        uuid NOT NULL REFERENCES courses(id) ON DELETE CASCADE,
  title            text NOT NULL,
  video_type       text NOT NULL,
  video_url        text NOT NULL,
  ingestion_status text NOT NULL
);

-- Constrain ingestion_status to known values
ALTER TABLE lectures
  ADD CONSTRAINT lectures_ingestion_status_check
  CHECK (ingestion_status IN ('pending', 'processing', 'ready', 'failed'));
