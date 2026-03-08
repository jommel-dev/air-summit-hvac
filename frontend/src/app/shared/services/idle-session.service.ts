import { Injectable, OnDestroy } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';
import { getAccessToken } from './auth-storage';

@Injectable({ providedIn: 'root' })
export class IdleSessionService implements OnDestroy {
  private readonly idleMs = 15 * 60 * 1000;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly activityEvents = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
  private started = false;
  private isPromptOpen = false;

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}

  start(): void {
    if (this.started || typeof window === 'undefined') {
      return;
    }

    this.started = true;
    this.activityEvents.forEach((eventName) =>
      window.addEventListener(eventName, this.onActivity, { passive: true }),
    );

    this.resetIdleTimer();
  }

  stop(): void {
    if (!this.started || typeof window === 'undefined') {
      return;
    }

    this.started = false;
    this.activityEvents.forEach((eventName) =>
      window.removeEventListener(eventName, this.onActivity),
    );

    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  ngOnDestroy(): void {
    this.stop();
  }

  private onActivity = (): void => {
    if (!this.started || this.isPromptOpen) {
      return;
    }

    this.resetIdleTimer();
  };

  private resetIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
    }

    this.idleTimer = setTimeout(() => {
      void this.handleIdleTimeout();
    }, this.idleMs);
  }

  private async handleIdleTimeout(): Promise<void> {
    if (this.isPromptOpen) {
      return;
    }

    if (!getAccessToken()) {
      this.resetIdleTimer();
      return;
    }

    this.isPromptOpen = true;
    const shouldContinue = window.confirm(
      'Your session is idle. Do you want to continue and refresh your session?',
    );

    if (!shouldContinue) {
      this.authService.logout();
      await this.router.navigateByUrl('/');
      this.isPromptOpen = false;
      return;
    }

    try {
      const refreshed = await this.authService.refreshSession();
      if (!refreshed.success) {
        this.authService.logout();
        await this.router.navigateByUrl('/');
      }
    } catch {
      this.authService.logout();
      await this.router.navigateByUrl('/');
    } finally {
      this.isPromptOpen = false;
      this.resetIdleTimer();
    }
  }
}
