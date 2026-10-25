/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CONFIG } from './config.js';
import { AuthAPI, InventoryAPI } from './api.js';
import {
  showToast,
  openModal,
  closeModal,
  formatCurrency,
  formatNumber,
  formatCairoDate,
  getStatusBadgeHtml,
  calculateEstimatedDays,
  showItemQrModal,
  openBarcodeScanner,
  exportCsv,
  createPurchaseOrderMessage,
  getSvgIcon,
  initPWA,
  esc,
  getConditionBadgeHtml,
  conditionOptionsHtml,
  normalizeCondition
} from './ui.js';

const state = {
  activeTab: 'items', // 4 tabs: items (الأصناف), stocktake (الجرد), movements (الحركات), settings (الإعدادات)
  items: [],
  categories: [],
  suppliers: [],
  movements: [],
  jobTemplates: [],
  settings: {},
  searchTerm: '',
  selectedCategory: 'all',
  selectedStatus: 'all',
  selectedCondition: 'all',
  stocktakeDraft: {},
  pinInput: '',
  lastMovement: null,
};

// ============================================================================
// 1. شاشة الدخول برمز PIN (بدون إيموجي)
// ============================================================================

function setupAuthScreen() {
  const pinDots = document.querySelectorAll('.pin-dot');
  const errorMsg = document.getElementById('auth-error-msg');
  const lockoutBox = document.getElementById('lockout-countdown-box');
  const lockoutSecondsSpan = document.getElementById('lockout-seconds');

  function updatePinDisplay() {
    pinDots.forEach((dot, idx) => {
      if (idx < state.pinInput.length) {
        dot.classList.add('filled');
      } else {
        dot.classList.remove('filled');
      }
    });
  }

  const lockout = AuthAPI.getLockoutStatus();
  if (lockout.isLocked) {
    lockoutBox.style.display = 'block';
    lockoutSecondsSpan.textContent = lockout.remainingSeconds;
    const interval = setInterval(() => {
      const current = AuthAPI.getLockoutStatus();
      if (!current.isLocked) {
        clearInterval(interval);
        lockoutBox.style.display = 'none';
        errorMsg.textContent = '';
      } else {
        lockoutSecondsSpan.textContent = current.remainingSeconds;
      }
    }, 1000);
  }

  document.querySelectorAll('.keypad-btn').forEach(btn => {
    btn.onclick = () => {
      const val = btn.dataset.val;
      if (val === 'clear') {
        state.pinInput = '';
        updatePinDisplay();
      } else if (val === 'backspace') {
        state.pinInput = state.pinInput.slice(0, -1);
        updatePinDisplay();
      } else if (val && state.pinInput.length < 8) {
        state.pinInput += val;
        updatePinDisplay();
        if (state.pinInput.length >= 6) {
          attemptLogin();
        }
      }
    };
  });

  window.addEventListener('keydown', (e) => {
    const authScreen = document.getElementById('auth-screen');
    if (authScreen && authScreen.style.display !== 'none') {
      if (e.key >= '0' && e.key <= '9') {
        if (state.pinInput.length < 8) {
          state.pinInput += e.key;
          updatePinDisplay();
          if (state.pinInput.length >= 6) attemptLogin();
        }
      } else if (e.key === 'Backspace') {
        state.pinInput = state.pinInput.slice(0, -1);
        updatePinDisplay();
      } else if (e.key === 'Escape') {
        state.pinInput = '';
        updatePinDisplay();
      }
    }
  });

  async function attemptLogin() {
    const pin = state.pinInput;
    try {
      errorMsg.textContent = 'جار التحقق...';
      const res = await AuthAPI.signInWithPin(pin, 'editor');
      if (res.success) {
        showToast('تم تسجيل الدخول بنجاح', 'success');
        document.getElementById('auth-screen').style.display = 'none';
        document.getElementById('app-main').style.display = 'block';
        initApp();
      }
    } catch (err) {
      errorMsg.textContent = err.message;
      state.pinInput = '';
      updatePinDisplay();

      const l = AuthAPI.getLockoutStatus();
      if (l.isLocked) {
        lockoutBox.style.display = 'block';
        lockoutSecondsSpan.textContent = l.remainingSeconds;
      }
    }
  }
}

function setupInactivityWatcher() {
  let lastCheck = 0;
  const resetTimer = () => {
    const nowTs = Date.now();
    if (nowTs - lastCheck < 1000) return; // لا نفحص أكثر من مرة في الثانية
    lastCheck = nowTs;
    const session = AuthAPI.checkSession('editor');
    if (!session && document.getElementById('app-main').style.display !== 'none') {
      showToast('تم تسجيل الخروج تلقائيا لعدم النشاط', 'warning');
      window.location.reload();
    }
  };

  ['mousemove', 'keydown', 'touchstart', 'click'].forEach(evt => {
    window.addEventListener(evt, resetTimer, { passive: true });
  });
}

// ============================================================================
// 2. تحميل البيانات
// ============================================================================

async function loadData() {
  try {
    state.settings = await InventoryAPI.getSettings();
    state.categories = await InventoryAPI.getCategories();
    state.suppliers = await InventoryAPI.getSuppliers();
    state.items = await InventoryAPI.getItems(true);
    state.movements = await InventoryAPI.getMovements(200);
    state.jobTemplates = await InventoryAPI.getJobTemplates();
    state.lastMovement = state.movements.length > 0 ? state.movements[0] : null;

    renderMetrics();
    renderCurrentView();
  } catch (err) {
    showToast('خطأ في تحميل البيانات: ' + err.message, 'error');
  }
}

// ============================================================================
// 3. التبويبات الأربعة الموحدة (Items, Stocktake, Movements, Settings)
// ============================================================================

function setupTabs() {
  document.querySelectorAll('.nav-tab-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.nav-tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.activeTab = btn.dataset.tab;

      document.querySelectorAll('.tab-content').forEach(section => {
        section.style.display = section.id === `tab-${state.activeTab}` ? 'block' : 'none';
      });

      renderCurrentView();
    };
  });
}

