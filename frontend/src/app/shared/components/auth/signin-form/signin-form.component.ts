
import { Component } from '@angular/core';
import { LabelComponent } from '../../form/label/label.component';
import { CheckboxComponent } from '../../form/input/checkbox.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { InputFieldComponent } from '../../form/input/input-field.component';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../services/auth.service';
import axios from 'axios';

@Component({
  selector: 'app-signin-form',
  imports: [
    LabelComponent,
    CheckboxComponent,
    ButtonComponent,
    InputFieldComponent,
    RouterModule,
    FormsModule
],
  templateUrl: './signin-form.component.html',
  styles: ``
})
export class SigninFormComponent {
  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
  ) {}

  showPassword = false;
  isChecked = false;

  username = '';
  password = '';
  isSubmitting = false;
  errorMessage = '';

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  async onSignIn() {
    if (this.isSubmitting) {
      return;
    }

    this.errorMessage = '';
    this.isSubmitting = true;

    try {
      const result = await this.authService.login(this.username, this.password, this.isChecked);

      if (!result.success) {
        this.errorMessage = result.message ?? 'Invalid username or password';
        return;
      }

      await this.router.navigateByUrl('/users/dashboard');
    } catch (error) {
      if (axios.isAxiosError(error)) {
        this.errorMessage =
          (error.response?.data as { message?: string } | undefined)?.message ??
          'Unable to reach backend API';
      } else {
        this.errorMessage = 'Unexpected error during sign in';
      }
    } finally {
      this.isSubmitting = false;
    }
  }
}
