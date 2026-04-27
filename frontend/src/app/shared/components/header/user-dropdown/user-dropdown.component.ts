import { Component, ChangeDetectorRef } from '@angular/core';
import { DropdownComponent } from '../../ui/dropdown/dropdown.component';
import { CommonModule } from '@angular/common';
import { Router, RouterModule } from '@angular/router';

import { AuthService } from '../../../services/auth.service';
import { RbacService } from '../../../services/rbac.service';
import { UserManagementService } from '../../../services/user-management.service';
import { FormsModule } from '@angular/forms';
import { ModalComponent } from '../../ui/modal/modal.component';
import { InputFieldComponent } from '../../form/input/input-field.component';
import { ButtonComponent } from '../../ui/button/button.component';
import { LabelComponent } from '../../form/label/label.component';

@Component({
  selector: 'app-user-dropdown',
  templateUrl: './user-dropdown.component.html',
  imports: [
    CommonModule,
    RouterModule,
    DropdownComponent,

    FormsModule,
    ModalComponent,
    InputFieldComponent,
    ButtonComponent,
    LabelComponent,
  ],
})
export class UserDropdownComponent {
  readonly defaultAvatar = '/images/user/faceless-avatar.svg';

  isOpen = false;
  isEditModalOpen = false;
  activeTab: 'personal' | 'password' = 'personal';
  isLoading = false;

  userProfile = {
    fullname: '',
    email: '',
    contact: '',
    address: '',
    birthdate: '',
  };

  passwordData = {
    newPassword: '',
    confirmPassword: '',
  };

  constructor(
    private readonly authService: AuthService,
    private readonly router: Router,
    private readonly rbacService: RbacService,
    private readonly userManagementService: UserManagementService,
    private readonly cdr: ChangeDetectorRef
  ) {}

  toggleDropdown() {
    this.isOpen = !this.isOpen;
  }

  closeDropdown() {
    this.isOpen = false;
  }

  get displayName(): string {
    return this.rbacService.getDisplayName();
  }

  get email(): string {
    return this.rbacService.getEmail();
  }

  async onSignOut() {
    this.authService.logout();
    this.closeDropdown();
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }

  async openEditProfile() {
    this.closeDropdown();
    this.activeTab = 'personal';
    this.passwordData = { newPassword: '', confirmPassword: '' };
    this.isEditModalOpen = true;

    const userId = this.rbacService.getUserId();
    if (userId) {
      try {
        const res = await this.userManagementService.getUserById(userId);
        if (res.success && res.data) {
          let bd = res.data.birthdate || '';
          if (bd && bd.includes('T')) {
            bd = bd.split('T')[0];
          }
          this.userProfile = {
            fullname: res.data.fullname || res.data.fullName || res.data.full_name || '',
            email: res.data.email || '',
            contact: res.data.contact || '',
            address: res.data.address || '',
            birthdate: bd,
          };
          this.cdr.detectChanges();
        }
      } catch (err) {
        console.error('Failed to load user profile', err);
      }
    }
  }

  closeEditProfile() {
    this.isEditModalOpen = false;
  }

  async saveProfile() {
    const userId = this.rbacService.getUserId();
    if (!userId) return;

    this.isLoading = true;
    try {
      if (this.activeTab === 'personal') {
        const payload = {
          fullname: this.userProfile.fullname,
          email: this.userProfile.email,
          contact: this.userProfile.contact,
          address: this.userProfile.address,
          birthdate: this.userProfile.birthdate,
        };
        const res = await this.userManagementService.updateUser(userId, payload);
        if (res.success) {
          // Profile updated
          this.closeEditProfile();
        } else {
          console.error(res.message);
          alert(res.message || 'Failed to update profile');
        }
      } else if (this.activeTab === 'password') {
        if (!this.passwordData.newPassword) {
          alert('New password is required');
          this.isLoading = false;
          return;
        }
        if (this.passwordData.newPassword !== this.passwordData.confirmPassword) {
          alert('Passwords do not match');
          this.isLoading = false;
          return;
        }
        const payload = {
          password: this.passwordData.newPassword,
        };
        const res = await this.userManagementService.updateUser(userId, payload);
        if (res.success) {
          alert('Password changed successfully');
          this.closeEditProfile();
        } else {
          console.error(res.message);
          alert(res.message || 'Failed to change password');
        }
      }
    } catch (err) {
      console.error('Error updating user', err);
      alert('An error occurred while saving.');
    } finally {
      this.isLoading = false;
    }
  }
}