function renderMetrics() {
  const activeItems = state.items.filter(i => !i.is_archived);
  const totalCount = activeItems.length;
  const lowCount = activeItems.filter(i => i.quantity > 0 && i.quantity <= i.min_limit).length;
  const outCount = activeItems.filter(i => i.quantity <= 0).length;
  const totalValuation = activeItems.reduce((sum, i) => sum + (Number(i.quantity) * Number(i.cost_price || 0)), 0);

  const elTotal = document.getElementById('stat-total-items');
  const elLow = document.getElementById('stat-low-stock');
  const elOut = document.getElementById('stat-out-stock');
  const elVal = document.getElementById('stat-valuation');
  const elBad = document.getElementById('stat-cond-bad');
  const elBadSub = document.getElementById('stat-cond-bad-sub');
  const poorCount = activeItems.filter(i => i.condition === 'poor').length;
  const fairCount = activeItems.filter(i => i.condition === 'fair').length;
  if (elBad) elBad.innerHTML = formatNumber(poorCount + fairCount);
  if (elBadSub) elBadSub.textContent = `${poorCount} سيئة، ${fairCount} متوسطة`;

  if (elTotal) elTotal.innerHTML = formatNumber(totalCount);
  if (elLow) elLow.innerHTML = formatNumber(lowCount);
  if (elOut) elOut.innerHTML = formatNumber(outCount);
  if (elVal) elVal.innerHTML = formatCurrency(totalValuation);

  // شريط التراجع عن آخر حركة
  const undoBox = document.getElementById('dashboard-undo-container');
  if (state.lastMovement && undoBox) {
    const m = state.lastMovement;
    const itm = state.items.find(i => i.id === m.item_id);
    const sign = m.change_amount > 0 ? '+' : '';
    undoBox.innerHTML = `
      <div style="background:#ffffff; border:1px solid #cbd5e1; border-radius:8px; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; flex-wrap:wrap; gap:8px; margin-bottom:16px;">
        <div style="font-size:0.95rem;">
          <strong style="color:#0f172a;">آخر حركة:</strong>
          <span>${esc(itm ? itm.name : 'صنف')} (${sign}${m.change_amount}) — ${esc(m.reason || m.type)}</span>
          <span style="font-size:0.8rem; color:#64748b; margin-right:8px;">[${formatCairoDate(m.created_at)}]</span>
        </div>
        <button class="btn btn-secondary btn-sm" id="btn-undo-last-mov">
          ${getSvgIcon('undo')} تراجع عن الحركة
        </button>
      </div>
    `;
    document.getElementById('btn-undo-last-mov').onclick = async () => {
      if (confirm(`تأكيد التراجع عن حركة: ${itm ? itm.name : ''} (${sign}${m.change_amount})؟`)) {
        try {
          await InventoryAPI.undoMovement(m.id);
          showToast('تم التراجع وتسجيل حركة تصحيحية بنجاح', 'success');
          loadData();
        } catch (e) {
          showToast(e.message, 'error');
        }
      }
    };
  } else if (undoBox) {
    undoBox.innerHTML = '';
  }
}

function renderCurrentView() {
  switch (state.activeTab) {
    case 'items':
      renderItemsTable();
      break;
    case 'stocktake':
      renderStocktake();
      break;
    case 'movements':
      renderMovements();
      break;
    case 'settings':
      renderSettings();
      break;
  }
}

// ============================================================================
// 4. جدول الأصناف (الأصناف)
// ============================================================================

function renderItemsTable() {
  const container = document.getElementById('inventory-table-container');
  if (!container) return;

  const catFilter = document.getElementById('inv-filter-cat');
  if (catFilter && catFilter.children.length <= 1) {
    state.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      catFilter.appendChild(opt);
    });
  }

  let filtered = state.items.filter(item => {
    const matchesSearch =
      !state.searchTerm ||
      item.name.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      item.sku.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
      (item.specs && item.specs.toLowerCase().includes(state.searchTerm.toLowerCase())) ||
      (item.storage_location && item.storage_location.toLowerCase().includes(state.searchTerm.toLowerCase())) ||
      (item.condition_note && item.condition_note.toLowerCase().includes(state.searchTerm.toLowerCase()));

    const matchesCat = state.selectedCategory === 'all' || item.category_id === state.selectedCategory;
    const matchesCond = state.selectedCondition === 'all' || item.condition === state.selectedCondition;

    let matchesStatus = true;
    if (state.selectedStatus === 'available') {
      matchesStatus = !item.is_archived && item.quantity > item.min_limit;
    } else if (state.selectedStatus === 'low') {
      matchesStatus = !item.is_archived && item.quantity > 0 && item.quantity <= item.min_limit;
    } else if (state.selectedStatus === 'out') {
      matchesStatus = !item.is_archived && item.quantity <= 0;
    } else if (state.selectedStatus === 'archived') {
      matchesStatus = !!item.is_archived;
    } else {
      // 'all' = جميع الأصناف النشطة
      matchesStatus = !item.is_archived;
    }

    return matchesSearch && matchesCat && matchesCond && matchesStatus;
  });

  const countBadge = document.getElementById('inv-count-badge');
  if (countBadge) countBadge.innerHTML = `<span class="tabular-nums">${filtered.length}</span> صنف`;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div style="text-align: center; padding: 48px 16px; color: #64748b; background:#ffffff; border:1px solid #e2e8f0; border-radius:8px;">
        <p style="font-size: 1.05rem; margin-bottom: 8px;">لا توجد أصناف مطابقة للبحث أو الفلتر</p>
        <button class="btn btn-secondary btn-sm" id="btn-reset-filters">إعادة ضبط الفلاتر</button>
      </div>
    `;
    const resetBtn = document.getElementById('btn-reset-filters');
    if (resetBtn) {
      resetBtn.onclick = () => {
        state.searchTerm = '';
        state.selectedCategory = 'all';
        state.selectedStatus = 'all';
        state.selectedCondition = 'all';
        document.getElementById('inv-filter-cond').value = 'all';
        document.getElementById('inv-search').value = '';
        document.getElementById('inv-filter-cat').value = 'all';
        document.getElementById('inv-filter-status').value = 'all';
        renderItemsTable();
      };
    }
    return;
  }

  let rows = '';
  filtered.forEach(item => {
    const days = calculateEstimatedDays(item.quantity, state.movements, item.id);
    const daysHtml = (!item.is_archived && days !== null) ? `<span style="font-size:0.75rem; color:#64748b; display:block;">يكفي <span class="tabular-nums">${days}</span> يوم</span>` : '';
    const catName = esc(state.categories.find(c => c.id === item.category_id)?.name || 'عام');
    const condCell = item.is_archived
      ? getConditionBadgeHtml(item.condition)
      : `<select class="cond-select cond-${item.condition}" data-action="set-condition" data-id="${esc(item.id)}" aria-label="حالة المنتج: ${esc(item.name)}">${conditionOptionsHtml(item.condition)}</select>`;
    const condNote = item.condition_note ? `<span class="cond-note">${esc(item.condition_note)}</span>` : '';

    const statusBadge = item.is_archived
      ? `<span class="badge badge-archived">مؤرشف</span>`
      : `${getStatusBadgeHtml(item.status, item.quantity, item.unit)}${daysHtml}`;

    const actionButtons = item.is_archived
      ? `
        <div style="display:flex; gap:6px; justify-content:flex-end;">
          <button class="btn btn-secondary btn-sm" data-action="restore-item" data-id="${esc(item.id)}" title="استعادة الصنف للمخزون النشط">
            ${getSvgIcon('undo')} استعادة
          </button>
          <button class="btn btn-secondary btn-sm btn-icon-only text-danger" data-action="delete-permanent" data-id="${esc(item.id)}" aria-label="حذف نهائي" title="حذف نهائي">
            ${getSvgIcon('trash')}
          </button>
        </div>
      `
      : `
        <div style="display:flex; gap:6px; justify-content:flex-end;">
          <button class="btn btn-secondary btn-sm" data-action="adjust-modal" data-id="${esc(item.id)}" title="تعديل مفصل">تعديل</button>
          <button class="btn btn-secondary btn-sm btn-icon-only" data-action="show-qr" data-id="${esc(item.id)}" aria-label="ملصق الصنف" title="ملصق الصنف">${getSvgIcon('qr')}</button>
          <button class="btn btn-secondary btn-sm btn-icon-only" data-action="edit-item" data-id="${esc(item.id)}" aria-label="تعديل بيانات الصنف" title="تعديل بيانات الصنف">${getSvgIcon('edit')}</button>
          <button class="btn btn-secondary btn-sm btn-icon-only text-danger" data-action="delete-item" data-id="${esc(item.id)}" aria-label="حذف الصنف" title="حذف الصنف">${getSvgIcon('trash')}</button>
        </div>
      `;

    rows += `
      <tr data-item-id="${esc(item.id)}" style="${item.is_archived ? 'opacity:0.75;' : ''}">
        <td>
          <div style="font-weight: 600; color: #0f172a;">${esc(item.name)}</div>
          <div style="font-size: 0.8rem; color: #64748b;" class="tabular-nums">${esc(item.sku)}</div>
          <div style="font-size: 0.8rem; color: #475569;">${esc(item.specs || '')}</div>
        </td>
        <td><span style="font-size:0.85rem; background:#f1f5f9; padding:4px 10px; border-radius:6px; border:1px solid #e2e8f0;">${catName}</span></td>
        <td>
          ${item.is_archived ? `
            <span style="font-size:1.05rem; font-weight:600;" class="tabular-nums">${item.quantity} ${esc(item.unit)}</span>
          ` : `
            <div style="display:flex; align-items:center; gap:8px;">
              <button class="btn-qty" data-action="quick-dec" data-id="${esc(item.id)}" aria-label="صرف 1" title="صرف 1">-</button>
              <span style="font-size:1.1rem; font-weight:700; min-width:36px; text-align:center;" class="tabular-nums">${item.quantity}</span>
              <button class="btn-qty" data-action="quick-inc" data-id="${esc(item.id)}" aria-label="توريد 1" title="توريد 1">+</button>
              <span style="font-size:0.85rem; color:#64748b;">${esc(item.unit)}</span>
            </div>
          `}
        </td>
        <td>${statusBadge}</td>
        <td>${condCell}${condNote}</td>
        <td>${formatCurrency(item.cost_price)}</td>
        <td style="font-size:0.85rem; color:#475569;">${esc(item.storage_location || '—')}</td>
        <td>${actionButtons}</td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th>الصنف والمواصفات</th>
            <th>التصنيف</th>
            <th>الكمية الحالية</th>
            <th>حالة المخزون</th>
            <th>حالة المنتج</th>
            <th>التكلفة</th>
            <th>مكان التخزين</th>
            <th style="text-align:left;">إجراءات</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('select[data-action="set-condition"]').forEach(sel => {
    sel.onchange = async () => {
      const item = state.items.find(i => i.id === sel.dataset.id);
      if (!item) return;
      try {
        await InventoryAPI.setItemCondition(item.id, sel.value);
        showToast(`تم تحديث حالة "${item.name}"`, 'success');
        loadData();
      } catch (err) {
        showToast(err.message, 'error');
        sel.value = item.condition;
      }
    };
  });

  container.querySelectorAll('button[data-action]').forEach(btn => {
    btn.onclick = () => {
      const action = btn.dataset.action;
      const itemId = btn.dataset.id;
      const item = state.items.find(i => i.id === itemId);
      if (!item) return;

      if (action === 'quick-inc') {
        quickAdjustStock(item, 1, 'supply', 'توريد سريع (+1)');
      } else if (action === 'quick-dec') {
        if (item.quantity <= 0) {
          showToast('الرصيد نفد بالفعل ولا يمكن صرف كميات إضافية', 'warning');
          return;
        }
        quickAdjustStock(item, -1, 'consume', 'صرف سريع (-1)');
      } else if (action === 'adjust-modal') {
        openQuickAdjustModal(item);
      } else if (action === 'show-qr') {
        showItemQrModal(item);
      } else if (action === 'edit-item') {
        openItemFormModal(item);
      } else if (action === 'delete-item') {
        openDeleteItemModal(item);
      } else if (action === 'restore-item') {
        restoreArchivedItem(item);
      } else if (action === 'delete-permanent') {
        confirmPermanentDelete(item);
      }
    };
  });
}

