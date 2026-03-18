import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DropdownComponent } from '../../ui/dropdown/dropdown.component';
import { BranchService } from '../../../services/branch.service';
import { SalesOrderService, BranchOption } from '../../../services/sales-order.service';
import { AuthService } from '../../../services/auth.service';

@Component({
  selector: 'app-branch-switcher',
  templateUrl: './branch-switcher.component.html',
  imports: [CommonModule, DropdownComponent],
})
export class BranchSwitcherComponent implements OnInit {
  isOpen = false;
  isLoading = false;
  branches: BranchOption[] = [];

  constructor(
    readonly branchService: BranchService,
    private readonly salesOrderService: SalesOrderService,
    private readonly authService: AuthService,
  ) {}

  ngOnInit(): void {
    void this.loadBranches();
  }

  get activeBranchName(): string {
    return this.branchService.getActiveBranchName();
  }

  get activeBranchId(): number | null {
    return this.branchService.getActiveBranchId();
  }

  get isLocked(): boolean {
    return this.branchService.isLocked;
  }

  get canSwitch(): boolean {
    return this.branchService.canSwitch;
  }

  get canSelectAllBranches(): boolean {
    return this.branchService.canSelectAllBranches;
  }

  toggleDropdown(): void {
    if (!this.canSwitch) return;
    this.isOpen = !this.isOpen;
  }

  closeDropdown(): void {
    this.isOpen = false;
  }

  async selectBranch(branch: BranchOption): Promise<void> {
    if (this.activeBranchId === branch.id) {
      this.closeDropdown();
      return;
    }

    this.branchService.setActiveBranch(branch);
    this.closeDropdown();

    try {
      await this.authService.refreshSession();
    } catch {
      // Ignore refresh failure and still reload so APIs re-run using latest branch context.
    }

    window.location.reload();
  }

  async selectAllBranches(): Promise<void> {
    if (!this.canSelectAllBranches) {
      this.closeDropdown();
      return;
    }

    if (this.activeBranchId === null) {
      this.closeDropdown();
      return;
    }

    this.branchService.setActiveBranch(null);
    this.closeDropdown();

    try {
      await this.authService.refreshSession();
    } catch {
      // Ignore refresh failure and still reload so APIs re-run using latest branch context.
    }

    window.location.reload();
  }

  private async loadBranches(): Promise<void> {
    this.isLoading = true;
    try {
      const data = await this.salesOrderService.getBranches();
      this.branches = data;
      this.branchService.initFromBranches(data);
    } catch {
      this.branches = [];
    } finally {
      this.isLoading = false;
    }
  }
}
