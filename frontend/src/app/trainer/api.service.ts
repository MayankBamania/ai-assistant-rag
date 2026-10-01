import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map, catchError } from 'rxjs/operators';
import { environment } from '../../environments/environment';

export interface Course {
  id: string;
  title: string;
}

export interface Lecture {
  id: string;
  course_id: string;
  title: string;
  video_type: string;
  video_url: string;
  ingestion_status: 'pending' | 'processing' | 'ready' | 'failed';
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private base = environment.apiBaseUrl;

  getCourses(): Observable<{ courses: Course[] }> {
    return this.http.get<{ courses: Course[] }>(`${this.base}/api/courses`);
  }

  createCourse(title: string): Observable<Course> {
    return this.http.post<Course>(`${this.base}/api/courses`, { title });
  }

  getLectures(courseId: string): Observable<{ lectures: Lecture[] }> {
    return this.http.get<{ lectures: Lecture[] }>(`${this.base}/api/courses/${courseId}/lectures`);
  }

  createLecture(courseId: string, title: string, youtubeUrl: string): Observable<Lecture> {
    return this.http.post<Lecture>(`${this.base}/api/courses/${courseId}/lectures`, { title, youtubeUrl });
  }

  getLectureStatus(courseId: string, lectureId: string): Observable<{ lectureId: string; ingestionStatus: string }> {
    return this.http.get<{ lectureId: string; ingestionStatus: string }>(
      `${this.base}/api/courses/${courseId}/lectures/${lectureId}/status`
    );
  }

  triggerIngest(courseId: string, lectureId: string, youtubeUrl: string): Observable<{ lectureId: string; status: string }> {
    return this.http.post<{ lectureId: string; status: string }>(`${this.base}/api/ingest`, {
      courseId,
      lectureId,
      youtubeUrl,
    });
  }

  getLectureById(courseId: string, lectureId: string): Observable<Lecture | undefined> {
    return this.getLectures(courseId).pipe(
      map(res => (res?.lectures ?? []).find(l => l.id === lectureId)),
      catchError(err => {
        console.error('[ApiService] getLectureById error:', err);
        // Re-throw so the component's error handler fires instead of hanging
        throw err;
      })
    );
  }

  constructor(private http: HttpClient) {}
}
