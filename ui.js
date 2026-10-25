/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { CONFIG } from './config.js';
import { makeQrSvg } from './qr.js';

// تهريب النصوص قبل إدخالها في HTML (حماية من XSS)
export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}


// ============================================================================
// 1. مكتبة أيقونات SVG خط رفيع مدمجة (بدون مكتبات وبدون إيموجي)
// ============================================================================

export function getSvgIcon(name, extraClass = '') {
  const icons = {
    box: '<path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path><polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline><line x1="12" y1="22.08" x2="12" y2="12"></line>',
    plus: '<line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line>',
    minus: '<line x1="5" y1="12" x2="19" y2="12"></line>',
    search: '<circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>',
    trash: '<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
    qr: '<rect x="3" y="3" width="7" height="7"></rect><rect x="14" y="3" width="7" height="7"></rect><rect x="3" y="14" width="7" height="7"></rect><rect x="14" y="14" width="3" height="3"></rect><rect x="18" y="18" width="3" height="3"></rect>',
    camera: '<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"></path><circle cx="12" cy="13" r="4"></circle>',
    check: '<polyline points="20 6 9 17 4 12"></polyline>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line>',
    x: '<line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line>',
    arrowRight: '<line x1="5" y1="12" x2="19" y2="12"></line><polyline points="12 5 19 12 12 19"></polyline>',
    arrowLeft: '<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>',
    refresh: '<polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>',
    settings: '<circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>',
    fileText: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>',
    clipboard: '<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path><rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>',
    undo: '<polyline points="1 4 1 10 7 10"></polyline><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"></path>',
    logOut: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>',
    upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line>',
    print: '<polyline points="6 9 6 2 18 2 18 9"></polyline><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path><rect x="6" y="14" width="12" height="8"></rect>',
    key: '<path d="M21 2l-2 2m-1.5 1.5L16 7l-2-2-1.5 1.5m-3 3l-1.5 1.5M7 17a5 5 0 1 1 7-7 5 5 0 0 1-7 7z"></path>',
    archive: '<polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line>',
  };

  const path = icons[name] || icons.box;
  return `<svg class="svg-icon ${extraClass}" viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
}

// ============================================================================
// 2. نظام التنبيهات (بدون إيموجي، مع أيقونة SVG متسقة)
// ============================================================================

export function showToast(message, type = 'info', duration = 3000) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const iconName = type === 'success' ? 'check' : type === 'error' ? 'x' : type === 'warning' ? 'alert' : 'box';
  toast.innerHTML = `${getSvgIcon(iconName)} <span>${esc(message)}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transition = 'opacity 180ms ease';
    setTimeout(() => toast.remove(), 200);
  }, duration);
}

// ============================================================================
// 3. إدارة النوافذ المنبثقة (Modals)
// ============================================================================

export function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.add('active');
    document.body.style.overflow = 'hidden';
  }
}

export function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) {
    modal.classList.remove('active');
    document.body.style.overflow = '';
  }
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('active');
    document.body.style.overflow = '';
  }
  const closeBtn = e.target.closest('[data-close-modal]');
  if (closeBtn) {
    closeModal(closeBtn.dataset.closeModal);
  }
});

// ============================================================================
// 4. التنسيقات (أرقام إنجليزية 0-9 مع tabular-nums)
// ============================================================================

export function formatCurrency(amount) {
  if (amount === null || amount === undefined || isNaN(amount)) return '—';
  const num = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `<span class="tabular-nums">${num}</span> ${CONFIG.LOCALE.CURRENCY}`;
}

export function formatNumber(num) {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return `<span class="tabular-nums">${new Intl.NumberFormat('en-US').format(num)}</span>`;
}

export function formatCairoDate(dateString, includeTime = true) {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    const options = {
      timeZone: CONFIG.LOCALE.TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    };
    if (includeTime) {
      options.hour = '2-digit';
      options.minute = '2-digit';
      options.hour12 = false;
    }
    // Using en-US to guarantee 0-9 English numerals
    const formatted = new Intl.DateTimeFormat('en-US', options).format(d);
    return `<span class="tabular-nums">${formatted}</span>`;
  } catch (e) {
    return dateString;
  }
}

// ============================================================================
// 5. عناصر الحالة وتوقعات النفاد (بدون إيموجي، مع كلمة مكتوبة صريحة)
// ============================================================================

export function getStatusBadgeHtml(status, quantity, unit = 'قطعة') {
  if (status === 'out_of_stock' || quantity <= 0) {
    return `<span class="badge-status badge-out">${getSvgIcon('alert')} نفد</span>`;
  }
  if (status === 'low') {
    return `<span class="badge-status badge-low">${getSvgIcon('alert')} قارب على النفاد</span>`;
  }
  return `<span class="badge-status badge-available">${getSvgIcon('check')} متوفر</span>`;
}

