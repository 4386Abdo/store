/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CONFIG } from './config.js';
import { AuthAPI, InventoryAPI } from './api.js';
import {
  showToast,
  formatCurrency,
  formatNumber,
  formatCairoDate,
  getStatusBadgeHtml,
  calculateEstimatedDays,
  initPWA,
  esc,
  getConditionBadgeHtml
} from './ui.js';

const state = {
  items: [],
  categories: [],
  movements: [],
  stocktakes: [],
  settings: {},
  searchTerm: '',
  selectedCategory: 'all',
  selectedStatus: 'all',
  selectedCondition: 'all',
  pinInput: '',
};

function checkViewerAuth() {
  if (!state.settings.require_viewer_pin) {
    document.getElementById('owner-auth-screen').style.display = 'none';
    document.getElementById('owner-main-screen').style.display = 'flex';
    renderOwnerDashboard();
    return;
  }

  const session = AuthAPI.checkSession('viewer') || AuthAPI.checkSession('editor');
  if (session) {
    document.getElementById('owner-auth-screen').style.display = 'none';
    document.getElementById('owner-main-screen').style.display = 'flex';
    renderOwnerDashboard();
  } else {
    document.getElementById('owner-auth-screen').style.display = 'flex';
    document.getElementById('owner-main-screen').style.display = 'none';
    setupViewerPinPad();
  }
}

function setupViewerPinPad() {
  const pinDots = document.querySelectorAll('.viewer-pin-dot');
  const errorMsg = document.getElementById('viewer-auth-error');

  function updateDots() {
    pinDots.forEach((dot, idx) => {
      if (idx < state.pinInput.length) dot.classList.add('filled');
      else dot.classList.remove('filled');
    });
  }

  document.querySelectorAll('.viewer-keypad-btn').forEach(btn => {
    btn.onclick = async () => {
      const val = btn.dataset.val;
      if (val === 'clear') {
        state.pinInput = '';
        updateDots();
      } else if (val === 'backspace') {
        state.pinInput = state.pinInput.slice(0, -1);
        updateDots();
      } else if (val && state.pinInput.length < 8) {
        state.pinInput += val;
        updateDots();
        if (state.pinInput.length >= 6) {
          try {
            errorMsg.textContent = 'جار التحقق...';
            await AuthAPI.signInWithPin(state.pinInput, 'viewer');
            document.getElementById('owner-auth-screen').style.display = 'none';
            document.getElementById('owner-main-screen').style.display = 'flex';
            renderOwnerDashboard();
          } catch (e) {
            errorMsg.textContent = e.message;
            state.pinInput = '';
            updateDots();
          }
        }
      }
    };
  });
}

async function loadOwnerData() {
  try {
    state.settings = await InventoryAPI.getSettings();
    state.categories = await InventoryAPI.getCategories();
    state.items = await InventoryAPI.getItems();
    state.movements = await InventoryAPI.getMovements(50);
    state.stocktakes = await InventoryAPI.getStocktakes();

    const lastStocktake = state.stocktakes.length > 0 ? state.stocktakes[0] : null;
    const lastStkEl = document.getElementById('last-stocktake-info');
    if (lastStkEl) {
      if (lastStocktake && lastStocktake.completed_at) {
        lastStkEl.innerHTML = `آخر جرد: ${formatCairoDate(lastStocktake.completed_at, false)}`;
      } else {
        lastStkEl.textContent = 'لم يسجل جرد بعد';
      }
    }

    renderOwnerDashboard();
  } catch (err) {
    showToast('تعذر تحميل البيانات: ' + err.message, 'error');
  }
}

function renderOwnerDashboard() {
  const items = state.items;
  const hideCost = !!state.settings.hide_cost_from_owner;

  const totalItems = items.length;
  const lowItems = items.filter(i => i.quantity > 0 && i.quantity <= i.min_limit);
  const outItems = items.filter(i => i.quantity <= 0);
  const totalValuation = items.reduce((sum, i) => sum + (i.quantity * (i.cost_price || 0)), 0);

  document.getElementById('owner-total-count').innerHTML = formatNumber(totalItems);
  document.getElementById('owner-low-count').innerHTML = formatNumber(lowItems.length);
  document.getElementById('owner-out-count').innerHTML = formatNumber(outItems.length);

  const costCard = document.getElementById('owner-valuation-card');
  if (costCard) {
    if (hideCost) {
      costCard.style.display = 'none';
    } else {
      costCard.style.display = 'flex';
      document.getElementById('owner-valuation-amount').innerHTML = formatCurrency(totalValuation);
    }
  }

  const poorCount = items.filter(i => i.condition === 'poor').length;
  const fairCount = items.filter(i => i.condition === 'fair').length;
  document.getElementById('owner-cond-bad').innerHTML = formatNumber(poorCount + fairCount);
  document.getElementById('owner-cond-bad-sub').textContent = `${poorCount} سيئة، ${fairCount} متوسطة`;

  renderUrgentItemsSection(lowItems, outItems);
  renderAllItemsList(hideCost);
  renderAuditStream();
}

