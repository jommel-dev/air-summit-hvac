import { Component, ElementRef, HostListener, ViewChild } from '@angular/core';
import { SidebarService } from '../../services/sidebar.service';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { ThemeToggleButtonComponent } from '../../components/common/theme-toggle/theme-toggle-button.component';
import { UserDropdownComponent } from '../../components/header/user-dropdown/user-dropdown.component';
import { BranchSwitcherComponent } from '../../components/header/branch-switcher/branch-switcher.component';
import { apiClient } from '../../services/api-client';

type HeaderSearchType = 'serial' | 'sales-order' | 'purchase-order';

interface HeaderSearchHit {
  type: HeaderSearchType;
  id: number;
  title: string;
  subtitle: string;
}

@Component({
    selector: 'app-header',
    imports: [
        CommonModule,
        FormsModule,
        RouterModule,
        ThemeToggleButtonComponent,
        UserDropdownComponent,
        BranchSwitcherComponent,
    ],
    templateUrl: './app-header.component.html',
})
export class AppHeaderComponent {
    isApplicationMenuOpen = false;
    readonly isMobileOpen$;

    searchValue = '';
    isDropdownOpen = false;
    isSearching = false;
    serialHits: HeaderSearchHit[] = [];
    salesOrderHits: HeaderSearchHit[] = [];
    purchaseOrderHits: HeaderSearchHit[] = [];
    activeIndex = -1;

    @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;
    @ViewChild('headerSearch') headerSearch?: ElementRef<HTMLElement>;

    private searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    private searchRequestId = 0;

    constructor(
        public sidebarService: SidebarService,
        private readonly router: Router,
    ) {
        this.isMobileOpen$ = this.sidebarService.isMobileOpen$;
    }

    get allHits(): HeaderSearchHit[] {
        return [...this.serialHits, ...this.salesOrderHits, ...this.purchaseOrderHits];
    }

    get hasHits(): boolean {
        return this.allHits.length > 0;
    }

    handleToggle() {
        if (window.innerWidth >= 1280) {
            this.sidebarService.toggleExpanded();
        } else {
            this.sidebarService.toggleMobileOpen();
        }
    }

    toggleApplicationMenu() {
        this.isApplicationMenuOpen = !this.isApplicationMenuOpen;
    }

    goToSerialSearch(): void {
        this.router.navigate(['/users/serial-global-search']);
    }

    onSearchInput(): void {
        const query = this.searchValue.trim();
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }

        if (query.length < 2 || this.looksLikeBulk(query)) {
            this.resetHits();
            this.isDropdownOpen = false;
            this.isSearching = false;
            return;
        }

