import { Component, OnInit, ViewChild, ChangeDetectorRef } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { CommonModule } from '@angular/common';
import { ApiService, Lecture } from '../trainer/api.service';
import { VideoPlayerComponent } from './video-player/video-player.component';
import { ChatSidebarComponent } from './chat-sidebar/chat-sidebar.component';

function extractYouTubeVideoId(url: string): string | null {
  // Matches:
  //   https://www.youtube.com/watch?v=VIDEO_ID
  //   https://youtu.be/VIDEO_ID
  //   https://www.youtube.com/embed/VIDEO_ID
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match) return match[1];
  }
  return null;
}

@Component({
  selector: 'app-lecture-page',
  standalone: true,
  imports: [CommonModule, VideoPlayerComponent, ChatSidebarComponent],
  templateUrl: './lecture-page.component.html',
  styleUrl: './lecture-page.component.scss',
})
export class LecturePageComponent implements OnInit {
  @ViewChild(VideoPlayerComponent) videoPlayer!: VideoPlayerComponent;

  lectureId: string = '';
  courseId: string = '';
  videoId: string = '';
  lecture: Lecture | undefined;
  loading = true;
  error: string | null = null;
  isPlayerReady = false;

  constructor(
    private route: ActivatedRoute,
    private api: ApiService,
    private cdr: ChangeDetectorRef,
  ) {}

  ngOnInit(): void {
    this.lectureId = this.route.snapshot.paramMap.get('lectureId') ?? '';
    this.courseId = this.route.snapshot.queryParamMap.get('courseId') ?? '';

    if (!this.courseId || !this.lectureId) {
      this.error = 'Missing course or lecture identifier.';
      this.loading = false;
      return;
    }

    this.api.getLectureById(this.courseId, this.lectureId).subscribe({
      next: (lecture) => {
        if (!lecture) {
          this.error = 'Lecture not found.';
        } else {
          this.lecture = lecture;
          this.videoId = extractYouTubeVideoId(lecture.video_url) ?? '';
        }
        this.loading = false;
        this.cdr.detectChanges();
      },
      error: () => {
        this.error = 'Failed to load lecture data.';
        this.loading = false;
        this.cdr.detectChanges();
      },
    });
  }

  onPlayerReady(): void {
    this.isPlayerReady = true;
  }

  onSeekRequest(seconds: number): void {
    this.videoPlayer.seekTo(seconds);
  }
}