function renderUrgentItemsSection(lowItems, outItems) {
  const container = document.getElementById('urgent-items-container');
  const section = document.getElementById('urgent-section');
  if (!container || !section) return;

  const allUrgent = [...outItems, ...lowItems];

  if (allUrgent.length === 0) {
    section.style.display = 'none';
    return;
  }

  section.style.display = 'block';

  let cards = '';
  allUrgent.forEach(item => {
    const isOut = item.quantity <= 0;
    const days = calculateEstimatedDays(item.quantity, state.movements, item.id);
    const catName = esc(state.categories.find(c => c.id === item.category_id)?.name || '');

    cards += `
      <div class="urgent-card" style="border-right: 4px solid ${isOut ? 'var(--status-out-text)' : 'var(--status-low-text)'};">
        <div>
          <h4 style="font-weight:700;">${esc(item.name)}</h4>
          <div style="font-size:0.85rem; color:#475569;">${esc(item.specs || '')} ${catName ? '• ' + catName : ''}</div>
          <div style="font-size:0.8rem; color:#64748b; margin-top:2px;">
            المكان: ${esc(item.storage_location || 'المخزن')} | الحد الأدنى: <span class="tabular-nums">${item.min_limit}</span> ${esc(item.unit)}
            ${item.condition && item.condition !== 'good' ? '<div style="margin-top:6px;">' + getConditionBadgeHtml(item.condition) + '</div>' : ''}
          </div>
        </div>
        <div class="urgent-badge ${isOut ? 'out' : 'low'}">
          <div style="font-size:1.15rem; font-weight:700;" class="tabular-nums">${item.quantity} ${esc(item.unit)}</div>
          <div style="font-size:0.8rem;">${isOut ? 'نفد' : 'قارب على النفاد'}</div>
          ${days !== null && !isOut ? `<div style="font-size:0.75rem; margin-top:2px;">يكفي <span class="tabular-nums">${days}</span> يوم</div>` : ''}
        </div>
      </div>
    `;
  });

  container.innerHTML = cards;
}

function renderAllItemsList(hideCost) {
  const container = document.getElementById('owner-items-table-container');
  if (!container) return;

  const catFilter = document.getElementById('owner-cat-filter');
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
      (item.specs && item.specs.toLowerCase().includes(state.searchTerm.toLowerCase()));

    const matchesCat = state.selectedCategory === 'all' || item.category_id === state.selectedCategory;
    const matchesCond = state.selectedCondition === 'all' || item.condition === state.selectedCondition;

    let matchesStatus = true;
    if (state.selectedStatus === 'available') matchesStatus = item.quantity > item.min_limit;
    else if (state.selectedStatus === 'low') matchesStatus = item.quantity > 0 && item.quantity <= item.min_limit;
    else if (state.selectedStatus === 'out') matchesStatus = item.quantity <= 0;

    return matchesSearch && matchesCat && matchesCond && matchesStatus;
  });

  if (filtered.length === 0) {
    container.innerHTML = '<p style="color:#64748b; text-align:center; padding:32px;">لا توجد أصناف مطابقة</p>';
    return;
  }

  let rows = '';
  filtered.forEach(item => {
    const days = calculateEstimatedDays(item.quantity, state.movements, item.id);
    const catName = esc(state.categories.find(c => c.id === item.category_id)?.name || 'عام');
    const daysText = days !== null ? `يكفي <span class="tabular-nums">${days}</span> يوم` : '—';

    rows += `
      <tr>
        <td>
          <div style="font-weight:600; color:#0f172a;">${esc(item.name)}</div>
          <div style="font-size:0.8rem; color:#64748b;" class="tabular-nums">${esc(item.specs || '')} [${esc(item.sku)}]</div>
        </td>
        <td><span style="font-size:0.85rem; background:#f1f5f9; padding:4px 10px; border-radius:6px; border:1px solid #e2e8f0;">${catName}</span></td>
        <td>
          <strong style="font-size:1.1rem;" class="tabular-nums">
            ${item.quantity} ${esc(item.unit)}
          </strong>
        </td>
        <td>${getStatusBadgeHtml(item.status, item.quantity, item.unit)}</td>
        <td>${getConditionBadgeHtml(item.condition)}${item.condition_note ? `<span class="cond-note">${esc(item.condition_note)}</span>` : ''}</td>
        <td style="font-size:0.85rem; color:#475569;">${daysText}</td>
        ${!hideCost ? `<td>${formatCurrency(item.cost_price)}</td>` : ''}
        ${!hideCost ? `<td><strong>${formatCurrency(item.quantity * (item.cost_price || 0))}</strong></td>` : ''}
        <td style="font-size:0.85rem; color:#64748b;">${esc(item.storage_location || '—')}</td>
      </tr>
    `;
  });

  const costHeaders = !hideCost ? '<th>سعر التكلفة</th><th>القيمة الإجمالية</th>' : '';

  container.innerHTML = `
    <div class="table-responsive">
      <table class="data-table">
        <thead>
          <tr>
            <th>الصنف والمواصفات</th>
            <th>التصنيف</th>
            <th>الرصيد الفعلي</th>
            <th>حالة المخزون</th>
            <th>حالة المنتج</th>
            <th>الوقت المتوقع للنفاد</th>
            ${costHeaders}
            <th>مكان التخزين</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  `;
}

