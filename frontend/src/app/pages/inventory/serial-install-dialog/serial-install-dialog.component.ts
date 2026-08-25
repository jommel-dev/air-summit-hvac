import { Component, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { apiClient } from '../../../shared/services/api-client';
import { NotificationService } from '../../../shared/services/notification.service';

export interface ValidationResponse {
  success: boolean;
  message: string;
  existing: string[];
  nonExisting: string[];
  updated: number;
}

@Component({
  selector: 'app-serial-install-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './serial-install-dialog.component.html',
  styleUrls: ['./serial-install-dialog.component.css'],
})
export class SerialInstallDialogComponent {
  // UI state
  currentStep = signal<'upload' | 'preview' | 'results'>('upload');
  isLoading = signal<boolean>(false);
  isDialogOpen = signal<boolean>(false);

  // Upload state
  uploadMode = signal<'file' | 'text'>('file');
  textInput = signal<string>('');
  csvFile = signal<File | null>(null);
  parseError = signal<string>('');

  // Preview/Results state
  parsedSerials = signal<string[]>([]);
  validationResult = signal<ValidationResponse | null>(null);
  installPassword = signal<string>('');
  installPasswordError = signal<string>('');

  // Computed values
  serialCount = computed(() => this.parsedSerials().length);
  existingCount = computed(() => this.validationResult()?.existing.length ?? 0);
  nonExistingCount = computed(() => this.validationResult()?.nonExisting.length ?? 0);
  updatedCount = computed(() => this.validationResult()?.updated ?? 0);

  showResults = computed(() => this.currentStep() === 'results' && this.validationResult() !== null);
  showPreview = computed(() => this.currentStep() === 'preview' && this.parsedSerials().length > 0);

  constructor(private notificationService: NotificationService) {}

  /**
   * Open the dialog
   */
  open() {
    this.isDialogOpen.set(true);
    this.resetState();
  }

  /**
   * Close the dialog
   */
  close() {
    this.isDialogOpen.set(false);
    this.resetState();
  }

  /**
   * Reset all state to initial values
   */
  private resetState() {
    this.currentStep.set('upload');
    this.uploadMode.set('file');
    this.textInput.set('');
    this.csvFile.set(null);
    this.parseError.set('');
    this.parsedSerials.set([]);
    this.validationResult.set(null);
    this.installPassword.set('');
    this.installPasswordError.set('');
    this.isLoading.set(false);
  }

  /**
   * Handle file selection
   */
  onFileSelected(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    if (file.type !== 'text/csv' && !file.name.endsWith('.csv')) {
      this.parseError.set('Please select a CSV file');
      return;
    }

    this.csvFile.set(file);
    this.parseError.set('');
  }

  /**
   * Parse CSV content into serial numbers
   */
  private parseSerialNumbers(content: string): string[] {
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('#'));

    return lines.map((line) => {
      // Handle CSV format: if it has commas, take the first column
      const parts = line.split(',');
      return parts[0].trim();
    });
  }

  /**
   * Proceed from upload step to preview
   */
  async onProceedToPreview() {
    this.parseError.set('');
    let serialNumbers: string[] = [];

    try {
      if (this.uploadMode() === 'file') {
        const file = this.csvFile();
        if (!file) {
          this.parseError.set('Please select a CSV file');
          return;
        }

        const content = await this.readFileAsText(file);
        serialNumbers = this.parseSerialNumbers(content);
      } else {
        const text = this.textInput();
        if (!text.trim()) {
          this.parseError.set('Please enter serial numbers (one per line)');
          return;
        }

        serialNumbers = this.parseSerialNumbers(text);
      }

      if (serialNumbers.length === 0) {
        this.parseError.set('No serial numbers found in input');
        return;
      }

      this.parsedSerials.set(serialNumbers);
      this.currentStep.set('preview');
    } catch (error) {
      this.parseError.set(`Error parsing file: ${String(error)}`);
    }
  }

  /**
   * Go back from preview to upload
   */
  onBackToUpload() {
    this.currentStep.set('upload');
    this.parsedSerials.set([]);
    this.validationResult.set(null);
  }

  /**
   * Submit the validation request to backend
   */
  async onConfirmValidation() {
    const serials = this.parsedSerials();
    if (serials.length === 0) {
      this.notificationService.error('Error', 'No serial numbers to validate');
      return;
    }

    const password = this.installPassword().trim();
    if (!password) {
      this.installPasswordError.set('Password is required to mark serials as installed.');
      return;
    }

    this.installPasswordError.set('');
    this.isLoading.set(true);

    try {
      const response = await apiClient.post<ValidationResponse>(
        '/serial-number/bulk-install-with-validation',
        { serialNumbers: serials, password },
      );

      this.validationResult.set(response.data);
      this.currentStep.set('results');
      this.installPassword.set('');

      if (response.data.success) {
        this.notificationService.success('Success', response.data.message);
      } else {
        this.notificationService.error('Error', response.data.message);
      }
    } catch (error: any) {
      const errorMessage =
        error?.response?.data?.message ?? String(error);
      this.installPasswordError.set(errorMessage);
      this.notificationService.error('Error', `Validation failed: ${errorMessage}`);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Close dialog after results
   */
  onCloseAfterResults() {
    this.close();
  }

  /**
   * Read file as text
   */
  private readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error('Failed to read file'));
      reader.readAsText(file);
    });
  }
}