// شارة حالة المنتج (جيد / متوسط / سيئ) بمؤشر ثلاثة أعمدة + كلمة مكتوبة
export function getConditionBadgeHtml(condition) {
  const key = CONFIG.CONDITIONS[condition] ? condition : CONFIG.DEFAULT_CONDITION;
  const c = CONFIG.CONDITIONS[key];
  const bars = [1, 2, 3].map(i => `<i class="${i <= c.bars ? 'on' : ''}"></i>`).join('');
  return `<span class="badge-cond cond-${key}" title="${esc(c.hint)}"><span class="cond-bars" aria-hidden="true">${bars}</span>${esc(c.label)}</span>`;
}

export function conditionOptionsHtml(selected) {
  return Object.entries(CONFIG.CONDITIONS)
    .map(([key, c]) => `<option value="${key}" ${key === selected ? 'selected' : ''}>${esc(c.label)}</option>`)
    .join('');
}

export function normalizeCondition(value) {
  return CONFIG.CONDITIONS[value] ? value : CONFIG.DEFAULT_CONDITION;
}

export function calculateEstimatedDays(quantity, movements, itemId, windowDays = 30) {
  if (quantity <= 0) return 0;
  if (!movements || movements.length === 0) return null;

  const now = Date.now();
  const windowMs = windowDays * 24 * 60 * 60 * 1000;

  const itemMovements = movements.filter(m => {
    const itemMatch = m.item_id === itemId;
    const isConsume = m.change_amount < 0 && (m.type === 'consume' || m.type === 'job_template');
    const withinWindow = (now - new Date(m.created_at).getTime()) <= windowMs;
    return itemMatch && isConsume && withinWindow;
  });

  const totalConsumed = itemMovements.reduce((sum, m) => sum + Math.abs(m.change_amount), 0);
  if (totalConsumed <= 0) return null;

  const dailyBurn = totalConsumed / windowDays;
  if (dailyBurn <= 0) return null;

  return Math.max(1, Math.round(quantity / dailyBurn));
}

// ============================================================================
// 6. ملصق الصنف برمز QR حقيقي
// ============================================================================

export function generateQrSvg(text, size = 180) {
  return makeQrSvg(text, size);
}

export function showItemQrModal(item) {
  let modal = document.getElementById('qr-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'qr-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-container" style="max-width: 380px;">
        <div class="modal-header">
          <h3 class="modal-title">ملصق الصنف</h3>
          <button class="modal-close" data-close-modal="qr-modal" aria-label="إغلاق">${getSvgIcon('x')}</button>
        </div>
        <div class="modal-body" style="text-align:center;">
          <div class="qr-label" style="background:#ffffff; border:1px solid #cbd5e1; border-radius:8px; padding:16px;">
            <h4 id="qr-item-name" style="margin-bottom:4px; font-weight:700;"></h4>
            <div id="qr-item-sku" class="tabular-nums" style="color:#64748b; font-size:0.9rem; margin-bottom:12px;"></div>
            <div id="qr-svg-holder" style="display:flex; justify-content:center;"></div>
            <p id="qr-item-specs" style="margin-top:10px; font-size:0.85rem; color:#475569;"></p>
            <div id="qr-item-loc" style="font-size:0.8rem; color:#64748b; margin-top:4px;"></div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-primary btn-sm" id="btn-print-qr">${getSvgIcon('print')} طباعة</button>
          <button class="btn btn-secondary btn-sm" data-close-modal="qr-modal">إغلاق</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('btn-print-qr').addEventListener('click', () => {
      // طباعة الملصق وحده: نخفي باقي الصفحة أثناء الطباعة
      document.body.classList.add('print-label');
      const cleanup = () => {
        document.body.classList.remove('print-label');
        window.removeEventListener('afterprint', cleanup);
      };
      window.addEventListener('afterprint', cleanup);
      window.print();
    });
  }

  document.getElementById('qr-item-name').textContent = item.name;
  document.getElementById('qr-item-sku').textContent = `SKU: ${item.sku}`;
  document.getElementById('qr-item-specs').textContent = item.specs || '';
  document.getElementById('qr-item-loc').textContent = item.storage_location ? `المكان: ${item.storage_location}` : '';
  document.getElementById('qr-svg-holder').innerHTML = generateQrSvg(item.sku, 180);

  openModal('qr-modal');
}

// ============================================================================
// 7. ماسح الباركود بالكاميرا (بدون إيموجي)
// ============================================================================

let currentScannerStream = null;