async function quickAdjustStock(item, amount, type, reason) {
  try {
    await InventoryAPI.adjustStock(item.id, amount, type, reason);
    showToast(`تم ${amount > 0 ? 'إضافة' : 'خصم'} ${Math.abs(amount)} ${item.unit} لـ ${item.name}`, 'success');
    loadData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openQuickAdjustModal(item) {
  let modal = document.getElementById('adjust-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'adjust-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-container" style="max-width: 460px;">
        <div class="modal-header">
          <h3 class="modal-title">تعديل رصيد المخزون</h3>
          <button class="modal-close" data-close-modal="adjust-modal" aria-label="إغلاق">${getSvgIcon('x')}</button>
        </div>
        <div class="modal-body">
          <div style="background:#f1f5f9; padding:12px; border-radius:8px; margin-bottom:16px; border:1px solid #e2e8f0;">
            <h4 id="adj-item-name" style="font-weight:700; color:#0f172a;"></h4>
            <div style="display:flex; justify-content:space-between; font-size:0.9rem; color:#475569; margin-top:4px;">
              <span>الرصيد الحالي: <strong id="adj-current-qty" style="color:#0f172a;"></strong></span>
              <span>الحد الأدنى: <strong id="adj-min-limit" style="color:#0f172a;"></strong></span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="adj-type">نوع الحركة:</label>
            <select id="adj-type" class="form-control">
              <option value="supply">توريد وارد (+)</option>
              <option value="consume">صرف استهلاك (-)</option>
              <option value="damage">تالف / هالك (-)</option>
              <option value="correction">تصحيح خطأ جرد</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label" for="adj-amount">الكمية:</label>
            <div style="display:flex; gap:8px; align-items:center;">
              <input type="number" id="adj-amount" class="form-control" step="any" min="0.01" placeholder="أدخل الكمية">
              <span id="adj-unit" style="font-weight:500; color:#64748b; min-width:40px;"></span>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label" for="adj-reason">السبب / الملاحظات:</label>
            <input type="text" id="adj-reason" class="form-control" placeholder="فاتورة توريد، تلف، طلب شغل...">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" id="btn-confirm-adjust">${getSvgIcon('check')} حفظ الحركة</button>
          <button class="btn btn-secondary" data-close-modal="adjust-modal">إلغاء</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  document.getElementById('adj-item-name').textContent = item.name;
  document.getElementById('adj-current-qty').textContent = `${item.quantity} ${item.unit}`;
  document.getElementById('adj-min-limit').textContent = `${item.min_limit} ${item.unit}`;
  document.getElementById('adj-unit').textContent = item.unit;
  document.getElementById('adj-amount').value = '';
  document.getElementById('adj-reason').value = '';

  const confirmBtn = document.getElementById('btn-confirm-adjust');
  confirmBtn.onclick = async () => {
    const type = document.getElementById('adj-type').value;
    const amountVal = parseFloat(document.getElementById('adj-amount').value);
    const reason = document.getElementById('adj-reason').value.trim();

    if (isNaN(amountVal) || amountVal <= 0) {
      showToast('يرجى إدخال كمية صالحة أكبر من الصفر', 'warning');
      return;
    }
    if (!reason) {
      showToast('يرجى كتابة سبب التعديل لتسجيله في السجل', 'warning');
      return;
    }

    let finalChange = amountVal;
    if (type === 'consume' || type === 'damage') {
      finalChange = -amountVal;
    }

    try {
      await InventoryAPI.adjustStock(item.id, finalChange, type, reason);
      showToast('تم تحديث الرصيد وتسجيل الحركة بنجاح', 'success');
      closeModal('adjust-modal');
      loadData();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  openModal('adjust-modal');
}

function setConditionInForm(condition, note) {
  const key = normalizeCondition(condition);
  const radio = document.querySelector(`input[name="form-item-condition"][value="${key}"]`);
  if (radio) radio.checked = true;
  document.getElementById('form-item-cond-note').value = note || '';
}

function openItemFormModal(item = null) {
  let modal = document.getElementById('item-form-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'item-form-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-container">
        <div class="modal-header">
          <h3 class="modal-title" id="item-modal-title">إضافة صنف جديد</h3>
          <button class="modal-close" data-close-modal="item-form-modal" aria-label="إغلاق">${getSvgIcon('x')}</button>
        </div>
        <div class="modal-body">
          <form id="item-edit-form">
            <input type="hidden" id="form-item-id">
            
            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="form-item-name">اسم الصنف *</label>
                <input type="text" id="form-item-name" class="form-control" required placeholder="مثال: ورق فوتوغرافي لامع">
              </div>
              <div class="form-group">
                <label class="form-label" for="form-item-sku">كود الصنف SKU</label>
                <input type="text" id="form-item-sku" class="form-control" placeholder="تلقائي إن ترك فارغا">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="form-item-category">التصنيف *</label>
                <select id="form-item-category" class="form-control"></select>
              </div>
              <div class="form-group">
                <label class="form-label" for="form-item-specs">المقاس والمواصفات</label>
                <input type="text" id="form-item-specs" class="form-control" placeholder="مثال: 30×40 سم، 260 جم">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="form-item-unit">وحدة القياس</label>
                <select id="form-item-unit" class="form-control">
                  <option value="قطعة">قطعة</option>
                  <option value="علبة">علبة</option>
                  <option value="رزمة">رزمة</option>
                  <option value="متر">متر</option>
                  <option value="لتر">لتر</option>
                  <option value="لوح">لوح</option>
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="form-item-qty">الكمية الحالية *</label>
                <input type="number" id="form-item-qty" class="form-control" step="any" min="0" required value="0">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="form-item-min">الحد الأدنى للتنبيه *</label>
                <input type="number" id="form-item-min" class="form-control" min="0" value="5">
              </div>
              <div class="form-group">
                <label class="form-label" for="form-item-reorder">كمية إعادة الطلب المقترحة</label>
                <input type="number" id="form-item-reorder" class="form-control" min="0" value="10">
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="form-item-cost">سعر التكلفة (ج.م)</label>
                <input type="number" id="form-item-cost" class="form-control" step="any" min="0" value="0">
              </div>
              <div class="form-group">
                <label class="form-label" for="form-item-supplier">المورد</label>
                <select id="form-item-supplier" class="form-control">
                  <option value="">بدون مورد محدد</option>
                </select>
              </div>
            </div>

            <div class="form-row">
              <div class="form-group">
                <label class="form-label" for="form-item-loc">مكان التخزين</label>
                <input type="text" id="form-item-loc" class="form-control" placeholder="مثال: رف أ-1، درج الأحبار">
              </div>
              <div class="form-group">
                <label class="form-label" for="form-item-expiry">تاريخ الصلاحية</label>
                <input type="date" id="form-item-expiry" class="form-control">
              </div>
            </div>

            <div class="form-group">
              <span class="form-label" id="cond-picker-label">حالة المنتج</span>
              <div class="cond-picker" role="radiogroup" aria-labelledby="cond-picker-label">
                ${Object.entries(CONFIG.CONDITIONS).map(([key, c]) => `
                  <label class="cond-${key}">
                    <input type="radio" name="form-item-condition" value="${key}" ${key === CONFIG.DEFAULT_CONDITION ? 'checked' : ''}>
                    ${getConditionBadgeHtml(key)}
                    <small>${esc(c.hint)}</small>
                  </label>`).join('')}
              </div>
            </div>

            <div class="form-group">
              <label class="form-label" for="form-item-cond-note">ملاحظة عن الحالة (اختياري)</label>
              <input type="text" id="form-item-cond-note" class="form-control" placeholder="مثال: خدوش بسيطة، الغطاء مكسور، رطوبة...">
            </div>

            <div class="form-group">
              <label class="form-label" for="form-item-notes">ملاحظات</label>
              <textarea id="form-item-notes" class="form-control" rows="2" placeholder="ملاحظات إضافية..."></textarea>
            </div>
          </form>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary" id="btn-save-item">${getSvgIcon('check')} حفظ الصنف</button>
          <div style="display:flex; gap:8px;">
            <button class="btn btn-danger btn-sm" id="btn-delete-item" style="display:none;">${getSvgIcon('trash')} أرشفة / حذف</button>
            <button class="btn btn-secondary" data-close-modal="item-form-modal">إلغاء</button>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);
  }

  const catSelect = document.getElementById('form-item-category');
  catSelect.innerHTML = '';
  state.categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = c.name;
    catSelect.appendChild(opt);
  });

  const supSelect = document.getElementById('form-item-supplier');
  supSelect.innerHTML = '<option value="">بدون مورد محدد</option>';
  state.suppliers.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = `${s.name} (${s.phone || 'بدون هاتف'})`;
    supSelect.appendChild(opt);
  });

  const deleteBtn = document.getElementById('btn-delete-item');

  if (item) {
    document.getElementById('item-modal-title').textContent = 'تعديل صنف: ' + item.name;
    document.getElementById('form-item-id').value = item.id;
    document.getElementById('form-item-name').value = item.name;
    document.getElementById('form-item-sku').value = item.sku;
    document.getElementById('form-item-category').value = item.category_id || '';
    document.getElementById('form-item-specs').value = item.specs || '';
    document.getElementById('form-item-unit').value = item.unit || 'قطعة';
    document.getElementById('form-item-qty').value = item.quantity;
    document.getElementById('form-item-min').value = item.min_limit;
    document.getElementById('form-item-reorder').value = item.reorder_qty || 10;
    document.getElementById('form-item-cost').value = item.cost_price || 0;
    document.getElementById('form-item-supplier').value = item.supplier_id || '';
    document.getElementById('form-item-loc').value = item.storage_location || '';
    document.getElementById('form-item-expiry').value = item.expiry_date || '';
    document.getElementById('form-item-notes').value = item.notes || '';
    setConditionInForm(item.condition, item.condition_note);
    deleteBtn.style.display = 'inline-flex';
    deleteBtn.innerHTML = `${getSvgIcon('trash')} حذف أو أرشفة`;
    deleteBtn.onclick = () => {
      openDeleteItemModal(item);
    };
  } else {
    document.getElementById('item-modal-title').textContent = 'إضافة صنف جديد';
    document.getElementById('form-item-id').value = '';
    document.getElementById('form-item-name').value = '';
    document.getElementById('form-item-sku').value = '';
    document.getElementById('form-item-specs').value = '';
    document.getElementById('form-item-unit').value = 'قطعة';
    document.getElementById('form-item-qty').value = '0';
    document.getElementById('form-item-min').value = state.settings.default_min_threshold || 5;
    document.getElementById('form-item-reorder').value = '10';
    document.getElementById('form-item-cost').value = '0';
    document.getElementById('form-item-loc').value = '';
    document.getElementById('form-item-expiry').value = '';
    document.getElementById('form-item-notes').value = '';
    document.getElementById('form-item-category').value = state.categories[0]?.id || '';
    document.getElementById('form-item-supplier').value = '';
    setConditionInForm(CONFIG.DEFAULT_CONDITION, '');
    deleteBtn.style.display = 'none';
  }

  document.getElementById('btn-save-item').onclick = async () => {
    const name = document.getElementById('form-item-name').value.trim();
    if (!name) {
      showToast('اسم الصنف مطلوب', 'warning');
      return;
    }

    const itemData = {
      id: document.getElementById('form-item-id').value || undefined,
      name,
      sku: document.getElementById('form-item-sku').value.trim() || undefined,
      category_id: document.getElementById('form-item-category').value || null,
      specs: document.getElementById('form-item-specs').value.trim(),
      unit: document.getElementById('form-item-unit').value,
      quantity: parseFloat(document.getElementById('form-item-qty').value) || 0,
      min_limit: parseFloat(document.getElementById('form-item-min').value) || 5,
      reorder_qty: parseFloat(document.getElementById('form-item-reorder').value) || 10,
      cost_price: parseFloat(document.getElementById('form-item-cost').value) || 0,
      supplier_id: document.getElementById('form-item-supplier').value || null,
      storage_location: document.getElementById('form-item-loc').value.trim(),
      expiry_date: document.getElementById('form-item-expiry').value || null,
      notes: document.getElementById('form-item-notes').value.trim(),
      condition: normalizeCondition(document.querySelector('input[name="form-item-condition"]:checked')?.value),
      condition_note: document.getElementById('form-item-cond-note').value.trim(),
    };

    try {
      await InventoryAPI.saveItem(itemData);
      showToast('تم حفظ الصنف بنجاح', 'success');
      closeModal('item-form-modal');
      loadData();
    } catch (e) {
      showToast(e.message, 'error');
    }
  };

  openModal('item-form-modal');
}