        this.isDropdownOpen = true;
        this.searchDebounceTimer = setTimeout(() => {
            void this.runGlobalSearch(query);
            this.searchDebounceTimer = null;
        }, 250);
    }

    onSearchFocus(): void {
        if (this.searchValue.trim().length >= 2 && !this.looksLikeBulk(this.searchValue)) {
            this.isDropdownOpen = true;
        }
    }

    async onHeaderSearch(event: Event): Promise<void> {
        event.preventDefault();
        const query = this.searchValue.trim();
        if (!query) {
            return;
        }

        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
            this.searchDebounceTimer = null;
        }

        if (this.looksLikeBulk(query)) {
            this.navigateAndClear(['/users/serial-global-search'], { q: query, mode: 'bulk' });
            return;
        }

        if (query.length < 2) {
            return;
        }

        await this.runGlobalSearch(query);

        const best = this.pickBestMatch(query);
        if (best) {
            this.openResult(best);
            return;
        }

        if (this.looksLikeSalesOrder(query)) {
            this.navigateAndClear(['/users/sales-order'], { search: query });
            return;
        }

        if (this.looksLikePurchaseOrder(query)) {
            this.navigateAndClear(['/users/purchase-order'], { search: query, tab: 'master-data' });
            return;
        }

        this.navigateAndClear(['/users/serial-global-search'], { q: query });
    }

    openResult(hit: HeaderSearchHit): void {
        if (hit.type === 'serial') {
            this.navigateAndClear(['/users/serial-global-search'], { q: hit.title });
            return;
        }

        if (hit.type === 'sales-order') {
            this.navigateAndClear(['/users/sales-order'], {
                search: hit.title,
                viewId: String(hit.id),
            });
            return;
        }

        this.navigateAndClear(['/users/purchase-order'], {
            search: hit.title,
            tab: 'master-data',
            editId: String(hit.id),
        });
    }

    onSearchKeydown(event: KeyboardEvent): void {
        if (!this.isDropdownOpen || !this.hasHits) {
            return;
        }

        if (event.key === 'ArrowDown') {
            event.preventDefault();
            this.activeIndex = Math.min(this.activeIndex + 1, this.allHits.length - 1);
            return;
        }

        if (event.key === 'ArrowUp') {
            event.preventDefault();
            this.activeIndex = Math.max(this.activeIndex - 1, 0);
            return;
        }

        if (event.key === 'Escape') {
            event.preventDefault();
            this.isDropdownOpen = false;
        }
    }

    ngAfterViewInit() {
        document.addEventListener('keydown', this.handleKeyDown);
    }

    ngOnDestroy() {
        document.removeEventListener('keydown', this.handleKeyDown);
        if (this.searchDebounceTimer) {
            clearTimeout(this.searchDebounceTimer);
        }
    }

    handleKeyDown = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
            event.preventDefault();
            this.searchInput?.nativeElement.focus();
        }
    };

    @HostListener('document:click', ['$event'])
    onDocumentClick(event: MouseEvent): void {
        const target = event.target as Node | null;
        if (this.headerSearch?.nativeElement.contains(target)) {
            return;
        }
        this.isDropdownOpen = false;
    }

    private async runGlobalSearch(query: string): Promise<void> {
        const requestId = ++this.searchRequestId;
        this.isSearching = true;
        this.isDropdownOpen = true;

        try {
            const [serialResponse, salesResponse, purchaseResponse] = await Promise.allSettled([
                apiClient.get<{ success?: boolean; items?: Array<{
                    id: number;
                    serialNumber?: string;
                    status?: string | null;
                    brandName?: string | null;
                    productName?: string | null;
                }> }>('/serial-number/global-search', {
                    params: { search: query, page: 1, pageSize: 5 },
                }),
                apiClient.get<{ success?: boolean; items?: Array<{
                    id: number;
                    soNumber?: string;
                    customerName?: string;
                    status?: string;
                }> }>('/sales-order', {
                    params: { search: query, page: 1, limit: 5 },
                }),
                apiClient.get<{ success?: boolean; items?: Array<{
                    id: number;
                    poNumber?: string;
                    vendorName?: string;
                    status?: string;
                }> }>('/purchase', {
                    params: { search: query, page: 1, limit: 5 },
                }),
            ]);

            if (requestId !== this.searchRequestId) {
                return;
            }

            this.serialHits = serialResponse.status === 'fulfilled'
                ? (serialResponse.value.data.items ?? []).map((item) => ({
                    type: 'serial' as const,
                    id: item.id,
                    title: String(item.serialNumber ?? '').trim(),
                    subtitle: [item.brandName, item.productName, item.status].filter(Boolean).join(' · ') || 'Serial number',
                })).filter((item) => item.title)
                : [];

            this.salesOrderHits = salesResponse.status === 'fulfilled'
                ? (salesResponse.value.data.items ?? []).map((item) => ({
                    type: 'sales-order' as const,
                    id: item.id,
                    title: String(item.soNumber ?? '').trim() || `SO #${item.id}`,
                    subtitle: [item.customerName, item.status].filter(Boolean).join(' · ') || 'Sales order',
                }))
                : [];

            this.purchaseOrderHits = purchaseResponse.status === 'fulfilled'
                ? (purchaseResponse.value.data.items ?? []).map((item) => ({
                    type: 'purchase-order' as const,
                    id: item.id,
                    title: String(item.poNumber ?? '').trim() || `PO #${item.id}`,
                    subtitle: [item.vendorName, item.status].filter(Boolean).join(' · ') || 'Purchase order',
                }))
                : [];

            this.activeIndex = this.hasHits ? 0 : -1;
        } catch {
            if (requestId !== this.searchRequestId) {
                return;
            }
            this.resetHits();
        } finally {
            if (requestId === this.searchRequestId) {
                this.isSearching = false;
            }
        }
    }

    private pickBestMatch(query: string): HeaderSearchHit | null {
        const hits = this.allHits;
        if (hits.length === 0) {
            return null;
        }

        const normalized = query.toLowerCase();
        const exactMatches = hits.filter((hit) => hit.title.toLowerCase() === normalized);
        if (exactMatches.length === 1) {
            return exactMatches[0];
        }

        if (exactMatches.length > 1) {
            if (this.looksLikeSalesOrder(query)) {
                return exactMatches.find((hit) => hit.type === 'sales-order') ?? exactMatches[0];
            }
            if (this.looksLikePurchaseOrder(query)) {
                return exactMatches.find((hit) => hit.type === 'purchase-order') ?? exactMatches[0];
            }
            return exactMatches.find((hit) => hit.type === 'serial') ?? exactMatches[0];
        }

        if (this.activeIndex >= 0 && hits[this.activeIndex]) {
            return hits[this.activeIndex];
        }

        if (this.looksLikeSalesOrder(query) && this.salesOrderHits[0]) {
            return this.salesOrderHits[0];
        }

        if (this.looksLikePurchaseOrder(query) && this.purchaseOrderHits[0]) {
            return this.purchaseOrderHits[0];
        }

        return hits[0];
    }

    private navigateAndClear(commands: string[], queryParams: Record<string, string>): void {
        this.router.navigate(commands, { queryParams });
        this.clearSearch();
    }

    private clearSearch(): void {
        this.searchValue = '';
        this.isDropdownOpen = false;
        this.isSearching = false;
        this.activeIndex = -1;
        this.resetHits();
        if (this.searchInput?.nativeElement) {
            this.searchInput.nativeElement.value = '';
        }
    }

    private resetHits(): void {
        this.serialHits = [];
        this.salesOrderHits = [];
        this.purchaseOrderHits = [];
    }

    private looksLikeBulk(query: string): boolean {
        return /[,;\n\t]/.test(query);
    }

    private looksLikeSalesOrder(query: string): boolean {
        return /^so[-_\s]?\d+/i.test(query.trim());
    }

    private looksLikePurchaseOrder(query: string): boolean {
        return /^po[-_\s]?\d+/i.test(query.trim());
    }
}