export function openBarcodeScanner(onDetected) {
  let modal = document.getElementById('scanner-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'scanner-modal';
    modal.className = 'modal-overlay';
    modal.innerHTML = `
      <div class="modal-container" style="max-width: 440px;">
        <div class="modal-header">
          <h3 class="modal-title">مسح الرمز</h3>
          <button class="modal-close" id="btn-close-scanner" aria-label="إغلاق">${getSvgIcon('x')}</button>
        </div>
        <div class="modal-body">
          <div style="position:relative; width:100%; aspect-ratio:4/3; background:#0f172a; border-radius:8px; overflow:hidden; display:flex; align-items:center; justify-content:center;">
            <video id="scanner-video" playsinline autoplay muted style="width:100%; height:100%; object-fit:cover;"></video>
            <div style="position:absolute; inset:20%; border:2px dashed #ffffff; border-radius:8px; pointer-events:none;"></div>
          </div>
          <p style="text-align:center; font-size:0.85rem; color:#64748b; margin-top:8px;">
            وجه الكاميرا نحو باركود الصنف
          </p>

          <div style="margin-top:16px; border-top:1px solid #e2e8f0; padding-top:16px;">
            <label class="form-label" for="manual-sku-input">أو إدخال كود الصنف يدويا:</label>
            <div style="display:flex; gap:8px;">
              <input type="text" id="manual-sku-input" class="form-control" placeholder="مثال: PRN-1015">
              <button class="btn btn-primary" id="btn-submit-manual-sku">بحث</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById('btn-close-scanner').addEventListener('click', () => {
      closeBarcodeScanner();
    });
  }

  const video = document.getElementById('scanner-video');
  const manualInput = document.getElementById('manual-sku-input');
  const manualBtn = document.getElementById('btn-submit-manual-sku');

  manualBtn.onclick = () => {
    const val = manualInput.value.trim();
    if (val) {
      closeBarcodeScanner();
      onDetected(val);
    }
  };

  manualInput.onkeydown = (e) => {
    if (e.key === 'Enter') manualBtn.click();
  };

  openModal('scanner-modal');

  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    }).then(stream => {
      currentScannerStream = stream;
      video.srcObject = stream;
      video.play();

      if ('BarcodeDetector' in window) {
        const barcodeDetector = new window.BarcodeDetector({
          formats: ['qr_code', 'code_128', 'code_39', 'ean_13', 'ean_8']
        });

        const scanFrame = () => {
          if (!currentScannerStream) return;
          barcodeDetector.detect(video).then(barcodes => {
            if (barcodes.length > 0) {
              const code = barcodes[0].rawValue;
              closeBarcodeScanner();
              onDetected(code);
            } else {
              requestAnimationFrame(scanFrame);
            }
          }).catch(() => {
            requestAnimationFrame(scanFrame);
          });
        };
        requestAnimationFrame(scanFrame);
      }
    }).catch(err => {
      console.warn('Camera error:', err);
      showToast('تعذر الوصول للكاميرا، يرجى إدخال الكود يدويا', 'warning');
    });
  }
}

export function closeBarcodeScanner() {
  if (currentScannerStream) {
    currentScannerStream.getTracks().forEach(t => t.stop());
    currentScannerStream = null;
  }
  closeModal('scanner-modal');
}

// ============================================================================
// 8. تصدير CSV ومشاركة الطلبات (نص عادي بدون إيموجي)
// ============================================================================

export function exportCsv(filename, headers, rows) {
  let csvContent = '\uFEFF';
  csvContent += headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',') + '\r\n';

  rows.forEach(row => {
    csvContent += row.map(cell => `"${(cell ?? '').toString().replace(/"/g, '""')}"`).join(',') + '\r\n';
  });

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

// رسالة الطلب: نص عادي بدون أي إيموجي ومطابق للمواصفات
export function createPurchaseOrderMessage(supplierPhone, supplierName, itemsList) {
  let message = `خلص من المخزون\n`;
  if (supplierName) message += `المورد: ${supplierName}\n\n`;
  message += `الأصناف المطلوبة:\n`;

  itemsList.forEach((itm, idx) => {
    const qty = itm.neededQty || (itm.reorder_qty || (itm.min_limit * 2));
    message += `${idx + 1}. ${itm.name} [${itm.specs || ''}]\nالكمية: ${qty} ${itm.unit}\n`;
  });

  message += `\nيرجى تأكيد التوافر وموعد التوريد.`;

  let cleanPhone = (supplierPhone || '').replace(/\D/g, '');
  if (cleanPhone.startsWith('01')) cleanPhone = '2' + cleanPhone;

  const encoded = encodeURIComponent(message);
  return cleanPhone ? `https://wa.me/${cleanPhone}?text=${encoded}` : `https://wa.me/?text=${encoded}`;
}

// ============================================================================
// 9. PWA وحالة الاتصال
// ============================================================================

export function initPWA() {
  // اطلب من المتصفح عدم مسح بيانات التطبيق تلقائيا عند امتلاء مساحة الجهاز
  try {
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  } catch (e) { /* غير مدعوم */ }

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(err => {
        console.warn('SW issue:', err);
      });
    });
  }

  const updateOnlineStatus = () => {
    const banners = document.querySelectorAll('.offline-banner');
    banners.forEach(b => {
      if (!navigator.onLine) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
  };

  window.addEventListener('online', updateOnlineStatus);
  window.addEventListener('offline', updateOnlineStatus);
  updateOnlineStatus();
}