function renderAuditStream() {
  const container = document.getElementById('owner-recent-movements');
  if (!container) return;

  const recents = state.movements.slice(0, 5);
  if (recents.length === 0) {
    container.innerHTML = '<p style="color:#64748b; font-size:0.85rem;">لا توجد حركات مسجلة</p>';
    return;
  }

  let itemsHtml = '';
  recents.forEach(m => {
    const itm = state.items.find(i => i.id === m.item_id);
    const sign = m.change_amount > 0 ? '+' : '';
    const color = m.change_amount > 0 ? 'var(--status-available-text)' : 'var(--status-out-text)';

    itemsHtml += `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid #e2e8f0; font-size:0.9rem;">
        <div>
          <strong>${esc(itm ? itm.name : 'صنف')}</strong>
          <span style="color:#64748b; font-size:0.8rem; margin-right:4px;">(${esc(m.reason || m.type)})</span>
        </div>
        <div style="display:flex; align-items:center; gap:12px;">
          <span style="font-weight:700; color:${color};" class="tabular-nums">${sign}${m.change_amount}</span>
          <span style="font-size:0.8rem; color:#64748b;">${formatCairoDate(m.created_at)}</span>
        </div>
      </div>
    `;
  });

  container.innerHTML = itemsHtml;
}

document.addEventListener('DOMContentLoaded', async () => {
  initPWA();
  await loadOwnerData();
  checkViewerAuth();

  InventoryAPI.subscribeRealtime(() => {
    loadOwnerData();
  });

  const searchInput = document.getElementById('owner-search');
  if (searchInput) {
    searchInput.oninput = (e) => {
      state.searchTerm = e.target.value.trim();
      renderAllItemsList(state.settings.hide_cost_from_owner);
    };
  }

  const catFilter = document.getElementById('owner-cat-filter');
  if (catFilter) {
    catFilter.onchange = (e) => {
      state.selectedCategory = e.target.value;
      renderAllItemsList(state.settings.hide_cost_from_owner);
    };
  }

  const condFilter = document.getElementById('owner-cond-filter');
  if (condFilter) {
    condFilter.onchange = (e) => {
      state.selectedCondition = e.target.value;
      renderAllItemsList(state.settings.hide_cost_from_owner);
    };
  }

  const statusFilter = document.getElementById('owner-status-filter');
  if (statusFilter) {
    statusFilter.onchange = (e) => {
      state.selectedStatus = e.target.value;
      renderAllItemsList(state.settings.hide_cost_from_owner);
    };
  }

  const refreshBtn = document.getElementById('btn-owner-refresh');
  if (refreshBtn) {
    refreshBtn.onclick = () => {
      loadOwnerData();
      showToast('تم تحديث البيانات', 'info');
    };
  }
});
