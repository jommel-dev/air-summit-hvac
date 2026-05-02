import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import axios from 'axios';

const appEnv = (import.meta as any).env;
const configuredApiBaseUrl = String(appEnv?.['NG_APP_API_BASE_URL'] ?? '').trim();
const isLocalHost = typeof window !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const API_BASE = configuredApiBaseUrl || (isLocalHost ? 'http://localhost:3000' : 'https://air-summit-backend-ewbho.ondigitalocean.app');

@Component({
  selector: 'app-feedback',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './feedback.component.html',
})
export class FeedbackComponent implements OnInit {
  businessName = signal<string>('');
  businessLogo = signal<string>('');

  rating = signal<number>(0);
  hoveredRating = signal<number>(0);
  wouldRecommend = signal<boolean | null>(null);
  insights = signal<string>('');
  name = signal<string>('');

  submitting = signal<boolean>(false);
  submitted = signal<boolean>(false);
  errorMsg = signal<string>('');

  summary = signal<{ total: number; avgRating: number; recommendPercent: number } | null>(null);

  readonly stars = [1, 2, 3, 4, 5];

  readonly ratingLabels: Record<number, string> = {
    1: 'Poor',
    2: 'Fair',
    3: 'Good',
    4: 'Very Good',
    5: 'Excellent',
  };

  readonly ratingEmojis: Record<number, string> = {
    1: '😞',
    2: '😐',
    3: '🙂',
    4: '😊',
    5: '🤩',
  };

  ngOnInit() {
    this.loadBusinessProfile();
    this.loadSummary();
  }

  async loadBusinessProfile() {
    try {
      const res = await axios.get(`${API_BASE}/settings/public/business-profile`);
      const item = res.data.item;
      if (item) {
        this.businessName.set(item.businessName ?? '');
        this.businessLogo.set(item.businessLogo ?? item.businessLogoLight ?? '');
      }
    } catch {}
  }

  async loadSummary() {
    try {
      const res = await axios.get(`${API_BASE}/public/feedback/summary`);
      if (res.data.success) this.summary.set(res.data.data);
    } catch {}
  }

  setRating(value: number) {
    this.rating.set(value);
  }

  displayRating() {
    return this.hoveredRating() || this.rating();
  }

  async submit() {
    this.errorMsg.set('');
    if (this.rating() < 1) return this.errorMsg.set('Please select a rating.');
    if (this.wouldRecommend() === null) return this.errorMsg.set('Please tell us if you would recommend us.');

    this.submitting.set(true);
    try {
      const res = await axios.post(`${API_BASE}/public/feedback`, {
        rating: this.rating(),
        wouldRecommend: this.wouldRecommend(),
        insights: this.insights().trim() || undefined,
        name: this.name().trim() || undefined,
      });
      if (res.data.success) {
        this.submitted.set(true);
        this.loadSummary();
      } else {
        this.errorMsg.set(res.data.message ?? 'Submission failed.');
      }
    } catch (err: any) {
      this.errorMsg.set(err?.response?.data?.message ?? 'An error occurred. Please try again.');
    } finally {
      this.submitting.set(false);
    }
  }

  resetForm() {
    this.rating.set(0);
    this.hoveredRating.set(0);
    this.wouldRecommend.set(null);
    this.insights.set('');
    this.name.set('');
    this.submitted.set(false);
    this.errorMsg.set('');
  }

  renderStars(avg: number): string[] {
    return this.stars.map(s => {
      if (s <= Math.floor(avg)) return 'full';
      if (s - avg < 1 && s - avg > 0) return 'half';
      return 'empty';
    });
  }
}