// ----------------------------------------------------------------------------
// نافذة تأكيد حذف / أرشفة الصنف
// ----------------------------------------------------------------------------
function openDeleteItemModal(item) {
  let modal = document.getElementById('delete-item-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'delete-item-modal';
    modal.className = 'modal-overlay';
    document.body.appendChild(modal);
  }

  const movCount = state.movements.filter(m => m.item_id === item.id).length;

  modal.innerHTML = `
    <div class="modal-container" style="max-width: 480px;">
      <div class="modal-header">
        <h3 class="modal-title" style="color:var(--color-danger); display:flex; align-items:center; gap:8px;">
          ${getSvgIcon('trash')} حذف أو أرشفة الصنف
        </h3>
        <button class="modal-close" data-close-modal="delete-item-modal" aria-label="إغلاق">${getSvgIcon('x')}</button>
      </div>
      <div class="modal-body">
        <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:12px 16px; margin-bottom:16px;">
          <h4 style="font-weight:700; color:#0f172a; margin-bottom:4px;">${esc(item.name)}</h4>
          <div style="font-size:0.85rem; color:#64748b; display:flex; gap:16px; flex-wrap:wrap;">
            <span>الكود: <strong class="tabular-nums" style="color:#0f172a;">${esc(item.sku)}</strong></span>
            <span>الرصيد: <strong class="tabular-nums" style="color:#0f172a;">${item.quantity} ${esc(item.unit)}</strong></span>
            <span>سجل الحركات: <strong class="tabular-nums" style="color:#0f172a;">${movCount} حركة</strong></span>
          </div>
        </div>

        <p style="font-size:0.95rem; color:#334155; line-height:1.7; margin-bottom:16px;">
          اختر نوع الإجراء المطلوب لهذا الصنف:
        </p>

        <div style="display:flex; flex-direction:column; gap:12px;">
          <button class="btn btn-secondary" id="modal-btn-archive-item" style="justify-content:flex-start; text-align:right; padding:12px 16px; height:auto;">
            <div style="display:flex; align-items:flex-start; gap:10px; width:100%;">
              <div style="color:var(--color-primary); margin-top:2px;">${getSvgIcon('archive')}</div>
              <div>
                <strong style="display:block; color:#0f172a; font-size:1rem;">أرشفة الصنف (إخفاء من المخزون)</strong>
                <span style="font-size:0.85rem; color:#64748b; font-weight:normal; display:block; margin-top:2px;">
                  يخفي الصنف فوراً من قائمة المخزون النشطة وواجهة صاحب الاستوديو، مع الحفاظ على سجل الحركات التاريخية للتدقيق.
                </span>
              </div>
            </div>
          </button>

          <button class="btn btn-secondary text-danger" id="modal-btn-permanent-delete-item" style="justify-content:flex-start; text-align:right; padding:12px 16px; height:auto;">
            <div style="display:flex; align-items:flex-start; gap:10px; width:100%;">
              <div style="color:var(--color-danger); margin-top:2px;">${getSvgIcon('trash')}</div>
              <div>
                <strong style="display:block; color:var(--color-danger); font-size:1rem;">حذف نهائي من النظام</strong>
                <span style="font-size:0.85rem; color:#64748b; font-weight:normal; display:block; margin-top:2px;">
                  إزالة الصنف تماماً وسجلاته من قاعدة البيانات دون إمكانية استرجاعه.
                </span>
              </div>
            </div>
          </button>
        </div>
      </div>
      <div class="modal-footer" style="justify-content:flex-end;">
        <button class="btn btn-secondary" data-close-modal="delete-item-modal">إلغاء</button>
      </div>
    </div>
  `;

  document.getElementById('modal-btn-archive-item').onclick = async () => {
    try {
      await InventoryAPI.archiveItem(item.id, true);
      showToast(`تمت أرشفة "${item.name}" وإخفاؤه من المخزون بنجاح`, 'success');
      closeModal('delete-item-modal');
      closeModal('item-form-modal');
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  document.getElementById('modal-btn-permanent-delete-item').onclick = async () => {
    if (confirm(`تأكيد الحذف النهائي للصنف "${item.name}" وإزالته بالكامل؟`)) {
      try {
        await InventoryAPI.deleteItem(item.id, true);
        showToast(`تم حذف الصنف "${item.name}" نهائياً من النظام`, 'info');
        closeModal('delete-item-modal');
        closeModal('item-form-modal');
        loadData();
      } catch (err) {
        showToast(err.message, 'error');
      }
    }
  };

  openModal('delete-item-modal');
}

async function restoreArchivedItem(item) {
  try {
    await InventoryAPI.restoreItem(item.id);
    showToast(`تمت استعادة الصنف "${item.name}" إلى قائمة المخزون النشطة`, 'success');
    loadData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function confirmPermanentDelete(item) {
  if (confirm(`تأكيد الحذف النهائي للصنف "${item.name}"؟`)) {
    try {
      await InventoryAPI.deleteItem(item.id, true);
      showToast(`تم حذف الصنف "${item.name}" نهائياً`, 'info');
      loadData();
    } catch (err) {
      showToast(err.message, 'error');
    }
  }
}

// ============================================================================
// 5. واجهة الجرد (الجرد)
// ============================================================================

function renderStocktake() {
  const container = document.getElementById('stocktake-content');
  if (!container) return;

  const catFilter = document.getElementById('stocktake-cat-filter');
  const selectedCat = catFilter ? catFilter.value : 'all';

  if (catFilter && catFilter.children.length <= 1) {
    state.categories.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = c.name;
      catFilter.appendChild(opt);
    });
  }

  let items = state.items.filter(i => !i.is_archived);
  if (selectedCat !== 'all') {
    items = items.filter(i => i.category_id === selectedCat);
  }

  let rows = '';
  items.forEach(item => {
    const draftVal = state.stocktakeDraft[item.id] !== undefined ? state.stocktakeDraft[item.id] : item.quantity;
    const diff = draftVal - item.quantity;
    const diffColor = diff === 0 ? 'var(--status-available-text)' : diff > 0 ? '#0284c7' : 'var(--status-out-text)';
    const isAbnormal = Math.abs(diff) >= 5 && (item.quantity > 0 ? (Math.abs(diff) / item.quantity) >= 0.2 : true);

    rows += `
      <tr data-item-id="${esc(item.id)}">
        <td>
          <div style="font-weight:600;">${esc(item.name)}</div>
          <div style="font-size:0.8rem; color:#64748b;">${esc(item.specs || '')} (${esc(item.storage_location || 'بدون مكان')})</div>
        </td>
        <td style="font-weight:600;"><span class="tabular-nums">${item.quantity}</span> ${esc(item.unit)}</td>
        <td>
          <input type="number" class="form-control stocktake-actual-input tabular-nums" data-id="${esc(item.id)}" value="${draftVal}" step="any" min="0" style="width:110px;">
        </td>
        <td>
          <span class="stocktake-diff-span tabular-nums" data-id="${esc(item.id)}" style="font-weight:700; color:${diffColor};">
            ${diff > 0 ? '+' : ''}${diff} ${esc(item.unit)}
          </span>
          ${isAbnormal ? `<span class="badge-status badge-out" style="margin-right:6px;">${getSvgIcon('alert')} فرق كبير</span>` : ''}
        </td>
        <td>
          <input type="text" class="form-control stocktake-notes-input" data-id="${esc(item.id)}" placeholder="سبب الفرق..." style="font-size:0.85rem;">
        </td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th>الصنف والمكان</th>
            <th>الرصيد الدفتري</th>
            <th>الرصيد الفعلي</th>
            <th>فرق الجرد</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;

  container.querySelectorAll('.stocktake-actual-input').forEach(input => {
    input.oninput = () => {
      const id = input.dataset.id;
      const itm = state.items.find(i => i.id === id);
      if (!itm) return;

      const actual = parseFloat(input.value) || 0;
      state.stocktakeDraft[id] = actual;
      const diff = actual - itm.quantity;
      const diffSpan = container.querySelector(`.stocktake-diff-span[data-id="${id}"]`);
      if (diffSpan) {
        diffSpan.style.color = diff === 0 ? 'var(--status-available-text)' : diff > 0 ? '#0284c7' : 'var(--status-out-text)';
        diffSpan.textContent = `${diff > 0 ? '+' : ''}${diff} ${itm.unit}`;
      }
    };
  });
}

async function applyStocktakeProcess() {
  const inputs = document.querySelectorAll('.stocktake-actual-input');
  if (inputs.length === 0) {
    showToast('لا توجد بنود جرد لاعتمادها', 'warning');
    return;
  }

  const lines = [];
  let discrepancyCount = 0;

  inputs.forEach(input => {
    const id = input.dataset.id;
    const itm = state.items.find(i => i.id === id);
    if (itm) {
      const actual = parseFloat(input.value) || 0;
      const diff = actual - itm.quantity;
      const notesInput = document.querySelector(`.stocktake-notes-input[data-id="${id}"]`);
      const notes = notesInput ? notesInput.value.trim() : '';

      if (diff !== 0) discrepancyCount++;
      lines.push({
        item_id: id,
        actual_quantity: actual,
        notes
      });
    }
  });

  const confirmMsg = `تأكيد اعتماد نتيجة الجرد لعدد ${lines.length} صنف (عدد الفروق: ${discrepancyCount})؟`;
  if (!confirm(confirmMsg)) return;

  try {
    const stocktakeId = 'stk-' + Date.now();
    await InventoryAPI.applyStocktake(stocktakeId, lines, 'جرد دوري معتمد');
    showToast('تم اعتماد الجرد وتحديث المخزون بنجاح', 'success');
    state.stocktakeDraft = {};
    loadData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// 6. سجل الحركات (الحركات)
// ============================================================================

function renderMovements() {
  const container = document.getElementById('movements-table-container');
  if (!container) return;

  const typeFilter = document.getElementById('mov-type-filter')?.value || 'all';

  let filtered = state.movements;
  if (typeFilter !== 'all') {
    filtered = filtered.filter(m => m.type === typeFilter);
  }

  const typeMap = {
    supply: 'توريد',
    consume: 'صرف',
    damage: 'تالف',
    stocktake: 'تسوية جرد',
    correction: 'تصحيح',
    job_template: 'استهلاك شغل'
  };

  let rows = '';
  filtered.forEach(m => {
    const sign = m.change_amount > 0 ? '+' : '';
    const color = m.change_amount > 0 ? 'var(--status-available-text)' : 'var(--status-out-text)';

    rows += `
      <tr>
        <td><strong>${esc(m.items?.name || 'صنف')}</strong></td>
        <td><span style="font-size:0.85rem; background:#f1f5f9; padding:4px 8px; border-radius:4px; border:1px solid #e2e8f0;">${esc(typeMap[m.type] || m.type)}</span></td>
        <td class="tabular-nums">${m.quantity_before}</td>
        <td class="tabular-nums" style="font-weight:700; color:${color};">${sign}${m.change_amount}</td>
        <td class="tabular-nums"><strong>${m.quantity_after}</strong></td>
        <td>${esc(m.reason || '—')}</td>
        <td style="font-size:0.85rem; color:#64748b;">${formatCairoDate(m.created_at)}</td>
        <td style="font-size:0.8rem; color:#64748b;">${esc(m.created_by || 'editor')}</td>
      </tr>
    `;
  });

  container.innerHTML = `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th>الصنف</th>
            <th>نوع الحركة</th>
            <th>قبل</th>
            <th>الفرق</th>
            <th>بعد</th>
            <th>السبب</th>
            <th>التاريخ والوقت</th>
            <th>المستخدم</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

// ============================================================================
// 7. الإعدادات والرمز (الإعدادات) - بدون حقول اسم الاستوديو أو الشعار
// ============================================================================

function renderSettings() {
  document.getElementById('setting-min-threshold').value = state.settings.default_min_threshold || 5;
  document.getElementById('setting-hide-cost').checked = !!state.settings.hide_cost_from_owner;
  document.getElementById('setting-require-viewer-pin').checked = !!state.settings.require_viewer_pin;
  document.getElementById('setting-supabase-url').value = localStorage.getItem('STUDIO_SUPABASE_URL') || '';
  document.getElementById('setting-supabase-key').value = localStorage.getItem('STUDIO_SUPABASE_KEY') || '';
}

function setupSettingsActions() {
  const saveBtn = document.getElementById('btn-save-settings');
  if (saveBtn) {
    saveBtn.onclick = async () => {
      try {
        const default_min_threshold = parseInt(document.getElementById('setting-min-threshold').value, 10) || 5;
        const hide_cost_from_owner = document.getElementById('setting-hide-cost').checked;
        const prevUrl = localStorage.getItem('STUDIO_SUPABASE_URL') || '';
        const prevKey = localStorage.getItem('STUDIO_SUPABASE_KEY') || '';

        await InventoryAPI.updateSettings({
          default_min_threshold,
          hide_cost_from_owner,
          require_viewer_pin: document.getElementById('setting-require-viewer-pin').checked,
        });

        const supaUrl = document.getElementById('setting-supabase-url').value.trim();
        const supaKey = document.getElementById('setting-supabase-key').value.trim();
        if (supaUrl) localStorage.setItem('STUDIO_SUPABASE_URL', supaUrl);
        else localStorage.removeItem('STUDIO_SUPABASE_URL');
        if (supaKey) localStorage.setItem('STUDIO_SUPABASE_KEY', supaKey);
        else localStorage.removeItem('STUDIO_SUPABASE_KEY');

        showToast('تم حفظ الإعدادات بنجاح', 'success');
        // تغيير بيانات الربط يحتاج إعادة تحميل لإنشاء الاتصال من جديد
        if (supaUrl !== prevUrl || supaKey !== prevKey) {
          setTimeout(() => window.location.reload(), 800);
          return;
        }
        loadData();
      } catch (e) {
        showToast(e.message, 'error');
      }
    };
  }

  const changePinBtn = document.getElementById('btn-change-pin');
  if (changePinBtn) {
    changePinBtn.onclick = async () => {
      const currentPin = document.getElementById('current-pin-input').value.trim();
      const newPin = document.getElementById('new-pin-input').value.trim();
      const confirmPin = document.getElementById('confirm-new-pin-input').value.trim();

      if (!newPin || newPin.length < 6) {
        showToast('الرمز الجديد يجب ألا يقل عن 6 أرقام', 'warning');
        return;
      }
      if (newPin !== confirmPin) {
        showToast('الرمز الجديد غير متطابق مع تأكيد الرمز', 'warning');
        return;
      }

      try {
        await AuthAPI.changePin(currentPin, newPin, 'editor');
        showToast('تم تغيير الرمز بنجاح', 'success');
        document.getElementById('current-pin-input').value = '';
        document.getElementById('new-pin-input').value = '';
        document.getElementById('confirm-new-pin-input').value = '';
      } catch (e) {
        showToast(e.message, 'error');
      }
    };
  }

  const changeViewerPinBtn = document.getElementById('btn-change-viewer-pin');
  if (changeViewerPinBtn) {
    changeViewerPinBtn.onclick = async () => {
      const newPin = document.getElementById('new-viewer-pin-input').value.trim();
      if (InventoryAPI.isLiveSupabase()) {
        showToast('مع ربط Supabase يتم تغيير رمز العرض من لوحة Supabase (Authentication ثم Users)', 'warning', 5000);
        return;
      }
      if (!/^\d{6,8}$/.test(newPin)) {
        showToast('رمز العرض يجب أن يكون من 6 إلى 8 أرقام', 'warning');
        return;
      }
      localStorage.setItem('studio_viewer_pin', newPin);
      document.getElementById('new-viewer-pin-input').value = '';
      showToast('تم تغيير رمز واجهة العرض', 'success');
    };
  }

  const exportBackupBtn = document.getElementById('btn-export-json-backup');
  if (exportBackupBtn) {
    exportBackupBtn.onclick = async () => {
      try {
        const backup = await InventoryAPI.exportFullBackup();
        const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(backup, null, 2));
        const dlAnchor = document.createElement('a');
        dlAnchor.setAttribute('href', dataStr);
        dlAnchor.setAttribute('download', `نسخة_مخزون_${new Date().toISOString().slice(0, 10)}.json`);
        document.body.appendChild(dlAnchor);
        dlAnchor.click();
        dlAnchor.remove();
        showToast('تم تصدير النسخة الاحتياطية بنجاح', 'success');
      } catch (e) {
        showToast(e.message, 'error');
      }
    };
  }

  const importFile = document.getElementById('import-json-file');
  if (importFile) {
    importFile.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (event) => {
        try {
          const parsed = JSON.parse(event.target.result);
          if (confirm('تأكيد استعادة هذه النسخة الاحتياطية؟')) {
            await InventoryAPI.importFullBackup(parsed);
            showToast('تمت استعادة البيانات بنجاح', 'success');
            loadData();
          }
        } catch (err) {
          showToast('فشل قراءة ملف النسخة: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    };
  }

  const logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.onclick = async () => {
      if (confirm('تأكيد تسجيل الخروج؟')) {
        await AuthAPI.signOut();
        window.location.reload();
      }
    };
  }
}

// ============================================================================
// 8. وظائف إضافية في تبويب الأصناف: قوالب الشغل وقائمة النواقص
// ============================================================================

function setupAuxiliaryModals() {
  // زر فتح قوالب الشغل
  const btnOpenJobs = document.getElementById('btn-open-jobs-modal');
  if (btnOpenJobs) {
    btnOpenJobs.onclick = () => {
      const container = document.getElementById('jobs-modal-list');
      if (!container) return;

      let cards = '';
      state.jobTemplates.forEach(tpl => {
        let linesHtml = '';
        let canApply = true;
        tpl.lines.forEach(line => {
          const itm = state.items.find(i => i.id === line.item_id);
          const avail = itm && itm.quantity >= line.quantity;
          if (!avail) canApply = false;
          linesHtml += `
            <div style="display:flex; justify-content:space-between; font-size:0.85rem; padding:4px 0; border-bottom:1px dashed #e2e8f0;">
              <span>${esc(itm ? itm.name : 'صنف')}</span>
              <span class="tabular-nums" style="color:${avail ? '#0f172a' : 'var(--status-out-text)'};">
                ${line.quantity} ${esc(itm ? itm.unit : '')} (المتوفر: ${itm ? itm.quantity : 0})
              </span>
            </div>
          `;
        });

        cards += `
          <div style="background:#f8fafc; border:1px solid #e2e8f0; border-radius:8px; padding:16px; margin-bottom:12px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
              <h4 style="font-weight:700;">${esc(tpl.name)}</h4>
              <span class="badge-status ${canApply ? 'badge-available' : 'badge-out'}">${canApply ? 'جاهز' : 'نواقص'}</span>
            </div>
            <div style="margin-bottom:12px;">${linesHtml}</div>
            <div style="display:flex; gap:8px;">
              <input type="number" id="job-mult-${tpl.id}" class="form-control tabular-nums" value="1" min="1" style="width:70px; text-align:center;">
              <button class="btn btn-primary btn-sm" data-run-job="${tpl.id}" style="flex:1;">خصم استهلاك الشغل</button>
            </div>
          </div>
        `;
      });
      container.innerHTML = cards || '<p>لا توجد قوالب شغل</p>';

      container.querySelectorAll('button[data-run-job]').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.dataset.runJob;
          const mult = parseInt(document.getElementById(`job-mult-${id}`)?.value, 10) || 1;
          try {
            await InventoryAPI.applyJobTemplate(id, mult);
            showToast('تم خصم الاستهلاك بنجاح', 'success');
            closeModal('jobs-modal');
            loadData();
          } catch (e) {
            showToast(e.message, 'error');
          }
        };
      });

      openModal('jobs-modal');
    };
  }

  // زر قائمة النواقص والمشتريات
  const btnOpenShortages = document.getElementById('btn-open-shortages-modal');
  if (btnOpenShortages) {
    btnOpenShortages.onclick = () => {
      const container = document.getElementById('shortages-modal-list');
      if (!container) return;

      const shortages = state.items.filter(i => !i.is_archived && i.quantity <= i.min_limit);
      if (shortages.length === 0) {
        container.innerHTML = '<p style="text-align:center; padding:24px; color:var(--status-available-text);">المخزون مكتمل، لا توجد نواقص حاليا</p>';
        openModal('shortages-modal');
        return;
      }

      let rows = '';
      shortages.forEach(itm => {
        const sup = state.suppliers.find(s => s.id === itm.supplier_id);
        const needed = itm.reorder_qty || (itm.min_limit * 2);
        rows += `
          <tr>
            <td><strong>${esc(itm.name)}</strong> [${esc(itm.specs || '')}] ${itm.condition === 'poor' ? getConditionBadgeHtml('poor') : ''}</td>
            <td class="tabular-nums" style="color:var(--status-out-text); font-weight:700;">${itm.quantity} ${esc(itm.unit)}</td>
            <td class="tabular-nums">${itm.min_limit}</td>
            <td class="tabular-nums" style="font-weight:700;">${needed}</td>
            <td>${esc(sup ? sup.name : '—')}</td>
          </tr>
        `;
      });

      const orderLink = createPurchaseOrderMessage('', '', shortages);

      container.innerHTML = `
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <span>إجمالي الأصناف الناقصة: <strong class="tabular-nums">${shortages.length}</strong></span>
          <a href="${orderLink}" target="_blank" class="btn btn-primary btn-sm">${getSvgIcon('clipboard')} إرسال طلب للمورد</a>
        </div>
        <div class="table-responsive">
          <table class="data-table">
            <thead>
              <tr>
                <th>الصنف</th>
                <th>الرصيد</th>
                <th>الحد الأدنى</th>
                <th>المطلوب</th>
                <th>المورد</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      `;

      openModal('shortages-modal');
    };
  }
}

// ============================================================================
// 9. تهيئة التطبيق
// ============================================================================

function initApp() {
  setupTabs();
  setupSettingsActions();
  setupAuxiliaryModals();
  setupInactivityWatcher();

  const addBtns = document.querySelectorAll('.action-add-item');
  addBtns.forEach(btn => {
    btn.onclick = () => openItemFormModal(null);
  });

  const scanBtn = document.getElementById('btn-scan-barcode');
  if (scanBtn) {
    scanBtn.onclick = () => {
      openBarcodeScanner((detectedSku) => {
        const itm = state.items.find(i => i.sku?.trim().toUpperCase() === detectedSku.trim().toUpperCase());
        if (itm) {
          showToast(`تم العثور على الصنف: ${itm.name}`, 'success');
          openQuickAdjustModal(itm);
        } else {
          showToast(`لم يتم العثور على كود: ${detectedSku}`, 'warning');
        }
      });
    };
  }

  const searchInput = document.getElementById('inv-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      state.searchTerm = e.target.value.trim();
      renderItemsTable();
    };
  }

  const catSelect = document.getElementById('inv-filter-cat');
  if (catSelect) {
    catSelect.onchange = (e) => {
      state.selectedCategory = e.target.value;
      renderItemsTable();
    };
  }

  const condSelect = document.getElementById('inv-filter-cond');
  if (condSelect) {
    condSelect.onchange = (e) => {
      state.selectedCondition = e.target.value;
      renderItemsTable();
    };
  }

  const csvBtn = document.getElementById('btn-export-items-csv');
  if (csvBtn) {
    csvBtn.onclick = () => {
      const rows = state.items.filter(i => !i.is_archived).map(i => [
        i.sku, i.name, state.categories.find(c => c.id === i.category_id)?.name || '',
        i.specs || '', i.unit, i.quantity, i.min_limit, i.cost_price || 0,
        CONFIG.CONDITIONS[i.condition]?.label || '', i.condition_note || '',
        state.suppliers.find(s => s.id === i.supplier_id)?.name || '',
        i.storage_location || '', i.expiry_date || ''
      ]);
      exportCsv(`مخزون_${new Date().toISOString().slice(0, 10)}.csv`,
        ['الكود', 'الصنف', 'التصنيف', 'المواصفات', 'الوحدة', 'الكمية', 'الحد الأدنى', 'سعر التكلفة', 'حالة المنتج', 'ملاحظة الحالة', 'المورد', 'مكان التخزين', 'تاريخ الصلاحية'],
        rows);
      showToast('تم تصدير ملف CSV', 'success');
    };
  }

  const statusSelect = document.getElementById('inv-filter-status');
  if (statusSelect) {
    statusSelect.onchange = (e) => {
      state.selectedStatus = e.target.value;
      renderItemsTable();
    };
  }

  const stocktakeCat = document.getElementById('stocktake-cat-filter');
  if (stocktakeCat) {
    stocktakeCat.onchange = () => renderStocktake();
  }

  const applyStocktakeBtn = document.getElementById('btn-apply-stocktake');
  if (applyStocktakeBtn) {
    applyStocktakeBtn.onclick = () => applyStocktakeProcess();
  }

  const movTypeFilter = document.getElementById('mov-type-filter');
  if (movTypeFilter) {
    movTypeFilter.onchange = () => renderMovements();
  }

  InventoryAPI.subscribeRealtime(() => {
    loadData();
  });

  loadData();
}

document.addEventListener('DOMContentLoaded', () => {
  initPWA();

  const session = AuthAPI.checkSession('editor');
  if (session) {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-main').style.display = 'block';
    initApp();
  } else {
    document.getElementById('auth-screen').style.display = 'flex';
    document.getElementById('app-main').style.display = 'none';
    setupAuthScreen();
  }
});
