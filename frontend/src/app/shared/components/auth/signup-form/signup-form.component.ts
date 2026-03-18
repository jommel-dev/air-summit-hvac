import { Component, OnInit } from '@angular/core';
import { LabelComponent } from '../../form/label/label.component';
import { CheckboxComponent } from '../../form/input/checkbox.component';
import { InputFieldComponent } from '../../form/input/input-field.component';
import { RouterModule } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { SalesOrderService, BranchOption } from '../../../services/sales-order.service';


@Component({
  selector: 'app-signup-form',
  imports: [
    CommonModule,
    LabelComponent,
    CheckboxComponent,
    InputFieldComponent,
    RouterModule,
    FormsModule
],
  templateUrl: './signup-form.component.html',
  styles: ``
})
export class SignupFormComponent implements OnInit {

  showPassword = false;
  isChecked = false;
  isLoadingBranches = false;
  branchOptions: BranchOption[] = [];

  fname = '';
  lname = '';
  email = '';
  password = '';
  branchId: number | '' = '';

  constructor(private readonly salesOrderService: SalesOrderService) {}

  ngOnInit(): void {
    void this.loadBranches();
  }

  togglePasswordVisibility() {
    this.showPassword = !this.showPassword;
  }

  onSignIn() {
    console.log('First Name:', this.fname);
    console.log('Last Name:', this.lname);
    console.log('Email:', this.email);
    console.log('Password:', this.password);
    console.log('Branch ID:', this.branchId);
    console.log('Remember Me:', this.isChecked);
  }

  private async loadBranches(): Promise<void> {
    this.isLoadingBranches = true;
    try {
      this.branchOptions = await this.salesOrderService.getBranches();
    } catch {
      this.branchOptions = [];
    } finally {
      this.isLoadingBranches = false;
    }
  }
}
