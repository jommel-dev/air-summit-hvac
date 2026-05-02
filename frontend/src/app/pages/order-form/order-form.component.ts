import { Component, OnInit, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import axios from 'axios';
import { DatePickerComponent } from '../../shared/components/form/date-picker/date-picker.component';

const appEnv = (import.meta as any).env;
const configuredApiBaseUrl = String(appEnv?.['NG_APP_API_BASE_URL'] ?? '').trim();
const isLocalHost = typeof window !== 'undefined' && (location.hostname === 'localhost' || location.hostname === '127.0.0.1');
const API_BASE = configuredApiBaseUrl || (isLocalHost ? 'http://localhost:3000' : 'https://air-summit-backend-ewbho.ondigitalocean.app');

interface ProductCapacity {
  id: number;
  capacity: string;
  sellPrice: number;
  unitPrice: number;
}

interface Product {
  id: number;
  name: string;
  brandName: string;
  unitTypes: string[];
  capacities: ProductCapacity[];
}

interface CartItem {
  productId: number;
  capacityId: number;
  productName: string;
  brandName: string;
  capacity: string;
  price: number;
  qty: number;
  unitTypes: string[];
}

interface CustomerSuggestion {
  id: string;
  name: string;
  address: string;
  contactNumber: string;
}

const SALES_TYPES = [
  { value: 'sales', label: 'Order', icon: '🛒' },
  { value: 'service', label: 'Service', icon: '🔧' },
  { value: 'concern', label: 'Concern', icon: '📋' },
  { value: 'sub-dealer', label: 'Sub Dealer', icon: '🤝' },
] as const;

const PAYMENT_METHODS = ['Cash', 'Bank Transfer', 'Terms', 'Terms with DP', 'Cheque', 'Credit Card', 'Installment'];

const SERVICE_OPTIONS = [
  'CLEANING', 'DISMANTLE', 'RELOCATION', 'CHARING FREON',
  'SURVEY', 'CHIPPING', 'PUMP DOWN', 'INSTALL ONLY', 'CHECKUP',
];

@Component({
  selector: 'app-order-form',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './order-form.component.html',
})
export class OrderFormComponent implements OnInit {
  salesTypes = SALES_TYPES;
  paymentMethods = PAYMENT_METHODS;
  serviceOptions = SERVICE_OPTIONS;

  salesType = signal<string>('sales');
  scheduleDate = signal<string>('');
  customerName = signal<string>('');
  address = signal<string>('');
  contactNumber = signal<string>('');
  landmark = signal<string>('');
  paymentMethod = signal<string>('Cash');

  // Service fields
  selectedServices = signal<string[]>([]);

  // Concern fields
  concernSubject = signal<string>('');
  concernDescription = signal<string>('');

  businessName = signal<string>('');
  businessLogo = signal<string>('');

  products = signal<Product[]>([]);
  cart = signal<CartItem[]>([]);
  customerSuggestions = signal<CustomerSuggestion[]>([]);
  showSuggestions = signal<boolean>(false);

  productSearch = signal<string>('');
  brandSearch = signal<string>('');
  selectedBrandName = signal<string>('');
  selectedProduct = signal<Product | null>(null);
  selectedCapacity = signal<ProductCapacity | null>(null);
  pendingQty = signal<number>(1);
  showBrandSuggestions = signal<boolean>(false);
  loading = signal<boolean>(false);
  submitting = signal<boolean>(false);
  submitted = signal<boolean>(false);
  errorMsg = signal<string>('');
  successMsg = signal<string>('');

  // Feedback after order
  feedbackStep = signal<'idle' | 'form' | 'done'>('idle');
  feedbackRating = signal<number>(0);
  feedbackHovered = signal<number>(0);
  feedbackRecommend = signal<boolean | null>(null);
  feedbackInsights = signal<string>('');
  feedbackSubmitting = signal<boolean>(false);
  feedbackError = signal<string>('');

  readonly stars = [1, 2, 3, 4, 5];
  readonly ratingLabels: Record<number, string> = { 1: 'Poor', 2: 'Fair', 3: 'Good', 4: 'Very Good', 5: 'Excellent' };
  readonly ratingEmojis: Record<number, string> = { 1: '😞', 2: '😐', 3: '🙂', 4: '😊', 5: '🤩' };

  displayFeedbackRating() { return this.feedbackHovered() || this.feedbackRating(); }

  async submitFeedback() {
    this.feedbackError.set('');
    if (this.feedbackRating() < 1) return this.feedbackError.set('Please select a rating.');
    if (this.feedbackRecommend() === null) return this.feedbackError.set('Please select yes or no.');
    this.feedbackSubmitting.set(true);
    try {
      await axios.post(`${API_BASE}/public/feedback`, {
        rating: this.feedbackRating(),
        wouldRecommend: this.feedbackRecommend(),
        insights: this.feedbackInsights().trim() || undefined,
        name: this.customerName().trim() || undefined,
      });
      this.feedbackStep.set('done');
    } catch {
      this.feedbackError.set('Failed to submit feedback. Please try again.');
    } finally {
      this.feedbackSubmitting.set(false);
    }
  }

  skipFeedback() { this.feedbackStep.set('done'); }

  cartTotal = computed(() => this.cart().reduce((sum, i) => sum + i.price * i.qty, 0));

  allBrands = computed(() => {
    const seen = new Set<string>();
    return this.products().filter(p => {
      if (seen.has(p.brandName)) return false;
      seen.add(p.brandName);
      return true;
    }).map(p => p.brandName).sort();
  });

  filteredBrandSuggestions = computed(() => {
    const q = this.brandSearch().toLowerCase().trim();
    if (!q) return this.allBrands();
    return this.allBrands().filter(b => b.toLowerCase().includes(q));
  });

  productsForBrand = computed(() => {
    const brand = this.selectedBrandName();
    if (!brand) return [];
    return this.products().filter(p => p.brandName === brand);
  });

  private customerSearchTimer: any;

  constructor(private route: ActivatedRoute) {}

  ngOnInit() {
    this.loadBusinessProfile();
    this.loadProducts();
  }

  toggleService(name: string) {
    const current = this.selectedServices();
    if (current.includes(name)) {
      this.selectedServices.set(current.filter(s => s !== name));
    } else {
      this.selectedServices.set([...current, name]);
    }
  }

  isProductType() {
    return this.salesType() === 'sales' || this.salesType() === 'sub-dealer';
  }

  onScheduleDateChange(event: { dateStr: string }) {
    this.scheduleDate.set(event.dateStr);
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

  async loadProducts() {
    this.loading.set(true);
    try {
      const res = await axios.get(`${API_BASE}/public/order-form/products`);
      this.products.set(res.data.items ?? []);
    } catch {
      this.errorMsg.set('Failed to load products.');
    } finally {
      this.loading.set(false);
    }
  }

  selectBrand(brand: string) {
    this.selectedBrandName.set(brand);
    this.brandSearch.set(brand);
    this.showBrandSuggestions.set(false);
    this.selectedProduct.set(null);
    this.selectedCapacity.set(null);
  }

  selectProduct(product: Product) {
    this.selectedProduct.set(product);
    this.selectedCapacity.set(null);
    this.pendingQty.set(1);
  }

  selectCapacity(cap: ProductCapacity) {
    this.selectedCapacity.set(cap);
    this.pendingQty.set(1);
  }

  confirmAddToCart() {
    const product = this.selectedProduct();
    const cap = this.selectedCapacity();
    const qty = this.pendingQty();
    if (!product || !cap || qty < 1) return;
    const existing = this.cart().find(i => i.productId === product.id && i.capacityId === cap.id);
    if (existing) {
      this.cart.update(items => items.map(i =>
        i.productId === product.id && i.capacityId === cap.id ? { ...i, qty: i.qty + qty } : i
      ));
    } else {
      this.cart.update(items => [...items, {
        productId: product.id, capacityId: cap.id,
        productName: product.name, brandName: product.brandName,
        capacity: cap.capacity, price: cap.sellPrice || cap.unitPrice, qty,
        unitTypes: product.unitTypes?.length ? product.unitTypes : ['set'],
      }]);
    }
    this.selectedCapacity.set(null);
    this.pendingQty.set(1);
  }

  onCustomerNameInput(value: string) {
    this.customerName.set(value);
    clearTimeout(this.customerSearchTimer);
    if (value.trim().length < 2) {
      this.customerSuggestions.set([]);
      this.showSuggestions.set(false);
      return;
    }
    this.customerSearchTimer = setTimeout(async () => {
      try {
        const res = await axios.get(`${API_BASE}/public/order-form/customers/search`, { params: { q: value } });
        this.customerSuggestions.set(res.data.items ?? []);
        this.showSuggestions.set(true);
      } catch {}
    }, 300);
  }

  selectCustomer(c: CustomerSuggestion) {
    this.customerName.set(c.name);
    this.address.set(c.address);
    this.contactNumber.set(c.contactNumber);
    this.showSuggestions.set(false);
    this.customerSuggestions.set([]);
  }

  addToCart(product: Product, capacity: ProductCapacity) {
    const existing = this.cart().find(
      (i) => i.productId === product.id && i.capacityId === capacity.id,
    );
    if (existing) {
      this.cart.update((items) =>
        items.map((i) =>
          i.productId === product.id && i.capacityId === capacity.id
            ? { ...i, qty: i.qty + 1 }
            : i,
        ),
      );
    } else {
      this.cart.update((items) => [
        ...items,
        {
          productId: product.id,
          capacityId: capacity.id,
          productName: product.name,
          brandName: product.brandName,
          capacity: capacity.capacity,
          price: capacity.sellPrice || capacity.unitPrice,
          qty: 1,
          unitTypes: product.unitTypes?.length ? product.unitTypes : ['set'],
        },
      ]);
    }
  }

  // Pending removal confirmation
  pendingRemoveItem = signal<CartItem | null>(null);

  requestRemove(item: CartItem) {
    this.pendingRemoveItem.set(item);
  }

  confirmRemove() {
    const item = this.pendingRemoveItem();
    if (item) this.removeFromCart(item);
    this.pendingRemoveItem.set(null);
  }

  cancelRemove() {
    const item = this.pendingRemoveItem();
    if (item) {
      // restore qty to 1 if it was zeroed out
      this.cart.update(items =>
        items.map(i =>
          i.productId === item.productId && i.capacityId === item.capacityId
            ? { ...i, qty: i.qty < 1 ? 1 : i.qty }
            : i
        )
      );
    }
    this.pendingRemoveItem.set(null);
  }

  updateQty(item: CartItem, qty: number) {
    const normalized = Math.floor(Number(qty));
    if (normalized < 1) {
      this.requestRemove(item);
      return;
    }
    this.cart.update((items) =>
      items.map((i) =>
        i.productId === item.productId && i.capacityId === item.capacityId ? { ...i, qty: normalized } : i,
      ),
    );
  }

  removeFromCart(item: CartItem) {
    this.cart.update((items) =>
      items.filter((i) => !(i.productId === item.productId && i.capacityId === item.capacityId)),
    );
  }

  isInCart(productId: number, capacityId: number): boolean {
    return this.cart().some((i) => i.productId === productId && i.capacityId === capacityId);
  }

  getCartQty(productId: number, capacityId: number): number {
    return this.cart().find((i) => i.productId === productId && i.capacityId === capacityId)?.qty ?? 0;
  }

  async submit() {
    this.errorMsg.set('');
    if (!this.salesType()) return this.errorMsg.set('Please select an order type.');
    if (!this.scheduleDate()) return this.errorMsg.set('Please select a schedule date.');
    if (!this.customerName().trim()) return this.errorMsg.set('Customer name is required.');
    if (!this.paymentMethod()) return this.errorMsg.set('Please select a payment method.');
    if (this.isProductType() && this.cart().length === 0) return this.errorMsg.set('Please add at least one product.');
    if (this.salesType() === 'service' && this.selectedServices().length === 0) return this.errorMsg.set('Please select at least one service.');
    if (this.salesType() === 'concern' && !this.concernSubject().trim()) return this.errorMsg.set('Please enter a concern subject.');
    if (this.salesType() === 'concern' && !this.concernDescription().trim()) return this.errorMsg.set('Please describe your concern.');

    this.submitting.set(true);
    try {
      const customerType = this.salesType() === 'sub-dealer' ? 'sub_dealer' : 'regular';
      const basePayload: any = {
        salesType: this.salesType(),
        scheduleDate: this.scheduleDate(),
        customerName: this.customerName().trim(),
        address: this.address().trim() || undefined,
        contactNumber: this.contactNumber().trim() || undefined,
        landmark: this.landmark().trim() || undefined,
        paymentMethod: this.isProductType() ? this.paymentMethod() : 'Cash',
        productItems: this.isProductType() ? this.cart().map(i => ({
          productId: i.productId, capacityId: i.capacityId,
          qty: i.qty, sellPrice: i.price, unitPrice: i.price,
          unitTypes: i.unitTypes,
        })) : [],
      };

      if (this.salesType() === 'service') {
        basePayload.serviceItems = this.selectedServices().map(s => ({ serviceName: s }));
      }

      if (this.salesType() === 'concern') {
        basePayload.concernSubject = this.concernSubject().trim();
        basePayload.concernDescription = this.concernDescription().trim();
      }

      const res = await axios.post(`${API_BASE}/public/order-form`, basePayload);
      if (res.data.success) {
        this.submitted.set(true);
        this.successMsg.set(`Your order has been submitted successfully! SO #${res.data.data?.salesOrderId ?? ''}`);
        this.feedbackStep.set('form');
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
    this.salesType.set('sales');
    this.scheduleDate.set('');
    this.customerName.set('');
    this.address.set('');
    this.contactNumber.set('');
    this.landmark.set('');
    this.paymentMethod.set('Cash');
    this.selectedServices.set([]);
    this.concernSubject.set('');
    this.concernDescription.set('');
    this.cart.set([]);
    this.productSearch.set('');
    this.brandSearch.set('');
    this.selectedBrandName.set('');
    this.selectedProduct.set(null);
    this.selectedCapacity.set(null);
    this.pendingQty.set(1);
    this.feedbackStep.set('idle');
    this.feedbackRating.set(0);
    this.feedbackHovered.set(0);
    this.feedbackRecommend.set(null);
    this.feedbackInsights.set('');
    this.feedbackError.set('');
    this.submitted.set(false);
    this.successMsg.set('');
    this.errorMsg.set('');
  }
}
